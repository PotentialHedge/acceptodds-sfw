/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are checked field by field */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { accounts, digestSends, events, orders } from '@/db/schema';
import { digestDay } from '@/lib/digest';
import { createMarket, trade } from '@/server/engine';
import { sendDailyDigest } from '@/server/digest';
import { follow } from '@/server/follows';
import { upsertListing } from '@/server/listings';
import { clearDevOutbox, devOutbox } from '@/server/mail';
import { api, signUp, trader } from './api-client';
import { closePool, resetDatabase, seedMarket, STARTING_MICRO } from './helpers';

const db = getDb();
const UNIT = 1_000_000n;
const BASE = 'https://papermarket.test';

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

describe('sendDailyDigest', () => {
  async function scene() {
    const moved = await paper('moved', 'A Paper That Moved');
    const small = await paper('small', 'A Paper That Barely Moved');
    const old = await paper('old', 'A Paper That Moved Last Week');
    const whale = await trader('whale');
    await buy(whale.id, old, 60n);
    await backdate(old.marketId, 3 * 86_400_000);
    await buy(whale.id, moved, 60n); // ≈ +10 pp
    await buy(whale.id, small, 10n); // ≈ +1.7 pp

    const alice = await trader('alice', ['read']);
    const bob = await trader('bob', ['read']);
    const carol = await trader('carol', ['read']);
    const bot = await trader('bot', ['read'], { isBot: true });
    await trader('dave', ['read']); // follows nothing
    for (const l of [moved, small, old]) await follow(alice.id, l.listing.id);
    await follow(bob.id, small.listing.id);
    await follow(bob.id, old.listing.id);
    await follow(carol.id, moved.listing.id);
    await db.update(accounts).set({ digestOptIn: false }).where(eq(accounts.id, carol.id));
    await follow(bot.id, moved.listing.id);
    return { alice, moved, small, old };
  }

  it('mails each opted-in follower once, listing only the papers that moved enough', async () => {
    const { alice } = await scene();
    const now = new Date();
    const r = await sendDailyDigest({ now, minMovePp: 5, baseUrl: BASE });
    expect(r).toMatchObject({ considered: 2, sent: 1, skippedNoMoves: 1, skippedAlreadySent: 0, failed: [] });
    expect(r.day).toBe(digestDay(now));

    const mail = devOutbox();
    expect(mail).toHaveLength(1);
    expect(mail[0].to).toBe('alice@example.org');
    expect(mail[0].subject).toContain('1 followed paper moved');
    expect(mail[0].text).toContain('A Paper That Moved');
    expect(mail[0].text).toMatch(/Will moved be accepted\?: 50% → 6\d% \(\+\d+ pp\)/);
    expect(mail[0].text).toContain(`${BASE}/papers/moved`);
    expect(mail[0].text).toContain(`${BASE}/profile#email`);
    expect(mail[0].text).not.toContain('Barely');
    expect(mail[0].text).not.toContain('Last Week');

    const sends = await db.select().from(digestSends);
    expect(sends).toEqual([expect.objectContaining({ accountId: alice.id, day: r.day })]);
    // Logged after the fact, without waiting on it.
    await expect
      .poll(
        async () =>
          (
            await db
              .select()
              .from(events)
              .where(and(eq(events.kind, 'digest.sent'), eq(events.accountId, alice.id)))
          ).length,
      )
      .toBe(1);
  });

  it('sends once per day however often it runs', async () => {
    await scene();
    const now = new Date();
    await sendDailyDigest({ now, baseUrl: BASE });
    const again = await sendDailyDigest({ now: new Date(now.getTime() + 60_000), baseUrl: BASE });
    expect(again).toMatchObject({ sent: 0, skippedAlreadySent: 1 });
    // Concurrent runs, too: the digest_sends insert decides.
    await Promise.all([sendDailyDigest({ now, baseUrl: BASE }), sendDailyDigest({ now, baseUrl: BASE })]);
    expect(devOutbox()).toHaveLength(1);
  });

  it('respects the threshold', async () => {
    await scene();
    const r = await sendDailyDigest({ minMovePp: 1, baseUrl: BASE });
    expect(r.sent).toBe(2); // alice (moved + small) and bob (small)
    const alice = devOutbox().find((m) => m.to === 'alice@example.org')!;
    expect(alice.subject).toContain('2 followed papers moved');
    // Biggest move first.
    expect(alice.text.indexOf('That Moved')).toBeLessThan(alice.text.indexOf('Barely'));

    clearDevOutbox();
    await db.delete(digestSends);
    expect((await sendDailyDigest({ minMovePp: 20, baseUrl: BASE })).sent).toBe(0);
    expect(devOutbox()).toHaveLength(0);
  });

  it('sends nothing once the move has left the 24h window', async () => {
    await scene();
    const r = await sendDailyDigest({ now: new Date(Date.now() + 86_400_000 + 60_000), baseUrl: BASE });
    expect(r.sent).toBe(0);
    expect(devOutbox()).toHaveLength(0);
    expect(await db.select().from(digestSends)).toHaveLength(0);
  });

  it('sends nothing to anyone when nobody follows anything', async () => {
    const p = await paper('lonely');
    const whale = await trader('whale');
    await buy(whale.id, p, 60n);
    const r = await sendDailyDigest({ baseUrl: BASE });
    expect(r).toMatchObject({ considered: 0, sent: 0 });
    expect(devOutbox()).toHaveLength(0);
  });

  it('uses 1 − P(last outcome) as the headline of a multi-outcome market', async () => {
    const { listing } = await upsertListing({ slug: 'multi', title: 'Multi' });
    const m = await createMarket({
      slug: 'multi-decision',
      question: 'Which decision?',
      outcomes: ['Oral', 'Poster', 'Reject'],
      closesAt: new Date(Date.now() + 7 * 86_400_000),
      startingBalanceMicro: STARTING_MICRO,
      expectedTraders: 1,
      status: 'open',
      listingId: listing.id,
    });
    const whale = await trader('whale');
    await trade(whale.id, m.marketId, m.outcomeIds[1], 80n * UNIT, 10_000n * UNIT);
    const alice = await trader('alice', ['read']);
    await follow(alice.id, listing.id);
    const r = await sendDailyDigest({ baseUrl: BASE });
    expect(r.sent).toBe(1);
    expect(devOutbox()[0].text).toMatch(/Which decision\? \(not Reject\): 67% → \d+%/);
    const f = await api('GET', '/me/follows', { token: alice.token });
    expect(f.body.follows[0].headline).toMatchObject({ outcomeLabel: 'Reject', negated: true });
    expect(f.body.follows[0].headline.price24hAgo).toBeCloseTo(2 / 3, 12);
    expect(f.body.follows[0].headline.price).toBeGreaterThan(0.72);
  });

  it('un-records a failed send so a re-run retries it', async () => {
    await scene();
    const prevKey = process.env.RESEND_API_KEY;
    const prevFrom = process.env.MAIL_FROM;
    process.env.RESEND_API_KEY = 're_test_invalid';
    delete process.env.MAIL_FROM; // sendMail throws before any network call
    try {
      const r = await sendDailyDigest({ baseUrl: BASE });
      expect(r.sent).toBe(0);
      expect(r.failed).toHaveLength(1);
      expect(await db.select().from(digestSends)).toHaveLength(0);
    } finally {
      if (prevKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = prevKey;
      if (prevFrom !== undefined) process.env.MAIL_FROM = prevFrom;
    }
    expect((await sendDailyDigest({ baseUrl: BASE })).sent).toBe(1);
  });
});
