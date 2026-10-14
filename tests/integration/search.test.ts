/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are checked field by field */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { closeMarket, createMarket } from '@/server/engine';
import { upsertListing } from '@/server/listings';
import { browseListings, encodeCursor } from '@/server/views';
import { api } from './api-client';
import { closePool, resetDatabase, seedMarket, STARTING_MICRO } from './helpers';

/**
 * Free-text search (issue #8): the home page's `browseListings({ q })` and
 * `GET /listings?q=` / `GET /markets?q=`. The fixture is built once; every
 * test only reads.
 */

const db = getDb();

beforeAll(async () => {
  await resetDatabase();
  process.env.API_RATE_LIMIT_BURST = '1000';
  process.env.API_RATE_LIMIT_PER_SECOND = '1000';
  await seedMarket(0, 10); // "Will the thing happen?", kind 'binary', unlisted

  const day = 86_400_000;
  const base = { outcomes: ['YES', 'NO'], startingBalanceMicro: STARTING_MICRO, expectedTraders: 10 };
  const paper = async (
    slug: string,
    listing: { title: string; authors?: string[]; summary?: string; keywords?: string[]; primaryArea?: string },
    marketsOf: { question: string; description?: string; status?: 'draft' | 'open' }[],
    kind = 'ICLR 2027',
  ) => {
    const { listing: l } = await upsertListing({ slug, kind, ...listing });
    const ids: string[] = [];
    for (const [i, m] of marketsOf.entries()) {
      const { marketId } = await createMarket({
        ...base,
        slug: `${slug}-${i}`,
        kind,
        listingId: l.id,
        listingRank: i,
        closesAt: new Date(Date.now() + (10 + i) * day),
        ...m,
      });
      ids.push(marketId);
    }
    return ids;
  };

  await paper(
    'attention',
    {
      title: 'Attention Is All You Need: a Transformer for Translation',
      authors: ['Ashish Vaswani', 'Noam Shazeer'],
      summary: 'A network architecture based solely on attention mechanisms.',
      keywords: ['sequence models', 'machine translation'],
      primaryArea: 'natural language processing',
    },
    [
      { question: 'Will this paper be accepted at ICLR 2027?' },
      { question: 'Will it be an oral?', description: 'Decided by the programme committee.' },
    ],
  );
  await paper(
    'diffusion',
    {
      title: 'Denoising Diffusion Probabilistic Models',
      authors: ['Jonathan Ho', 'Pieter Abbeel'],
      summary: 'High quality image synthesis.',
      keywords: ['generative models', 'image synthesis'],
      primaryArea: 'generative models',
    },
    [
      { question: 'Will this paper be accepted at ICLR 2027?' },
      { question: 'Will it win an award?', description: 'Judged on reinforcement of prior results.' },
      { question: 'Will it mention chromodynamics?', status: 'draft' },
    ],
  );
  const [graphMain] = await paper(
    'graphs',
    { title: 'Graph Neural Networks at Scale', authors: ['Petar Velickovic'], summary: 'Message passing.' },
    [{ question: 'Will this paper be accepted at NeurIPS 2026?' }],
    'NeurIPS 2026',
  );
  await closeMarket(graphMain);
  // "attention" only in the abstract, so it ranks below a title match.
  await paper(
    'mixture',
    { title: 'Sparse Mixture of Experts', authors: ['Some One'], summary: 'Routing tokens with learned attention.' },
    [{ question: 'Will this paper be accepted at ICLR 2027?' }],
  );
  await createMarket({
    ...base,
    slug: 'unlisted-leaderboard',
    question: 'Will a transformer model top the leaderboard by 2027?',
    kind: 'ICLR 2027',
    closesAt: new Date(Date.now() + 30 * day),
  });
}, 60_000);

afterAll(async () => {
  await closePool();
});

/** Row identities: a listing's slug, or an unlisted market's. */
async function search(q: string | null, opts: { kind?: string | null; status?: any; sort?: any } = {}) {
  const { rows } = await browseListings({
    kind: opts.kind ?? null,
    status: opts.status ?? 'all',
    sort: opts.sort ?? 'relevance',
    q,
  });
  return rows.map((r) => r.listing?.slug ?? r.main!.market.slug);
}

const sorted = (xs: string[]) => [...xs].sort();

describe('browseListings with q', () => {
  it('stems: "transformers" finds "Transformer" and "transformer"', async () => {
    expect(sorted(await search('transformers'))).toEqual(['attention', 'unlisted-leaderboard']);
  });

  it('matches authors, abstracts, and any visible market in the row', async () => {
    expect(await search('Vaswani')).toEqual(['attention']);
    expect(await search('abbeel')).toEqual(['diffusion']);
    expect(await search('mechanisms')).toEqual(['attention']);
    expect(await search('leaderboard')).toEqual(['unlisted-leaderboard']);
    // The listing's second market's description.
    expect(await search('reinforcement')).toEqual(['diffusion']);
    // A draft market does not make its listing match.
    expect(await search('chromodynamics')).toEqual([]);
  });

  it('speaks websearch syntax: phrases, OR, negation', async () => {
    expect(await search('"denoising diffusion"')).toEqual(['diffusion']);
    expect(await search('"diffusion denoising"')).toEqual([]);
    expect(sorted(await search('vaswani or abbeel'))).toEqual(['attention', 'diffusion']);
    expect(await search('transformer -leaderboard')).toEqual(['attention']);
  });

  it('matches the last word as a prefix while typing', async () => {
    expect(sorted(await search('transf'))).toEqual(['attention', 'unlisted-leaderboard']);
    expect(await search('vaswa')).toEqual(['attention']);
    expect(await search('denoising diff')).toEqual(['diffusion']);
    // Only the last word: an earlier one must be whole.
    expect(await search('diff denoising')).toEqual([]);
  });

  it('ranks a title match above an abstract match', async () => {
    expect(await search('attention')).toEqual(['attention', 'mixture']);
  });

  it('combines with the status and kind filters and other sorts', async () => {
    expect(await search('graph', { status: 'open' })).toEqual([]);
    expect(await search('graph', { status: 'closed' })).toEqual(['graphs']);
    expect(await search('transformer', { kind: 'NeurIPS 2026' })).toEqual([]);
    expect(await search('transformer', { kind: 'ICLR 2027', status: 'open', sort: 'closing' })).toEqual([
      'attention',
      'unlisted-leaderboard',
    ]);
    expect(await search('attention', { sort: 'newest' })).toEqual(['mixture', 'attention']);
  });

  it('treats hostile input as text', async () => {
    for (const q of [
      "'; drop table listings; --",
      'a & | ! :* ( ) <-> \\',
      '"unbalanced',
      '-',
      'or',
      'the', // only a stopword
      'nul\u0000byte',
      '<script>alert(1)</script>',
      'x'.repeat(1000),
      'café naïve 東京',
    ]) {
      await expect(search(q)).resolves.toBeInstanceOf(Array);
    }
    const { rows } = await db.execute<{ n: number }>(sql`select count(*)::int as n from listings`);
    expect(rows[0].n).toBe(4);
  });
});

describe('browseListings search syntax (#10)', () => {
  it('filters on fields', async () => {
    expect(await search('author:vaswani')).toEqual(['attention']);
    expect(await search('a:"pieter abbeel"')).toEqual(['diffusion']);
    expect(await search('title:diffusion')).toEqual(['diffusion']);
    expect(await search('venue:neurips')).toEqual(['graphs']);
    expect(await search('keyword:translation')).toEqual(['attention']);
    expect(await search('kw:"image synthesis"')).toEqual(['diffusion']);
    // One keyword at a time: a value never spans two.
    expect(await search('keyword:"models machine"')).toEqual([]);
    expect(await search('area:generative')).toEqual(['diffusion']);
    expect(await search('primaryArea:language')).toEqual(['attention']);
    expect(await search('status:closed')).toEqual(['graphs']);
    // An unlisted market's title is its question.
    expect(await search('t:leaderboard')).toEqual(['unlisted-leaderboard']);
  });

  it('combines text and filters, with negation', async () => {
    expect(await search('transformer -author:vaswani')).toEqual(['unlisted-leaderboard']);
    expect(await search('attention venue:iclr')).toEqual(['attention', 'mixture']);
    expect(await search('attention -title:attention')).toEqual(['mixture']);
    expect(sorted(await search('-status:open'))).toEqual(['graphs']);
  });

  it('groups with OR and parentheses', async () => {
    expect(sorted(await search('(venue:neurips OR author:abbeel)'))).toEqual(['diffusion', 'graphs']);
    expect(sorted(await search('venue:iclr (vaswani OR abbeel)'))).toEqual(['attention', 'diffusion']);
    expect(await search('-(venue:iclr OR venue:binary)')).toEqual(['graphs']);
  });

  it('excludes by text alone: no document in the row may match', async () => {
    const all = await search(null, { sort: 'closing' });
    const without = await search('-attention', { sort: 'closing' });
    expect(without).toEqual(all.filter((s) => s !== 'attention' && s !== 'mixture'));
  });

  it('compares numbers: acceptance, volume, trades', async () => {
    // Nothing has traded: every binary headline is its opening 50%.
    const all = await search(null, { sort: 'closing' });
    expect(await search('accept>=50', { sort: 'closing' })).toEqual(all);
    expect(await search('accept>50%')).toEqual([]);
    expect(await search('trades=0', { sort: 'closing' })).toEqual(all);
    expect(await search('trades>0')).toEqual([]);
    expect(await search('volume<0.5', { sort: 'closing' })).toEqual(all);
  });

  it('treats an unknown key as text, and a bad filter as absent', async () => {
    expect(await search('Graph: neural')).toEqual(['graphs']);
    expect(await search('graph accept>lots')).toEqual(['graphs']);
  });
});

describe('GET /listings?q= and /markets?q=', () => {
  it('filters listings and markets by relevance', async () => {
    const listings = await api('GET', '/listings?q=vaswani');
    expect(listings.status).toBe(200);
    expect(listings.body.listings.map((l: any) => l.slug)).toEqual(['attention']);
    expect(listings.body.nextCursor).toBeNull();

    // A market matches on its listing's text too.
    const byAuthor = await api('GET', '/markets?q=vaswani');
    expect(sorted(byAuthor.body.markets.map((m: any) => m.slug))).toEqual(['attention-0', 'attention-1']);
    expect((await api('GET', '/markets?q=leaderboard')).body.markets.map((m: any) => m.slug)).toEqual([
      'unlisted-leaderboard',
    ]);
    expect((await api('GET', '/markets?q=graph&status=open')).body.markets).toEqual([]);
    expect((await api('GET', '/listings?q=transformer&kind=NeurIPS%202026')).body.listings).toEqual([]);
    // Blank is the same as absent.
    expect((await api('GET', '/listings?q=%20')).body.listings).toHaveLength(4);
  });

  it('pages in rank order with a rank cursor', async () => {
    const q = encodeURIComponent('attention or diffusion or graph or transformer');
    const all = (await api('GET', `/listings?q=${q}`)).body.listings.map((l: any) => l.slug);
    expect(sorted(all)).toEqual(['attention', 'diffusion', 'graphs', 'mixture']);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res: any = await api('GET', `/listings?q=${q}&limit=1${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status).toBe(200);
      seen.push(...res.body.listings.map((l: any) => l.slug));
      cursor = res.body.nextCursor;
    } while (cursor);
    expect(seen).toEqual(all);

    const markets: string[] = [];
    cursor = null;
    do {
      const res: any = await api('GET', `/markets?q=${q}&limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      markets.push(...res.body.markets.map((m: any) => m.slug));
      cursor = res.body.nextCursor;
    } while (cursor);
    expect(markets).toEqual((await api('GET', `/markets?q=${q}`)).body.markets.map((m: any) => m.slug));
    expect(new Set(markets).size).toBe(markets.length);
  });

  it('refuses an over-long query and a cursor from the other ordering', async () => {
    const long = await api('GET', `/listings?q=${'a'.repeat(201)}`);
    expect(long.status).toBe(400);
    expect(long.body.error.code).toBe('validation_error');

    const timeCursor = encodeCursor({ t: '2026-01-01T00:00:00.000000Z', id: '00000000-0000-0000-0000-000000000000' });
    expect((await api('GET', `/markets?q=graph&cursor=${timeCursor}`)).status).toBe(400);
    const rankCursor = encodeCursor({ r: '0.1', id: '00000000-0000-0000-0000-000000000000' });
    expect((await api('GET', `/markets?cursor=${rankCursor}`)).status).toBe(400);
  });

  it('documents q in the OpenAPI document', async () => {
    const doc = (await api('GET', '/openapi.json')).body;
    for (const path of ['/listings']) {
      expect(doc.paths[path].get.parameters.map((p: any) => p.name)).toContain('q');
    }
  });
});
