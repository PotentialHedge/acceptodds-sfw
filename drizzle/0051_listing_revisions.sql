CREATE TABLE "listing_revisions" (
	"listing_id" uuid PRIMARY KEY NOT NULL,
	"version_ref" text NOT NULL,
	"revised_at" timestamp with time zone NOT NULL,
	"current_url" text,
	"history_url" text,
	"words_before" integer NOT NULL,
	"words_after" integer NOT NULL,
	"words_added" integer NOT NULL,
	"words_removed" integer NOT NULL,
	"passages" integer NOT NULL,
	"hunks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listing_revisions" ADD CONSTRAINT "listing_revisions_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;