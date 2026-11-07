/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are checked field by field */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { upsertListing, setRelated, setVenueStatus } from '@/server/listings';
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

describe('PUT and DELETE /listings/{id}/venue-status', () => {
  it('takes an admin, keeps the time while the status holds, survives a re-post, and clears', async () => {
    await paper('p1');
    const reader = await trader('ann', ['read']);
    const admin = await trader('adm', ['read', 'admin']);
    const path = '/listings/p1/venue-status';
    const put = (status: string, token = admin.token) => api('PUT', path, { token, body: { status } });

    expect((await put('withdrawn', reader.token)).status).toBe(403);
    expect((await put('rejected')).status).toBe(400);
    const first = await put('withdrawn');
    expect(first.status).toBe(200);
    const at = (first.body as any).venueStatusAt;
    expect((first.body as any).venueStatus).toBe('withdrawn');
    expect(((await put('withdrawn')).body as any).venueStatusAt).toBe(at);

    await paper('p1', 'Retitled');
    expect(((await api('GET', '/listings/p1')).body as any).venueStatus).toBe('withdrawn');

    expect(((await put('desk_rejected')).body as any).venueStatus).toBe('desk_rejected');
    const cleared = (await api('DELETE', path, { token: admin.token })).body as any;
    expect([cleared.venueStatus, cleared.venueStatusAt]).toEqual([null, null]);
    expect(((await api('GET', '/listings/p1')).body as any).venueStatus).toBeNull();
  });
});

describe('browsing around withdrawn and desk-rejected papers', () => {
  it('splits the list and a search, with counts of each', async () => {
    await paper('kept', 'Graph networks');
    await setVenueStatus(await paper('gone', 'Graph sparsification'), 'withdrawn');
    const desk = await paper('desk', 'Graph pooling');
    await setVenueStatus(desk, 'desk_rejected');
    const base = { sort: 'newest', status: 'all', kind: 'ICLR 2027' } as const;

    expect(await slugs(base)).toEqual(['desk', 'gone', 'kept']);
    expect(await slugs({ ...base, out: 'hide' })).toEqual(['kept']);
    expect(await slugs({ ...base, out: 'only' })).toEqual(['desk', 'gone']);

    const q = 'graph';
    expect((await browseListings({ ...base, q, out: 'hide' })).total).toBe(1);
    expect((await browseListings({ ...base, q, out: 'only' })).total).toBe(2);

    // Each read is cached by what it asks: a mark drops those caches.
    await setVenueStatus(desk, null);
    expect(await slugs({ ...base, out: 'hide' })).toEqual(['desk', 'kept']);
  });

  it('keeps them out of the map search, related lists and the sitemap, but not their own page', async () => {
    const kept = await paper('kept', 'Graph networks');
    const gone = await paper('gone', 'Graph sparsification');
    await setRelated(kept, [{ slug: 'gone', score: 0.9 }]);
    await setVenueStatus(gone, 'desk_rejected');

    expect((await mapSearch('graph', 'ICLR 2027')).slugs).toEqual(['kept']);
    expect((await listingRelatedTo(await resolveListing('kept'))).related).toEqual([]);
    expect(await sitemapPaths()).toEqual(['/papers/kept']);
    expect((await api('GET', '/listings/gone')).status).toBe(200);
  });
});
