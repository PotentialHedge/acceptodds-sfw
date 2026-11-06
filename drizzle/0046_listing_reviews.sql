CREATE TABLE "listing_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"kind" text NOT NULL,
	"reply_to" text,
	"author" text,
	"title" text,
	"rating" double precision,
	"scores" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"license" text,
	"posted_at" timestamp with time zone,
	CONSTRAINT "listing_reviews_kind_check" CHECK ("listing_reviews"."kind" in ('review', 'comment'))
);
--> statement-breakpoint
ALTER TABLE "listing_reviews" ADD CONSTRAINT "listing_reviews_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "listing_reviews_external_key" ON "listing_reviews" USING btree ("listing_id","external_id");--> statement-breakpoint
CREATE INDEX "listing_reviews_rated_idx" ON "listing_reviews" USING btree ("listing_id","rating") WHERE "listing_reviews"."kind" = 'review' and "listing_reviews"."rating" is not null;