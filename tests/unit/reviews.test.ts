import { describe, expect, it } from 'vitest';
import { atomsOf, CURVE_POINTS, densityCurve, factorMeans, meanRating, shareBelow, threadReviews } from '@/lib/reviews';

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

describe('atomsOf and shareBelow', () => {
  const atoms = atomsOf([1, 2, 2, 2, 3]);
  it('gathers ties, with shares summing to one', () => {
    expect(atoms).toEqual([
      [1, 0.2],
      [2, 0.6],
      [3, 0.2],
    ]);
  });
  it('counts only what is strictly below: a tie is not beaten', () => {
    expect(shareBelow(atoms, 1)).toBe(0);
    expect(shareBelow(atoms, 2)).toBeCloseTo(0.2);
    expect(shareBelow(atoms, 2.5)).toBeCloseTo(0.8);
    expect(shareBelow(atoms, 4)).toBeCloseTo(1);
  });
});

describe('densityCurve', () => {
  // The shape that made a histogram a comb: means on the thirds of a 1–4 scale.
  const thirds = atomsOf([1.67, 1.67, 2, 2, 2, 2, 2.33, 2.33, 2.33, 2.67].map((x) => Math.round(x * 3) / 3));
  const curve = densityCurve(thirds, [1, 4]);
  it('samples the whole scale and peaks at 1', () => {
    expect(curve).toHaveLength(CURVE_POINTS);
    expect(Math.max(...curve)).toBeCloseTo(1);
    expect(Math.min(...curve)).toBeGreaterThanOrEqual(0);
  });
  it('blends neighbouring thirds into one hump, with no comb between them', () => {
    const peak = curve.indexOf(Math.max(...curve));
    for (let i = 1; i <= peak; i += 1) expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1] - 1e-9);
    for (let i = peak + 1; i < curve.length; i += 1) expect(curve[i]).toBeLessThanOrEqual(curve[i - 1] + 1e-9);
  });
  it('survives an empty field', () => {
    expect(densityCurve([], [1, 4]).every((y) => y === 0)).toBe(true);
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

describe('factorMeans', () => {
  const review = (scores: Record<string, number>) => ({
    scores: Object.entries(scores).map(([label, value]) => ({ label, value })),
  });

  it('means each label over the reviews that gave it, tie-break order first, any other by name', () => {
    const out = factorMeans([
      review({ Zest: 1, Confidence: 4, Soundness: 3, Novelty: 2 }),
      review({ Confidence: 2, Soundness: 2 }),
    ]);
    expect(out.map((f) => f.label)).toEqual(['Soundness', 'Confidence', 'Novelty', 'Zest']);
    expect(out[0]).toEqual({ label: 'Soundness', mean: 2.5, count: 2 });
    expect(out[2]).toEqual({ label: 'Novelty', mean: 2, count: 1 });
  });

  it('is empty without scores', () => {
    expect(factorMeans([review({})])).toEqual([]);
  });
});
