/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are checked field by field */
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { markets } from '@/db/schema';
import { marketHeadline } from '@/lib/headline';
import * as mapTitlesRoute from '@/app/api/v1/map/titles/route';
import { MINIMAP_NEAREST } from '@/lib/map';
import { defaultMarketKind } from '@/lib/venue';
import * as S from '@/server/api/schemas';
import { createMarket } from '@/server/engine';
import { upsertListing } from '@/server/listings';
import { invalidateMap } from '@/server/map-cache';
import {
  browseListings,
  listingMinimap,
  listingRelatedTo,
  mapKinds,
  marketKinds,
  onMap,
  resolveListing,
  sparklines,
} from '@/server/views';
import { api, ORIGIN, trader } from './api-client';
import { closePool, resetDatabase, seedMarket, STARTING_MICRO, type Fixture } from './helpers';

const db = getDb();
let fx: Fixture;
let admin: { token: string };

beforeEach(async () => {
  await resetDatabase();
  process.env.API_RATE_LIMIT_BURST = '1000';
  process.env.API_RATE_LIMIT_PER_SECOND = '1000';
  process.env.STARTING_BALANCE_MICRO = STARTING_MICRO.toString();
  fx = await seedMarket(0, 10);
  admin = await trader('admin', ['admin']);
}, 60_000);

afterAll(async () => {
  await closePool();
});

const LISTING = {
  slug: 'subject-one',
  title: 'An opaque subject',
  summary: 'Some text the client supplied.',
  tldr: 'One line of it.',
  authors: ['A. Person', 'B. Person'],
  authorIds: ['~A_Person1', '~B_Person1'],
  keywords: ['first topic', 'second topic'],
  primaryArea: 'some area',
  links: [
    { label: 'PDF', url: 'https://example.org/one.pdf' },
    { label: 'Page', url: 'http://example.org/one' },
  ],
  kind: 'ICLR 2027',
};

function market(slug: string, extra: Record<string, unknown> = {}) {
  return api('POST', '/markets', {
    token: admin.token,
    body: {
      slug,
      question: `${slug}?`,
      outcomes: ['YES', 'NO'],
      closesAt: new Date(Date.now() + 86_400_000).toISOString(),
      expectedTraders: 10,
      kind: 'ICLR 2027',
      ...extra,
    },
  });
}

describe('POST /listings', () => {
  it('creates, then replaces by slug', async () => {
    const created = await api('POST', '/listings', { token: admin.token, body: LISTING });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ created: true, listing: LISTING });
    expect(created.body.listing).not.toHaveProperty('markets');

    const replaced = await api('POST', '/listings', {
      token: admin.token,
      body: { slug: LISTING.slug, title: 'Renamed', authors: ['C. Person'] },
    });
    expect(replaced.status).toBe(200);
    expect(replaced.body.created).toBe(false);
    // Same row, every field replaced: the ones left out are cleared.
    expect(replaced.body.listing).toMatchObject({
      id: created.body.listing.id,
      title: 'Renamed',
      authors: ['C. Person'],
      authorIds: [],
      keywords: [],
      primaryArea: null,
      summary: null,
      tldr: null,
      links: [],
      kind: null,
    });
  });

  it('opens an OpenAI Math listing’s market with it, at 50/50, by nobody, once', async () => {
    const body = { ...LISTING, slug: 'oai-result', kind: 'OpenAI Math' };
    const created = await api('POST', '/listings', { token: admin.token, body });
    expect(created.status).toBe(201);
    const opened = (await api('GET', '/markets/oai-result-decision')).body;
    expect(opened).toMatchObject({ slug: 'oai-result-decision', kind: 'OpenAI Math', status: 'open', orderCount: 0 });
    expect(opened.outcomes.map((o: any) => [o.label, o.price])).toEqual([
      ['Verified', expect.closeTo(0.5, 9)],
      ['Not verified', expect.closeTo(0.5, 9)],
    ]);
    const [row] = await db.select().from(markets).where(eq(markets.id, opened.id));
    expect(row.createdBy).toBeNull();

    // Posted again: the same market, no second one.
    const again = await api('POST', '/listings', { token: admin.token, body });
    expect(again.status).toBe(200);
    expect(await db.select().from(markets).where(eq(markets.listingId, created.body.listing.id))).toHaveLength(1);
  });

  it('needs the admin scope', async () => {
    const t = await trader('t');
    expect((await api('POST', '/listings', { body: LISTING })).status).toBe(401);
    expect((await api('POST', '/listings', { token: t.token, body: LISTING })).status).toBe(403);
  });

  it('refuses non-http(s) links, a bad slug, an empty title and ids that do not match the authors', async () => {
    for (const body of [
      { ...LISTING, links: [{ label: 'x', url: 'javascript:alert(1)' }] },
      { ...LISTING, links: [{ label: 'x', url: 'ftp://example.org/a' }] },
      { ...LISTING, slug: 'Not A Slug' },
      { ...LISTING, slug: '00000000-0000-4000-8000-000000000000' },
      { ...LISTING, title: '   ' },
      { ...LISTING, authorIds: ['~A_Person1'] },
      { ...LISTING, authors: undefined },
    ]) {
      const res = await api('POST', '/listings', { token: admin.token, body });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_error');
    }
  });
});

describe('markets in a listing', () => {
  it('attach by listingSlug and come back ordered by rank, by id or slug', async () => {
    const listing = (await api('POST', '/listings', { token: admin.token, body: LISTING })).body.listing;
    const oral = await market('subject-one-oral', { listingSlug: LISTING.slug, listingRank: 1 });
    expect(oral.status).toBe(201);
    expect(oral.body.market).toMatchObject({ listingId: listing.id, listingRank: 1 });
    const main = await market('subject-one-accept', { listingSlug: LISTING.slug });
    expect(main.body.market).toMatchObject({ listingId: listing.id, listingRank: 0 });

    for (const ref of [listing.id, LISTING.slug]) {
      const res = await api('GET', `/listings/${ref}`);
      expect(res.status).toBe(200);
      expect(res.body.markets.map((m: any) => m.slug)).toEqual(['subject-one-accept', 'subject-one-oral']);
    }

    // A market outside any listing says so.
    expect((await api('GET', `/markets/${fx.marketId}`)).body).toMatchObject({ listingId: null, listingRank: 0 });
  });

  it('refuses an unknown listing, and a rank without one', async () => {
    const unknown = await market('orphan', { listingSlug: 'no-such-listing' });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('not_found');
    expect(await db.select().from(markets).where(eq(markets.slug, 'orphan'))).toEqual([]);

    const rankOnly = await market('rank-only', { listingRank: 2 });
    expect(rankOnly.status).toBe(400);
    await upsertListing(LISTING);
    expect((await market('negative', { listingSlug: LISTING.slug, listingRank: -1 })).status).toBe(400);
  });

  it('404s an unknown listing on read', async () => {
    const res = await api('GET', '/listings/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });
});

describe('GET /listings', () => {
  it('pages newest first without repeats, and filters by kind', async () => {
    for (const [slug, kind] of [
      ['l-a', 'x'],
      ['l-b', 'y'],
      ['l-c', 'x'],
    ]) {
      await upsertListing({ slug, title: slug, kind });
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res: any = await api('GET', `/listings?limit=1${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status).toBe(200);
      seen.push(...res.body.listings.map((l: any) => l.slug));
      cursor = res.body.nextCursor;
    } while (cursor);
    expect(seen).toEqual(['l-c', 'l-b', 'l-a']);
    expect((await api('GET', '/listings?kind=x')).body.listings.map((l: any) => l.slug)).toEqual(['l-c', 'l-a']);
  });
});

describe('citations (#38)', () => {
  const post = (body: Record<string, unknown>) => api('POST', '/listings', { token: admin.token, body });
  const citations = (ref: string) => api('GET', `/listings/${ref}/citations`);

  it('keeps the bibliography in order, matching slugs to listings when read', async () => {
    await post({ slug: 'cited', title: 'Cited paper', authors: ['A. Cited'] });
    expect((await market('cited-accept', { listingSlug: 'cited' })).status).toBe(201);
    const res = await post({
      slug: 'citing',
      title: 'Citing paper',
      references: [
        { title: 'Off the site', authors: ['X. Y.'], year: 1986, venue: 'Nature', url: 'https://example.org/x' },
        { title: 'Cited paper', slug: 'cited' },
        { title: 'Not listed yet', slug: 'later' },
      ],
    });
    expect(res.status).toBe(201);

    const first = await citations('citing');
    expect(first.status).toBe(200);
    expect(first.body.references).toMatchObject([
      {
        title: 'Off the site',
        authors: ['X. Y.'],
        year: 1986,
        venue: 'Nature',
        url: 'https://example.org/x',
        slug: null,
        listing: null,
      },
      { title: 'Cited paper', slug: 'cited', listing: { slug: 'cited' } },
      { title: 'Not listed yet', slug: 'later', listing: null },
    ]);

    // Listed afterwards, it links up by itself.
    await post({ slug: 'later', title: 'Later paper' });
    expect((await citations('citing')).body.references[2].listing).toMatchObject({ slug: 'later' });
  });

  it('lists who cites a listing once each, never itself', async () => {
    await post({ slug: 'a', title: 'A' });
    await post({
      slug: 'b',
      title: 'B',
      references: [
        { title: 'A', slug: 'a' },
        { title: 'A again', slug: 'a' },
      ],
    });
    await post({ slug: 'c', title: 'C', references: [{ title: 'A', slug: 'a' }] });
    await post({ slug: 'self', title: 'Self', references: [{ title: 'Self', slug: 'self' }] });

    const a = await citations('a');
    expect(a.body.citedBy.map((l: any) => l.slug)).toEqual(['c', 'b']);
    expect(a.body.citedByTotal).toBe(2);

    const self = await citations('self');
    expect(self.body.citedBy).toEqual([]);
    expect(self.body.references).toMatchObject([{ slug: 'self', listing: null }]);
  });

  it('replaces the bibliography whole, and clears it when left out', async () => {
    await post({ slug: 'a', title: 'A' });
    await post({ slug: 'b', title: 'B', references: [{ title: 'one' }, { title: 'A', slug: 'a' }] });
    await post({ slug: 'b', title: 'B', references: [{ title: 'two' }] });
    expect((await citations('b')).body.references.map((r: any) => r.title)).toEqual(['two']);
    expect((await citations('a')).body.citedBy).toEqual([]);

    await post({ slug: 'b', title: 'B' });
    expect((await citations('b')).body.references).toEqual([]);
  });

  it('refuses a bad reference, and 404s an unknown listing', async () => {
    for (const references of [
      [{ title: 'x', url: 'javascript:alert(1)' }],
      [{ title: '  ' }],
      [{ title: 'x', slug: 'Not A Slug' }],
    ]) {
      const res = await post({ slug: 'bad', title: 'Bad', references });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_error');
    }
    expect((await citations('nope')).status).toBe(404);
  });
});

describe('browsing listings', () => {
  it('shows one row per listing, read from its main market, plus unlisted markets', async () => {
    const { listing } = await upsertListing({ slug: 'p', title: 'P' });
    const opts = {
      outcomes: ['YES', 'NO'],
      startingBalanceMicro: STARTING_MICRO,
      expectedTraders: 10,
      kind: 'binary',
      listingId: listing.id,
    };
    const second = await createMarket({
      ...opts,
      slug: 'p-oral',
      question: 'oral?',
      listingRank: 1,
      closesAt: new Date(Date.now() + 2 * 86_400_000),
    });
    const main = await createMarket({
      ...opts,
      slug: 'p-accept',
      question: 'accept?',
      listingRank: 0,
      closesAt: new Date(Date.now() + 3 * 86_400_000),
    });

    const t = await trader('t');
    const buy = (marketId: string, outcomeId: string) =>
      api('POST', `/markets/${marketId}/orders`, {
        token: t.token,
        body: { outcomeId, sharesMicro: '10000000', maxCostMicro: '1000000000' },
      });
    await buy(main.marketId, main.outcomeIds[0]);
    await buy(second.marketId, second.outcomeIds[1]);

    const { rows } = await browseListings({ kind: null, sort: 'closing' });
    expect(rows.map((r) => [r.main!.market.slug, r.listing?.slug ?? null, r.marketCount])).toEqual([
      // Traded first: the fixture's market has no fills.
      ['p-accept', 'p', 2],
      ['concurrency', null, 1],
    ]);
    const row = rows[0];
    // Volume and fills over the whole listing; the headline from the main market.
    expect(row.totalOrderCount).toBe(2);
    expect(row.totalVolumeMicro).toBeGreaterThan(row.main!.volumeMicro);
    expect(row.main!.outcomes[0].price).toBeGreaterThan(0.5);
    // The sparkline is the main market's.
    expect((await sparklines(rows.map((r) => r.main!))).get(main.marketId)).toHaveLength(2);

    // A listing counts once in its main market's kind.
    expect(await marketKinds()).toEqual([{ kind: 'binary', count: 2 }]);
  });

  it('sorts by likelihood: the headline, highest first, void last', async () => {
    const opts = {
      startingBalanceMicro: STARTING_MICRO,
      expectedTraders: 10,
      kind: 'lk',
      closesAt: new Date(Date.now() + 86_400_000),
    };
    const make = (slug: string, outcomes = ['YES', 'NO']) =>
      createMarket({ ...opts, slug, question: `${slug}?`, outcomes });
    const low = await make('low');
    const high = await make('high');
    await make('mid');
    // Three outcomes open at a headline of 1 − 1/3.
    const multi = await make('multi', ['A', 'B', 'C']);
    const gone = await make('gone', ['A', 'B', 'C']);

    const t = await trader('t');
    const buy = (marketId: string, outcomeId: string, units: number) =>
      api('POST', `/markets/${marketId}/orders`, {
        token: t.token,
        body: { outcomeId, sharesMicro: String(units * 1_000_000), maxCostMicro: '1000000000' },
      });
    await buy(low.marketId, low.outcomeIds[1], 20);
    await buy(high.marketId, high.outcomeIds[0], 30);
    await buy(multi.marketId, multi.outcomeIds[0], 50);

    // There is no void path in the engine yet; the status is all the sort reads.
    await db.update(markets).set({ status: 'void' }).where(eq(markets.id, gone.marketId));

    const { rows } = await browseListings({ kind: 'lk', sort: 'likelihood', status: 'all' });
    // Traded first; `mid` and `gone` have no fills.
    expect(rows.map((r) => r.main!.market.slug)).toEqual(['multi', 'high', 'low', 'mid', 'gone']);
    expect(rows[3].main!.outcomes[0].price).toBeCloseTo(0.5);
    // The SQL headline is the same number `lib/headline.ts` computes.
    const m = rows[0];
    expect(1 - m.main!.outcomes[2].price).toBeGreaterThan(2 / 3);
    expect(marketHeadline({ ...m.main!.market, outcomes: m.main!.outcomes })).toBeCloseTo(
      1 - m.main!.outcomes[2].price,
      12,
    );
  });
});

describe('related listings', () => {
  const post = (body: Record<string, unknown>) => api('POST', '/listings', { token: admin.token, body });
  const put = (ref: string, related: unknown, token = admin.token) =>
    api('PUT', `/listings/${ref}/related`, { token, body: { related } });
  const related = (ref: string) => api('GET', `/listings/${ref}/related`);

  it('keeps the supplied order, matches slugs when read and skips unlisted ones', async () => {
    for (const slug of ['a', 'b', 'c']) await post({ slug, title: `Paper ${slug}` });
    expect((await market('c-accept', { listingSlug: 'c' })).status).toBe(201);

    const res = await put('a', [
      { slug: 'c', score: 0.9 },
      { slug: 'not-yet', score: 0.8 },
      { slug: 'a', score: 0.7 },
      { slug: 'b', score: 0.6 },
      { slug: 'c', score: 0.5 },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);

    const got = await related('a');
    expect(got.body.related.map((r: any) => r.slug)).toEqual(['c', 'b']);
    expect(got.body.related[0]).not.toHaveProperty('market');

    await post({ slug: 'not-yet', title: 'Later' });
    expect((await related('a')).body.related.map((r: any) => r.slug)).toEqual(['c', 'not-yet', 'b']);
  });

  it('is replaced whole, survives a listing upsert and is directional', async () => {
    for (const slug of ['a', 'b']) await post({ slug, title: slug });
    await put('a', [{ slug: 'b', score: 1 }]);
    await post({ slug: 'a', title: 'a, retitled' });
    expect((await related('a')).body.related).toHaveLength(1);
    expect((await related('b')).body.related).toEqual([]);
    await put('a', []);
    expect((await related('a')).body.related).toEqual([]);
  });

  it('needs the admin scope and an existing listing', async () => {
    await post({ slug: 'a', title: 'a' });
    const reader = await trader('reader', ['read']);
    expect((await put('a', [], reader.token)).status).toBe(403);
    expect((await put('nope', [])).status).toBe(404);
    expect((await related('nope')).status).toBe(404);
  });
});

describe('the paper map', () => {
  const post = (body: Record<string, unknown>) => api('POST', '/listings', { token: admin.token, body });
  // The default venue's map unless the body names another.
  const put = (body: object, token = admin.token) =>
    api('PUT', '/map', { token, body: { kind: defaultMarketKind(), ...body } });
  const getMap = (kind?: string) => api('GET', kind ? `/map?kind=${encodeURIComponent(kind)}` : '/map');

  it('matches slugs when read, skips unlisted ones and carries the main market’s headline', async () => {
    for (const slug of ['a', 'b']) await post({ slug, title: `Paper ${slug}`, primaryArea: 'area' });
    const made = await market('a-accept', { listingSlug: 'a' });
    expect(made.status).toBe(201);
    const t = await trader('t');

    const res = await put({
      points: [
        { slug: 'a', x: 1, y: 2, region: 0, cluster: 3 },
        { slug: 'not-yet', x: 0, y: 0 },
        { slug: 'b', x: -1, y: 5, region: 1, cluster: null },
        { slug: 'a', x: 9, y: 9 },
      ],
      regions: [
        { number: 0, label: 'first region' },
        { number: 1, label: 'second region' },
      ],
      clusters: [{ number: 3, label: 'a cluster' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);

    const got = await getMap();
    expect(got.status).toBe(200);
    expect(got.headers.get('cache-control')).toBe('public, max-age=300, stale-while-revalidate=3600');
    const { slugs, x, y, region, cluster, area, areas, headline } = got.body;
    expect({ slugs, x, y, region, cluster, area, areas }).toEqual({
      slugs: ['a', 'b'],
      x: [1, -1],
      y: [2, 5],
      region: [0, 1],
      cluster: [3, null],
      area: [0, 0],
      areas: ['area'],
    });
    // Untraded, the market shows no price; traded, its headline.
    expect(headline).toEqual([null, null]);
    const buy = await api('POST', `/markets/${made.body.market.id}/orders`, {
      token: t.token,
      body: { outcomeId: made.body.market.outcomes[0].id, sharesMicro: '1000000', maxCostMicro: '1000000000' },
    });
    expect(buy.status).toBe(201);
    invalidateMap();
    expect((await getMap()).body.headline[0]).toBeGreaterThan(0.5);
    expect(got.body.regions).toEqual([
      { number: 0, label: 'first region' },
      { number: 1, label: 'second region' },
    ]);
    expect(got.body.clusters).toEqual([{ number: 3, label: 'a cluster' }]);

    // Titles are their own request, by slug.
    const titles = await api('GET', '/map/titles');
    expect(titles.status).toBe(200);
    expect(titles.body).toEqual({ titles: { a: 'Paper a', b: 'Paper b' } });

    await post({ slug: 'not-yet', title: 'Later' });
    const later = await getMap();
    expect(later.body.slugs).toEqual(['a', 'b', 'not-yet']);
    expect(later.body.area).toEqual([0, 0, null]);
    expect((await api('GET', '/map/titles')).body.titles['not-yet']).toBe('Later');
  });

  it('sends a large body compressed when the client accepts it', async () => {
    const slugs = Array.from({ length: 60 }, (_, i) => `paper-${i}`);
    for (const slug of slugs) await post({ slug, title: `A paper with a long enough title, number ${slug}` });
    await put({ points: slugs.map((slug, i) => ({ slug, x: i, y: -i })) });
    const plain = await api('GET', '/map/titles');
    expect(plain.headers.get('content-encoding')).toBeNull();

    for (const [accept, encoding, decode] of [
      ['gzip, deflate, br', 'br', brotliDecompressSync],
      ['gzip', 'gzip', gunzipSync],
      ['br;q=0, gzip', 'gzip', gunzipSync],
    ] as const) {
      // The handler itself: `api()` reads the body as text.
      const req = new Request(new URL('/api/v1/map/titles', ORIGIN), { headers: { 'accept-encoding': accept } });
      const res = await mapTitlesRoute.GET(req, { params: Promise.resolve({}) });
      expect(res.headers.get('content-encoding')).toBe(encoding);
      expect(res.headers.get('vary')).toBe('Accept-Encoding');
      expect(res.headers.get('etag')).toBe(plain.headers.get('etag'));
      expect(JSON.parse(decode(Buffer.from(await res.arrayBuffer())).toString())).toEqual(plain.body);
    }
  });

  it('answers a revalidation with 304 until the map changes', async () => {
    await post({ slug: 'a', title: 'a' });
    await put({ points: [{ slug: 'a', x: 0, y: 0 }] });
    const first = await getMap();
    const etag = first.headers.get('etag')!;
    expect(etag).toMatch(/^".+"$/);
    const again = await api('GET', '/map', { headers: { 'if-none-match': etag } });
    expect(again.status).toBe(304);
    expect(again.body).toBeNull();
    // A write bumps the cache: the next read is the new map, under a new tag.
    await put({ points: [{ slug: 'a', x: 1, y: 1 }] });
    const changed = await api('GET', '/map', { headers: { 'if-none-match': etag } });
    expect(changed.status).toBe(200);
    expect(changed.body.x).toEqual([1]);
    expect(changed.headers.get('etag')).not.toBe(etag);
  });

  it('is replaced whole, and empty clears it', async () => {
    for (const slug of ['a', 'b']) await post({ slug, title: slug });
    await put({ points: [{ slug: 'a', x: 0, y: 0 }], regions: [{ number: 0, label: 'old' }] });
    await put({ points: [{ slug: 'b', x: 1, y: 1 }] });
    const got = await getMap();
    expect(got.body.slugs).toEqual(['b']);
    expect(got.body.regions).toEqual([]);
    await put({ points: [] });
    expect((await getMap()).body.slugs).toEqual([]);
  });

  it('needs the admin scope to write and refuses a non-finite coordinate', async () => {
    const reader = await trader('reader', ['read']);
    expect((await put({ points: [] }, reader.token)).status).toBe(403);
    expect((await put({ points: [{ slug: 'a', x: 'far', y: 0 }] })).status).toBe(400);
    expect((await api('PUT', '/map', { token: admin.token, body: { points: [] } })).status).toBe(400);
  });

  it('is one per venue: each is read, replaced and cleared alone, and only venues with one have a map', async () => {
    for (const slug of ['a', 'b']) await post({ slug, title: slug });
    await put({ points: [{ slug: 'a', x: 0, y: 0 }], regions: [{ number: 0, label: 'mine' }] });
    await put({ kind: 'Other', points: [{ slug: 'b', x: 1, y: 1 }], regions: [{ number: 0, label: 'theirs' }] });
    expect(await mapKinds()).toEqual([defaultMarketKind(), 'Other'].sort());

    const [own, other] = [await getMap(), await getMap('Other')];
    expect([own.body.kind, own.body.slugs, own.body.regions]).toEqual([
      defaultMarketKind(),
      ['a'],
      [{ number: 0, label: 'mine' }],
    ]);
    expect([other.body.kind, other.body.slugs, other.body.regions]).toEqual([
      'Other',
      ['b'],
      [{ number: 0, label: 'theirs' }],
    ]);
    expect((await api('GET', '/map/titles?kind=Other')).body.titles).toEqual({ b: 'b' });

    // Replacing one venue's map keeps the other's; emptying it leaves that venue with none.
    await put({ points: [] });
    expect((await getMap('Other')).body.slugs).toEqual(['b']);
    expect((await getMap()).body.slugs).toEqual([]);
    expect(await mapKinds()).toEqual(['Other']);
  });

  it('refuses vectors of different lengths', async () => {
    const points = [
      { slug: 'a', x: 0, y: 0, vector: [1, 2, 3] },
      { slug: 'b', x: 1, y: 1, vector: [1, 2] },
    ];
    expect((await put({ points })).status).toBe(400);
    expect((await put({ points: [points[0], { ...points[1], vector: null }] })).status).toBe(200);
  });
});

describe('a paper’s minimap', () => {
  // In the default venue, whose map `putMap` writes, unless the body names another.
  const post = (body: Record<string, unknown>) =>
    api('POST', '/listings', { token: admin.token, body: { kind: defaultMarketKind(), ...body } });
  const putRelated = (ref: string, slugs: string[]) =>
    api('PUT', `/listings/${ref}/related`, {
      token: admin.token,
      body: { related: slugs.map((slug) => ({ slug, score: 1 })) },
    });
  const putMap = (
    points: { slug: string; x: number; y: number; cluster?: number; vector?: number[] }[],
    kind = defaultMarketKind(),
  ) => api('PUT', '/map', { token: admin.token, body: { kind, points, clusters: [{ number: 1, label: 'near' }] } });
  const minimap = async (slug: string) => {
    const listing = await resolveListing(slug);
    return listingMinimap(listing, (await listingRelatedTo(listing, { all: true })).related);
  };

  it('is null off the map', async () => {
    await post({ slug: 'c', title: 'c' });
    expect(await minimap('c')).toBeNull();
    expect((await api('GET', '/listings/c/minimap')).status).toBe(404);
  });

  it('is drawn from the paper’s own venue’s map, never another’s', async () => {
    await post({ slug: 'c', title: 'c', kind: 'Other' });
    await post({ slug: 'd', title: 'd', kind: 'Other' });
    await putMap([
      { slug: 'c', x: 0, y: 0 },
      { slug: 'd', x: 1, y: 0 },
    ]);
    expect(await minimap('c')).toBeNull();
    expect(await onMap(await resolveListing('c'))).toBe(false);
    await putMap([{ slug: 'c', x: 5, y: 5 }], 'Other');
    const m = (await minimap('c'))!;
    expect(m.points.map((p) => p.slug)).toEqual(['c']);
    expect(await onMap(await resolveListing('c'))).toBe(true);
  });

  it('is served by the API, public and cached, and follows a change to the related list', async () => {
    for (const slug of ['c', 'd', 'e']) await post({ slug, title: slug });
    await putMap([
      { slug: 'c', x: 0, y: 0 },
      { slug: 'd', x: 1, y: 0 },
      { slug: 'e', x: 2, y: 0 },
    ]);
    await putRelated('c', ['d']);
    const got = await api('GET', '/listings/c/minimap');
    expect(got.status).toBe(200);
    expect(got.headers.get('cache-control')).toMatch(/^public, /);
    expect(got.body).toEqual(JSON.parse(JSON.stringify(S.Minimap.parse(await minimap('c')))));
    expect(got.body.related.map((i: number) => got.body.points[i].slug)).toEqual(['d']);
    await putRelated('c', ['e']);
    const after = await api('GET', '/listings/c/minimap');
    expect(after.body.related.map((i: number) => after.body.points[i].slug)).toEqual(['e']);
  });

  it('takes in the nearest papers and the related ones wherever they lie, with the related pairs among them', async () => {
    // Papers at distance 1, 2, … from the paper: only the nearest MINIMAP_NEAREST belong.
    const line = Array.from({ length: MINIMAP_NEAREST + 10 }, (_, k) => ({
      slug: `n${k}`,
      x: k + 1,
      y: 0,
      cluster: 1,
    }));
    for (const slug of ['c', 'far', 'theirs', 'unmapped', ...line.map((p) => p.slug)])
      await post({ slug, title: slug });
    await putMap([
      { slug: 'c', x: 0, y: 0, cluster: 1 },
      { slug: 'far', x: 1000, y: 0 },
      { slug: 'theirs', x: 0, y: 2000 },
      ...line,
    ]);
    await putRelated('c', ['far', 'unmapped', 'n0']);
    // A related paper's own related papers stay out unless they are near anyway.
    await putRelated('far', ['theirs', 'c', 'n1']);

    const m = (await minimap('c'))!;
    expect(m.points[m.self].slug).toBe('c');
    expect(m.related.map((i) => m.points[i].slug)).toEqual(['far', 'n0']);
    expect(m.relatedElsewhere).toBe(1);
    const slugs = m.points.map((p) => p.slug);
    expect(slugs).toContain('far');
    expect(slugs).not.toContain('theirs');
    expect(slugs.filter((s) => s.startsWith('n'))).toHaveLength(MINIMAP_NEAREST);
    expect(slugs).not.toContain(`n${MINIMAP_NEAREST}`);
    expect(m.clusters).toEqual([{ number: 1, label: 'near' }]);
    const pair = ([a, b]: [number, number]) => `${m.points[a].slug}>${m.points[b].slug}`;
    expect(m.edges.map(pair).sort()).toEqual(['c>far', 'c>n0', 'far>c', 'far>n1']);
    // No vectors were supplied: nothing to redraw from.
    expect(m.vectors).toBeNull();
  });

  it('picks the nearest papers by vector from the nearest on the map, and sends every vector', async () => {
    // On the map n0 is nearest; by vector the first ten are the farthest from the paper.
    const line = Array.from({ length: MINIMAP_NEAREST + 10 }, (_, k) => ({
      slug: `n${k}`,
      x: k + 1,
      y: 0,
      vector: k < 10 ? [0, 1] : [1000, k],
    }));
    for (const slug of ['c', 'far', ...line.map((p) => p.slug)]) await post({ slug, title: slug });
    await putMap([{ slug: 'c', x: 0, y: 0, vector: [1, 0] }, { slug: 'far', x: 1000, y: 0, vector: [0, -1] }, ...line]);
    await putRelated('c', ['far', 'n0']);

    const m = (await minimap('c'))!;
    const slugs = m.points.map((p) => p.slug);
    expect(slugs.filter((s) => s.startsWith('n'))).toHaveLength(MINIMAP_NEAREST + 1);
    // n0 is related, so it stays; n1–n9 are near on the map but far by vector.
    expect(slugs).toContain('n0');
    for (let k = 1; k < 10; k++) expect(slugs).not.toContain(`n${k}`);
    expect(slugs).toContain(`n${MINIMAP_NEAREST + 9}`);
    expect(m.vectors).toEqual(
      m.points.map((p) => (p.slug === 'c' ? [1, 0] : (line.find((l) => l.slug === p.slug)?.vector ?? [0, -1]))),
    );
  });
});
