/**
 * Where a paper is on PotentialPaper (`lib/split.ts`): its page by OpenReview id, `/openreview/<id>`, which answers
 * with a redirect to the paper's short address when it has the paper and a 404 when it doesn't. The short address is
 * asked for, not the long one, since that redirect drops the query and with it `?ref=`.
 *
 * Kept per container: a paper found for a day, one not found for an hour (it may be added). A slow or failed answer
 * counts as not found, briefly, so the visitor stays here rather than waits.
 */

const SITE = 'https://potentialpaper.com';
const FOUND_MS = 24 * 3600_000;
const MISSING_MS = 3600_000;
const FAILED_MS = 5 * 60_000;
const TIMEOUT_MS = 1500;
const MAX_ENTRIES = 50_000;

const cache = new Map<string, { path: string | null; until: number }>();

/** The paper's path on PotentialPaper (`/s/123`), or null when it has none, or didn't say in time. */
export async function potentialPaperPath(openreviewId: string): Promise<string | null> {
  const now = Date.now();
  const hit = cache.get(openreviewId);
  if (hit && hit.until > now) return hit.path;
  let path: string | null = null;
  let ttl = MISSING_MS;
  try {
    const res = await fetch(`${SITE}/openreview/${encodeURIComponent(openreviewId)}`, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      const target = new URL(location, SITE);
      if (target.origin === SITE) {
        path = target.pathname;
        ttl = FOUND_MS;
      }
    } else if (res.ok) {
      path = `/openreview/${encodeURIComponent(openreviewId)}`;
      ttl = FOUND_MS;
    } else if (res.status !== 404) {
      ttl = FAILED_MS;
    }
  } catch {
    ttl = FAILED_MS;
  }
  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(openreviewId, { path, until: now + ttl });
  return path;
}

/** The address a visitor is sent to: the paper's page there, marked as coming from here. */
export function potentialPaperUrl(path: string): string {
  return `${SITE}${path}?ref=acceptodds`;
}
