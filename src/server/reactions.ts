import { and, eq, sql } from 'drizzle-orm';
import { getDb, type Database } from '@/db';
import { listingReactions } from '@/db/schema';
import { canonicalEmoji, MAX_REACTIONS_PER_ACCOUNT } from '@/lib/reactions';
import { ApiError } from './api/errors';

/**
 * Emoji reactions to a listing (safe for work edition): the only writer of
 * `listing_reactions`. Anonymous: a reader gets a count per emoji and whether
 * they reacted with it themselves, never who else did. Like a follow, a
 * reaction is a preference: one statement, idempotent both ways.
 */

export interface ReactionCount {
  emoji: string;
  count: number;
  /** Whether the viewer reacted with it; false when anonymous. */
  mine: boolean;
}

/** A listing's reactions, most used first, ties by first use. */
export async function reactionsOf(
  listingId: string,
  viewerAccountId: string | null,
  database: Database = getDb(),
): Promise<ReactionCount[]> {
  const rows = await database
    .select({
      emoji: listingReactions.emoji,
      count: sql<number>`count(*)::int`,
      mine: viewerAccountId
        ? sql<boolean>`bool_or(${listingReactions.accountId} = ${viewerAccountId})`
        : sql<boolean>`false`,
    })
    .from(listingReactions)
    .where(eq(listingReactions.listingId, listingId))
    .groupBy(listingReactions.emoji)
    .orderBy(sql`count(*) desc`, sql`min(${listingReactions.createdAt})`);
  return rows;
}

/** The emoji, canonical, or a 400. */
export function parseEmoji(raw: string): string {
  const emoji = canonicalEmoji(raw);
  if (emoji === null) throw new ApiError(400, 'validation_error', 'a reaction is a single emoji');
  return emoji;
}

/**
 * React with `emoji`, or take it back. A new emoji past
 * `MAX_REACTIONS_PER_ACCOUNT` on one listing is a 409; repeating one is not.
 */
export async function setReaction(
  accountId: string,
  listingId: string,
  emoji: string,
  on: boolean,
  database: Database = getDb(),
): Promise<void> {
  if (!on) {
    await database
      .delete(listingReactions)
      .where(
        and(
          eq(listingReactions.listingId, listingId),
          eq(listingReactions.accountId, accountId),
          eq(listingReactions.emoji, emoji),
        ),
      );
    return;
  }
  // One statement: the count and the insert see the same snapshot. Two racing inserts may overshoot by one; harmless.
  const { rows } = await database.execute<{ n: number }>(sql`
    with mine as (
      select count(*)::int as n from ${listingReactions}
       where ${listingReactions.listingId} = ${listingId} and ${listingReactions.accountId} = ${accountId}
    ), added as (
      insert into ${listingReactions} (listing_id, account_id, emoji)
      select ${listingId}, ${accountId}, ${emoji} from mine where mine.n < ${MAX_REACTIONS_PER_ACCOUNT}
      on conflict do nothing
      returning 1
    )
    select (select n from mine) as n, (select count(*)::int from added) as added`);
  const [{ n }] = rows;
  if (n >= MAX_REACTIONS_PER_ACCOUNT) {
    const [existing] = await database
      .select({ emoji: listingReactions.emoji })
      .from(listingReactions)
      .where(
        and(
          eq(listingReactions.listingId, listingId),
          eq(listingReactions.accountId, accountId),
          eq(listingReactions.emoji, emoji),
        ),
      );
    if (!existing) {
      throw new ApiError(409, 'too_many_reactions', `at most ${MAX_REACTIONS_PER_ACCOUNT} different reactions a paper`);
    }
  }
}
