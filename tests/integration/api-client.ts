import * as listingReadRoute from '@/app/api/v1/listings/[id]/read/route';
import * as groupReadingListRoute from '@/app/api/v1/groups/[id]/reading-list/route';
import * as groupReadingItemRoute from '@/app/api/v1/groups/[id]/reading-list/[listingId]/route';
/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are checked field by field */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { user } from '@/db/auth-schema';
import { accounts, type TokenScope } from '@/db/schema';
import { createAccount } from '@/server/accounts';
import { clearDevOutbox, devOutbox } from '@/server/mail';
import { mintToken } from '@/server/tokens';
import { MAIL_LINK_TARGETS, SIGN_IN_LINK_PATH } from '@/lib/links';
import * as authRoute from '@/app/api/auth/[...all]/route';
import * as marketsRoute from '@/app/api/v1/markets/route';
import * as marketRoute from '@/app/api/v1/markets/[id]/route';
import * as historyRoute from '@/app/api/v1/markets/[id]/history/route';
import * as ordersRoute from '@/app/api/v1/markets/[id]/orders/route';
import * as quoteRoute from '@/app/api/v1/markets/[id]/quote/route';
import * as commentsRoute from '@/app/api/v1/markets/[id]/comments/route';
import * as backingRoute from '@/app/api/v1/comments/[id]/backing/route';
import * as repliesRoute from '@/app/api/v1/comments/[id]/replies/route';
import * as closeRoute from '@/app/api/v1/markets/[id]/close/route';
import * as settleRoute from '@/app/api/v1/markets/[id]/settle/route';
import * as listingsRoute from '@/app/api/v1/listings/route';
import * as listingRoute from '@/app/api/v1/listings/[id]/route';
import * as listingFollowRoute from '@/app/api/v1/listings/[id]/follow/route';
import * as listingCommentsRoute from '@/app/api/v1/listings/[id]/comments/route';
import * as listingCommentRepliesRoute from '@/app/api/v1/listings/[id]/comments/[commentId]/replies/route';
import * as listingReactionsRoute from '@/app/api/v1/listings/[id]/reactions/route';
import * as listingReactionRoute from '@/app/api/v1/listings/[id]/reactions/[emoji]/route';
import * as listingOrdersRoute from '@/app/api/v1/listings/[id]/orders/route';
import * as listingMarketRoute from '@/app/api/v1/listings/[id]/market/route';
import * as listingTextRoute from '@/app/api/v1/listings/[id]/text/route';
import * as listingClosedRoute from '@/app/api/v1/listings/[id]/closed/route';
import * as listingViewRoute from '@/app/api/v1/listings/[id]/view/route';
import * as listingCitationsRoute from '@/app/api/v1/listings/[id]/citations/route';
import * as listingRelatedRoute from '@/app/api/v1/listings/[id]/related/route';
import * as listingMinimapRoute from '@/app/api/v1/listings/[id]/minimap/route';
import * as mapRoute from '@/app/api/v1/map/route';
import * as mapSearchRoute from '@/app/api/v1/map/search/route';
import * as mapRelatedRoute from '@/app/api/v1/map/related/route';
import * as mapTitlesRoute from '@/app/api/v1/map/titles/route';
import * as announcementsRoute from '@/app/api/v1/announcements/route';
import * as announcementRoute from '@/app/api/v1/announcements/[id]/route';
import * as transitionsRoute from '@/app/api/v1/transitions/route';
import * as versionRoute from '@/app/api/v1/version/route';
import * as myFollowsRoute from '@/app/api/v1/me/follows/route';
import * as myMentionsRoute from '@/app/api/v1/me/mentions/route';
import * as groupsRoute from '@/app/api/v1/groups/route';
import * as groupJoinRoute from '@/app/api/v1/groups/join/route';
import * as groupRoute from '@/app/api/v1/groups/[id]/route';
import * as groupInviteRoute from '@/app/api/v1/groups/[id]/invite/route';
import * as groupMemberRoute from '@/app/api/v1/groups/[id]/members/[handle]/route';
import * as myGroupsRoute from '@/app/api/v1/me/groups/route';
import * as leaderboardRoute from '@/app/api/v1/leaderboard/route';
import * as accountRoute from '@/app/api/v1/accounts/[handle]/route';
import * as accountPositionsRoute from '@/app/api/v1/accounts/[handle]/positions/route';
import * as publicPositionRoute from '@/app/api/v1/positions/[id]/route';
import * as myPositionPublicRoute from '@/app/api/v1/me/positions/[outcomeId]/public/route';
import * as meRoute from '@/app/api/v1/me/route';
import * as portfolioRoute from '@/app/api/v1/me/portfolio/route';
import * as myOrdersRoute from '@/app/api/v1/me/orders/route';
import * as tokensRoute from '@/app/api/v1/me/tokens/route';
import * as tokenRoute from '@/app/api/v1/me/tokens/[id]/route';
import * as affiliationsRoute from '@/app/api/v1/me/affiliations/route';
import * as affiliationRoute from '@/app/api/v1/me/affiliations/[id]/route';
import * as affiliationVerifyRoute from '@/app/api/v1/me/affiliations/[id]/verify/route';
import * as myPasswordRoute from '@/app/api/v1/me/password/route';
import * as agentCodeRoute from '@/app/api/v1/agent/code/route';
import * as myAgentCodeRoute from '@/app/api/v1/me/agent-code/route';
import * as agentTokenRoute from '@/app/api/v1/agent/token/route';
import * as myPendingBetRoute from '@/app/api/v1/me/pending-bet/route';
import * as onboardingRoute from '@/app/api/v1/onboarding/route';
import * as openapiRoute from '@/app/api/v1/openapi.json/route';
import * as fallbackRoute from '@/app/api/v1/[...rest]/route';

/**
 * Calls the real route modules under `src/app/api/v1` with real `Request`
 * objects and returns real `Response`s — the same objects Next hands them —
 * without starting a server. The route table mirrors the file system.
 */

type Mod = Record<string, unknown>;

const ROUTES: [pattern: string, mod: Mod][] = [
  ['/openapi.json', openapiRoute],
  ['/markets', marketsRoute],
  ['/markets/[id]', marketRoute],
  ['/markets/[id]/history', historyRoute],
  ['/markets/[id]/orders', ordersRoute],
  ['/markets/[id]/quote', quoteRoute],
  ['/markets/[id]/comments', commentsRoute],
  ['/comments/[id]/backing', backingRoute],
  ['/comments/[id]/replies', repliesRoute],
  ['/markets/[id]/close', closeRoute],
  ['/markets/[id]/settle', settleRoute],
  ['/listings', listingsRoute],
  ['/listings/[id]', listingRoute],
  ['/listings/[id]/read', listingReadRoute],
  ['/groups/[id]/reading-list', groupReadingListRoute],
  ['/groups/[id]/reading-list/[listingId]', groupReadingItemRoute],
  ['/listings/[id]/follow', listingFollowRoute],
  ['/listings/[id]/comments', listingCommentsRoute],
  ['/listings/[id]/comments/[commentId]/replies', listingCommentRepliesRoute],
  ['/listings/[id]/reactions', listingReactionsRoute],
  ['/listings/[id]/reactions/[emoji]', listingReactionRoute],
  ['/listings/[id]/orders', listingOrdersRoute],
  ['/listings/[id]/market', listingMarketRoute],
  ['/listings/[id]/text', listingTextRoute],
  ['/listings/[id]/closed', listingClosedRoute],
  ['/listings/[id]/view', listingViewRoute],
  ['/listings/[id]/citations', listingCitationsRoute],
  ['/listings/[id]/related', listingRelatedRoute],
  ['/listings/[id]/minimap', listingMinimapRoute],
  ['/map', mapRoute],
  ['/map/search', mapSearchRoute],
  ['/map/related', mapRelatedRoute],
  ['/map/titles', mapTitlesRoute],
  ['/announcements', announcementsRoute],
  ['/announcements/[id]', announcementRoute],
  ['/transitions', transitionsRoute],
  ['/version', versionRoute],
  ['/leaderboard', leaderboardRoute],
  ['/groups', groupsRoute],
  // A static segment wins over a dynamic one, as in Next.
  ['/groups/join', groupJoinRoute],
  ['/groups/[id]', groupRoute],
  ['/groups/[id]/invite', groupInviteRoute],
  ['/groups/[id]/members/[handle]', groupMemberRoute],
  ['/accounts/[handle]', accountRoute],
  ['/accounts/[handle]/positions', accountPositionsRoute],
  ['/positions/[id]', publicPositionRoute],
  ['/me/positions/[outcomeId]/public', myPositionPublicRoute],
  ['/me', meRoute],
  ['/me/portfolio', portfolioRoute],
  ['/me/orders', myOrdersRoute],
  ['/me/follows', myFollowsRoute],
  ['/me/mentions', myMentionsRoute],
  ['/me/groups', myGroupsRoute],
  ['/me/tokens', tokensRoute],
  ['/me/tokens/[id]', tokenRoute],
  ['/me/affiliations', affiliationsRoute],
  ['/me/affiliations/[id]', affiliationRoute],
  ['/me/affiliations/[id]/verify', affiliationVerifyRoute],
  ['/me/password', myPasswordRoute],
  ['/agent/code', agentCodeRoute],
  ['/me/agent-code', myAgentCodeRoute],
  ['/agent/token', agentTokenRoute],
  ['/me/pending-bet', myPendingBetRoute],
  ['/onboarding', onboardingRoute],
];

export const ROUTE_PATTERNS = ROUTES.map(([p]) => p);

function match(path: string): { mod: Mod; params: Record<string, string> } {
  const segments = path.split('/').filter(Boolean);
  for (const [pattern, mod] of ROUTES) {
    const parts = pattern.split('/').filter(Boolean);
    if (parts.length !== segments.length) continue;
    const params: Record<string, string> = {};
    const ok = parts.every((p, i) => {
      const m = /^\[(\w+)\]$/.exec(p);
      if (m) {
        params[m[1]] = decodeURIComponent(segments[i]);
        return true;
      }
      return p === segments[i];
    });
    if (ok) return { mod, params };
  }
  return { mod: fallbackRoute, params: { rest: segments.join('/') } };
}

export interface ApiResult<T = any> {
  status: number;
  headers: Headers;
  body: T;
}

export const ORIGIN = 'http://test.local';

export async function api<T = any>(
  method: string,
  pathAndQuery: string,
  opts: {
    token?: string;
    cookie?: string;
    /** Defaults to our own origin when a cookie is sent; pass `null` to omit. */
    origin?: string | null;
    body?: unknown;
    headers?: Record<string, string>;
    rawBody?: string;
  } = {},
): Promise<ApiResult<T>> {
  const url = new URL(`/api/v1${pathAndQuery}`, ORIGIN);
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.cookie) {
    headers.cookie = opts.cookie;
    const origin = opts.origin === undefined ? ORIGIN : opts.origin;
    if (origin !== null) headers.origin = origin;
  }
  let body: string | undefined = opts.rawBody;
  if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers['content-type'] = 'application/json';
  }
  const req = new Request(url, { method, headers, body });

  const { mod, params } = match(url.pathname.replace(/^\/api\/v1/, ''));
  const handler = mod[method] as
    ((req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response> | Response) | undefined;
  if (!handler) throw new Error(`no ${method} export for ${url.pathname}`);
  const res = await handler(req, { params: Promise.resolve(params) });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

/**
 * The Better Auth path a mailed link opens, for `authCall`: every sign-in
 * and confirmation link lands on `/signin/link`, whose button submits the
 * same query to the route its `?to=` names; a reset link is Better Auth's.
 */
export function authPathOf(link: URL): string {
  // A password-reset link is Better Auth's own: its GET only checks the token.
  if (link.pathname.startsWith('/api/auth/reset-password/')) return link.pathname.replace(/^\/api\/auth/, '');
  if (link.pathname !== SIGN_IN_LINK_PATH) throw new Error(`not a mailed auth link: ${link}`);
  const to = link.searchParams.get('to') === 'confirm' ? 'confirm' : 'magic-link';
  return MAIL_LINK_TARGETS[to].action.replace(/^\/api\/auth/, '');
}

/** Better Auth's own endpoints, under /api/auth. */
export async function authCall(
  method: string,
  path: string,
  opts: { body?: unknown; cookie?: string; headers?: Record<string, string> } = {},
): Promise<Response> {
  const headers: Record<string, string> = { ...opts.headers, origin: ORIGIN };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const req = new Request(new URL(`/api/auth${path}`, ORIGIN), {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return (method === 'GET' ? authRoute.GET : authRoute.POST)(req);
}

/** `name=value; …` from a response's Set-Cookie headers. */
export function cookieFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

/**
 * Sign up the way a person without a bet does: a sign-in link to a new
 * address, opened from the dev outbox (it makes the confirmed user and the
 * session), then a name (`PATCH /me`) and a password (`POST /me/password`).
 * Returns the session cookie — the whole human path, through the real
 * endpoints.
 */
export async function signUp(email: string, name = 'Test Person', password = 'correct horse battery'): Promise<string> {
  clearDevOutbox();
  const res = await authCall('POST', '/sign-in/magic-link', { body: { email, callbackURL: '/verify-email' } });
  if (res.status !== 200) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
  const mail = devOutbox().find((m) => m.to === email);
  if (!mail) throw new Error('no sign-in mail');
  const link = new URL(/https?:\/\/\S+/.exec(mail.text)![0]);
  const opened = await authCall('GET', `${authPathOf(link)}${link.search}`);
  const cookie = cookieFrom(opened);
  if (!cookie.includes('session_token')) throw new Error(`the link gave no session: ${opened.status}`);
  const named = await api('PATCH', '/me', { cookie, body: { displayName: name } });
  if (named.status !== 200) throw new Error(`setting the name failed: ${named.status}`);
  const set = await api('POST', '/me/password', { cookie, body: { password } });
  if (set.status !== 200) throw new Error(`setting the password failed: ${set.status}`);
  return cookie;
}

/**
 * A trader with a token. Humans get a Better Auth user (as sign-up would
 * give them) and, unless `verified: false`, a confirmed institution; bots
 * get their login-less user when the token is minted. `grantMicro` opens a
 * wallet in `kind` (default `binary`, `createMarket`'s) with that grant now;
 * without it, a first trade in a venue opens one with the starting balance.
 */
export async function trader(
  handle: string,
  scopes: TokenScope[] = ['read', 'trade'],
  opts: { isBot?: boolean; grantMicro?: bigint; kind?: string; verified?: boolean } = {},
): Promise<{ id: string; userId: string; token: string; tokenId: string }> {
  const db = getDb();
  let account = await createAccount({
    handle,
    displayName: handle,
    isBot: opts.isBot ?? false,
    wallets: opts.grantMicro === undefined ? [] : [{ kind: opts.kind ?? 'binary', grantMicro: opts.grantMicro }],
  });
  if (!account.isBot) {
    const userId = randomUUID();
    await db.insert(user).values({ id: userId, name: handle, email: `${handle}@example.org`, emailVerified: true });
    [account] = await db
      .update(accounts)
      .set({
        userId,
        ...(opts.verified === false ? {} : { verifiedAt: new Date(), institutions: ['Test University'] }),
      })
      .where(eq(accounts.id, account.id))
      .returning();
  }
  const { token, record } = await mintToken({ account, name: `${handle} test`, scopes });
  const [after] = await db.select().from(accounts).where(eq(accounts.id, account.id));
  return { id: account.id, userId: after.userId!, token, tokenId: record.id };
}
