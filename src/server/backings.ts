import { and, eq, sql } from 'drizzle-orm';
import { getDb, type Database } from '@/db';
import { accounts, commentBackings, comments, markets, outcomes, positions } from '@/db/schema';
import { ApiError } from './api/errors';

/**
 * Putting stake behind a comment, and taking it back.
 *
 * A backing is a claim on part of the backer's position in one outcome of the
 * comment's market: for each (account, outcome), Σ backing ≤ position. No
 * reputation moves; the shares stay where they are. Rules:
 *
 *   - only on an **open** market (status `open`, before `closes_at`): the same
 *     window in which the position can change, so nothing is backed that a
 *     sell could no longer trim;
 *   - never on your own comment;
 *   - only shares you hold and have not already put behind another comment.
 *
 * The invariant is kept on both sides. Here, a backing is inserted in a short
 * transaction holding the backer's `accounts` row `FOR UPDATE`; `engine.trade()`
 * locks the same row (second, after the market) and trims backings LIFO on a
 * sell. So a sell and a backing on one account serialize, and whichever runs
 * second sees the other's effect. No market lock is taken here, so there is no
 * lock-order inversion with trade().
 *
 * One race is left open on purpose: settlement zeroes positions under the
 * market lock, which this does not take (taking positions after accounts
 * would invert settlement's order). A backing that commits just before a
 * settlement is simply a backing made before it, kept as a frozen record.
 */

export async function backComment(
  input: { commentId: string; accountId: string; outcomeId: string; sharesMicro: bigint },
  database: Database = getDb(),
): Promise<{ marketId: string }> {
  if (input.sharesMicro <= 0n) {
    throw new ApiError(400, 'validation_error', 'sharesMicro must be positive');
  }
  return database.transaction(async (tx) => {
    const [row] = await tx
      .select({ authorId: comments.accountId, market: markets })
      .from(comments)
      .innerJoin(markets, eq(markets.id, comments.marketId))
      .where(eq(comments.id, input.commentId));
    if (!row) throw new ApiError(404, 'not_found', `no comment ${input.commentId}`);
    const { market } = row;

    const [outcome] = await tx
      .select({ id: outcomes.id })
      .from(outcomes)
      .where(and(eq(outcomes.id, input.outcomeId), eq(outcomes.marketId, market.id)));
    if (!outcome) throw new ApiError(404, 'not_found', `outcome ${input.outcomeId} is not on this comment's market`);

    if (row.authorId === input.accountId) {
      throw new ApiError(409, 'own_comment', 'you cannot back your own comment');
    }
    if (market.status !== 'open') {
      throw new ApiError(409, 'market_not_open', `market is ${market.status}`);
    }
    if (market.closesAt.getTime() <= Date.now()) {
      throw new ApiError(409, 'market_closed', 'market has closed');
    }

    // The same row trade() locks second. Everything read below is read after
    // any sell on this account has committed, and no sell can start trimming
    // until this backing has.
    const [account] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, input.accountId))
      .for('update');
    if (!account) throw new ApiError(404, 'not_found', 'no such account');

    const [held] = await tx
      .select({ sharesMicro: positions.sharesMicro })
      .from(positions)
      .where(and(eq(positions.accountId, input.accountId), eq(positions.outcomeId, input.outcomeId)));
    const heldMicro = held?.sharesMicro ?? 0n;

    // sum(bigint) is numeric: read it as text, never as a JS number (§1.6).
    const [alloc] = await tx
      .select({ total: sql<string>`coalesce(sum(${commentBackings.sharesMicro}), 0)::text` })
      .from(commentBackings)
      .where(and(eq(commentBackings.accountId, input.accountId), eq(commentBackings.outcomeId, input.outcomeId)));
    const allocatedMicro = BigInt(alloc.total);

    if (allocatedMicro + input.sharesMicro > heldMicro) {
      const available = heldMicro > allocatedMicro ? heldMicro - allocatedMicro : 0n;
      throw new ApiError(409, 'insufficient_stake', 'not enough unallocated shares of this outcome', {
        heldMicro: heldMicro.toString(),
        allocatedMicro: allocatedMicro.toString(),
        availableMicro: available.toString(),
      });
    }

    await tx.insert(commentBackings).values({
      commentId: input.commentId,
      accountId: input.accountId,
      outcomeId: input.outcomeId,
      sharesMicro: input.sharesMicro,
    });
    return { marketId: market.id };
  });
}

/**
 * Remove all of an account's backing from one comment. Idempotent: nothing to
 * remove is not an error. Only ever shrinks a claim, so it needs no lock
 * beyond the rows it deletes.
 */
export async function withdrawBacking(
  input: { commentId: string; accountId: string },
  database: Database = getDb(),
): Promise<{ marketId: string }> {
  const [comment] = await database
    .select({ marketId: comments.marketId })
    .from(comments)
    .where(eq(comments.id, input.commentId));
  // A paper's comment (safe for work edition) has no market and no backing.
  if (!comment?.marketId) throw new ApiError(404, 'not_found', `no comment ${input.commentId}`);
  await database
    .delete(commentBackings)
    .where(and(eq(commentBackings.commentId, input.commentId), eq(commentBackings.accountId, input.accountId)));
  return { marketId: comment.marketId };
}
