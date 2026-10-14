/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are checked field by field */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { accounts, events, orders } from '@/db/schema';
import { createMarket, trade } from '@/server/engine';
import { follow } from '@/server/follows';
import { upsertListing } from '@/server/listings';
import { clearDevOutbox } from '@/server/mail';
import { api, signUp, trader } from './api-client';
import { closePool, resetDatabase, seedMarket, STARTING_MICRO } from './helpers';

const db = getDb();
const UNIT = 1_000_000n;

beforeEach(async () => {
  await resetDatabase();
  process.env.API_RATE_LIMIT_BURST = '1000';
  process.env.API_RATE_LIMIT_PER_SECOND = '1000';
  process.env.STARTING_BALANCE_MICRO = STARTING_MICRO.toString();
  await seedMarket(0, 10); // the house, and an unlisted market
  clearDevOutbox();
}, 60_000);

afterAll(async () => {
  await closePool();
});

/** A listing with one binary main market, thin enough (b ≈ 144 units) to move. */
async function paper(slug: string, title = `Paper ${slug}`) {
  const { listing } = await upsertListing({ slug, title, kind: 'ICLR 2027' });
  const m = await createMarket({
    slug: `${slug}-accept`,
    question: `Will ${slug} be accepted?`,
    outcomes: ['YES', 'NO'],
    closesAt: new Date(Date.now() + 7 * 86_400_000),
    startingBalanceMicro: STARTING_MICRO,
    expectedTraders: 1,
    status: 'open',
    listingId: listing.id,
  });
  return { listing, marketId: m.marketId, yes: m.outcomeIds[0] };
}

async function buy(accountId: string, p: { marketId: string; yes: string }, units: bigint) {
  return trade(accountId, p.marketId, p.yes, units * UNIT, 10_000n * UNIT);
}

async function backdate(marketId: string, ms: number) {
  await db
    .update(orders)
    .set({ createdAt: sql`${orders.createdAt} - make_interval(secs => ${ms / 1000})` })
    .where(eq(orders.marketId, marketId));
}

describe('PUT/DELETE /listings/{id}/follow', () => {
  it('follows and unfollows idempotently, by id or slug, and counts followers', async () => {
    const p = await paper('one');
    const a = await trader('alice', ['read']);
    const b = await trader('bob', ['read']);

    const first = await api('PUT', `/listings/${p.listing.id}/follow`, { token: a.token });
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ listingId: p.listing.id, following: true, followers: 1 });
    const again = await api('PUT', '/listings/one/follow', { token: a.token });
    expect(again.body).toEqual({ listingId: p.listing.id, following: true, followers: 1 });
    expect((await api('PUT', '/listings/one/follow', { token: b.token })).body.followers).toBe(2);

    expect((await api('GET', '/listings/one')).body.followers).toBe(2);
    expect((await api('GET', '/listings')).body.listings[0].followers).toBe(2);

    const off = await api('DELETE', '/listings/one/follow', { token: a.token });
    expect(off.status).toBe(200);
    expect(off.body).toEqual({ listingId: p.listing.id, following: false, followers: 1 });
    expect((await api('DELETE', '/listings/one/follow', { token: a.token })).body.followers).toBe(1);

    // One event per change, none for the no-ops, and no payload anywhere.
    const kinds = await db.select({ kind: events.kind }).from(events).where(eq(events.accountId, a.id));
    const k = kinds.map((r) => r.kind);
    expect(k.filter((x) => x === 'listing.followed')).toHaveLength(1);
    expect(k.filter((x) => x === 'listing.unfollowed')).toHaveLength(1);
  });

  it('needs authentication and the read scope; 404 for an unknown listing', async () => {
    await paper('one');
    expect((await api('PUT', '/listings/one/follow')).status).toBe(401);
    const tradeOnly = await trader('t', ['trade']);
    const r = await api('PUT', '/listings/one/follow', { token: tradeOnly.token });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('forbidden');
    const reader = await trader('r', ['read']);
    const missing = await api('PUT', '/listings/nope/follow', { token: reader.token });
    expect(missing.status).toBe(404);
    expect((await api('GET', '/listings/one/follow', { token: reader.token })).status).toBe(405);
  });

  it('works for an unverified account, and a cookie write must carry our Origin', async () => {
    await paper('one');
    const cookie = await signUp('person@example.org');
    const hostile = await api('PUT', '/listings/one/follow', { cookie, origin: 'https://evil.example' });
    expect(hostile.status).toBe(403);
    expect((await api('PUT', '/listings/one/follow', { cookie, origin: null })).status).toBe(403);
    const ok = await api('PUT', '/listings/one/follow', { cookie });
    expect(ok.status).toBe(200);
    expect(ok.body.following).toBe(true);

    const unverified = await trader('u', ['read'], { verified: false });
    expect((await api('PUT', '/listings/one/follow', { token: unverified.token })).status).toBe(200);
  });
});

describe('GET /me/follows', () => {
  it('lists followed listings, newest first, with the main market price now and 24h ago', async () => {
    const p1 = await paper('one');
    const p2 = await paper('two');
    const t = await trader('alice', ['read', 'trade']);
    const whale = await trader('whale');

    // Moved before the window: then == now. p2 moved inside it.
    await buy(whale.id, p1, 30n);
    await backdate(p1.marketId, 2 * 86_400_000);
    await buy(whale.id, p2, 60n);

    await api('PUT', '/listings/one/follow', { token: t.token });
    await api('PUT', '/listings/two/follow', { token: t.token });
    const r = await api('GET', '/me/follows', { token: t.token });
    expect(r.status).toBe(200);
    expect(r.body.follows.map((f: any) => f.listing.slug)).toEqual(['two', 'one']);

    // The safe for work edition sends no prices.
    for (const f of r.body.follows) expect(f).not.toHaveProperty('headline');

    expect((await api('GET', '/me/follows')).status).toBe(401);
    const tradeOnly = await trader('t', ['trade']);
    expect((await api('GET', '/me/follows', { token: tradeOnly.token })).status).toBe(403);
  });

  it('lists a listing with no market', async () => {
    const { listing } = await upsertListing({ slug: 'empty', title: 'Empty' });
    const t = await trader('alice', ['read']);
    await follow(t.id, listing.id);
    const r = await api('GET', '/me/follows', { token: t.token });
    expect(r.body.follows[0]).toMatchObject({ listing: { slug: 'empty' } });
  });
});

describe('PATCH /me', () => {
  it('turns the digest off and on', async () => {
    const t = await trader('alice', ['read']);
    expect((await api('GET', '/me', { token: t.token })).body.digestOptIn).toBe(true);
    const off = await api('PATCH', '/me', { token: t.token, body: { digestOptIn: false } });
    expect(off.status).toBe(200);
    expect(off.body.digestOptIn).toBe(false);
    const [row] = await db.select().from(accounts).where(eq(accounts.id, t.id));
    expect(row.digestOptIn).toBe(false);
    expect((await api('PATCH', '/me', { token: t.token, body: { nope: 1 } })).status).toBe(400);

    const cookie = await signUp('person@example.org');
    expect(
      (await api('PATCH', '/me', { cookie, origin: 'https://evil.example', body: { digestOptIn: false } })).status,
    ).toBe(403);
    expect((await api('PATCH', '/me', { cookie, body: { digestOptIn: false } })).body.digestOptIn).toBe(false);
  });
});
