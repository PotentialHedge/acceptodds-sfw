/**
 * The split test with PotentialPaper (potentialpaper.com), a page for every paper with the same ICLR 2027
 * submissions: a share of visitors who land on a paper's page here are sent to that paper's page there instead, to
 * compare how each site keeps a reader. Shared by `proxy.ts`, so relative imports only.
 *
 * Each browser gets a bucket, 0–99, once (`SPLIT_COOKIE`, a year), and keeps it: those below the share
 * (`POTENTIALPAPER_SHARE`, a percentage, 0 when unset) are sent, the rest stay, so raising the share keeps everyone
 * already sent going there. Only visitors who aren't signed in, and never crawlers, so the pages here stay indexed
 * and accounts keep their follows, lists and groups. See `server/potentialpaper.ts` for the rest.
 */

export const SPLIT_COOKIE = 'ao_split';
/** The bucket, for the request it was assigned on: the cookie only arrives with the next one. */
export const SPLIT_HEADER = 'x-ao-split';

/** A bucket from a cookie or header value: a whole number 0–99, or null. */
export function parseBucket(value: string | null | undefined): number | null {
  if (!value || !/^\d{1,2}$/.test(value)) return null;
  return Number(value);
}

export function newBucket(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] % 100;
}

/** The share sent, 0–100, from `POTENTIALPAPER_SHARE`; anything else is 0. */
export function splitShare(raw = process.env.POTENTIALPAPER_SHARE): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.floor(n))) : 0;
}

/** Crawlers, link previewers and other machines: never sent, so what they see is this site's page. */
const BOT =
  /bot|crawl|spider|slurp|preview|fetch|scrape|facebookexternalhit|embedly|quora|whatsapp|telegram|discord|slack|curl|wget|python|httpclient|headless|lighthouse/i;

export function isBot(userAgent: string | null | undefined): boolean {
  return !userAgent || BOT.test(userAgent);
}
