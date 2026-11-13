import { and, asc, eq } from 'drizzle-orm';
import { getDb, type Database } from '@/db';
import { ApiError } from '@/server/api/errors';
import {
  listingVersionDiffs,
  listingVersions,
  type DiffRun,
  type Listing,
  type ListingVersion,
  type ListingVersionDiff,
} from '@/db/schema';

export interface VersionsInput {
  versions: {
    ref: string;
    label: string;
    at?: string | null;
    seenAt: string;
    words: number;
    url?: string | null;
  }[];
  diffs: {
    from: number;
    to: number;
    wordsAdded: number;
    wordsRemoved: number;
    passages: number;
    runs: DiffRun[];
  }[];
}

export type DiffStats = Omit<ListingVersionDiff, 'runs' | 'listingId'>;

/** A listing's versions, oldest first, and the counts of every diff between them (not the text). */
export async function versionsOf(
  listingId: string,
  database: Database = getDb(),
): Promise<{ versions: ListingVersion[]; diffs: DiffStats[] }> {
  const [versions, diffs] = await Promise.all([
    database
      .select()
      .from(listingVersions)
      .where(eq(listingVersions.listingId, listingId))
      .orderBy(asc(listingVersions.seq)),
    database
      .select({
        fromSeq: listingVersionDiffs.fromSeq,
        toSeq: listingVersionDiffs.toSeq,
        wordsAdded: listingVersionDiffs.wordsAdded,
        wordsRemoved: listingVersionDiffs.wordsRemoved,
        passages: listingVersionDiffs.passages,
      })
      .from(listingVersionDiffs)
      .where(eq(listingVersionDiffs.listingId, listingId)),
  ]);
  return { versions, diffs };
}

/** One diff, with its text; null when there is none for that pair. */
export async function versionDiff(
  listingId: string,
  fromSeq: number,
  toSeq: number,
  database: Database = getDb(),
): Promise<ListingVersionDiff | null> {
  const [row] = await database
    .select()
    .from(listingVersionDiffs)
    .where(
      and(
        eq(listingVersionDiffs.listingId, listingId),
        eq(listingVersionDiffs.fromSeq, fromSeq),
        eq(listingVersionDiffs.toSeq, toSeq),
      ),
    );
  return row ?? null;
}

/**
 * Replace a listing's versions and diffs, whole, in one transaction. Its own call, like the
 * reviews, so writing the listing keeps them. A diff must name two versions, older first.
 */
export async function setVersions(
  listing: Pick<Listing, 'id'>,
  x: VersionsInput,
  database: Database = getDb(),
): Promise<{ versions: number; diffs: number }> {
  for (const d of x.diffs) {
    if (!(d.from < d.to && d.to < x.versions.length)) {
      throw new ApiError(
        400,
        'validation_error',
        `diff ${d.from}→${d.to} does not name two of the ${x.versions.length} versions, older first`,
      );
    }
  }
  await database.transaction(async (tx) => {
    await tx.delete(listingVersionDiffs).where(eq(listingVersionDiffs.listingId, listing.id));
    await tx.delete(listingVersions).where(eq(listingVersions.listingId, listing.id));
    if (x.versions.length === 0) return;
    await tx.insert(listingVersions).values(
      x.versions.map((v, seq) => ({
        listingId: listing.id,
        seq,
        ref: v.ref,
        label: v.label,
        at: v.at ? new Date(v.at) : null,
        seenAt: new Date(v.seenAt),
        words: v.words,
        url: v.url ?? null,
      })),
    );
    // One at a time: each holds a whole paper's text.
    for (const d of x.diffs) {
      await tx.insert(listingVersionDiffs).values({
        listingId: listing.id,
        fromSeq: d.from,
        toSeq: d.to,
        wordsAdded: d.wordsAdded,
        wordsRemoved: d.wordsRemoved,
        passages: d.passages,
        runs: d.runs,
      });
    }
  });
  return { versions: x.versions.length, diffs: x.diffs.length };
}
