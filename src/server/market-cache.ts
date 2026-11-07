import { ReadCache } from './read-cache';
import { WarmCache } from './warm-cache';

/** Shared public boards/tapes; auth, rate limiting and logging stay per request. */
export const marketReads = new ReadCache();
export const MARKET_READ_TTL_MS = 1_000;
export const sparklineReads = new ReadCache();
/**
 * The home list's pages that depend on no viewer, and its venues: a scan of
 * every listing each (#12). A listing upsert drops them all. A market write
 * (a fill, an opening, a settlement) leaves them at most
 * `BROWSE_STALE_AFTER_WRITE_MS` to live: at a fill or an opening every few
 * seconds, dropping them on each made nearly every home page a cache miss,
 * and a list a few seconds behind the tape is fine. The TTL only covers
 * writers outside this process (the seed). Never mutate a cached page.
 */
export const browseReads = new ReadCache(200);
export const BROWSE_READ_TTL_MS = 30_000;
/** 0 (the tests' setting, `tests/setup-env.ts`) drops them at once, as a listing upsert does. */
const BROWSE_STALE_AFTER_WRITE_MS = Number(process.env.BROWSE_STALE_AFTER_WRITE_MS ?? 5_000);

/**
 * The home page's example searches (`views.browseListings`), refreshed in the background
 * (`example-warmer.ts`) so they are fast for everyone, the first visitor included.
 */
// One per process, on `globalThis`: `instrumentation.ts`, which starts the warmer, is bundled apart from
// the pages, and a module-level cache would be two (as `db/index.ts`'s pool).
declare global {
  var __papermarketExampleReads: WarmCache | undefined;
}
export const exampleReads = (globalThis.__papermarketExampleReads ??= new WarmCache(100, 5 * 60_000));

/** `views.traderInstitutions`: every account scanned, for the board picker and the home page's strip. */
export const institutionReads = new ReadCache(1);
export const INSTITUTION_READ_TTL_MS = 60_000;

/** Called only after a market write commits. In-flight older reads cannot repopulate the cache. */
export function invalidateMarketReads(marketId: string): void {
  marketReads.invalidate(marketId);
  marketReads.invalidate('refs');
  sparklineReads.invalidate(marketId);
  browseReads.expireWithin(BROWSE_STALE_AFTER_WRITE_MS);
}

/** Called only after a listing write commits. */
export function invalidateBrowseReads(): void {
  browseReads.clear();
  // The tests' setting: a write is seen at once, so a warm example is dropped too.
  if (BROWSE_STALE_AFTER_WRITE_MS <= 0) exampleReads.clear();
  else exampleReads.written();
}

export function clearMarketReads(): void {
  marketReads.clear();
  sparklineReads.clear();
  browseReads.clear();
  exampleReads.clear();
  institutionReads.clear();
}
