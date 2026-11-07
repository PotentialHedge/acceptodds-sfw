import { eq, sql } from 'drizzle-orm';
import { getDb, type Database } from '@/db';
import { countBelow } from '@/lib/distribution';
import { percentAhead } from '@/lib/leaderboard';
import {
  atomsOf,
  COHORT_BANDWIDTH,
  densityCurve,
  factorMeans,
  factorOf,
  meanRating,
  MIN_COHORT,
  NEAREST_COHORT,
  OVERALL,
  REVIEW_FACTORS,
  roundMean,
  type Atom,
  type ReviewCohort,
  type ReviewFactor,
} from '@/lib/reviews';
import { listingRelated, listings, type Listing } from '@/db/schema';
import { normalizeSearch } from '@/lib/search';
import { ReadCache } from './read-cache';
import { reviewsOf } from './reviews';
import { searchReviewMeans, type ReviewMeans } from './views';
import { nearestIn, vectorIndexes } from './vector-index';

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
  /** How many papers the field is of. */
  papers: number;
  /** On a cohort, the shape of the whole venue on the same scale, to compare by eye. */
  reference?: number[];
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
    papers: venue.means.length,
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

/** A cohort's scores on one paper's other papers, each on its venue's scale. */
export interface ReviewCohortView {
  cohort: ReviewCohort;
  series: ReviewSeries[];
}

/** A curve is drawn, not read: four places are plenty, and it goes over the wire for every score. */
const curveToSend = (curve: number[]) => curve.map((y) => Math.round(y * 1e4) / 1e4);

/** The `NEAREST_COHORT` papers nearest this one by the map's vectors. Empty when it has no vector. */
async function nearestIds(listingId: string, database: Database): Promise<string[]> {
  const index = (await vectorIndexes(database)).find((i) => i.row.has(listingId));
  return index ? nearestIn(index, listingId, NEAREST_COHORT) : [];
}

async function relatedIds(listingId: string, database: Database): Promise<string[]> {
  const rows = await database
    .select({ id: listings.id })
    .from(listingRelated)
    .innerJoin(listings, eq(listings.slug, listingRelated.relatedSlug))
    .where(eq(listingRelated.listingId, listingId));
  return rows.map((r) => r.id);
}

/** A paper's own means, each with the column it is read from. */
type OwnScore = { label: string; mean: number; count: number; column: 'rating' | ReviewFactor };

/** The paper's reviewed scores, the overall first. Empty for a paper with no venue or no reviews. */
async function ownScores(listing: Listing, database: Database): Promise<OwnScore[]> {
  const reviews = (await reviewsOf(listing.id, database)).filter((r) => r.kind === 'review');
  const mean = meanRating(reviews.map((r) => r.rating));
  return [
    ...(mean === null
      ? []
      : [{ label: OVERALL, mean, count: reviews.filter((r) => r.rating !== null).length, column: 'rating' as const }]),
    ...factorMeans(reviews).flatMap((f) => {
      const column = factorOf(f.label);
      return column ? [{ ...f, column }] : [];
    }),
  ];
}

/**
 * The paper's scores among `members` (their means, by id; the paper itself is
 * left out), each on its venue's scale with the venue's shape behind it. A
 * score fewer than `MIN_COHORT` of them have is left out.
 */
async function placedAmong(
  kind: string,
  own: readonly OwnScore[],
  members: ReadonlyMap<string, ReviewMeans>,
  database: Database,
): Promise<ReviewSeries[]> {
  const series = await Promise.all(
    own.map(async ({ label, mean, count, column }) => {
      const venue = await placed(kind, column, mean, database);
      if (!venue) return null;
      const means = [...members.values()]
        .flatMap((m) => (m[column] === null ? [] : [roundMean(m[column])]))
        .sort((a, b) => a - b);
      if (means.length < MIN_COHORT) return null;
      const atoms = atomsOf(means);
      const field: ReviewField = {
        kind,
        domain: venue.domain,
        curve: curveToSend(densityCurve(atoms, venue.domain, COHORT_BANDWIDTH)),
        atoms,
        // `means` leaves the paper out, and `percentAhead` is told the field with it.
        ahead: percentAhead(countBelow(means, mean), means.length + 1),
        papers: means.length,
        reference: curveToSend(venue.curve),
      };
      return { label, mean, count, field };
    }),
  );
  return series.filter((s) => s !== null);
}

/** Every reviewed paper's means at `kind`, by id, among `ids`. */
async function meansOf(kind: string, ids: readonly string[], database: Database): Promise<Map<string, ReviewMeans>> {
  if (ids.length === 0) return new Map();
  const columns = sql.raw(REVIEW_FACTORS.map((f) => `avg(r.${f})::float8 as ${f}`).join(', '));
  const { rows } = await database.execute<ReviewMeans>(sql`
    select r.listing_id as id, avg(r.rating)::float8 as rating, ${columns}
      from listing_reviews r join listings l on l.id = r.listing_id
     where l.kind = ${kind} and r.kind = 'review'
       and r.listing_id in (${sql.join(
         ids.map((id) => sql`${id}::uuid`),
         sql`, `,
       )})
     group by r.listing_id
  `);
  return new Map(rows.map((r) => [r.id, r]));
}

/** `members` without `id`. */
function without(members: ReadonlyMap<string, ReviewMeans>, id: string): Map<string, ReviewMeans> {
  const out = new Map(members);
  out.delete(id);
  return out;
}

/**
 * Where a paper's mean on each score sits among the papers nearest it in
 * embedding space, and among its related papers, on its venue's scale. Only
 * reviewed papers at its venue count, never the paper itself. A cohort with fewer than
 * `MIN_COHORT` reviewed papers on a score leaves that score out, and with none
 * left the cohort is left out. Vectors and relatedness are the similarity
 * service's; a mean is the same as the venue field's.
 */
export async function reviewCohorts(listing: Listing, database: Database = getDb()): Promise<ReviewCohortView[]> {
  const kind = listing.kind;
  if (kind === null) return [];
  const own = await ownScores(listing, database);
  if (own.length === 0) return [];

  const [nearest, related] = await Promise.all([nearestIds(listing.id, database), relatedIds(listing.id, database)]);
  const ids = [...new Set([...nearest, ...related])].filter((id) => id !== listing.id);
  if (ids.length === 0) return [];
  const byId = await meansOf(kind, ids, database);

  const compute = async (cohort: ReviewCohort, members: string[]): Promise<ReviewCohortView | null> => {
    const chosen = new Map(members.flatMap((id) => (id !== listing.id && byId.has(id) ? [[id, byId.get(id)!]] : [])));
    const series = await placedAmong(kind, own, chosen, database);
    return series.length > 0 ? { cohort, series } : null;
  };
  const cohorts = await Promise.all([compute('nearest', nearest), compute('related', related)]);
  return cohorts.filter((c) => c !== null);
}

/** A paper's scores among the papers a search finds. */
export interface ReviewQueryView {
  /** Empty when the query finds too few reviewed papers (or the paper has no scores). */
  series: ReviewSeries[];
  /** Reviewed papers the query found at the venue, the paper itself left out. */
  papers: number;
  /** Terms the parser could not use and left out. */
  errors: string[];
}

/** What a search finds at a venue moves only with reviews and trades: a few minutes is fresh enough. */
const QUERY_TTL_MS = 5 * 60_000;
const queries = new ReadCache(200);

/**
 * Where a paper's mean on each score sits among the reviewed papers at its
 * venue that `q`, in the home page's search syntax, finds
 * (`views.searchReviewMeans`), on its venue's scale. Never the paper itself,
 * whether the query finds it or not. A venue's matches are cached per query,
 * so every paper asking the same question shares one search.
 */
export async function reviewQueryCohort(
  listing: Listing,
  q: string | null | undefined,
  database: Database = getDb(),
): Promise<ReviewQueryView> {
  const kind = listing.kind;
  const text = normalizeSearch(q);
  if (kind === null || text === null) return { series: [], papers: 0, errors: [] };
  const search = async () => {
    const { rows, errors } = await searchReviewMeans(text, kind, database);
    return { members: new Map(rows.map((r) => [r.id, r])), errors };
  };
  const { members, errors } = await (database === getDb()
    ? queries.get(`${kind}\n${text}`, QUERY_TTL_MS, search)
    : search());
  const others = without(members, listing.id);
  const own = await ownScores(listing, database);
  return { series: await placedAmong(kind, own, others, database), papers: others.size, errors };
}

/** After a test's writes. */
export function clearReviewFieldCache(): void {
  venues.clear();
  queries.clear();
}
