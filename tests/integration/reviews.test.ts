/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are checked field by field */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { upsertListing } from '@/server/listings';
import { getDb } from '@/db';
import { factorMeans } from '@/lib/reviews';
import { clearReviewFieldCache, reviewFactorFields, reviewField, reviewQueryCohort } from '@/server/review-field';
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

describe('the review distribution among a search', () => {
  const titled = async (slug: string, title: string, kind = 'ICLR 2027') =>
    (await upsertListing({ slug, title, kind })).listing;
  const write = async (l: { id: string; slug: string }, ratings: number[]) =>
    setReviews(
      l as any,
      ratings.map((r, i) => rated(`${l.slug}-${i}`, r)),
    );

  it('places the paper among the venue’s reviewed papers the query finds, itself left out', async () => {
    const me = await titled('me', 'Diffusion for me');
    await write(me, [3]);
    // Six diffusion papers: 1, 2, 2, 4, 4, 4. Three others that do not match, and one elsewhere that does.
    const ratings = [1, 2, 2, 4, 4, 4];
    for (const [i, r] of ratings.entries()) await write(await titled(`d${i}`, `Diffusion model ${i}`), [r]);
    for (const i of [0, 1, 2]) await write(await titled(`o${i}`, `Graph thing ${i}`), [1]);
    await write(await titled('far', 'Diffusion far away', 'Other'), [10]);

    const view = await reviewQueryCohort(me, 'diffusion');
    expect(view.errors).toEqual([]);
    expect(view.papers).toBe(6);
    const overall = view.series[0];
    expect(overall.mean).toBe(3);
    expect(overall.field.papers).toBe(6);
    expect(overall.field.ahead).toBe(50); // 3 of the 6 below it
    expect(overall.field.domain).toEqual([1, 4]); // the venue’s scale, not the far venue’s
    expect(overall.field.reference).toBeDefined();

    // Filters and the parser’s errors come through; too few found draws nothing.
    const few = await reviewQueryCohort(me, 'title:graph accept>=200');
    expect(few.series).toEqual([]);
    expect(few.papers).toBe(3);
    expect(few.errors).toHaveLength(1);
    expect((await reviewQueryCohort(me, '   ')).papers).toBe(0);
  });

  it('answers over the API', async () => {
    const me = await titled('me', 'Diffusion for me');
    await write(me, [3]);
    for (const i of [0, 1, 2, 3, 4]) await write(await titled(`d${i}`, `Diffusion ${i}`), [(i % 4) + 1]);
    const got = await api('GET', `/listings/${me.slug}/review-query?q=${encodeURIComponent('rating>=1 diffusion')}`);
    expect(got.status).toBe(200);
    expect(got.body.papers).toBe(5);
    expect(got.body.series[0].field.papers).toBe(5);
    expect((await api('GET', `/listings/nope/review-query?q=x`)).status).toBe(404);
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

  const scored = (externalId: string, rating: number, scores: Record<string, number>) => ({
    ...rated(externalId, rating),
    scores: Object.entries(scores).map(([label, value]) => ({ label, value })),
  });

  it('breaks a tie in the rating by the other scores, in order, before the number of reviews', async () => {
    const [unscored, confident, informative, sound, lower] = await Promise.all(
      ['unscored', 'confident', 'informative', 'sound', 'lower'].map((s) => paper(s)),
    );
    await setReviews(unscored, [rated('a', 3), rated('b', 3), rated('c', 3)]);
    await setReviews(confident, [scored('a', 3, { Soundness: 2, Informativeness: 2, Confidence: 4 })]);
    await setReviews(informative, [scored('a', 3, { Soundness: 2, Informativeness: 3, Confidence: 1 })]);
    await setReviews(sound, [scored('a', 3, { Soundness: 3, Informativeness: 1, Confidence: 1 })]);
    await setReviews(lower, [scored('a', 2, { Soundness: 3, Informativeness: 3, Confidence: 4 })]);
    const { rows } = await browseListings({ sort: 'rating', status: 'all', kind: 'ICLR 2027' }, getDb());
    expect(rows.map((r) => r.listing?.slug)).toEqual([
      sound.slug,
      informative.slug,
      confident.slug,
      unscored.slug,
      lower.slug,
    ]);
  });

  it('filters on the mean of another score, and never matches a paper without it', async () => {
    const [none, thirds, high] = await Promise.all(['none', 'thirds', 'high'].map((s) => paper(s)));
    await setReviews(none, [rated('a', 3)]);
    await setReviews(thirds, [
      scored('a', 3, { Soundness: 2 }),
      scored('b', 3, { Soundness: 3 }),
      scored('c', 3, { Soundness: 3 }),
    ]);
    await setReviews(high, [scored('a', 1, { Soundness: 3, Confidence: 1 })]);
    const found = async (q: string) => {
      const { rows } = await browseListings({ sort: 'newest', status: 'all', q }, getDb());
      return rows.map((r) => r.listing?.slug).sort();
    };
    expect(await found('soundness>=2.67')).toEqual([high.slug, thirds.slug].sort());
    expect(await found('soundness=2.67')).toEqual([thirds.slug]);
    expect(await found('soundness!=3')).toEqual([thirds.slug]);
    expect(await found('confidence<2')).toEqual([high.slug]);
    expect(await found('soundness>=2 rating>=2')).toEqual([thirds.slug]);
  });

  it('searches what reviewers wrote, stemmed, as a phrase, and not their section labels', async () => {
    const [leaky, reversed, silent, commented] = await Promise.all(
      ['leaky', 'reversed', 'silent', 'commented'].map((s) => paper(s)),
    );
    const said = (externalId: string, text: string) => ({
      ...rated(externalId, 3),
      sections: [{ label: 'Critical weaknesses', text }],
    });
    await setReviews(leaky, [said('a', 'The authors leak data leakages everywhere.')]);
    await setReviews(reversed, [said('a', 'Leakage of data is unlikely.')]);
    await setReviews(commented, [
      { externalId: 'c', kind: 'comment', sections: [{ label: '', text: 'No data leakage here.' }] },
    ]);
    const found = async (q: string) => {
      const { rows } = await browseListings({ sort: 'newest', status: 'all', q }, getDb());
      return rows.map((r) => r.listing?.slug).sort();
    };
    expect(await found('review:"data leakage"')).toEqual([commented.slug, leaky.slug].sort());
    expect(await found('review:leakage')).toEqual([commented.slug, leaky.slug, reversed.slug].sort());
    expect(await found('review:critical')).toEqual([]);
    expect(await found('review:"data leakage" title:leaky')).toEqual([leaky.slug]);
    expect(await found('review!=leakage')).toEqual([silent.slug]);
    expect(await found('-review:leakage')).toEqual([silent.slug]);
  });

  it('places a paper on each of its scores, each on its own scale, and leaves out one with no field', async () => {
    const [a, b] = await Promise.all(['a', 'b'].map((s) => paper(s)));
    await setReviews(a, [scored('x', 3, { Soundness: 3, Confidence: 1, Rare: 2 })]);
    await setReviews(b, [scored('x', 3, { Soundness: 1, Confidence: 4 })]);
    const series = await reviewFactorFields(
      'ICLR 2027',
      factorMeans((await reviewsOf(a.id)).filter((r) => r.kind === 'review')),
    );
    expect(series.map((s) => s.label)).toEqual(['Soundness', 'Confidence']);
    expect(series[0].field).toMatchObject({ domain: [1, 3], ahead: 100 });
    expect(series[1].field).toMatchObject({ domain: [1, 4], ahead: 0 });
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
