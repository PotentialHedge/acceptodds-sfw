import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { events, markets } from '@/db/schema';
import { createMarket } from '@/server/engine';
import { upsertListing } from '@/server/listings';
import { shareSubject } from '@/server/share';
import * as shortRoute from '@/app/s/[slug]/route';
import { closePool, resetDatabase, seedMarket, STARTING_MICRO, type Fixture } from './helpers';

const db = getDb();
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
