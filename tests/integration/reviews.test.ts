/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are checked field by field */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { upsertListing } from '@/server/listings';
import { getDb } from '@/db';
import { clearReviewFieldCache, reviewField } from '@/server/review-field';
import { reviewsOf, setReviews } from '@/server/reviews';
import { browseListings } from '@/server/views';
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
    expect(field?.atoms.reduce((x, [, share]) => x + share, 0)).toBeCloseTo(1);
    expect(field?.atoms).toHaveLength(3); // the tie is one point of the field
    expect(Math.max(...field!.curve)).toBeCloseTo(1);
    expect(field?.ahead).toBe(33); // a of the 3 others; the tie is not beaten
  });

  it('has no field for a paper with no mean, or a venue of one', async () => {
    await setReviews(await paper('solo'), [rated('s', 3)]);
    expect(await reviewField('ICLR 2027', null)).toBeNull();
    expect(await reviewField(null, 3)).toBeNull();
    expect(await reviewField('ICLR 2027', 3)).toBeNull();
  });
});

describe('the home list and ratings', () => {
  it('sorts by mean rating, more reviews first on a tie, the unreviewed last, and carries the mean', async () => {
    const [none, low, tied1, tied2] = await Promise.all(['none', 'low', 'tied1', 'tied2'].map((s) => paper(s)));
    await setReviews(low, [rated('a', 1), rated('b', 2)]);
    await setReviews(tied1, [rated('a', 3)]);
    // A review with no rating and a comment count for nothing.
    await setReviews(tied2, [
      rated('a', 3),
      rated('b', 3),
      rated('c', null),
      { externalId: 'd', kind: 'comment', rating: 1 },
    ]);
    const { rows, total } = await browseListings({ sort: 'rating', status: 'all', kind: 'ICLR 2027' }, getDb());
    expect(total).toBe(4);
    expect(rows.map((r) => r.listing?.slug)).toEqual([tied2.slug, tied1.slug, low.slug, none.slug]);
    expect(rows.map((r) => r.reviewMean)).toEqual([3, 3, 1.5, null]);
    expect(rows.map((r) => r.reviewCount)).toEqual([2, 1, 2, 0]);
  });

  it('filters on the mean as a row shows it, in the search syntax', async () => {
    const [none, thirds, high, commented] = await Promise.all(
      ['none', 'thirds', 'high', 'commented'].map((s) => paper(s)),
    );
    await setReviews(thirds, [rated('a', 2), rated('b', 3), rated('c', 3)]); // 2.666…, shown as 2.67
    await setReviews(high, [rated('a', 4)]);
    await setReviews(commented, [rated('a', null), { externalId: 'b', kind: 'comment', rating: 4 }]);
    const found = async (q: string) => {
      const { rows } = await browseListings({ sort: 'newest', status: 'all', q }, getDb());
      return rows.map((r) => r.listing?.slug).sort();
    };
    expect(await found('rating>=2.67')).toEqual([high.slug, thirds.slug].sort());
    expect(await found('rating=2.67')).toEqual([thirds.slug]);
    expect(await found('rating>2.67')).toEqual([high.slug]);
    expect(await found('score<3')).toEqual([thirds.slug]);
    expect(await found('rating!=4')).toEqual([thirds.slug]);
    // Combined with the rest of the syntax; a negation also keeps the unrated.
    expect(await found('rating>=2 title:high')).toEqual([high.slug]);
    expect(await found('rating>=4 OR title:thirds')).toEqual([high.slug, thirds.slug].sort());
    expect(await found('-rating>=3')).toEqual([commented.slug, none.slug, thirds.slug].sort());
  });

  it('carries the mean under any other sort', async () => {
    const l = await paper('p1');
    await setReviews(l, [rated('a', 2), rated('b', 3), rated('c', 3)]);
    const { rows } = await browseListings({ sort: 'newest', status: 'all' });
    expect(rows[0]).toMatchObject({ reviewMean: 2.666667, reviewCount: 3 });
  });
});
