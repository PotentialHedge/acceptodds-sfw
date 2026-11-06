-- What reviewers wrote, for the `review:` search. Stored and not declared in src/db/schema.ts, as on
-- listings (0006): a phrase's GIN match is lossy, and rechecking an expression would rebuild the vector
-- from de-TOASTed sections for every candidate. Only the text is indexed: every review's section labels
-- are alike, so "paper" would otherwise match them all.
CREATE FUNCTION review_search_vector(sections jsonb)
RETURNS tsvector
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT pg_catalog.jsonb_to_tsvector(
    'pg_catalog.english'::regconfig,
    pg_catalog.jsonb_path_query_array(sections, '$[*].text'),
    '["string"]'::jsonb
  )
$$;
--> statement-breakpoint
-- Rewrites the table and builds the index over every review's text, minutes at 125k reviews: past the
-- pool's statement timeout. For this transaction only.
SET LOCAL statement_timeout = 0;--> statement-breakpoint
ALTER TABLE "listing_reviews" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (review_search_vector(sections)) STORED;--> statement-breakpoint
CREATE INDEX "listing_reviews_search_idx" ON "listing_reviews" USING gin (search_vector);
