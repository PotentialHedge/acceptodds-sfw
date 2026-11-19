ALTER TABLE "listing_review_stats" ADD COLUMN "initial_mean" numeric;--> statement-breakpoint
UPDATE "listing_review_stats" s
   SET "initial_mean" = f.initial_mean
  FROM (
    SELECT r.listing_id,
           round(avg(coalesce(
             (SELECT (c->>'from')::numeric FROM jsonb_array_elements(r.score_changes) c
               WHERE lower(c->>'label') = 'rating' LIMIT 1),
             r.rating))::numeric, 2) AS initial_mean
      FROM "listing_reviews" r
     WHERE r.kind = 'review' AND r.rating IS NOT NULL
     GROUP BY r.listing_id
  ) f
 WHERE f.listing_id = s.listing_id;--> statement-breakpoint
UPDATE "listing_review_stats" SET "initial_mean" = "mean" WHERE "initial_mean" IS NULL;--> statement-breakpoint
ALTER TABLE "listing_review_stats" ALTER COLUMN "initial_mean" SET NOT NULL;
