ALTER TABLE "listings" ADD COLUMN "venue_status" text;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "venue_status_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_venue_status_check" CHECK ("listings"."venue_status" in ('withdrawn', 'desk_rejected'));--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_venue_status_at_check" CHECK (("listings"."venue_status" is null) = ("listings"."venue_status_at" is null));