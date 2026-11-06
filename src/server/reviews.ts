import { asc, eq, sql } from 'drizzle-orm';
import { getDb, type Database } from '@/db';
import {
  listingReviews,
  type Listing,
  type ListingReview,
  type ListingReviewScore,
  type ListingReviewSection,
} from '@/db/schema';

export interface ReviewInput {
  externalId: string;
  kind: 'review' | 'comment';
  replyTo?: string | null;
  author?: string | null;
  title?: string | null;
  rating?: number | null;
  scores?: ListingReviewScore[];
  sections?: ListingReviewSection[];
  license?: string | null;
  postedAt?: string | null;
}

/** A listing's reviews and comments, oldest first. */
export function reviewsOf(listingId: string, database: Database = getDb()): Promise<ListingReview[]> {
  return database
    .select()
    .from(listingReviews)
    .where(eq(listingReviews.listingId, listingId))
    .orderBy(sql`${listingReviews.postedAt} asc nulls last`, asc(listingReviews.externalId));
}

/**
 * Replace a listing's reviews and comments, whole, in one transaction: a reader
 * sees the old set or the new, and one the source took down goes. Its own call,
 * like the full text, so whatever writes the listing never clears these.
 */
export async function setReviews(
  listing: Pick<Listing, 'id'>,
  items: readonly ReviewInput[],
  database: Database = getDb(),
): Promise<{ reviews: number; comments: number }> {
  await database.transaction(async (tx) => {
    await tx.delete(listingReviews).where(eq(listingReviews.listingId, listing.id));
    if (items.length === 0) return;
    await tx.insert(listingReviews).values(
      items.map((x) => ({
        listingId: listing.id,
        externalId: x.externalId,
        kind: x.kind,
        replyTo: x.replyTo ?? null,
        author: x.author ?? null,
        title: x.title ?? null,
        // A comment has no rating, whatever is sent: the field counts only reviews.
        rating: x.kind === 'review' ? (x.rating ?? null) : null,
        scores: x.scores ?? [],
        sections: x.sections ?? [],
        license: x.license ?? null,
        postedAt: x.postedAt ? new Date(x.postedAt) : null,
      })),
    );
  });
  const reviews = items.filter((x) => x.kind === 'review').length;
  return { reviews, comments: items.length - reviews };
}
