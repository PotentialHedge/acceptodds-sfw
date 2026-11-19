/**
 * What page analytics may learn about a URL. Umami records the full page URL
 * and referrer of every hit, and some of ours carry things that are not ours
 * to hand on: `/verify-email?email=…` names the person, and `?next=` is a whole
 * other URL. So a same-site URL keeps its path and only the query parameters
 * listed here, which are the browsing state (search, filters, sorts, pages),
 * and never a hash; any other site's URL keeps only its origin and path.
 *
 * An allowlist, not a blocklist: a parameter added later stays out of the
 * analytics until someone decides it belongs there.
 */

export const ANALYTICS_PARAMS: ReadonlySet<string> = new Set([
  'q',
  'sort',
  'status',
  'kind',
  'page',
  'fpage',
  'hpage',
  'market',
  'paper',
  'basis',
  'following',
  'tldr',
  'around',
  'institution',
  'resent',
  'step',
  'error',
  // where a link of ours was posted (an announcement, a tweet): `?ref=announcement`
  'ref',
]);

/** `url` as analytics may record it; `origin` is this site's. Unparseable input becomes ''. */
export function analyticsUrl(url: string, origin: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url, origin);
  } catch {
    return '';
  }
  parsed.hash = '';
  parsed.username = '';
  parsed.password = '';
  if (parsed.origin !== new URL(origin).origin) {
    parsed.search = '';
    return parsed.toString();
  }
  const kept = new URLSearchParams();
  for (const [key, value] of parsed.searchParams) {
    if (ANALYTICS_PARAMS.has(key)) kept.append(key, value);
  }
  parsed.search = kept.toString();
  return parsed.toString();
}
