CREATE TABLE "listing_version_diffs" (
	"listing_id" uuid NOT NULL,
	"from_seq" integer NOT NULL,
	"to_seq" integer NOT NULL,
	"words_added" integer NOT NULL,
	"words_removed" integer NOT NULL,
	"passages" integer NOT NULL,
	"runs" jsonb NOT NULL,
	CONSTRAINT "listing_version_diffs_listing_id_from_seq_to_seq_pk" PRIMARY KEY("listing_id","from_seq","to_seq"),
	CONSTRAINT "listing_version_diffs_order_check" CHECK ("listing_version_diffs"."from_seq" < "listing_version_diffs"."to_seq")
);
--> statement-breakpoint
CREATE TABLE "listing_versions" (
	"listing_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"ref" text NOT NULL,
	"label" text NOT NULL,
	"at" timestamp with time zone,
	"seen_at" timestamp with time zone NOT NULL,
	"words" integer NOT NULL,
	"url" text,
	CONSTRAINT "listing_versions_listing_id_seq_pk" PRIMARY KEY("listing_id","seq")
);
--> statement-breakpoint
ALTER TABLE "listing_version_diffs" ADD CONSTRAINT "listing_version_diffs_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_versions" ADD CONSTRAINT "listing_versions_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;