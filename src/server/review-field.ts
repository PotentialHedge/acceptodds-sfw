import { sql } from 'drizzle-orm';
import { getDb, type Database } from '@/db';
import { countBelow } from '@/lib/distribution';
import { percentAhead } from '@/lib/leaderboard';
import { atomsOf, densityCurve, factorOf, roundMean, type Atom, type ReviewFactor } from '@/lib/reviews';
import { ReadCache } from './read-cache';

/**
 * Where a paper's mean review rating sits among the reviewed papers at its
 * venue: the density of every such paper's mean, across the venue's own
 * scale (the lowest and highest single rating given there, so no venue's scale
 * is written down here). **Reads only.** Reviews arrive in bulk from
 * `../research`, so the field is cached per venue for longer than a market's.
 */

export interface ReviewField {
  kind: string;
  /** The venue's scale, as whole numbers. */
  domain: [number, number];
  /** The shape of the field: its density at even points across `domain`, peaking at 1. Drawing only. */
  curve: number[];
  /** Each distinct mean with its share of the field, ascending: exact, for reading shares off the chart. */
  atoms: Atom[];
  /** The share of the other reviewed papers strictly below this one, rounded down. */
  ahead: number | null;
}

/** One score of a paper's, and the field it is placed in: what the chart can switch between. */
export interface ReviewSeries {
  label: string;
  mean: number;
  /** How many reviews gave it. */
  count: number;
  field: ReviewField;
}

/** One paper alone has nothing to be placed among. */
const MIN_FIELD = 2;
const TTL_MS = 10 * 60_000;

interface Venue {
  domain: [number, number];
  curve: number[];
  atoms: Atom[];
  /** Every reviewed paper's mean, ascending. Stays on the server: the page gets the share. */
  means: number[];
}

const venues = new ReadCache(100);

/** `column` is `rating` or one of `REVIEW_FACTORS`, never input. */
async function readVenue(kind: string, column: 'rating' | ReviewFactor, database: Database): Promise<Venue | null> {
  const score = sql.raw(`r.${column}`);
  const { rows } = await database.execute<{ mean: number; lo: number; hi: number }>(sql`
    select avg(${score})::float8 as mean, min(${score})::float8 as lo, max(${score})::float8 as hi
      from listing_reviews r join listings l on l.id = r.listing_id
     where l.kind = ${kind} and r.kind = 'review' and ${score} is not null
     group by r.listing_id
  `);
  if (rows.length < MIN_FIELD) return null;
  const lo = Math.floor(Math.min(...rows.map((r) => r.lo)));
  const hi = Math.ceil(Math.max(...rows.map((r) => r.hi)));
  if (!(hi > lo)) return null;
  const domain: [number, number] = [lo, hi];
  const means = rows.map((r) => roundMean(r.mean)).sort((a, b) => a - b);
  const atoms = atomsOf(means);
  return { domain, means, atoms, curve: densityCurve(atoms, domain) };
}

async function placed(
  kind: string,
  column: 'rating' | ReviewFactor,
  mean: number,
  database: Database,
): Promise<ReviewField | null> {
  const compute = () => readVenue(kind, column, database);
  const venue = await (database === getDb() ? venues.get(`${kind}\n${column}`, TTL_MS, compute) : compute());
  if (!venue) return null;
  return {
    kind,
    domain: venue.domain,
    curve: venue.curve,
    atoms: venue.atoms,
    ahead: percentAhead(countBelow(venue.means, mean), venue.means.length),
  };
}

/** `null` when the paper has no venue or no mean, or its venue is too few or all of one rating. */
export async function reviewField(
  kind: string | null,
  mean: number | null,
  database: Database = getDb(),
): Promise<ReviewField | null> {
  if (kind === null || mean === null) return null;
  return placed(kind, 'rating', mean, database);
}

/**
 * Where a paper's mean on each of its other scores sits at its venue, each on that score's own scale.
 * A score that is not one of `REVIEW_FACTORS`, or has no field to sit in, is left out.
 */
export async function reviewFactorFields(
  kind: string | null,
  paper: readonly { label: string; mean: number; count: number }[],
  database: Database = getDb(),
): Promise<ReviewSeries[]> {
  if (kind === null) return [];
  const series = await Promise.all(
    paper.map(async (p) => {
      const factor = factorOf(p.label);
      const field = factor && (await placed(kind, factor, p.mean, database));
      return field && { ...p, field };
    }),
  );
  return series.filter((s) => s !== null);
}

/** After a test's writes. */
export function clearReviewFieldCache(): void {
  venues.clear();
}
