/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are checked field by field */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { upsertListing } from '@/server/listings';
import { getDb } from '@/db';
import { clearReviewFieldCache, reviewField } from '@/server/review-field';
import { reviewsOf, setReviews } from '@/server/reviews';
import { api, trader } from './api-client';
import { closePool, resetDatabase } from './helpers';

beforeEach(async () => {
  await resetDatabase();
  clearReviewFieldCache();
  process.env.API_RATE_LIMIT_BURST = '1000';
  process.env.API_RATE_LIMIT_PER_SECOND = '1000';
}, 60_000);

afterAll(async () => {
  await closePool();
});

const paper = async (slug: string, kind = 'ICLR 2027') => (await upsertListing({ slug, title: slug, kind })).listing;
const rated = (externalId: string, rating: number | null) => ({ externalId, kind: 'review' as const, rating });

describe('PUT and GET /listings/{id}/reviews', () => {
  it('takes an admin to write, none to read, and replaces whole', async () => {
    const l = await paper('p1');
    const reader = await trader('ann', ['read']);
    const admin = await trader('adm', ['read', 'admin']);
    const body = {
      reviews: [
        {
          externalId: 'r1',
          kind: 'review',
          author: 'Reviewer_A',
          rating: 3,
          scores: [{ label: 'Confidence', value: 2 }],
          sections: [{ label: 'Strengths', text: 'Good *work*' }],
          license: 'CC BY 4.0',
          postedAt: '2026-11-01T00:00:00Z',
        },
        {
          externalId: 'c1',
          kind: 'comment',
          replyTo: 'r1',
          author: 'Authors',
          sections: [{ label: '', text: 'Thanks' }],
        },
      ],
    };
    expect((await api('PUT', `/listings/${l.id}/reviews`, { token: reader.token, body })).status).toBe(403);
    const put = await api('PUT', `/listings/${l.slug}/reviews`, { token: admin.token, body });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ reviews: 1, comments: 1 });

    const got = await api('GET', `/listings/${l.id}/reviews`);
    expect(got.status).toBe(200);
    expect(got.body.reviews.map((r: any) => r.externalId)).toEqual(['r1', 'c1']);
    expect(got.body.reviews[0]).toMatchObject({ rating: 3, author: 'Reviewer_A', license: 'CC BY 4.0' });

    await api('PUT', `/listings/${l.id}/reviews`, { token: admin.token, body: { reviews: [rated('r2', 1)] } });
    expect((await api('GET', `/listings/${l.id}/reviews`)).body.reviews.map((r: any) => r.externalId)).toEqual(['r2']);
    await api('PUT', `/listings/${l.id}/reviews`, { token: admin.token, body: { reviews: [] } });
    expect((await api('GET', `/listings/${l.id}/reviews`)).body.reviews).toEqual([]);
  });

  it('refuses a repeated externalId, leaving what is stored', async () => {
    const l = await paper('p1');
    const admin = await trader('adm', ['read', 'admin']);
    await setReviews(l, [rated('r1', 2)]);
    const bad = { reviews: [rated('x', 1), rated('x', 2)] };
    expect((await api('PUT', `/listings/${l.id}/reviews`, { token: admin.token, body: bad })).status).toBe(400);
    expect((await reviewsOf(l.id)).map((r) => r.externalId)).toEqual(['r1']);
  });

  it('refuses a NUL with a 400, which Postgres could not store', async () => {
    const l = await paper('p1');
    const admin = await trader('adm', ['read', 'admin']);
    const body = { reviews: [{ externalId: 'r', kind: 'review', sections: [{ label: 'x', text: 'a\u0000b' }] }] };
    expect((await api('PUT', `/listings/${l.id}/reviews`, { token: admin.token, body })).status).toBe(400);
  });

  it('never keeps a rating on a comment', async () => {
    const l = await paper('p1');
    await setReviews(l, [{ externalId: 'c', kind: 'comment', rating: 4 }]);
    expect((await reviewsOf(l.id))[0].rating).toBeNull();
  });
});

describe('reviewField', () => {
  it('places a paper among its venue’s means, on the venue’s own scale, ties not beaten', async () => {
    const write = async (slug: string, ratings: (number | null)[], kind?: string) =>
      setReviews(
        await paper(slug, kind),
        ratings.map((r, i) => rated(`${slug}-${i}`, r)),
      );
    await write('a', [1, 2]); // 1.5
    await write('b', [2, 3, 3]); // 2.67
    await write('c', [2, 3, 3]); // 2.67, tied
    await write('d', [4, 5]); // 4.5
    await write('unrated', [null]);
    await write('elsewhere', [10, 10], 'Other'); // another venue's scale stays there

    const field = await reviewField('ICLR 2027', (2 + 3 + 3) / 3, getDb());
    expect(field?.domain).toEqual([1, 5]);
    expect(field?.bins.reduce((x, y) => x + y, 0)).toBe(4);
    expect(field?.ahead).toBe(33); // a of the 3 others; the tie is not beaten
  });

  it('has no field for a paper with no mean, or a venue of one', async () => {
    await setReviews(await paper('solo'), [rated('s', 3)]);
    expect(await reviewField('ICLR 2027', null)).toBeNull();
    expect(await reviewField(null, 3)).toBeNull();
    expect(await reviewField('ICLR 2027', 3)).toBeNull();
  });
});
