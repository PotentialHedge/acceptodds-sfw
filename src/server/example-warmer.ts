import { defaultMarketKind } from '@/lib/venue';
import { exampleReads } from './market-cache';
import { warmExampleSearches } from './views';

/** How often the example searches are computed afresh; under `exampleReads`' age for a cold entry. */
const REFRESH_MS = 4 * 60_000;
/** After a listing write, how long to wait for more before refreshing: a sync writes many at once. */
const AFTER_WRITE_MS = 5_000;
/** After the server starts, before the first warm-up: let it take its first requests. */
const AFTER_START_MS = 3_000;

let started = false;

/**
 * Keeps the home page's example searches warm in the default venue (`views.warmExampleSearches`): once
 * the server is up, every few minutes, and a few seconds after a listing write. One run at a time, each
 * reading one search after another, so it never holds more than a connection or two of the pool.
 * Started once per process, by `instrumentation.ts`.
 */
export function startExampleWarmer(): void {
  if (started) return;
  started = true;
  const kind = defaultMarketKind();
  let running = false;
  let again = false;
  const run = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      await warmExampleSearches(kind);
    } catch (err) {
      console.error('warming the example searches failed', err);
    } finally {
      running = false;
      if (again) {
        again = false;
        void run();
      }
    }
  };
  let soon: ReturnType<typeof setTimeout> | null = null;
  exampleReads.onStale(() => {
    if (soon) return;
    soon = setTimeout(() => {
      soon = null;
      void run();
    }, AFTER_WRITE_MS);
    soon.unref?.();
  });
  setTimeout(() => void run(), AFTER_START_MS).unref?.();
  setInterval(() => void run(), REFRESH_MS).unref?.();
}
