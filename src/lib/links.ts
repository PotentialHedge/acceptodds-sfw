/** The platform's source code, linked from the home page's abstract. */
export const REPO_URL = 'https://github.com/benedict-armstrong/acceptodds-sfw';

/** Where an account goes after its first trade (`Fill.firstTrade`): what it bought, and a link to share. */
export const FIRST_TRADE_PATH = '/first-trade';

/**
 * Where a market is read: its paper's page with the market selected, or the
 * market's own page when it has no listing. Plain, so Server and Client
 * Components can both call it.
 */
export function marketHref(m: { marketSlug: string; listingSlug: string | null }): string {
  return m.listingSlug
    ? `/papers/${m.listingSlug}?market=${encodeURIComponent(m.marketSlug)}`
    : `/markets/${m.marketSlug}`;
}

/** The short share link (#11): a listing's or an unlisted market's `short_id`, which `/s/` redirects to its page. */
export function shortPath(shortId: number): string {
  return `/s/${shortId}`;
}

/**
 * Where a password-reset link lands (`app/set-password`): the address rides
 * along so the page can name the account and offer a new link.
 */
export function setPasswordPath(email: string): string {
  return `/set-password?${new URLSearchParams({ email })}`;
}

/**
 * Where a sign-in or confirmation link from a mail lands (`app/signin/link`):
 * a button, not the sign-in itself. Better Auth's `/magic-link/verify` spends
 * its one-time token on the first GET, and `/verify-email` confirms and signs
 * in whoever opens it first; institutional mail scanners (Safe Links,
 * Proofpoint, …) open every link in a mail before the person does, so a link
 * straight to either was "already used" by the time it was clicked. A
 * password-reset link is safe as it is: its GET only checks the token, and
 * `/set-password` spends it by POST.
 */
export const SIGN_IN_LINK_PATH = '/signin/link';

/** The Better Auth routes a mailed link may open, by the landing page's `?to=`; none means a sign-in link. */
export const MAIL_LINK_TARGETS = {
  'magic-link': {
    action: '/api/auth/magic-link/verify',
    query: ['token', 'callbackURL', 'newUserCallbackURL', 'errorCallbackURL'],
  },
  confirm: { action: '/api/auth/verify-email', query: ['token', 'callbackURL'] },
} as const;

export type MailLinkTarget = keyof typeof MAIL_LINK_TARGETS;

/** The link to mail, from the URL Better Auth built: same origin and query, on our landing page. */
export function mailLinkUrl(authUrl: string): string {
  const url = new URL(authUrl);
  const to = (Object.keys(MAIL_LINK_TARGETS) as MailLinkTarget[]).find(
    (k) => MAIL_LINK_TARGETS[k].action === url.pathname,
  );
  if (!to) throw new Error(`not a mailed auth link: ${url.pathname}`);
  url.searchParams.set('to', to);
  return `${url.origin}${SIGN_IN_LINK_PATH}${url.search}`;
}

/** A public position's page (#36): the link its holder shares. */
export function publicPositionPath(id: string): string {
  return `/positions/${id}`;
}

/** A group's board (#25): the leaderboard ranked among its members. */
export function groupPath(id: string, kind?: string | null): string {
  // Safe for work edition: a group's own page, not the leaderboard (`app/groups/[id]`). Groups are not per venue.
  void kind;
  return `/groups/${id}`;
}

/** An institution's board: the leaderboard ranked among the traders confirmed there. */
export function institutionPath(name: string, kind?: string | null): string {
  return `/leaderboard?institution=${encodeURIComponent(name)}${kind ? `&kind=${encodeURIComponent(kind)}` : ''}`;
}

/** Two institutions compared (`/leaderboard/compare`); a side left null is still to be picked. */
export function comparePath(a: string | null, b: string | null, kind?: string | null): string {
  const params = new URLSearchParams();
  if (kind) params.set('kind', kind);
  if (a) params.set('a', a);
  if (b) params.set('b', b);
  const s = params.toString();
  return s ? `/leaderboard/compare?${s}` : '/leaderboard/compare';
}

/**
 * A group's invite link. The code rides in the query, which page analytics
 * never records (`lib/analytics.ts`), so it stays with whoever it was sent to.
 */
export function groupInvitePath(code: string): string {
  return `/groups/join?code=${encodeURIComponent(code)}`;
}

/** `?price=jev` on a paper's page: the opening price was asked for while signed out, so ask again on arrival. */
export const JEV_PRICE_PARAM = 'price';

/** A paper's page with `?price=jev`: where a sign-up for JEV's price returns to. */
export function jevPricePath(slug: string): string {
  return `/papers/${encodeURIComponent(slug)}?${JEV_PRICE_PARAM}=jev`;
}

/** Whether a same-site path asks for JEV's price (`jevPricePath`). */
export function asksJevPrice(path: string): boolean {
  const query = path.split('#', 1)[0].split('?')[1] ?? '';
  return new URLSearchParams(query).get(JEV_PRICE_PARAM) === 'jev';
}
