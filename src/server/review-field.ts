import { sql } from 'drizzle-orm';
import { getDb, type Database } from '@/db';
import { countBelow } from '@/lib/distribution';
import { percentAhead } from '@/lib/leaderboard';
import { histogram, REVIEW_BINS, roundMean } from '@/lib/reviews';
import { ReadCache } from './read-cache';

/**
 * Where a paper's mean review rating sits among the reviewed papers at its
 * venue: the histogram of every such paper's mean, across the venue's own
 * scale (the lowest and highest single rating given there, so no venue's scale
 * is written down here). **Reads only.** Reviews arrive in bulk from
 * `../research`, so the field is cached per venue for longer than a market's.
 */

export interface ReviewField {
  kind: string;
  /** The venue's scale, as whole numbers. */
  domain: [number, number];
  /** Papers per equal-width bin across `domain` (`REVIEW_BINS`), the last closed at its top. */
  bins: number[];
  /** The share of the other reviewed papers strictly below this one, rounded down. */
  ahead: number | null;
}

/** One paper alone has nothing to be placed among. */
const MIN_FIELD = 2;
const TTL_MS = 10 * 60_000;

interface Venue {
  domain: [number, number];
  bins: number[];
  /** Every reviewed paper's mean, ascending. Stays on the server: the page gets the share. */
  means: number[];
}

const venues = new ReadCache(50);

async function readVenue(kind: string, database: Database): Promise<Venue | null> {
  const { rows } = await database.execute<{ mean: number; lo: number; hi: number }>(sql`
    select avg(r.rating)::float8 as mean, min(r.rating)::float8 as lo, max(r.rating)::float8 as hi
      from listing_reviews r join listings l on l.id = r.listing_id
     where l.kind = ${kind} and r.kind = 'review' and r.rating is not null
     group by r.listing_id
  `);
  if (rows.length < MIN_FIELD) return null;
  const lo = Math.floor(Math.min(...rows.map((r) => r.lo)));
  const hi = Math.ceil(Math.max(...rows.map((r) => r.hi)));
  if (!(hi > lo)) return null;
  const domain: [number, number] = [lo, hi];
  const means = rows.map((r) => roundMean(r.mean)).sort((a, b) => a - b);
  return { domain, means, bins: histogram(means, domain, REVIEW_BINS) };
}

/** `null` when the paper has no venue or no mean, or its venue is too few or all of one rating. */
export async function reviewField(
  kind: string | null,
  mean: number | null,
  database: Database = getDb(),
): Promise<ReviewField | null> {
  if (kind === null || mean === null) return null;
  const compute = () => readVenue(kind, database);
  const venue = await (database === getDb() ? venues.get(kind, TTL_MS, compute) : compute());
  if (!venue) return null;
  return {
    kind,
    domain: venue.domain,
    bins: venue.bins,
    ahead: percentAhead(countBelow(venue.means, mean), venue.means.length),
  };
}

/** After a test's writes. */
export function clearReviewFieldCache(): void {
  venues.clear();
}
