import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { account as authAccount, session, user } from '@/db/auth-schema';
import { accounts, ledgerEntries, orders } from '@/db/schema';
import { ensureAccountForUser } from '@/server/accounts';
import { walletsOf } from '@/server/wallets';
import { getAuth, missingFromUser } from '@/server/better-auth';
import { clearDevOutbox, devOutbox } from '@/server/mail';
import { api, authCall, authPathOf, cookieFrom, ORIGIN, signUp, trader } from './api-client';
import { closePool, resetDatabase, seedMarket, STARTING_MICRO, type Fixture } from './helpers';

const db = getDb();
let fx: Fixture;
const FIXTURE_DOMAINS = 'tests/fixtures/institution-domains.json';

beforeEach(async () => {
  await resetDatabase();
  process.env.API_RATE_LIMIT_BURST = '1000';
  process.env.API_RATE_LIMIT_PER_SECOND = '1000';
  process.env.STARTING_BALANCE_MICRO = STARTING_MICRO.toString();
  process.env.INSTITUTION_DOMAINS_PATH = FIXTURE_DOMAINS;
  clearDevOutbox();
  fx = await seedMarket(0, 10);
}, 60_000);

afterAll(async () => {
  await closePool();
});

/** Sign up (`POST /onboarding`, with a small bet) without clicking the link. */
async function signUpUnconfirmed(email: string) {
  return api('POST', '/onboarding', {
    body: {
      email,
      bet: { marketId: fx.marketId, outcomeId: fx.outcomeIds[0], stakeMicro: '1000000', seenOrderCount: 0 },
    },
  });
}

/**
 * An unconfirmed user holding a password, as Better Auth's own sign-up used
 * to make — or as someone else could have, with your address.
 */
async function unconfirmedWithPassword(email: string, password = 'correct horse battery') {
  const ctx = await getAuth().$context;
  const u = await ctx.internalAdapter.createUser(
    { email, name: 'Pending Person', emailVerified: false },
    { method: 'email' },
  );
  await ctx.internalAdapter.linkAccount({
    userId: u.id,
    providerId: 'credential',
    accountId: u.id,
    password: await ctx.password.hash(password),
  });
  return u;
}

async function accountsFor(email: string) {
  return db
    .select({ account: accounts })
    .from(accounts)
    .innerJoin(user, eq(user.id, accounts.userId))
    .where(eq(user.email, email));
}

/** The 6-digit code in a confirmation mail. */
function codeFrom(text: string): string {
  return /code is (\d{6})/.exec(text)![1];
}

async function confirmWithCode(email: string, otp: string): Promise<Response> {
  return authCall('POST', '/email-otp/verify-email', { body: { email, otp } });
}

const order = (outcomeId: string) => ({ outcomeId, sharesMicro: '1000000', maxCostMicro: '10000000' });

// ---------------------------------------------------------------------------
// sign-up
// ---------------------------------------------------------------------------

describe('sign-up', () => {
  it('confirming the email creates a verified trader, with no wallet yet, and a session', async () => {
    const cookie = await signUp('ada@example.org', 'Ada Lovelace');

    const me = await api('GET', '/me', { cookie });
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      handle: 'ada-lovelace',
      displayName: 'Ada Lovelace',
      isBot: false,
      institutions: ['Example University'],
      verifiedAt: expect.any(String),
      auth: { method: 'session', scopes: ['read', 'trade'] },
    });

    expect(await db.select().from(ledgerEntries).where(eq(ledgerEntries.accountId, me.body.id))).toEqual([]);

    // Verified by construction, so it can trade straight away; the trade opens its venue's wallet with the grant.
    const trade = await api('POST', `/markets/${fx.marketId}/orders`, { cookie, body: order(fx.outcomeIds[0]) });
    expect(trade.status).toBe(201);
    const entries = await db.select().from(ledgerEntries).where(eq(ledgerEntries.accountId, me.body.id));
    expect(entries).toContainEqual(expect.objectContaining({ reason: 'signup', deltaMicro: STARTING_MICRO }));
    // A session's order is the UI's, and nothing claimed a model placed it.
    const [placed] = await db.select().from(orders).where(eq(orders.id, trade.body.orderId));
    expect(placed).toMatchObject({ via: 'web', isLlm: false });
  });

  it('grants nothing, and creates no trader, until the email is confirmed; then a trader with no wallet', async () => {
    expect((await signUpUnconfirmed('later@example.org')).status).toBe(200);
    expect(await accountsFor('later@example.org')).toEqual([]);
    const [{ total }] = await db
      .select({ total: sql<string>`coalesce(sum(${ledgerEntries.deltaMicro}), 0)::text` })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.reason, 'signup'));
    // Only the fixture's grants: the house's, which createHouse records as a signup, and its traders'.
    expect(BigInt(total)).toBe(fx.grantedMicro);

    // The mail links to the landing page, never the route a mail scanner's GET would confirm with.
    const mail = devOutbox().find((m) => m.to === 'later@example.org')!;
    expect(mail.text).not.toContain('/api/auth/verify-email');
    expect(mail.html).not.toContain('/api/auth/verify-email');
    const link = new URL(/https?:\/\/\S+/.exec(mail.text)![0]);
    expect(link.pathname).toBe('/signin/link');
    expect(link.searchParams.get('to')).toBe('confirm');

    // Clicking it now creates the account, verified, with no money yet: its
    // first trade in a venue opens a wallet there with the grant.
    await authCall('GET', `${authPathOf(link)}${link.search}`);
    const [row] = await accountsFor('later@example.org');
    expect(row.account.verifiedAt).not.toBeNull();
    expect(await walletsOf(row.account.id)).toEqual([]);

    // A second click makes nothing more.
    await authCall('GET', `${authPathOf(link)}${link.search}`);
    expect(await accountsFor('later@example.org')).toHaveLength(1);
    const grants = await db.select().from(ledgerEntries).where(eq(ledgerEntries.accountId, row.account.id));
    expect(grants).toHaveLength(0);
  });

  it("takes no password: Better Auth's own sign-up is off, and nothing signs in before confirming", async () => {
    const off = await authCall('POST', '/sign-up/email', {
      body: { email: 'slow@example.org', password: 'correct horse battery', name: 'Slow' },
    });
    expect(off.status).toBe(404);

    expect((await signUpUnconfirmed('slow@example.org')).status).toBe(200);
    const inRes = await authCall('POST', '/sign-in/email', {
      body: { email: 'slow@example.org', password: 'correct horse battery' },
    });
    expect(inRes.status).toBe(401); // there is no password to sign in with
    expect(cookieFrom(inRes)).not.toContain('session_token=');
  });

  it('confirming drops a password set before the address was proven, and every session with it', async () => {
    // Someone signed up with your address and their password, before sign-up stopped taking one.
    await unconfirmedWithPassword('owner@example.org', 'the attacker password');
    expect((await signUpUnconfirmed('owner@example.org')).status).toBe(200);
    const code = codeFrom(devOutbox().findLast((m) => m.to === 'owner@example.org')!.text);

    const confirmed = await confirmWithCode('owner@example.org', code);
    const cookie = cookieFrom(confirmed);
    expect(cookie).toContain('session_token=');
    expect((await api('GET', '/me', { cookie })).status).toBe(200); // the confirmer's own session survives

    const attacker = await authCall('POST', '/sign-in/email', {
      body: { email: 'owner@example.org', password: 'the attacker password' },
    });
    expect(attacker.status).toBe(401);
    const [u] = await db.select().from(user).where(eq(user.email, 'owner@example.org'));
    expect(await missingFromUser(u.id)).toEqual({ name: false, password: true });
  });

  it('signing in unconfirmed with the right password sends a fresh code and link; a wrong one sends nothing', async () => {
    await unconfirmedWithPassword('again@example.org');
    const wrong = await authCall('POST', '/sign-in/email', {
      body: { email: 'again@example.org', password: 'not the password' },
    });
    expect(wrong.status).toBe(401);
    expect(devOutbox()).toHaveLength(0);

    const right = await authCall('POST', '/sign-in/email', {
      body: { email: 'again@example.org', password: 'correct horse battery' },
    });
    expect(right.status).toBe(403);
    const mail = devOutbox().find((m) => m.to === 'again@example.org')!;
    expect(codeFrom(mail.text)).toMatch(/^\d{6}$/);
    expect(mail.text).toMatch(/https?:\/\/\S+\/signin\/link\?\S*\bto=confirm\b/);
  });

  it('signing up again with an unconfirmed address resends the code and link, and creates nothing', async () => {
    await signUpUnconfirmed('twice@example.org');
    clearDevOutbox();
    const again = await signUpUnconfirmed('twice@example.org');
    expect(again.status).toBe(200); // indistinguishable from a fresh sign-up
    expect(await db.select().from(user).where(eq(user.email, 'twice@example.org'))).toHaveLength(1);

    const mail = devOutbox().find((m) => m.to === 'twice@example.org')!;
    const otp = codeFrom(mail.text);
    // The link returns via /verify-email, which asks for the name and password.
    expect(mail.text).toContain(encodeURIComponent('/verify-email'));
    expect((await confirmWithCode('twice@example.org', otp)).status).toBe(200);
  });

  it('signing up again with a confirmed address mails its owner that it has an account, and changes nothing', async () => {
    await signUp('taken@example.org', 'Taken');
    clearDevOutbox();
    const again = await signUpUnconfirmed('taken@example.org');
    expect(again.status).toBe(200);
    expect(devOutbox()).toEqual([
      expect.objectContaining({
        to: 'taken@example.org',
        subject: expect.stringContaining('sign-in code'),
        text: expect.stringMatching(/already has an acceptodds account[\s\S]*\/signin\/link\?token=/),
      }),
    ]);
    const [row] = await db.select().from(user).where(eq(user.email, 'taken@example.org'));
    expect(row.name).toBe('Taken');
  });

  it('gives two users with the same name different handles', async () => {
    const a = await api('GET', '/me', { cookie: await signUp('one@example.org', 'Sam Smith') });
    const b = await api('GET', '/me', { cookie: await signUp('two@example.org', 'Sam Smith') });
    expect(a.body.handle).toBe('sam-smith');
    expect(b.body.handle).toMatch(/^sam-smith-[a-z0-9]{4}$/);
  });

  it('provisions exactly one account per confirmed user, however many callers race', async () => {
    const id = 'race-user';
    await db.insert(user).values({ id, name: 'Racer', email: 'racer@example.org', emailVerified: true });
    const results = await Promise.all(
      Array.from({ length: 6 }, () => ensureAccountForUser({ id, name: 'Racer', email: 'racer@example.org' })),
    );
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    const rows = await db.select().from(accounts).where(eq(accounts.userId, id));
    expect(rows).toHaveLength(1);
    // No money before a first trade: that opens a wallet in its venue.
    const grants = await db.select().from(ledgerEntries).where(eq(ledgerEntries.accountId, rows[0].id));
    expect(grants).toHaveLength(0);
  });

  it('ends the session on sign-out', async () => {
    const cookie = await signUp('bye@example.org');
    const out = await authCall('POST', '/sign-out', { cookie, body: {} });
    expect(out.status).toBe(200);
    expect((await api('GET', '/me', { cookie })).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// confirming with the code (issue #15)
// ---------------------------------------------------------------------------

describe('confirming with the code from the mail', () => {
  it('the code confirms the address, creates the trader with no wallet yet, and signs in', async () => {
    await signUpUnconfirmed('code@example.org');
    const code = codeFrom(devOutbox().find((m) => m.to === 'code@example.org')!.text);

    const res = await confirmWithCode('code@example.org', code);
    expect(res.status).toBe(200);
    const cookie = cookieFrom(res);
    expect(cookie).toContain('session_token=');

    const me = await api('GET', '/me', { cookie });
    expect(me.body).not.toHaveProperty('wallets');
    const grants = await db.select().from(ledgerEntries).where(eq(ledgerEntries.accountId, me.body.id));
    expect(grants).toHaveLength(0);

    // The code is spent; the link still confirms, and grants nothing more.
    expect((await confirmWithCode('code@example.org', code)).status).toBe(400);
  });

  it('stores no IP address or user agent on the session', async () => {
    await signUpUnconfirmed('private@example.org');
    const code = codeFrom(devOutbox().find((m) => m.to === 'private@example.org')!.text);
    const res = await authCall('POST', '/email-otp/verify-email', {
      body: { email: 'private@example.org', otp: code },
      headers: { 'cf-connecting-ip': '203.0.113.7', 'user-agent': 'Mozilla/5.0 (Test)' },
    });
    expect(res.status).toBe(200);
    const [u] = await db.select().from(user).where(eq(user.email, 'private@example.org'));
    const rows = await db.select().from(session).where(eq(session.userId, u.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ipAddress: null, userAgent: null });
  });

  it('refuses a wrong code, and grants nothing', async () => {
    await signUpUnconfirmed('guess@example.org');
    const code = codeFrom(devOutbox().find((m) => m.to === 'guess@example.org')!.text);
    const wrong = code === '000000' ? '111111' : '000000';
    const res = await confirmWithCode('guess@example.org', wrong);
    expect(res.status).toBe(400);
    expect(cookieFrom(res)).not.toContain('session_token=');
    expect(await accountsFor('guess@example.org')).toEqual([]);
  });

  it('mails one address at most ten auth mails a day, silently', async () => {
    await signUpUnconfirmed('flood@example.org'); // the first
    for (let i = 0; i < 12; i += 1) {
      const res = await authCall('POST', '/send-verification-email', { body: { email: 'flood@example.org' } });
      expect(res.status).toBe(200); // the same answer as for an address with no account
    }
    expect(devOutbox().filter((m) => m.to === 'flood@example.org')).toHaveLength(10);
  });

  it('a resend replaces the code: only the newest one works', async () => {
    await signUpUnconfirmed('resend@example.org');
    const first = codeFrom(devOutbox().find((m) => m.to === 'resend@example.org')!.text);
    clearDevOutbox();
    const resent = await authCall('POST', '/send-verification-email', { body: { email: 'resend@example.org' } });
    expect(resent.status).toBe(200);
    const second = codeFrom(devOutbox().find((m) => m.to === 'resend@example.org')!.text);

    if (first !== second) expect((await confirmWithCode('resend@example.org', first)).status).toBe(400);
    expect((await confirmWithCode('resend@example.org', second)).status).toBe(200);
  });

  it('keeps every email-OTP route but confirming by code off', async () => {
    await signUpUnconfirmed('off@example.org');
    for (const path of [
      '/email-otp/send-verification-otp',
      '/sign-in/email-otp',
      '/email-otp/request-password-reset',
      '/forget-password/email-otp',
      '/email-otp/request-email-change',
      '/email-otp/change-email',
      '/email-otp/check-verification-otp',
      '/email-otp/reset-password',
    ]) {
      const res = await authCall('POST', path, { body: { email: 'off@example.org', type: 'sign-in', otp: '123456' } });
      expect(res.status, path).toBe(404);
    }
  });
});

// ---------------------------------------------------------------------------
// sessions on the API
// ---------------------------------------------------------------------------

describe('a session on /api/v1', () => {
  it('may browse and quote but never administer', async () => {
    const cookie = await signUp('browser@example.org');
    expect((await api('GET', '/markets', { cookie })).status).toBe(200);
    const q = await api('POST', `/markets/${fx.marketId}/quote`, {
      cookie,
      body: { outcomeId: fx.outcomeIds[0], sharesMicro: '1000000' },
    });
    expect(q.status).toBe(200);

    const close = await api('POST', `/markets/${fx.marketId}/close`, { cookie });
    expect(close.status).toBe(403);
    expect(close.body.error).toMatchObject({ code: 'forbidden', details: { requiredScope: 'admin' } });
  });

  it('gets admin only when the email is in ADMIN_EMAILS', async () => {
    process.env.ADMIN_EMAILS = 'someone@else.org, Boss@Example.org';
    try {
      const cookie = await signUp('boss@example.org');
      const me = await api('GET', '/me', { cookie });
      expect(me.body.auth.scopes).toEqual(['read', 'trade', 'admin']);
      const close = await api('POST', `/markets/${fx.marketId}/close`, { cookie });
      expect(close.status).toBe(200);
      expect(close.body.status).toBe('closed');
    } finally {
      delete process.env.ADMIN_EMAILS;
    }
  });

  it('refuses a cookie-authenticated write from another origin, or with no Origin', async () => {
    const cookie = await signUp('csrf@example.org');
    for (const origin of ['https://evil.example', null]) {
      const res = await api('POST', `/markets/${fx.marketId}/orders`, {
        cookie,
        origin,
        body: order(fx.outcomeIds[0]),
      });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('forbidden');
    }
    // Reads don't need it.
    expect((await api('GET', '/me', { cookie, origin: null })).status).toBe(200);
  });

  it('is rate limited per user', async () => {
    // Four: sign-up's own PATCH /me and POST /me/password spend the first two.
    process.env.API_RATE_LIMIT_BURST = '4';
    process.env.API_RATE_LIMIT_PER_SECOND = '0.001';
    const cookie = await signUp('busy@example.org');
    expect((await api('GET', '/me', { cookie })).status).toBe(200);
    expect((await api('GET', '/me', { cookie })).status).toBe(200);
    const limited = await api('GET', '/me', { cookie });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('rate_limited');
  });

  it('treats a garbage cookie as anonymous on public routes and 401 on protected ones', async () => {
    const cookie = 'better-auth.session_token=nope';
    expect((await api('GET', '/markets', { cookie })).status).toBe(200);
    expect((await api('GET', '/me', { cookie })).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// trading is gated on institutional verification (§8)
// ---------------------------------------------------------------------------

describe('trading eligibility', () => {
  it('refuses an unverified human with not_verified', async () => {
    const t = await trader('unverified-token', ['read', 'trade'], { verified: false });
    const res = await api('POST', `/markets/${fx.marketId}/orders`, { token: t.token, body: order(fx.outcomeIds[0]) });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('not_verified');
    // Quoting is still open to them.
    const q = await api('POST', `/markets/${fx.marketId}/quote`, {
      token: t.token,
      body: { outcomeId: fx.outcomeIds[0], sharesMicro: '1000000' },
    });
    expect(q.status).toBe(200);
  });

  it('exempts bots', async () => {
    const bot = await trader('robo', ['read', 'trade'], { isBot: true });
    const res = await api('POST', `/markets/${fx.marketId}/orders`, {
      token: bot.token,
      body: order(fx.outcomeIds[0]),
    });
    expect(res.status).toBe(201);
  });
});

describe('the institution allowlist', () => {
  it('refuses sign-up from an unlisted domain before creating a user or sending mail', async () => {
    for (const email of ['me@gmail.com', 'me@notethz.ch', 'me@ethz.ch.evil.com', 'me@oxford.uk']) {
      const res = await signUpUnconfirmed(email);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('email_domain_not_allowed');
    }
    expect(await db.select().from(user)).toEqual([]);
    expect(devOutbox()).toEqual([]);
  });

  it('admits subdomains of a listed domain, and records the institution', async () => {
    const cookie = await signUp('grace@inf.ethz.ch', 'Grace');
    const me = await api('GET', '/me', { cookie });
    expect(me.body).toMatchObject({ institutions: ['ETH Zurich'] });
    const profile = await api('GET', `/accounts/${me.body.handle}`);
    expect(profile.body).toMatchObject({ institutions: ['ETH Zurich'], verifiedAt: expect.any(String) });
  });

  it('a domain dropped from the list before confirmation gets a funded account that cannot trade', async () => {
    expect((await signUpUnconfirmed('dropped@example.org')).status).toBe(200);
    const narrower = join(mkdtempSync(join(tmpdir(), 'pm-domains-')), 'domains.json');
    writeFileSync(narrower, JSON.stringify({ domains: { 'ethz.ch': 'ETH Zurich' } }));
    process.env.INSTITUTION_DOMAINS_PATH = narrower;

    const mail = devOutbox().find((m) => m.to === 'dropped@example.org')!;
    const link = new URL(/https?:\/\/\S+/.exec(mail.text)![0]);
    const verified = await authCall('GET', `${authPathOf(link)}${link.search}`);
    const cookie = cookieFrom(verified);

    const me = await api('GET', '/me', { cookie });
    expect(me.body).toMatchObject({ verifiedAt: null, institutions: [] });
    const res = await api('POST', `/markets/${fx.marketId}/orders`, { cookie, body: order(fx.outcomeIds[0]) });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('not_verified');
  });

  it('does not let a user change their email to get round it', async () => {
    const cookie = await signUp('stay@example.org');
    const res = await authCall('POST', '/change-email', { cookie, body: { newEmail: 'me@gmail.com' } });
    expect(res.status).not.toBe(200);
    const [u] = await db.select().from(user).where(eq(user.email, 'stay@example.org'));
    expect(u).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// API tokens via the apiKey plugin
// ---------------------------------------------------------------------------

describe('token management', () => {
  it('a signed-in user mints, lists and revokes their own tokens', async () => {
    const cookie = await signUp('keys@example.org', 'Key Holder');

    const minted = await api('POST', '/me/tokens', { cookie, body: { name: 'laptop', scopes: ['read'] } });
    expect(minted.status).toBe(201);
    expect(minted.body.token).toMatch(/^pm_live_[A-Za-z0-9_-]{43}$/);
    expect(minted.body.start).toBe(minted.body.token.slice(0, 16));
    expect(minted.body.scopes).toEqual(['read']);

    // The token works, as the same account, with only its scopes.
    const me = await api('GET', '/me', { token: minted.body.token });
    expect(me.body).toMatchObject({ handle: 'key-holder', auth: { method: 'token', scopes: ['read'] } });

    const list = await api('GET', '/me/tokens', { cookie });
    expect(list.body.tokens).toHaveLength(1);
    expect(list.body.tokens[0]).toMatchObject({ id: minted.body.id, name: 'laptop', enabled: true });
    expect(JSON.stringify(list.body)).not.toContain(minted.body.token);

    const revoked = await api('DELETE', `/me/tokens/${minted.body.id}`, { cookie });
    expect(revoked.status).toBe(204);
    expect((await api('GET', '/me', { token: minted.body.token })).status).toBe(401);
    expect((await api('GET', '/me/tokens', { cookie })).body.tokens[0].enabled).toBe(false);
  });

  it("closes the API-key plugin's own routes, so a revoked key stays revoked", async () => {
    const cookie = await signUp('revoker@example.org');
    const minted = await api('POST', '/me/tokens', { cookie, body: { name: 'old', scopes: ['read'] } });
    await api('DELETE', `/me/tokens/${minted.body.id}`, { cookie });

    const revived = await authCall('POST', '/api-key/update', {
      cookie,
      body: { keyId: minted.body.id, enabled: true },
    });
    expect(revived.status).toBe(404);
    expect((await api('GET', '/me', { token: minted.body.token })).status).toBe(401);
    for (const path of ['/api-key/create', '/api-key/list', '/api-key/get', '/api-key/delete']) {
      expect((await authCall('POST', path, { cookie, body: { name: 'side door' } })).status).toBe(404);
    }
  });

  it('never mints admin tokens from a session', async () => {
    const cookie = await signUp('greedy@example.org');
    const res = await api('POST', '/me/tokens', { cookie, body: { name: 'x', scopes: ['admin'] } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it("cannot revoke someone else's token", async () => {
    const other = await trader('victim');
    const cookie = await signUp('attacker@example.org');
    const res = await api('DELETE', `/me/tokens/${other.tokenId}`, { cookie });
    expect(res.status).toBe(404);
    expect((await api('GET', '/me', { token: other.token })).status).toBe(200);
  });

  it('refuses every token-management call made with a token', async () => {
    const t = await trader('tok');
    for (const [method, path] of [
      ['GET', '/me/tokens'],
      ['POST', '/me/tokens'],
      ['DELETE', `/me/tokens/${t.tokenId}`],
    ] as const) {
      const res = await api(method, path, {
        token: t.token,
        body: method === 'POST' ? { name: 'x', scopes: ['read'] } : undefined,
      });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('session_required');
    }
  });

  it('issues a bot a login-less user the first time it gets a token', async () => {
    const bot = await trader('login-less', ['read'], { isBot: true });
    const [u] = await db.select().from(user).where(eq(user.id, bot.userId));
    expect(u.email).toBe('login-less@bots.papermarket.invalid');
    // No credential or linked provider: nothing can sign in as it.
    expect(await db.select().from(authAccount).where(eq(authAccount.userId, bot.userId))).toEqual([]);
  });

  it('stores only a hash of each token', async () => {
    const cookie = await signUp('hash@example.org');
    const minted = await api('POST', '/me/tokens', { cookie, body: { name: 'x', scopes: ['read', 'trade'] } });
    const rows = await db.execute(sql`select * from apikey`);
    expect(JSON.stringify(rows.rows)).not.toContain(minted.body.token);
  });
});

describe('Better Auth configuration', () => {
  it('trusts only our own origin for its own endpoints', async () => {
    const req = new Request(new URL('/api/auth/sign-in/email', ORIGIN), {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'x@example.org', password: 'correct horse battery' }),
    });
    const { POST } = await import('@/app/api/auth/[...all]/route');
    const res = await POST(req);
    expect(res.status).toBe(403);
  });
});
