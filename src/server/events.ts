import { getPool } from '@/db';

/**
 * The global log (invariant §1.4).
 *
 * `events` is **never a source of truth**. Effects live in `orders`,
 * `positions` and `ledger_entries`; this holds only what would otherwise leave
 * no trace at all — above all reads: who looked at which board, and when.
 *
 * Two rules, both absolute:
 *
 *  1. **Never log a payload.** The table has no payload column and must not
 *     grow one. A payload makes the log a shadow copy of the tables above,
 *     which then disagrees with them, and nobody notices which is right.
 *  2. **A logging failure must never raise into the caller.** Nothing here
 *     rejects. A trade that succeeded and then failed to be logged is a
 *     successful trade.
 *
 * It also writes on the pool rather than inside the caller's transaction, so
 * that a failed insert cannot abort a trade. The engine calls it **after** the
 * commit, and the table carries no foreign keys, so a log write can never take
 * a lock on a row a live transaction is holding. Both of those were learned
 * the hard way: an FK on `market_id` deadlocked the engine against its own
 * `SELECT ... FOR UPDATE`.
 */
export type EventKind =
  | 'market.read'
  | 'market.list'
  | 'market.history.read'
  | 'market.tape.read'
  | 'market.created'
  | 'market.closed'
  | 'market.settled'
  | 'quote.read'
  | 'order.placed'
  | 'portfolio.read'
  | 'me.read'
  | 'me.orders.read'
  | 'token.minted'
  | 'affiliation.requested'
  | 'affiliation.confirmed'
  | 'affiliation.removed'
  | 'leaderboard.read'
  | 'account.read'
  | 'comments.read'
  | 'comment.posted'
  | 'comment.mention_mailed'
  | 'comment.backed'
  | 'comment.unbacked'
  | 'listing.list'
  | 'listing.read'
  | 'listing.text_read'
  | 'listing.created'
  | 'listing.updated'
  | 'listing.followed'
  | 'listing.unfollowed'
  | 'follows.read'
  | 'mentions.read'
  | 'group.read'
  | 'group.created'
  | 'group.updated'
  | 'group.deleted'
  | 'group.invite_rotated'
  | 'group.joined'
  | 'group.member_removed'
  | 'groups.read'
  | 'me.updated'
  | 'digest.sent'
  | 'announcement.posted'
  | 'announcement.deleted'
  | 'share.opened'
  | 'position.read'
  | 'position.published'
  | 'position.unpublished'
  | 'badge.read'
  | 'onboarding.started'
  | 'password.set'
  | 'paper_comments.read'
  | 'paper_comment.posted'
  | 'reaction.added'
  | 'reaction.removed';

export function log(kind: EventKind, ids: { accountId?: string | null; marketId?: string | null } = {}): void {
  try {
    void getPool()
      .query('insert into events (kind, account_id, market_id) values ($1, $2, $3)', [
        kind,
        ids.accountId ?? null,
        ids.marketId ?? null,
      ])
      .catch(() => {
        /* invariant §1.4: a log failure never raises into the caller. */
      });
  } catch {
    /* nor does a failure to even get a connection. */
  }
}
