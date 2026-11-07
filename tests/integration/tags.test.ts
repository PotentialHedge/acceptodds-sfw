import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db';
import { upsertListing } from '@/server/listings';
import { browseListings, resolveListing } from '@/server/views';
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

describe('PUT /listing-tags', () => {
  it('takes an admin, replaces the tags of the slugs named, skips unknown ones, and keyword: finds them', async () => {
    const kind = 'ICLR 2027';
    await upsertListing({ slug: 'a', title: 'A', kind, keywords: ['LLMs; Agents'] });
    await upsertListing({ slug: 'b', title: 'B', kind, keywords: ['Large Language Models'] });
    await upsertListing({ slug: 'c', title: 'C', kind, keywords: ['graphs'] });
    const body = {
      tags: [
        { slug: 'a', tags: ['llm', 'llm agents'] },
        { slug: 'b', tags: ['llm'] },
        { slug: 'nope', tags: ['x'] },
      ],
    };
    const reader = await trader('rd', ['read']);
    expect((await api('PUT', '/listing-tags', { token: reader.token, body })).status).toBe(403);
    const admin = await trader('adm', ['read', 'admin']);
    const put = await api('PUT', '/listing-tags', { token: admin.token, body });
    expect(put.status).toBe(200);
    expect(put.body.count).toBe(2);
    // Unchanged: nothing to write.
    expect((await api('PUT', '/listing-tags', { token: admin.token, body })).body.count).toBe(0);

    expect((await resolveListing('a')).tags).toEqual(['llm', 'llm agents']);
    expect((await resolveListing('c')).tags).toEqual([]);
    expect((await resolveListing('b')).keywords).toEqual(['Large Language Models']); // as written, kept

    const found = async (q: string) =>
      (await browseListings({ sort: 'newest', status: 'all', kind, q }, getDb())).rows
        .map((r) => r.listing?.slug)
        .sort();
    expect(await found('keyword:llm')).toEqual(['a', 'b']); // cleaned
    expect(await found('keyword:"large language"')).toEqual(['b']); // as written
    expect(await found('keyword:graphs')).toEqual(['c']);

    await api('PUT', '/listing-tags', { token: admin.token, body: { tags: [{ slug: 'a', tags: [] }] } });
    expect((await resolveListing('a')).tags).toEqual([]);
  });
});
