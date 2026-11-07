/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are checked field by field */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { upsertListing, setRelated, setWithdrawn } from '@/server/listings';
import { sitemapPaths } from '@/server/seo';
import { browseListings, listingRelatedTo, mapSearch, resolveListing } from '@/server/views';
import { api, trader } from './api-client';
import { closePool, resetDatabase } from './helpers';

beforeEach(async () => {
  await resetDatabase();
  process.env.API_RATE_LIMIT_BURST = '1000';
  process.env.API_RATE_LIMIT_PER_SECOND = '1000';
}, 60_000);

afterAll(async () => {
  await closePool();
});

const paper = async (slug: string, title = slug) => (await upsertListing({ slug, title, kind: 'ICLR 2027' })).listing;

const slugs = async (q: Parameters<typeof browseListings>[0]) =>
  (await browseListings(q)).rows.map((r) => r.listing?.slug).sort();

describe('PUT and DELETE /listings/{id}/withdrawn', () => {
  it('takes an admin, keeps the first time, survives a re-post, and clears', async () => {
    await paper('p1');
    const reader = await trader('ann', ['read']);
    const admin = await trader('adm', ['read', 'admin']);
    const path = '/listings/p1/withdrawn';

    expect((await api('PUT', path, { token: reader.token })).status).toBe(403);
    const first = await api('PUT', path, { token: admin.token });
    expect(first.status).toBe(200);
    const at = (first.body as any).withdrawnAt;
    expect(at).toEqual(expect.any(String));
    expect(((await api('PUT', path, { token: admin.token })).body as any).withdrawnAt).toBe(at);

    await paper('p1', 'Retitled');
    expect(((await api('GET', '/listings/p1')).body as any).withdrawnAt).toBe(at);

    expect(((await api('DELETE', path, { token: admin.token })).body as any).withdrawnAt).toBeNull();
    expect(((await api('GET', '/listings/p1')).body as any).withdrawnAt).toBeNull();
  });
});

describe('browsing around a withdrawn paper', () => {
  it('splits the list and a search, with counts of each', async () => {
    await paper('kept', 'Graph networks');
    const gone = await paper('gone', 'Graph sparsification');
    await setWithdrawn(gone, true);
    const base = { sort: 'newest', status: 'all', kind: 'ICLR 2027' } as const;

    expect(await slugs(base)).toEqual(['gone', 'kept']);
    expect(await slugs({ ...base, withdrawn: 'hide' })).toEqual(['kept']);
    expect(await slugs({ ...base, withdrawn: 'only' })).toEqual(['gone']);

    const q = 'graph';
    const hidden = await browseListings({ ...base, q, withdrawn: 'hide' });
    expect(hidden.total).toBe(1);
    const apart = await browseListings({ ...base, q, withdrawn: 'only' });
    expect(apart.total).toBe(1);
    expect(apart.rows[0].listing?.slug).toBe('gone');

    // Each read is cached by what it asks: a mark drops those caches.
    await setWithdrawn(gone, false);
    expect(await slugs({ ...base, withdrawn: 'hide' })).toEqual(['gone', 'kept']);
  });

  it('keeps it out of the map search, related lists and the sitemap, but not its own page', async () => {
    const kept = await paper('kept', 'Graph networks');
    const gone = await paper('gone', 'Graph sparsification');
    await setRelated(kept, [{ slug: 'gone', score: 0.9 }]);
    await setWithdrawn(gone, true);

    expect((await mapSearch('graph', 'ICLR 2027')).slugs).toEqual(['kept']);
    expect((await listingRelatedTo(await resolveListing('kept'))).related).toEqual([]);
    expect(await sitemapPaths()).toEqual(['/papers/kept']);
    expect((await api('GET', '/listings/gone')).status).toBe(200);
  });
});
