import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb, type Database } from '@/db';
import { accounts, groupMembers, groupReadingList, listingReads, listings } from '@/db/schema';
import { ApiError } from './api/errors';

/** Read markers are global preferences, independent of membership and page-view counts. */
export async function setListingRead(
  accountId: string,
  listingId: string,
  read: boolean,
  database: Database = getDb(),
) {
  if (read) {
    await database.insert(listingReads).values({ accountId, listingId }).onConflictDoNothing();
  } else {
    await database
      .delete(listingReads)
      .where(and(eq(listingReads.accountId, accountId), eq(listingReads.listingId, listingId)));
  }
}

/** Lock membership through the write so removal cannot race the authorization check. */
export async function setReadingList(
  accountId: string,
  groupId: string,
  listingId: string,
  on: boolean,
  database: Database = getDb(),
) {
  await database.transaction(async (tx) => {
    const [member] = await tx
      .select()
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.accountId, accountId)))
      .for('share');
    if (!member) throw new ApiError(403, 'forbidden', 'only reading-group members can change its reading list');
    if (on) {
      await tx.insert(groupReadingList).values({ groupId, listingId }).onConflictDoNothing();
    } else {
      await tx
        .delete(groupReadingList)
        .where(and(eq(groupReadingList.groupId, groupId), eq(groupReadingList.listingId, listingId)));
    }
  });
}

const person = { accountId: accounts.id, handle: accounts.handle, displayName: accounts.displayName };

/** Only fellow group members (or the specified group's roster). Batched for tables. */
export async function readingStatuses(
  listingIds: string[],
  viewerId: string | null,
  groupId?: string,
  database: Database = getDb(),
) {
  if (listingIds.length === 0) return [];
  const peers =
    groupId || viewerId
      ? await database
          .selectDistinct(person)
          .from(groupMembers)
          .innerJoin(accounts, eq(accounts.id, groupMembers.accountId))
          .where(
            groupId
              ? eq(groupMembers.groupId, groupId)
              : sql`${groupMembers.groupId} in (select group_id from group_members where account_id = ${viewerId})`,
          )
          .orderBy(asc(accounts.displayName), asc(accounts.id))
      : [];
  const accountIds = [...new Set([...peers.map((p) => p.accountId), ...(viewerId ? [viewerId] : [])])];
  const reads =
    accountIds.length === 0
      ? []
      : await database
          .select({ accountId: listingReads.accountId, listingId: listingReads.listingId })
          .from(listingReads)
          .where(and(inArray(listingReads.listingId, listingIds), inArray(listingReads.accountId, accountIds)));
  return listingIds.map((listingId) => {
    const readIds = new Set(reads.filter((r) => r.listingId === listingId).map((r) => r.accountId));
    return {
      listingId,
      read: viewerId !== null && readIds.has(viewerId),
      readers: peers.filter((p) => readIds.has(p.accountId)),
      memberCount: peers.length,
    };
  });
}

export async function readingList(groupId: string, viewerId: string | null, database: Database = getDb()) {
  const rows = await database
    .select({ listing: listings })
    .from(groupReadingList)
    .innerJoin(listings, eq(listings.id, groupReadingList.listingId))
    .where(eq(groupReadingList.groupId, groupId))
    .orderBy(desc(groupReadingList.createdAt), asc(listings.id));
  const statuses = await readingStatuses(
    rows.map((r) => r.listing.id),
    viewerId,
    groupId,
    database,
  );
  // Safe for work edition: each paper's venue where the market edition showed its odds.
  return {
    entries: rows.map(({ listing }, i) => ({
      listingId: listing.id,
      slug: listing.slug,
      title: listing.title,
      venue: listing.kind,
      status: statuses[i],
    })),
  };
}

/** Which of this account's groups already have a listing, for the add chooser. */
export async function readingGroupIdsForListing(
  accountId: string,
  listingId: string,
  database: Database = getDb(),
): Promise<Set<string>> {
  const rows = await database
    .select({ groupId: groupReadingList.groupId })
    .from(groupReadingList)
    .innerJoin(
      groupMembers,
      and(eq(groupMembers.groupId, groupReadingList.groupId), eq(groupMembers.accountId, accountId)),
    )
    .where(eq(groupReadingList.listingId, listingId));
  return new Set(rows.map((r) => r.groupId));
}
