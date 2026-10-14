import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { validate } from '@readme/openapi-parser';
import { sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { orders } from '@/db/schema';
import { revokeToken } from '@/server/tokens';
import pkg from '../../package.json';
import { api, ROUTE_PATTERNS, trader } from './api-client';
import { closePool, resetDatabase, seedMarket, STARTING_MICRO, type Fixture } from './helpers';

const db = getDb();

let fx: Fixture;

beforeEach(async () => {
  await resetDatabase();
  process.env.API_RATE_LIMIT_BURST = '1000';
  process.env.API_RATE_LIMIT_PER_SECOND = '1000';
  process.env.STARTING_BALANCE_MICRO = STARTING_MICRO.toString();
  fx = await seedMarket(0, 10);
}, 60_000);

afterAll(async () => {
  await closePool();
});

async function buy(token: string, outcomeId: string, sharesMicro: bigint, marketId = fx.marketId) {
  const q = await api('POST', `/markets/${marketId}/quote`, {
    body: { outcomeId, sharesMicro: sharesMicro.toString() },
  });
  expect(q.status).toBe(200);
  return api('POST', `/markets/${marketId}/orders`, {
    token,
    body: { outcomeId, sharesMicro: sharesMicro.toString(), maxCostMicro: q.body.costMicro },
  });
}

// ---------------------------------------------------------------------------
// the contract
// ---------------------------------------------------------------------------

describe('OpenAPI', () => {
  it('serves a document that validates as OpenAPI 3.1', async () => {
    const res = await api('GET', '/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');
    const result = await validate(structuredClone(res.body));
    expect(result.valid ? [] : result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('documents every route file under app/api/v1, and nothing else', async () => {
    const root = join(process.cwd(), 'src/app/api/v1');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name === 'route.ts') files.push(relative(root, dir));
      }
    };
    walk(root);
    const routes = files
      .filter((f) => f !== 'openapi.json' && f !== '[...rest]')
      .map((f) => '/' + f.replace(/\[(\w+)\]/g, '{$1}'))
      .sort();

    const doc = (await api('GET', '/openapi.json')).body;
    expect(Object.keys(doc.paths).sort()).toEqual(routes);
    // …and the in-process test router knows about all of them.
    expect(
      ROUTE_PATTERNS.filter((p) => p !== '/openapi.json')
        .map((p) => p.replace(/\[(\w+)\]/g, '{$1}'))
        .sort(),
    ).toEqual(routes);
  });
});

describe('every response', () => {
  it('is Cache-Control: no-store, including errors', async () => {
    for (const res of [
      await api('GET', '/markets'),
      await api('GET', `/markets/${fx.marketId}`),
      await api('GET', '/markets/nope'),
      await api('GET', '/me'),
      await api('GET', '/no/such/thing'),
    ]) {
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('uses the one error shape, including for unknown routes and wrong methods', async () => {
    const cases = [
      [await api('GET', '/no/such/thing'), 404, 'not_found'],
      [await api('DELETE', '/markets'), 405, 'method_not_allowed'],
      [await api('GET', `/markets/${fx.marketId}/quote`), 405, 'method_not_allowed'],
      [await api('GET', '/markets/does-not-exist'), 404, 'not_found'],
    ] as const;
    for (const [res, status, code] of cases) {
      expect(res.status).toBe(status);
      expect(res.body).toEqual({ error: { code, message: expect.any(String) } });
    }
  });
});

// ---------------------------------------------------------------------------
// public reads
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// auth, scopes and rate limits
// ---------------------------------------------------------------------------

describe('authentication', () => {
  it('401s a missing, malformed, unknown or revoked token on a protected route', async () => {
    const t = await trader('authy');
    expect((await api('GET', '/me', { token: t.token })).status).toBe(200);

    const missing = await api('GET', '/me');
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe('unauthorized');

    const malformed = await api('GET', '/me', { headers: { authorization: 'Basic abc' } });
    expect(malformed.body.error.code).toBe('unauthorized');

    // Right prefix, wrong secret: found by prefix, refused by the hash compare.
    const forged = t.token.slice(0, 16) + 'A'.repeat(t.token.length - 16);
    expect((await api('GET', '/me', { token: forged })).status).toBe(401);

    expect(await revokeToken(t.userId, t.tokenId)).toBe(true);
    const revoked = await api('GET', '/me', { token: t.token });
    expect(revoked.status).toBe(401);
    expect(revoked.body.error.code).toBe('unauthorized');
  });

  it('401s a bad token on a public route rather than silently serving it anonymously', async () => {
    const res = await api('GET', '/markets', { token: 'pm_live_nope' });
    expect(res.status).toBe(401);
    expect((await api('GET', '/markets')).status).toBe(200);
  });

  it('stores only a hash of the token', async () => {
    const t = await trader('hashy');
    const rows = await db.execute(sql`select * from apikey`);
    expect(JSON.stringify(rows.rows)).not.toContain(t.token);
  });

  it('never mints a token from a token: /me/tokens is session-only', async () => {
    const t = await trader('minter', ['read', 'trade', 'admin']);
    const res = await api('POST', '/me/tokens', { token: t.token, body: { name: 'x', scopes: ['read'] } });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('session_required');
    expect((await api('POST', '/me/tokens', { body: { name: 'x', scopes: ['read'] } })).status).toBe(401);
  });
});

describe('scopes', () => {
  it('a read token can read but not trade or administer', async () => {
    const t = await trader('reader', ['read']);
    expect((await api('GET', '/me', { token: t.token })).status).toBe(200);
    expect((await api('GET', '/me/portfolio', { token: t.token })).status).toBe(200);

    const order = await api('POST', `/markets/${fx.marketId}/orders`, {
      token: t.token,
      body: { outcomeId: fx.outcomeIds[0], sharesMicro: '1000000', maxCostMicro: '1000000' },
    });
    expect(order.status).toBe(403);
    expect(order.body.error).toMatchObject({ code: 'forbidden', details: { requiredScope: 'trade' } });
    expect(await db.select().from(orders)).toEqual([]);

    const close = await api('POST', `/markets/${fx.marketId}/close`, { token: t.token });
    expect(close.status).toBe(403);
  });

  it('a trade-only token can trade but not read /me or administer', async () => {
    const t = await trader('trade-only', ['trade']);
    expect((await buy(t.token, fx.outcomeIds[0], 1_000_000n)).status).toBe(201);
    expect((await api('GET', '/me', { token: t.token })).status).toBe(403);
    const create = await api('POST', '/markets', {
      token: t.token,
      body: {
        slug: 'nope',
        question: 'q',
        outcomes: ['A', 'B'],
        closesAt: new Date(Date.now() + 86_400_000).toISOString(),
        expectedTraders: 10,
      },
    });
    expect(create.status).toBe(403);
  });

  it('admin does not imply trade', async () => {
    const t = await trader('admin-only', ['admin']);
    const res = await buy(t.token, fx.outcomeIds[0], 1_000_000n);
    expect(res.status).toBe(403);
  });
});

describe('rate limiting', () => {
  it('429s past the burst with Retry-After and X-RateLimit headers', async () => {
    process.env.API_RATE_LIMIT_BURST = '3';
    process.env.API_RATE_LIMIT_PER_SECOND = '0.01';
    const t = await trader('chatty', ['read']);

    const ok = [];
    for (let i = 0; i < 3; i += 1) ok.push(await api('GET', '/me', { token: t.token }));
    expect(ok.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(ok.map((r) => r.headers.get('x-ratelimit-remaining'))).toEqual(['2', '1', '0']);
    expect(ok[0].headers.get('x-ratelimit-limit')).toBe('3');

    const limited = await api('GET', '/me', { token: t.token });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('rate_limited');
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(limited.headers.get('x-ratelimit-remaining')).toBe('0');

    // Per token, not per account or global: a second token is unaffected.
    const other = await trader('quiet', ['read']);
    expect((await api('GET', '/me', { token: other.token })).status).toBe(200);
    // Anonymous reads are the edge's job, not this bucket's.
    expect((await api('GET', '/markets')).status).toBe(200);
  });

  it('gives an admin credential its own, larger bucket', async () => {
    process.env.API_RATE_LIMIT_BURST = '1';
    process.env.API_RATE_LIMIT_PER_SECOND = '0.01';
    process.env.API_ADMIN_RATE_LIMIT_BURST = '3';
    process.env.API_ADMIN_RATE_LIMIT_PER_SECOND = '0.01';
    try {
      const admin = await trader('ops', ['admin', 'read']);
      const ok = [];
      for (let i = 0; i < 3; i += 1) ok.push(await api('GET', '/me', { token: admin.token }));
      expect(ok.map((r) => r.status)).toEqual([200, 200, 200]);
      expect(ok[0].headers.get('x-ratelimit-limit')).toBe('3');
      expect((await api('GET', '/me', { token: admin.token })).status).toBe(429);

      // A trading key keeps the ordinary bucket.
      const bot = await trader('bot', ['read', 'trade']);
      expect((await api('GET', '/me', { token: bot.token })).status).toBe(200);
      expect((await api('GET', '/me', { token: bot.token })).status).toBe(429);
    } finally {
      delete process.env.API_ADMIN_RATE_LIMIT_BURST;
      delete process.env.API_ADMIN_RATE_LIMIT_PER_SECOND;
    }
  });

  it('holds under concurrency: exactly `burst` of a simultaneous flood get through', async () => {
    process.env.API_RATE_LIMIT_BURST = '5';
    process.env.API_RATE_LIMIT_PER_SECOND = '0.001';
    const t = await trader('flood', ['read']);
    const results = await Promise.all(Array.from({ length: 20 }, () => api('GET', '/me', { token: t.token })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(5);
    expect(results.filter((r) => r.status === 429)).toHaveLength(15);
  });

  it('refills over time', async () => {
    process.env.API_RATE_LIMIT_BURST = '1';
    process.env.API_RATE_LIMIT_PER_SECOND = '20';
    const t = await trader('patient', ['read']);
    expect((await api('GET', '/me', { token: t.token })).status).toBe(200);
    expect((await api('GET', '/me', { token: t.token })).status).toBe(429);
    await new Promise((r) => setTimeout(r, 120));
    expect((await api('GET', '/me', { token: t.token })).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// trading
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// me
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// leaderboard and profiles (§1.2)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// admin
// ---------------------------------------------------------------------------

describe('version', () => {
  it('says what is running, with no credential', async () => {
    const res = await api('GET', '/version');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      version: pkg.version,
      commit: expect.stringMatching(/^[0-9a-f]{40}$/),
      startedAt: expect.any(String),
    });
    process.env.GIT_COMMIT = 'stamped-at-build';
    try {
      expect((await api('GET', '/version')).body.commit).toBe('stamped-at-build');
    } finally {
      delete process.env.GIT_COMMIT;
    }
  });
});

// ---------------------------------------------------------------------------
// the event log (§1.4)
// ---------------------------------------------------------------------------
