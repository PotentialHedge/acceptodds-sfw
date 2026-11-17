CREATE TABLE "listing_review_stats" (
	"listing_id" uuid PRIMARY KEY NOT NULL,
	"mean" numeric NOT NULL,
	"n" integer NOT NULL,
	"soundness" double precision,
	"informativeness" double precision,
	"presentation" double precision,
	"confidence" double precision
);
--> statement-breakpoint
ALTER TABLE "listing_review_stats" ADD CONSTRAINT "listing_review_stats_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "listing_review_stats" ("listing_id", "mean", "n", "soundness", "informativeness", "presentation", "confidence")
SELECT r.listing_id, round(avg(r.rating)::numeric, 2), count(*)::int,
       avg(r.soundness), avg(r.informativeness), avg(r.presentation), avg(r.confidence)
  FROM "listing_reviews" r
 WHERE r.kind = 'review' AND r.rating IS NOT NULL
 GROUP BY r.listing_id;
