import { eq } from 'drizzle-orm';
import { getDb, type Database } from '@/db';
import { listingRevisions, type Listing, type ListingRevision, type ListingRevisionHunk } from '@/db/schema';

export interface RevisionInput {
  versionRef: string;
  revisedAt: string;
  currentUrl?: string | null;
  historyUrl?: string | null;
  wordsBefore: number;
  wordsAfter: number;
  wordsAdded: number;
  wordsRemoved: number;
  passages: number;
  hunks: ListingRevisionHunk[];
}

/** What changed in a listing's document since it was submitted, or null when nothing has. */
export async function revisionOf(listingId: string, database: Database = getDb()): Promise<ListingRevision | null> {
  const [row] = await database.select().from(listingRevisions).where(eq(listingRevisions.listingId, listingId));
  return row ?? null;
}

/** Replace a listing's revision diff, whole. Its own call, like the reviews, so writing the listing keeps it. */
export async function setRevision(
  listing: Pick<Listing, 'id'>,
  x: RevisionInput,
  database: Database = getDb(),
): Promise<void> {
  const values = {
    versionRef: x.versionRef,
    revisedAt: new Date(x.revisedAt),
    currentUrl: x.currentUrl ?? null,
    historyUrl: x.historyUrl ?? null,
    wordsBefore: x.wordsBefore,
    wordsAfter: x.wordsAfter,
    wordsAdded: x.wordsAdded,
    wordsRemoved: x.wordsRemoved,
    passages: x.passages,
    hunks: x.hunks,
    updatedAt: new Date(),
  };
  await database
    .insert(listingRevisions)
    .values({ listingId: listing.id, ...values })
    .onConflictDoUpdate({ target: listingRevisions.listingId, set: values });
}

/** Clear it: the current version is the submitted one again. */
export async function clearRevision(listing: Pick<Listing, 'id'>, database: Database = getDb()): Promise<void> {
  await database.delete(listingRevisions).where(eq(listingRevisions.listingId, listing.id));
}
