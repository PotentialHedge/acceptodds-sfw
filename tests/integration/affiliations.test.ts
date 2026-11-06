import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { accounts, affiliations } from '@/db/schema';
import { clearDevOutbox, devOutbox } from '@/server/mail';
import { leaderboardStandings } from '@/server/views';
import { api, signUp, trader } from './api-client';
import { closePool, resetDatabase, seedMarket, STARTING_MICRO, TEST_KIND, type Fixture } from './helpers';
import { openWallet } from '@/server/wallets';

/**
 * More than one affiliation per account (`server/affiliations.ts`): each
 * address is confirmed by its own code, and only confirmed ones count.
 */

const db = getDb();
let fx: Fixture;
const FIXTURE_DOMAINS = 'tests/fixtures/institution-domains.json';

beforeEach(async () => {
  await resetDatabase();
  process.env.API_RATE_LIMIT_BURST = '1000';
  process.env.API_RATE_LIMIT_PER_SECOND = '1000';
  process.env.INSTITUTION_DOMAINS_PATH = FIXTURE_DOMAINS;
  clearDevOutbox();
  fx = await seedMarket(0, 10);
}, 60_000);

afterAll(async () => {
  await closePool();
});

/** The code in the newest affiliation mail to `email`, if it has one. */
function codeFor(email: string): string | null {
  const mail = [...devOutbox()].reverse().find((m) => m.to === email);
  if (!mail) throw new Error(`no mail to ${email}`);
  return /enter (\d{6})/.exec(mail.text)?.[1] ?? null;
}

async function add(cookie: string, email: string) {
  return api('POST', '/me/affiliations', { cookie, body: { email } });
}

async function verify(cookie: string, id: string, code: string) {
  return api('POST', `/me/affiliations/${id}/verify`, { cookie, body: { code } });
}

const order = (outcomeId: string) => ({ outcomeId, sharesMicro: '1000000', maxCostMicro: '10000000' });

describe('affiliations', () => {
  it('the sign-up address is the primary affiliation', async () => {
    const cookie = await signUp('ada@example.org', 'Ada');
    const list = await api('GET', '/me/affiliations', { cookie });
    expect(list.status).toBe(200);
    expect(list.body.affiliations).toEqual([
      expect.objectContaining({
        email: 'ada@example.org',
        institutionName: 'Example University',
        primary: true,
        verifiedAt: expect.any(String),
        codeExpiresAt: null,
      }),
    ]);
    const me = await api('GET', '/me', { cookie });
    expect(me.body.institutions).toEqual(['Example University']);
  });

  it('an added address counts only once its code is confirmed', async () => {
    const cookie = await signUp('ada@example.org', 'Ada');
    const added = await add(cookie, 'Ada@INF.ethz.ch');
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({
      email: 'ada@inf.ethz.ch',
      institutionName: 'ETH Zurich',
      primary: false,
      verifiedAt: null,
      codeExpiresAt: expect.any(String),
    });

    // Pending: not an institution yet.
    expect((await api('GET', '/me', { cookie })).body.institutions).toEqual(['Example University']);

    const code = codeFor('ada@inf.ethz.ch')!;
    const wrong = code === '000000' ? '000001' : '000000';
    const bad = await verify(cookie, added.body.id, wrong);
    expect(bad.status).toBe(422);
    expect(bad.body.error).toMatchObject({ code: 'invalid_code', details: { reason: 'wrong' } });

    const ok = await verify(cookie, added.body.id, code);
    expect(ok.status).toBe(200);
    expect(ok.body.verifiedAt).toEqual(expect.any(String));

    const me = await api('GET', '/me', { cookie });
    expect(me.body.institutions).toEqual(['Example University', 'ETH Zurich']);
    const pub = await api('GET', `/accounts/${me.body.handle}`);
    expect(pub.body.institutions).toEqual(['Example University', 'ETH Zurich']);

    // Confirming again is a no-op, and the code is spent.
    expect((await verify(cookie, added.body.id, code)).status).toBe(200);
  });

  it('ranks the trader at every confirmed institution', async () => {
    const cookie = await signUp('ada@example.org', 'Ada');
    const added = await add(cookie, 'ada@ethz.ch');
    await verify(cookie, added.body.id, codeFor('ada@ethz.ch')!);
    // A board is a venue's: Ada is on it once she has a wallet there.
    const me = await api('GET', '/me', { cookie });
    await openWallet(db, me.body.id, TEST_KIND, STARTING_MICRO);

    const eth = await leaderboardStandings({ kind: TEST_KIND, basis: 'net_worth', institution: 'ETH Zurich' });
    const home = await leaderboardStandings({ kind: TEST_KIND, basis: 'net_worth', institution: 'Example University' });
    expect(eth.map((r) => r.displayName)).toEqual(['Ada']);
    expect(home.map((r) => r.displayName)).toEqual(['Ada']);
  });

  it('refuses an address off the allowlist, before mailing it', async () => {
    const cookie = await signUp('ada@example.org', 'Ada');
    clearDevOutbox();
    const res = await add(cookie, 'ada@gmail.com');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('email_domain_not_allowed');
    expect(devOutbox()).toEqual([]);
  });

  it('gives up on a code after five wrong guesses, and a fresh code works', async () => {
    const cookie = await signUp('ada@example.org', 'Ada');
    const added = await add(cookie, 'ada@ethz.ch');
    const first = codeFor('ada@ethz.ch')!;
    const wrong = first === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i += 1) await verify(cookie, added.body.id, wrong);
    const locked = await verify(cookie, added.body.id, first);
    expect(locked.status).toBe(422);
    expect(locked.body.error.details.reason).toBe('too_many_attempts');

    // Adding it again rotates the code; the old one is dead.
    const again = await add(cookie, 'ada@ethz.ch');
    expect(again.body.id).toBe(added.body.id);
    const second = codeFor('ada@ethz.ch')!;
    if (second !== first) expect((await verify(cookie, added.body.id, first)).status).toBe(422);
    expect((await verify(cookie, added.body.id, second)).status).toBe(200);
  });

  it('refuses an expired code', async () => {
    const cookie = await signUp('ada@example.org', 'Ada');
    const added = await add(cookie, 'ada@ethz.ch');
    await db
      .update(affiliations)
      .set({ codeExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(affiliations.id, added.body.id));
    const res = await verify(cookie, added.body.id, codeFor('ada@ethz.ch')!);
    expect(res.status).toBe(422);
    expect(res.body.error.details.reason).toBe('expired');
  });

  it('an address another account confirmed looks the same to the adder, and sends its owner no code', async () => {
    await signUp('grace@ethz.ch', 'Grace');
    const cookie = await signUp('ada@example.org', 'Ada');
    clearDevOutbox();
    const res = await add(cookie, 'grace@ethz.ch');
    expect(res.status).toBe(201);
    expect(res.body.verifiedAt).toBeNull();
    expect(codeFor('grace@ethz.ch')).toBeNull();
    expect(devOutbox()[0].subject).toMatch(/already affiliated/);
    const guess = await verify(cookie, res.body.id, '123456');
    expect(guess.status).toBe(422);
    expect(guess.body.error.details.reason).toBe('none');
  });

  it('the first account to confirm an address wins', async () => {
    const ada = await signUp('ada@example.org', 'Ada');
    const bob = await signUp('bob@example.org', 'Bob');
    const a = await add(ada, 'shared@ethz.ch');
    const aCode = codeFor('shared@ethz.ch')!;
    const b = await add(bob, 'shared@ethz.ch');
    const bCode = codeFor('shared@ethz.ch')!;
    expect((await verify(bob, b.body.id, bCode)).status).toBe(200);
    const late = await verify(ada, a.body.id, aCode);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('affiliation_taken');
  });

  it('signing up with an address another account confirmed gives an unverified account', async () => {
    const ada = await signUp('ada@example.org', 'Ada');
    const added = await add(ada, 'twin@ethz.ch');
    await verify(ada, added.body.id, codeFor('twin@ethz.ch')!);

    const twin = await signUp('twin@ethz.ch', 'Twin');
    const me = (await api('GET', '/me', { cookie: twin })).body;
    expect(me).toMatchObject({ verifiedAt: null, institutions: [] });
    expect((await api('GET', '/me/affiliations', { cookie: twin })).body.affiliations).toEqual([]);
  });

  it('an already-confirmed address of your own is a 409', async () => {
    const cookie = await signUp('ada@example.org', 'Ada');
    const res = await add(cookie, 'ada@example.org');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('already_affiliated');
  });

  it('caps unconfirmed addresses', async () => {
    const cookie = await signUp('ada@example.org', 'Ada');
    for (let i = 0; i < 5; i += 1) expect((await add(cookie, `ada${i}@ethz.ch`)).status).toBe(201);
    const res = await add(cookie, 'ada5@ethz.ch');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('too_many_pending');
  });

  it('limits affiliation mail to ten per account, then refuses with a 429', async () => {
    const cookie = await signUp('ada@example.org', 'Ada');
    clearDevOutbox();
    for (let i = 0; i < 10; i += 1) expect((await add(cookie, 'ada@ethz.ch')).status).toBe(201);
    const res = await add(cookie, 'ada@ethz.ch');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('rate_limited');
    expect(res.headers.get('retry-after')).toMatch(/^\d+$/);
    expect(devOutbox()).toHaveLength(10);
  });

  it('removes a secondary affiliation but never the primary', async () => {
    const cookie = await signUp('ada@example.org', 'Ada');
    const added = await add(cookie, 'ada@ethz.ch');
    await verify(cookie, added.body.id, codeFor('ada@ethz.ch')!);

    const list = await api('GET', '/me/affiliations', { cookie });
    const primary = list.body.affiliations.find((f: { primary: boolean }) => f.primary);
    const refused = await api('DELETE', `/me/affiliations/${primary.id}`, { cookie });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('primary_affiliation');

    expect((await api('DELETE', `/me/affiliations/${added.body.id}`, { cookie })).status).toBe(204);
    expect((await api('GET', '/me', { cookie })).body.institutions).toEqual(['Example University']);
    expect((await api('DELETE', `/me/affiliations/${added.body.id}`, { cookie })).status).toBe(404);
  });

  it('lets an account whose sign-up domain was dropped verify through another address', async () => {
    // As if example.org left the list between sign-up and confirmation: an
    // account with no affiliation, which may browse but not trade.
    const cookie = await signUp('ada@example.org', 'Ada');
    const me0 = (await api('GET', '/me', { cookie })).body;
    await db.delete(affiliations).where(eq(affiliations.accountId, me0.id));
    await db.update(accounts).set({ institutions: [], verifiedAt: null }).where(eq(accounts.id, me0.id));
    const narrower = join(mkdtempSync(join(tmpdir(), 'pm-domains-')), 'domains.json');
    writeFileSync(narrower, JSON.stringify({ domains: { 'ethz.ch': 'ETH Zurich' } }));
    process.env.INSTITUTION_DOMAINS_PATH = narrower;

    const blocked = await api('POST', `/markets/${fx.marketId}/orders`, { cookie, body: order(fx.outcomeIds[0]) });
    expect(blocked.body.error.code).toBe('not_verified');

    const added = await add(cookie, 'ada@ethz.ch');
    await verify(cookie, added.body.id, codeFor('ada@ethz.ch')!);
    const me = (await api('GET', '/me', { cookie })).body;
    expect(me).toMatchObject({ institutions: ['ETH Zurich'], verifiedAt: expect.any(String) });
    const traded = await api('POST', `/markets/${fx.marketId}/orders`, { cookie, body: order(fx.outcomeIds[0]) });
    expect(traded.status).toBe(201);

    // Removing the only confirmed one unverifies the account again.
    expect((await api('DELETE', `/me/affiliations/${added.body.id}`, { cookie })).status).toBe(204);
    expect((await api('GET', '/me', { cookie })).body).toMatchObject({ verifiedAt: null });
  });

  it('never accepts an API token', async () => {
    const bot = await trader('ada', ['read', 'trade']);
    for (const [method, path] of [
      ['GET', '/me/affiliations'],
      ['POST', '/me/affiliations'],
    ] as const) {
      const res = await api(method, path, {
        token: bot.token,
        body: method === 'POST' ? { email: 'x@ethz.ch' } : undefined,
      });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('session_required');
    }
  });

  it('refuses a cross-site write', async () => {
    const cookie = await signUp('ada@example.org', 'Ada');
    const res = await api('POST', '/me/affiliations', {
      cookie,
      origin: 'https://evil.example',
      body: { email: 'ada@ethz.ch' },
    });
    expect(res.status).toBe(403);
  });
});
