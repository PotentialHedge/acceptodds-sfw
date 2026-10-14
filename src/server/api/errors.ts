import { EngineError, type EngineErrorCode } from '../errors';

/**
 * The public API's error codes. Every error the API returns has the shape
 * `{ error: { code, message, details? } }` with `code` from this list.
 *
 * **Stable.** Bots branch on these strings, so renaming or removing one is a
 * breaking change to `/api/v1`. Adding one is not.
 */
export const API_ERROR_CODES = [
  // from the engine (server/errors.ts)
  'not_found',
  'market_not_open',
  'market_closed',
  'market_already_settled',
  'invalid_size',
  'insufficient_balance',
  'insufficient_shares',
  'slippage_exceeded',
  'house_underfunded',
  'invalid_market',
  // from the HTTP layer
  'validation_error',
  'unauthorized',
  'forbidden',
  'session_required',
  'rate_limited',
  'slug_taken',
  'idempotency_key_reused',
  'not_verified',
  'insufficient_stake',
  'own_comment',
  'email_domain_not_allowed',
  'already_affiliated',
  'too_many_pending',
  'invalid_code',
  'affiliation_taken',
  'primary_affiliation',
  'password_already_set',
  'too_many_groups',
  'group_admin',
  'bots_cannot_open_markets',
  'listing_closed',
  'too_many_reactions',
  'method_not_allowed',
  'internal_error',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

// Compile-time check that every engine code is also an API code.
const _engineCodesAreApiCodes: readonly ApiErrorCode[] = [] as EngineErrorCode[];
void _engineCodesAreApiCodes;

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;
  readonly headers?: Record<string, string>;

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    details?: Record<string, unknown>,
    headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.headers = headers;
  }
}

const ENGINE_STATUS: Record<EngineErrorCode, number> = {
  not_found: 404,
  invalid_size: 400,
  market_not_open: 409,
  market_closed: 409,
  market_already_settled: 409,
  insufficient_balance: 409,
  insufficient_shares: 409,
  slippage_exceeded: 409,
  house_underfunded: 409,
  invalid_market: 409,
};

export function fromEngineError(err: EngineError): ApiError {
  return new ApiError(ENGINE_STATUS[err.code], err.code, err.message, err.details);
}
