-- Rewrites the table, past the pool's statement timeout on a venue's reviews. For this transaction only.
SET LOCAL statement_timeout = 0;--> statement-breakpoint
ALTER TABLE "listing_reviews" ADD COLUMN "soundness" double precision GENERATED ALWAYS AS ((jsonb_path_query_first(scores, '$[*] ? (@.label == "Soundness").value'))::float8) STORED;--> statement-breakpoint
ALTER TABLE "listing_reviews" ADD COLUMN "informativeness" double precision GENERATED ALWAYS AS ((jsonb_path_query_first(scores, '$[*] ? (@.label == "Informativeness").value'))::float8) STORED;--> statement-breakpoint
ALTER TABLE "listing_reviews" ADD COLUMN "presentation" double precision GENERATED ALWAYS AS ((jsonb_path_query_first(scores, '$[*] ? (@.label == "Presentation").value'))::float8) STORED;--> statement-breakpoint
ALTER TABLE "listing_reviews" ADD COLUMN "confidence" double precision GENERATED ALWAYS AS ((jsonb_path_query_first(scores, '$[*] ? (@.label == "Confidence").value'))::float8) STORED;