import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import { listed } from './listed';
import { getDb, type Database } from '@/db';
import { listings, markets } from '@/db/schema';

/**
 * What the crawler surfaces read (`sitemap.ts`, `llms.txt`).
 * **Reads only**, public data only: the same rows the public pages show.
 */

/** Sitemaps allow 50,000 URLs; a venue is ~30k papers (#12). */
const MAX_PAPERS = 45_000;
const MAX_UNLISTED_MARKETS = 4_000;

/**
 * Paths of every public paper and every visible market with no paper, newest
 * first. No last-modified date: a listing is re-upserted in place and keeps no
 * `updated_at`, so its creation date would claim a retitled paper unchanged.
 */
export async function sitemapPaths(database: Database = getDb()): Promise<string[]> {
  const papers = await database
    .select({ slug: listings.slug })
    .from(listings)
    .where(listed(listings.venueStatus))
    .orderBy(desc(listings.createdAt))
    .limit(MAX_PAPERS);
  const loose = await database
    .select({ slug: markets.slug })
    .from(markets)
    .where(and(isNull(markets.listingId), ne(markets.status, 'draft')))
    .orderBy(desc(markets.createdAt))
    .limit(MAX_UNLISTED_MARKETS);
  return [
    ...papers.map((p) => `/papers/${encodeURIComponent(p.slug)}`),
    ...loose.map((m) => `/markets/${encodeURIComponent(m.slug)}`),
  ];
}

export interface TopPaper {
  title: string;
  slug: string;
  kind: string | null;
}

/** The most traded open papers: what an agent should look at first. */
export async function topPapers(limit: number, database: Database = getDb()): Promise<TopPaper[]> {
  return database
    .select({ title: listings.title, slug: listings.slug, kind: listings.kind })
    .from(listings)
    .innerJoin(markets, and(eq(markets.listingId, listings.id), eq(markets.isMain, true)))
    .where(eq(markets.status, 'open'))
    .orderBy(desc(markets.volumeMicro), desc(listings.createdAt))
    .limit(limit);
}
