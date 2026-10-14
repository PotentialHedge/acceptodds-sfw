import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { events, markets } from '@/db/schema';
import { headlinePrice } from '@/lib/headline';
import { createMarket, trade } from '@/server/engine';
import { upsertListing } from '@/server/listings';
import { shareSubject } from '@/server/share';
import { browseListings, sparklines } from '@/server/views';
import * as badgeRoute from '@/app/badge/[file]/route';
import * as shortRoute from '@/app/s/[slug]/route';
import { closePool, resetDatabase, seedMarket, STARTING_MICRO, type Fixture } from './helpers';

const db = getDb();
const UNIT = 1_000_000n;
let fx: Fixture;

beforeEach(async () => {
  await resetDatabase();
  process.env.STARTING_BALANCE_MICRO = STARTING_MICRO.toString();
  fx = await seedMarket(2, 10); // the house, two traders and an unlisted binary market ('concurrency')
}, 60_000);

afterAll(async () => {
  await closePool();
});

/** A paper with the default single market: four outcomes, best first. */
async function paper(slug: string) {
  const { listing } = await upsertListing({ slug, title: `A paper called ${slug}`, kind: 'ICLR 2027' });
  const m = await createMarket({
    slug: `${slug}-decision`,
    question: 'How will ICLR 2027 decide this paper?',
    kind: 'ICLR 2027',
    outcomes: ['Oral', 'Spotlight', 'Poster', 'Reject'],
    closesAt: new Date(Date.now() + 7 * 86_400_000),
    startingBalanceMicro: STARTING_MICRO,
    expectedTraders: 1,
    status: 'open',
    listingId: listing.id,
    listingRank: 0,
  });
  return { listing, ...m };
}

const get = (url: string, headers: Record<string, string> = {}) => new Request(`http://test.local${url}`, { headers });

describe('/s/<slug>', () => {
  it('redirects a paper, a listed market and an unlisted market, and logs the open', async () => {
    const p = await paper('p');
    // The request arrives on the server's bind address, as it does behind the
    // proxy; the redirect must still point at the public origin.
    const saved = process.env.APP_URL;
    process.env.APP_URL = 'https://share.example/';
    const go = async (slug: string) =>
      shortRoute.GET(new Request(`http://0.0.0.0:3000/s/${slug}`), { params: Promise.resolve({ slug }) });

    try {
      let res = await go('p');
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe('https://share.example/papers/p');
      res = await go('p-decision');
      expect(res.headers.get('location')).toBe('https://share.example/papers/p');
      res = await go('concurrency');
      expect(res.headers.get('location')).toBe('https://share.example/markets/concurrency');
      expect((await go('nope')).status).toBe(404);

      // The links we hand out are the short ids, one sequence for both tables.
      const [m] = await db.select().from(markets).where(eq(markets.id, fx.marketId));
      const ps = await shareSubject('p');
      expect(ps!.sharePath).toBe(`/s/${p.listing.shortId}`);
      expect((await shareSubject('concurrency'))!.sharePath).toBe(`/s/${m.shortId}`);
      expect(p.listing.shortId).not.toBe(m.shortId);
      res = await go(String(p.listing.shortId));
      expect(res.headers.get('location')).toBe('https://share.example/papers/p');
      res = await go(String(m.shortId));
      expect(res.headers.get('location')).toBe('https://share.example/markets/concurrency');
      expect((await go('999999999')).status).toBe(404);
    } finally {
      if (saved === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = saved;
    }

    await new Promise((r) => setTimeout(r, 200)); // the log writes after the response
    const logged = await db
      .select()
      .from(events)
      .where(and(eq(events.kind, 'share.opened'), eq(events.marketId, p.marketId)));
    expect(logged).toHaveLength(3);
  });

  it('hides a draft market', async () => {
    await db.update(markets).set({ status: 'draft' }).where(eq(markets.id, fx.marketId));
    expect(await shareSubject('concurrency')).toBeNull();
  });
});

describe('/badge/<slug>.svg', () => {
  const badge = (file: string, headers: Record<string, string> = {}, query = '') =>
    badgeRoute.GET(get(`/badge/${file}${query}`, headers), { params: Promise.resolve({ file }) });

  it('shows a paper’s headline and bar, and is cacheable', async () => {
    const p = await paper('p');
    // Buying Poster moves money off Reject: the headline, 1 − P(Reject), rises from 75%.
    await trade(fx.traderIds[0], p.marketId, p.outcomeIds[2], 30n * UNIT, 1_000n * UNIT);
    const res = await badge('p.svg');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/svg+xml');
    expect(res.headers.get('cache-control')).toContain('max-age=300');
    const svg = await res.text();
    expect(svg).toMatch(/>\d+% accept</);
    expect(Number(/>(\d+)% accept</.exec(svg)![1])).toBeGreaterThan(75);
    expect(svg).toContain('#c49a2c'); // the Poster segment of the bar

    // Same state, same ETag: a 304. A fill changes it.
    const tag = res.headers.get('etag')!;
    expect((await badge('p.svg', { 'if-none-match': tag })).status).toBe(304);
    await trade(fx.traderIds[1], p.marketId, p.outcomeIds[3], 5n * UNIT, 1_000n * UNIT);
    expect((await badge('p.svg', { 'if-none-match': tag })).status).toBe(200);
  });

  it('says the result once settled, and 404s what does not exist', async () => {
    const p = await paper('p');
    await db
      .update(markets)
      .set({ status: 'settled', resolvedOutcomeId: p.outcomeIds[1] })
      .where(eq(markets.id, p.marketId));
    expect(await (await badge('p.svg')).text()).toContain('Spotlight ✓');
    expect((await badge('nope.svg')).status).toBe(404);
    expect((await badge('p.png')).status).toBe(404);
  });

  it('names an unlisted binary market’s first outcome', async () => {
    expect(await (await badge('concurrency.svg', {}, '?style=compact')).text()).toContain('50% YES');
  });
});

describe('sparklines', () => {
  it('replays the headline of a four-outcome market from its fills', async () => {
    const p = await paper('p');
    await trade(fx.traderIds[0], p.marketId, p.outcomeIds[3], 10n * UNIT, 1_000n * UNIT); // Reject: down
    await trade(fx.traderIds[1], p.marketId, p.outcomeIds[1], 25n * UNIT, 1_000n * UNIT); // Spotlight: up
    const { rows } = await browseListings({ kind: 'ICLR 2027', sort: 'closing' });
    const line = (await sparklines(rows.map((r) => r.main!))).get(p.marketId)!;
    expect(line).toHaveLength(3);
    expect(line[0]).toBeCloseTo(0.75, 12); // the opening headline, 1 − 1/4
    expect(line[1]).toBeLessThan(0.75);
    expect(line[2]).toBeGreaterThan(line[1]);
    const row = rows.find((r) => r.main!.market.id === p.marketId)!;
    expect(line[2]).toBeCloseTo(headlinePrice(row.main!.outcomes.map((o) => o.price)), 12);
  });
});
