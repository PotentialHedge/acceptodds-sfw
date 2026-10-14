import { eq } from 'drizzle-orm';
import { getDb, type Database } from '@/db';
import { listings, markets, type Listing } from '@/db/schema';
import { shares } from '@/lib/format';
import { publicPositionPath, shortPath } from '@/lib/links';
import type { PublicPositionView } from './public-positions';
import { listingView, marketView, resolveListing, resolveMarket, type MarketView } from './views';
import { ApiError } from './api/errors';

/**
 * What the share surfaces read (issue #11): the short link `/s/<n>`, the
 * preview images, the badge and the text share. **Reads only**, through
 * `views.ts`; prices, never values (§1.1).
 */

/** The public origin, for absolute links in previews, badges and share text. */
export function siteUrl(): string {
  return (process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
}

/** The name on the badge. */
export function siteName(): string {
  return process.env.SITE_NAME ?? 'acceptodds';
}

export interface ShareSubject {
  /** The paper, or null for a market with no listing. */
  listing: Listing | null;
  /** The main market (rank 0), or the market itself; null for a listing with no visible market. */
  main: MarketView | null;
  title: string;
  kind: string | null;
  /** The page, e.g. `/papers/<slug>`. */
  path: string;
  /** The short link, `/s/<n>`. */
  sharePath: string;
}

/**
 * A short id, slug or id as something to share: a listing first, else a
 * market with no listing. `null` when neither exists, or the market is a
 * draft — a listed market is shared as its listing. All digits is a short id
 * (`listings.short_id` and `markets.short_id` share one sequence, so it names
 * one of them); anything else is a slug or uuid, which the badge's URL uses.
 */
export async function shareSubject(ref: string, database: Database = getDb()): Promise<ShareSubject | null> {
  if (/^\d{1,15}$/.test(ref)) {
    const id = Number(ref);
    const [l] = await database.select({ id: listings.id }).from(listings).where(eq(listings.shortId, id));
    if (l) return shareSubject(l.id, database);
    const [m] = await database.select({ id: markets.id }).from(markets).where(eq(markets.shortId, id));
    return m ? shareSubject(m.id, database) : null;
  }
  const listing = await resolveListing(ref, database).catch(notFoundAsNull);
  if (listing) {
    const view = await listingView(listing, database);
    return {
      listing,
      main: view.markets[0] ?? null,
      title: listing.title,
      kind: listing.kind ?? view.markets[0]?.market.kind ?? null,
      path: `/papers/${encodeURIComponent(listing.slug)}`,
      sharePath: shortPath(listing.shortId),
    };
  }
  const market = await resolveMarket(ref, database).catch(notFoundAsNull);
  if (!market || market.status === 'draft') return null;
  if (market.listingId) {
    const parent = await resolveListing(market.listingId, database);
    return shareSubject(parent.id, database);
  }
  return {
    listing: null,
    main: await marketView(market, database),
    title: market.question,
    kind: market.kind,
    path: `/markets/${encodeURIComponent(market.slug)}`,
    sharePath: shortPath(market.shortId),
  };
}

function notFoundAsNull(err: unknown): null {
  if (err instanceof ApiError && err.status === 404) return null;
  throw err;
}

/**
 * A public position (#36) as something to share: its own market, which need
 * not be its paper's main one, under the paper's title.
 */
export async function positionSubject(p: PublicPositionView, database: Database = getDb()): Promise<ShareSubject> {
  const listing = p.market.listingSlug ? await resolveListing(p.market.listingSlug, database) : null;
  return {
    listing,
    main: await marketView(await resolveMarket(p.market.id, database), database),
    title: listing?.title ?? p.market.question,
    kind: listing?.kind ?? p.market.kind,
    path: publicPositionPath(p.id),
    sharePath: publicPositionPath(p.id),
  };
}

/** What a public position says in one line: "@alice holds 120 Oral", "@alice held Oral, sold since", "… : won". */
export function positionLine(p: PublicPositionView): string {
  const who = `@${p.trader.handle}`;
  switch (p.state) {
    case 'held':
      return `${who} holds ${shares(p.heldMicro)} ${p.outcome.label}`;
    case 'sold':
      return `${who} held ${p.outcome.label}, sold since`;
    case 'won':
    case 'lost':
      return `${who} held ${shares(p.heldMicro)} ${p.outcome.label}: ${p.state}`;
    case 'void':
      return `${who} held ${p.outcome.label}: void`;
  }
}
