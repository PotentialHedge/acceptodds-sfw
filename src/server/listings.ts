import { eq, getTableColumns, sql } from 'drizzle-orm';
import { getDb, type Database } from '@/db';
import { listingReferences, listingRelated, listings, listingTexts, type Listing, type ListingLink } from '@/db/schema';
import type { VenueStatus } from '@/lib/venue-status';
import { invalidateMap } from './map-cache';
import { invalidateBrowseReads } from './market-cache';

/**
 * Writing listings. A listing is an **opaque subject** that markets can be
 * grouped under — a title, a summary and a tldr, names and their ids,
 * keywords, a primary area, labelled links and a bibliography (`listing_references`, #38), all supplied by the creating
 * client (`../research`). The venue never fetches, checks or
 * interprets any of it; only the UI calls a listing a "paper".
 *
 * This is not market state: no money, no shares, no prices. It is written
 * here, in its own small transaction, and never by the engine or inside a
 * trade. A market is attached to a listing when the engine creates it.
 */

export interface UpsertListingInput {
  slug: string;
  title: string;
  summary?: string | null;
  tldr?: string | null;
  authors?: string[];
  /** One opaque id per name in `authors`, or empty. */
  authorIds?: string[];
  keywords?: string[];
  primaryArea?: string | null;
  links?: ListingLink[];
  kind?: string | null;
  /** The bibliography, in order (#38). Replaced whole, like every other field. */
  references?: ReferenceInput[];
}

export interface RelatedInput {
  /** The related work's listing slug. Matched when read, so it need not exist yet. */
  slug: string;
  /** The similarity service's own score. Not interpreted. */
  score: number;
}

export interface ReferenceInput {
  title: string;
  authors?: string[];
  year?: number | null;
  venue?: string | null;
  url?: string | null;
  /** The cited work's listing slug, if it has (or may get) one here. Matched when read. */
  citedSlug?: string | null;
}

/**
 * Create the listing with this slug, or replace every field of the existing
 * one. A full replacement, so repeating a call is a no-op and a field left out
 * is cleared rather than silently kept.
 */
export async function upsertListing(
  input: UpsertListingInput,
  database: Database = getDb(),
): Promise<{ listing: Listing; created: boolean }> {
  const values = {
    title: input.title,
    summary: input.summary ?? null,
    tldr: input.tldr ?? null,
    authors: input.authors ?? [],
    authorIds: input.authorIds ?? [],
    keywords: input.keywords ?? [],
    primaryArea: input.primaryArea ?? null,
    links: input.links ?? [],
    kind: input.kind ?? null,
  };
  const result = await database.transaction(async (tx) => {
    const [{ created, ...listing }] = await tx
      .insert(listings)
      .values({ slug: input.slug, ...values })
      .onConflictDoUpdate({ target: listings.slug, set: values })
      // `xmax = 0` holds only for a row version this statement inserted.
      .returning({ ...getTableColumns(listings), created: sql<boolean>`(xmax = 0)` });
    await tx.delete(listingReferences).where(eq(listingReferences.listingId, listing.id));
    const refs = input.references ?? [];
    if (refs.length > 0) {
      await tx.insert(listingReferences).values(
        refs.map((r, position) => ({
          listingId: listing.id,
          position,
          title: r.title,
          authors: r.authors ?? [],
          year: r.year ?? null,
          venue: r.venue ?? null,
          url: r.url ?? null,
          citedSlug: r.citedSlug ?? null,
        })),
      );
    }
    return { listing, created };
  });
  // A slug on the map is shown once it is listed, under the listing's title.
  invalidateMap();
  invalidateBrowseReads();
  return result;
}

/**
 * Replace a listing's full text (`listing_texts`) and its opaque `source`,
 * whole: a text sent without a source has none. A call of its own, like the
 * related list, so whatever extracts the text and whatever writes the listing
 * never clear each other's. Empty clears it.
 */
export async function setText(
  listing: Pick<Listing, 'id'>,
  text: string | null,
  source: string | null = null,
  database: Database = getDb(),
): Promise<number> {
  if (!text) {
    await database.delete(listingTexts).where(eq(listingTexts.listingId, listing.id));
    return 0;
  }
  await database
    .insert(listingTexts)
    .values({ listingId: listing.id, body: text, source })
    .onConflictDoUpdate({ target: listingTexts.listingId, set: { body: text, source } });
  return text.length;
}

/**
 * Close a listing to new markets, or open it again. Closing keeps the time
 * it was first closed; it leaves the listing's markets alone (closing those is
 * the engine's, `POST /markets/{id}/close`). One statement, never the engine.
 */
export async function setClosed(
  listing: Pick<Listing, 'id'>,
  closed: boolean,
  database: Database = getDb(),
): Promise<Date | null> {
  const [row] = await database
    .update(listings)
    .set({ closedAt: closed ? sql`coalesce(${listings.closedAt}, now())` : null })
    .where(eq(listings.id, listing.id))
    .returning({ closedAt: listings.closedAt });
  invalidateBrowseReads();
  return row?.closedAt ?? null;
}

/**
 * Mark a listing withdrawn or desk-rejected, or clear it (`null`: a withdrawal
 * can be reverted). Idempotent: the time is kept while the status stays the
 * same, and restarts when it changes.
 */
export async function setVenueStatus(
  listing: Pick<Listing, 'id'>,
  status: VenueStatus | null,
  database: Database = getDb(),
): Promise<{ venueStatus: VenueStatus | null; venueStatusAt: Date | null }> {
  const [row] = await database
    .update(listings)
    .set({
      venueStatus: status,
      venueStatusAt:
        status === null
          ? null
          : sql`case when ${listings.venueStatus} = ${status} then ${listings.venueStatusAt} else now() end`,
    })
    .where(eq(listings.id, listing.id))
    .returning({ venueStatus: listings.venueStatus, venueStatusAt: listings.venueStatusAt });
  invalidateBrowseReads();
  invalidateMap();
  return { venueStatus: row?.venueStatus ?? null, venueStatusAt: row?.venueStatusAt ?? null };
}

/**
 * Replace a listing's related listings with this list, in order (best first).
 * Whole-list replacement, like the bibliography, but a call of its own: the
 * similarity service writes this, `../research` writes the listing. A listing
 * relating to itself is dropped, and so is a repeated slug (the first wins).
 */
export async function setRelated(
  listing: Pick<Listing, 'id' | 'slug'>,
  related: RelatedInput[],
  database: Database = getDb(),
): Promise<number> {
  const seen = new Set<string>([listing.slug]);
  const kept = related.filter((r) => !seen.has(r.slug) && seen.add(r.slug));
  await database.transaction(async (tx) => {
    await tx.delete(listingRelated).where(eq(listingRelated.listingId, listing.id));
    if (kept.length > 0) {
      await tx
        .insert(listingRelated)
        .values(kept.map((r, position) => ({ listingId: listing.id, position, relatedSlug: r.slug, score: r.score })));
    }
  });
  invalidateMap();
  return kept.length;
}

/**
 * Replace the cleaned keywords (`listings.tags`) of each listing named, by slug, in one statement. A slug
 * with no listing is skipped; a listing not named keeps its tags. Returns how many listings changed.
 */
export async function setTags(
  entries: readonly { slug: string; tags: readonly string[] }[],
  database: Database = getDb(),
): Promise<number> {
  if (entries.length === 0) return 0;
  const result = await database.execute(sql`
    update listings l
       set tags = array(select jsonb_array_elements_text(t.tags))
      from jsonb_to_recordset(${JSON.stringify(entries)}::jsonb) as t(slug text, tags jsonb)
     where l.slug = t.slug
       and l.tags is distinct from array(select jsonb_array_elements_text(t.tags))
  `);
  if ((result.rowCount ?? 0) > 0) invalidateBrowseReads();
  return result.rowCount ?? 0;
}
