import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { binOf, histogram, meanRating, REVIEW_BINS, threadReviews } from '@/lib/reviews';

const comment = (externalId: string, replyTo: string | null) => ({ externalId, kind: 'comment' as const, replyTo });
const review = (externalId: string) => ({ externalId, kind: 'review' as const, replyTo: null });

describe('meanRating', () => {
  it('ignores reviews with no rating, and has no mean without one', () => {
    expect(meanRating([1, null, 2])).toBe(1.5);
    expect(meanRating([null])).toBeNull();
    expect(meanRating([])).toBeNull();
  });
  it('counts a rating of zero', () => {
    expect(meanRating([0, 2])).toBe(1);
  });
});

describe('binOf', () => {
  it('closes the last bin at the top of the scale, and keeps out-of-range values on the chart', () => {
    expect(binOf(1, [1, 5], 48)).toBe(0);
    expect(binOf(5, [1, 5], 48)).toBe(47);
    expect(binOf(0, [1, 5], 48)).toBe(0);
    expect(binOf(9, [1, 5], 48)).toBe(47);
  });
  it('puts a mean on an edge in the bin that starts there', () => {
    // 1/12-wide bins: every third and quarter of a point is an edge, and division must not drop it a bin.
    for (let k = 0; k < 48; k += 1) expect(binOf(1 + k / 12, [1, 5], 48)).toBe(k);
  });
  it('survives a one-point domain', () => {
    expect(binOf(3, [3, 3], 48)).toBe(0);
  });
  it('is monotonic and always a real bin', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 10, noNaN: true }), fc.double({ min: 0, max: 10, noNaN: true }), (a, b) => {
        const [x, y] = a <= b ? [a, b] : [b, a];
        const [i, j] = [binOf(x, [0, 10], REVIEW_BINS), binOf(y, [0, 10], REVIEW_BINS)];
        return i <= j && i >= 0 && j < REVIEW_BINS;
      }),
    );
  });
});

describe('histogram', () => {
  it('counts every value exactly once', () => {
    const values = [1, 1.5, 2, 3.25, 5];
    const bins = histogram(values, [1, 5], REVIEW_BINS);
    expect(bins).toHaveLength(REVIEW_BINS);
    expect(bins.reduce((a, b) => a + b, 0)).toBe(values.length);
  });
});

describe('threadReviews', () => {
  it('hangs a comment under its review, through any depth of replies', () => {
    const { reviews, loose } = threadReviews([
      review('r1'),
      review('r2'),
      comment('c1', 'r1'),
      comment('c2', 'c1'),
      comment('c3', 'r2'),
    ]);
    expect(reviews.map((r) => [r.review.externalId, r.comments.map((c) => c.externalId)])).toEqual([
      ['r1', ['c1', 'c2']],
      ['r2', ['c3']],
    ]);
    expect(loose).toEqual([]);
  });
  it('keeps a comment on the paper, or on something not sent, loose', () => {
    const { loose } = threadReviews([comment('c1', null), comment('c2', 'gone'), comment('c3', 'c2')]);
    expect(loose.map((c) => c.externalId)).toEqual(['c1', 'c2', 'c3']);
  });
  it('does not hang on a cycle', () => {
    const { reviews, loose } = threadReviews([comment('a', 'b'), comment('b', 'a'), comment('self', 'self')]);
    expect(reviews).toEqual([]);
    expect(loose).toHaveLength(3);
  });
});
