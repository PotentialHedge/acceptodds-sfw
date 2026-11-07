import { ENTERED_COOKIE } from '@/lib/sfw';
import { defaultMarketKind } from '@/lib/venue';
import { warmReads } from './market-cache';
import { warmHomeReads } from './views';

/** How often they are computed afresh; under `warmReads`' age for a cold entry. */
const REFRESH_MS = 4 * 60_000;
/** After a listing write, how long to wait for more before refreshing: a sync writes many at once. */
const AFTER_WRITE_MS = 5_000;
/** After the server starts, before the first warm-up: let it take its first requests. */
const AFTER_START_MS = 3_000;

let started = false;

declare global {
  /** The first warm-up, while it runs: on `globalThis`, since `/healthz` is bundled apart from this. */
  var __papermarketWarming: { since: number; done: boolean } | undefined;
}

/** Longest the first warm-up holds `/healthz` back: a database that is down must not keep a server out. */
const WARMING_AT_MOST_MS = 60_000;

/**
 * Whether the server is still on its first warm-up, so not ready for visitors: `/healthz` answers 503
 * meanwhile, and the swap (and Traefik) wait. False when nothing warms, as in the tests.
 */
export function warming(): boolean {
  const w = globalThis.__papermarketWarming;
  return w !== undefined && !w.done && Date.now() - w.since < WARMING_AT_MOST_MS;
}

/** The home page, from this server itself, past the gate. Its failure is only logged. */
async function selfVisit(): Promise<void> {
  try {
    const res = await fetch(`http://127.0.0.1:${process.env.PORT ?? 3000}/`, {
      headers: { cookie: `${ENTERED_COOKIE}=1` },
      signal: AbortSignal.timeout(20_000),
    });
    await res.arrayBuffer();
  } catch (err) {
    console.error('warming the home page by a visit failed', err);
  }
}

/**
 * Keeps the home page's default list and example searches warm in the default venue
 * (`views.warmHomeReads`): once
 * the server is up, every few minutes, and a few seconds after a listing write. One run at a time, each
 * reading one search after another, so it never holds more than a connection or two of the pool.
 * Started once per process, by `instrumentation.ts`.
 */
export function startHomeWarmer(): void {
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
      await warmHomeReads(kind);
    } catch (err) {
      console.error('warming the home page failed', err);
    } finally {
      running = false;
      if (again) {
        again = false;
        void run();
      }
    }
  };
  let soon: ReturnType<typeof setTimeout> | null = null;
  warmReads.onStale(() => {
    if (soon) return;
    soon = setTimeout(() => {
      soon = null;
      void run();
    }, AFTER_WRITE_MS);
    soon.unref?.();
  });
  // The first run is followed by a request for the home page, as a visitor's: the first render of a
  // fresh server loads its code and other reads (1.5 s on dev, with the list already warm), and it should
  // not be a visitor who waits for it, the first one after a deploy.
  // Until then `/healthz` says the server is starting, so no visitor is sent to it cold (`warming`).
  globalThis.__papermarketWarming = { since: Date.now(), done: false };
  setTimeout(
    () =>
      void run()
        .then(selfVisit)
        .finally(() => (globalThis.__papermarketWarming!.done = true)),
    AFTER_START_MS,
  ).unref?.();
  setInterval(() => void run(), REFRESH_MS).unref?.();
}
