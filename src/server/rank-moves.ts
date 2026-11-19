import { sql } from 'drizzle-orm';
import { getDb, type Database } from '@/db';
import { ReadCache } from './read-cache';
import { listed } from './listed';

/** A paper's place in its venue by mean rating, now and before reviewers changed their scores. */
export interface RankMove {
  /** Its rank by the first recorded ratings (`listing_review_stats.initial_mean`), 1 the best. */
  was: number;
  /** Its rank by the current ratings. */
  now: number;
  /** Rated papers ranked. */
  of: number;
}

/**
 * Each listed, rated paper of a venue whose rank moved, by listing id; the others are left out. Ranks are
 * by mean rating alone, ties sharing the best rank (`rank()`): means fall on thirds, so a rank inside a
 * tie, broken by the list's other sort keys, would move with changes to papers it never passed. A
 * paper whose ratings never changed still moves as others pass it or fall behind it.
 *
 * Cached per venue for `TTL_MS` and per container: every paper's rank can move with any one paper's
 * reviews, so the whole venue is ranked at once (one query over `listing_review_stats`), and a review
 * sync shows within the TTL.
 */
export function rankMoves(kind: string, database: Database = getDb()): Promise<ReadonlyMap<string, RankMove>> {
  return database === getDb() ? moves.get(kind, TTL_MS, () => compute(kind, database)) : compute(kind, database);
}

const TTL_MS = 10 * 60_000;
const moves = new ReadCache(20);

async function compute(kind: string, database: Database): Promise<ReadonlyMap<string, RankMove>> {
  const { rows } = await database.execute<{ listing_id: string; was: number; now: number; of: number }>(sql`
    select listing_id, was, now, of from (
      select s.listing_id,
             rank() over (order by s.initial_mean desc)::int as was,
             rank() over (order by s.mean desc)::int as now,
             count(*) over ()::int as of
        from listing_review_stats s
        join listings l on l.id = s.listing_id
       where l.kind = ${kind} and ${listed(sql`l.venue_status`)}
    ) ranked
     where was <> now`);
  return new Map(rows.map((r) => [r.listing_id, { was: r.was, now: r.now, of: r.of }]));
}

/** For the tests, which rewrite reviews and read the moves right after. */
export function clearRankMovesCache(): void {
  moves.clear();
}
