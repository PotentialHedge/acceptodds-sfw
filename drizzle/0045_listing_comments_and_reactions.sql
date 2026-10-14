CREATE TABLE "listing_reactions" (
	"listing_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listing_reactions_listing_id_account_id_emoji_pk" PRIMARY KEY("listing_id","account_id","emoji"),
	CONSTRAINT "listing_reactions_emoji_length" CHECK (char_length("listing_reactions"."emoji") between 1 and 16)
);
--> statement-breakpoint
ALTER TABLE "comments" ALTER COLUMN "market_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "listing_id" uuid;--> statement-breakpoint
ALTER TABLE "listing_reactions" ADD CONSTRAINT "listing_reactions_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_reactions" ADD CONSTRAINT "listing_reactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_listing_created_idx" ON "comments" USING btree ("listing_id","created_at","id");--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_one_scope" CHECK (("comments"."market_id" is null) <> ("comments"."listing_id" is null));