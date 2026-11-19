import { asc, eq, sql } from 'drizzle-orm';
import { getDb, type Database } from '@/db';
import {
  listingReviews,
  listingReviewStats,
  type Listing,
  type ListingReview,
  type ListingReviewScore,
  type ListingReviewScoreChange,
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
  scoreChanges?: ListingReviewScoreChange[];
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
    // The summary goes with them, and comes back below from whatever was written.
    await tx.delete(listingReviewStats).where(eq(listingReviewStats.listingId, listing.id));
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
        // Like the rating, a comment has none.
        scoreChanges: x.kind === 'review' ? (x.scoreChanges ?? []) : [],
        sections: x.sections ?? [],
        license: x.license ?? null,
        postedAt: x.postedAt ? new Date(x.postedAt) : null,
      })),
    );
    // As migration 0052 first filled it: nothing when no review has a rating.
    await tx.execute(sql`
      insert into listing_review_stats (listing_id, mean, initial_mean, n, soundness, informativeness, presentation, confidence)
      select r.listing_id, round(avg(r.rating)::numeric, 2),
             -- Each review's first recorded rating (as migration 0053 filled it), else its rating.
             round(avg(coalesce(
               (select (c->>'from')::numeric from jsonb_array_elements(r.score_changes) c
                 where lower(c->>'label') = 'rating' limit 1),
               r.rating))::numeric, 2),
             count(*)::int,
             avg(r.soundness), avg(r.informativeness), avg(r.presentation), avg(r.confidence)
        from listing_reviews r
       where r.listing_id = ${listing.id} and r.kind = 'review' and r.rating is not null
       group by r.listing_id`);
  });
  const reviews = items.filter((x) => x.kind === 'review').length;
  return { reviews, comments: items.length - reviews };
}
