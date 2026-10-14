/**
 * The safe for work edition: the papers without the markets. Shared by
 * `proxy.ts` (which runs before any route, so relative imports only) and the
 * gate's routes.
 */

/** Set once a visitor has gone past the gate (`/enter`); its absence shows the gate. */
export const ENTERED_COOKIE = 'sfw_entered';

/** A year: the gate is shown once per browser, not once per visit. */
export const ENTERED_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Pages of the market edition with no place here. A request for one is a
 * 404, whatever the page's code would still do.
 */
export const MARKET_PAGES = [
  '/about',
  '/leaderboard',
  '/portfolio',
  '/people',
  '/positions',
  '/first-trade',
  '/badge',
  '/agent',
];

/**
 * API paths that trade, value or rank, or serve agents that trade: 404. A
 * `*` is one path segment. Everything else in `/api/v1` (listings, search,
 * the map, follows, groups, reading lists, the account) still answers.
 */
export const MARKET_API = [
  '/api/v1/markets',
  '/api/v1/listings/*/market',
  '/api/v1/listings/*/orders',
  '/api/v1/leaderboard',
  '/api/v1/accounts/*/positions',
  '/api/v1/positions',
  '/api/v1/comments',
  '/api/v1/onboarding',
  '/api/v1/agent',
  '/api/v1/me/portfolio',
  '/api/v1/me/orders',
  '/api/v1/me/pending-bet',
  '/api/v1/me/positions',
  '/api/v1/me/mentions',
  '/api/v1/me/agent-code',
];

/** Whether `path` is `prefix` or under it, `*` matching one segment. */
export function under(path: string, prefix: string): boolean {
  const want = prefix.split('/');
  const have = path.split('/');
  if (have.length < want.length) return false;
  return want.every((seg, i) => (seg === '*' ? have[i] !== '' : seg === have[i]));
}
