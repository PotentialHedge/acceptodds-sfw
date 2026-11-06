import { createHash } from 'node:crypto';
import { z } from 'zod';
import { EngineError } from '../errors';
import { rateLimitHeaders } from '../ratelimit';
import type { Principal } from '../auth';
import { ApiError, fromEngineError, type ApiErrorCode } from './errors';

/**
 * The HTTP edge of `/api/v1`: one error shape, `Cache-Control: no-store` on
 * everything, and Zod on the way in and on the way out.
 */

/**
 * The header carrying the real client IP. Exported for configuration that must
 * name it (Better Auth's rate limiter); code that needs the IP calls
 * `clientIp()`.
 */
// The one sanctioned spelling; see the lint rule in eslint.config.mjs.
// eslint-disable-next-line no-restricted-syntax
export const CLIENT_IP_HEADER = 'cf-connecting-ip';

/**
 * The client's IP address. **The only place that reads it.**
 *
 * Every request reaches the origin from a Cloudflare proxy, so the socket
 * address is Cloudflare's and `X-Forwarded-For` is whatever the client chose
 * to send. The real client is `Cf-Connecting-Ip`, and that header is only
 * trustworthy because the origin refuses non-Cloudflare sources (§11 —
 * `cfonly` on the shared Traefik). Never key anything on `X-Forwarded-For` or
 * on the socket.
 *
 * `null` when the header is absent (local dev, tests).
 */
export function clientIp(req: Request): string | null {
  const ip = req.headers.get(CLIENT_IP_HEADER)?.trim();
  return ip ? ip : null;
}

const BASE_HEADERS: Record<string, string> = {
  // A cached quote or portfolio served to the wrong trader is a correctness
  // bug. Cloudflare also bypasses cache for /api/* (§11); this is the braces.
  'Cache-Control': 'no-store',
};

export function errorResponse(
  status: number,
  code: ApiErrorCode,
  message: string,
  details?: Record<string, unknown>,
  headers: Record<string, string> = {},
): Response {
  const body: { error: { code: ApiErrorCode; message: string; details?: Record<string, unknown> } } = {
    error: { code, message },
  };
  if (details !== undefined) body.error.details = details;
  return Response.json(body, { status, headers: { ...BASE_HEADERS, ...headers } });
}

function zodDetails(err: z.ZodError): Record<string, unknown> {
  return {
    issues: err.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })),
  };
}

/**
 * Validate a response body against its schema and send it. A response that
 * does not match the contract is a bug on our side, and it becomes a 500
 * rather than a surprise in a client.
 */
export function respond<S extends z.ZodType>(
  schema: S,
  body: z.input<S>,
  init: { status?: number; principal?: Principal | null; headers?: Record<string, string> } = {},
): Response {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    console.error('response failed its schema', zodDetails(parsed.error));
    throw new ApiError(500, 'internal_error', 'response failed validation');
  }
  const rl = init.principal?.rateLimit;
  return Response.json(parsed.data, {
    status: init.status ?? 200,
    headers: { ...BASE_HEADERS, ...(rl ? rateLimitHeaders(rl) : {}), ...init.headers },
  });
}

/** A body validated and serialised once, to be sent many times (`preparedResponse`). */
export interface Prepared {
  json: string;
  etag: string;
}

/**
 * `respond`'s validation and serialisation, done once for a cached body
 * (`map-cache.ts`). Never compressed here: since 16.4 Next drops a route
 * handler's `Content-Encoding`, so a body encoded here reaches the browser as
 * bytes it cannot read. Nothing in the app compresses these; that is for the proxy.
 */
export async function prepare<S extends z.ZodType>(schema: S, body: z.input<S>): Promise<Prepared> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    console.error('response failed its schema', zodDetails(parsed.error));
    throw new ApiError(500, 'internal_error', 'response failed validation');
  }
  const json = JSON.stringify(parsed.data);
  return { json, etag: `"${createHash('sha1').update(json).digest('base64url')}"` };
}

/**
 * Send a prepared body, or `304` with no body when the client already holds
 * it (`If-None-Match`): a revalidation then costs neither a query nor the
 * transfer.
 */
export function preparedResponse(
  req: Request,
  prepared: Prepared,
  init: { principal?: Principal | null; headers?: Record<string, string> } = {},
): Response {
  const rl = init.principal?.rateLimit;
  const headers: Record<string, string> = {
    ...BASE_HEADERS,
    ...(rl ? rateLimitHeaders(rl) : {}),
    ...init.headers,
    ETag: prepared.etag,
  };
  const held = req.headers.get('if-none-match');
  if (held && held.split(',').some((t) => t.trim().replace(/^W\//, '') === prepared.etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(prepared.json, { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } });
}

export async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.output<S>> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new ApiError(400, 'validation_error', 'request body must be JSON');
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError(400, 'validation_error', 'invalid request body', zodDetails(parsed.error));
  }
  return parsed.data;
}

export function parseQuery<S extends z.ZodType>(req: Request, schema: S): z.output<S> {
  const params = Object.fromEntries(new URL(req.url).searchParams);
  const parsed = schema.safeParse(params);
  if (!parsed.success) {
    throw new ApiError(400, 'validation_error', 'invalid query', zodDetails(parsed.error));
  }
  return parsed.data;
}

export function parseParam<S extends z.ZodType>(value: unknown, schema: S, name: string): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(400, 'validation_error', `invalid path parameter "${name}"`, zodDetails(parsed.error));
  }
  return parsed.data;
}

type Params = Record<string, string | string[]>;
type RouteContext = { params: Promise<Params> };

/**
 * Wrap a route handler: every thrown error becomes the one error shape.
 * Handlers throw `ApiError` or let an `EngineError` through; anything else is
 * a 500 whose details stay in the server log.
 */
export function route(
  fn: (req: Request, params: Params) => Promise<Response>,
): (req: Request, ctx: RouteContext) => Promise<Response> {
  return async (req, ctx) => {
    try {
      const params = ctx?.params ? await ctx.params : {};
      return await fn(req, params);
    } catch (err) {
      if (err instanceof ApiError) {
        return errorResponse(err.status, err.code, err.message, err.details, err.headers);
      }
      if (err instanceof EngineError) {
        const api = fromEngineError(err);
        return errorResponse(api.status, api.code, api.message, api.details);
      }
      console.error(err);
      return errorResponse(500, 'internal_error', 'internal error');
    }
  };
}

export function toIso(d: Date): string {
  return d.toISOString();
}

export function toIsoOrNull(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
type Method = (typeof METHODS)[number];

/**
 * Handlers for the methods a route does *not* support, so that a wrong method
 * still gets the one error shape (and an `Allow` header) rather than Next's
 * empty 405. Spread into a route file:
 * `export const { PUT, PATCH, DELETE } = methodNotAllowed('GET', 'POST');`
 */
export function methodNotAllowed(...allowed: Method[]): Record<Method, (req: Request) => Response> {
  const handler = (req: Request) =>
    errorResponse(405, 'method_not_allowed', `${req.method} is not allowed here`, undefined, {
      Allow: allowed.join(', '),
    });
  return Object.fromEntries(METHODS.map((m) => [m, handler])) as Record<Method, (req: Request) => Response>;
}
