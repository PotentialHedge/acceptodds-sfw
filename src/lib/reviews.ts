/**
 * The arithmetic and threading behind a paper's reviews: pure and client-safe.
 * The field itself is read in `server/review-field.ts`.
 */

/**
 * How many bars the review field is cut into. Finer than the 20 of the chance
 * of acceptance. A mean of three whole-number ratings falls on thirds, so bars
 * this narrow keep neighbouring means apart and some stand empty between them:
 * that is the shape of the data, not a gap in it.
 */
export const REVIEW_BINS = 48;

/** A mean, rounded so one read in SQL and one summed here compare equal. */
export function roundMean(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

/** The mean of the numbers among `ratings`, or `null` when there are none. */
export function meanRating(ratings: readonly (number | null)[]): number | null {
  const xs = ratings.filter((r): r is number => r !== null);
  return xs.length === 0 ? null : roundMean(xs.reduce((a, b) => a + b, 0) / xs.length);
}

/**
 * The bin of `x` among `n` equal bins across `domain`, the last closed at its
 * top. The nudge is for a mean sitting on an edge: 2.25 must not fall to the
 * bin below because a division came out a hair under.
 */
export function binOf(x: number, domain: readonly [number, number], n: number): number {
  const [lo, hi] = domain;
  if (!(hi > lo)) return 0;
  return Math.max(0, Math.min(n - 1, Math.floor(((x - lo) / (hi - lo)) * n + 1e-9)));
}

/** The histogram of `values` across `domain`. */
export function histogram(values: readonly number[], domain: readonly [number, number], n: number): number[] {
  const bins = Array.from({ length: n }, () => 0);
  for (const x of values) bins[binOf(x, domain, n)] += 1;
  return bins;
}

interface Threaded {
  externalId: string;
  kind: 'review' | 'comment';
  replyTo: string | null;
}

/**
 * Each review with the comments under it, however deep (`replyTo` chains up to
 * the review, flattened in the order given), and the comments that answer no
 * review: on the paper itself, or on something the supplier did not send. A
 * cycle in `replyTo` ends at the comment that closes it, as answering no review.
 */
export function threadReviews<T extends Threaded>(items: readonly T[]) {
  const byId = new Map(items.map((x) => [x.externalId, x]));
  const reviewOf = (start: T): T | null => {
    const seen = new Set<string>();
    let at: T | undefined = start;
    while (at && !seen.has(at.externalId)) {
      if (at.kind === 'review') return at;
      seen.add(at.externalId);
      at = at.replyTo ? byId.get(at.replyTo) : undefined;
    }
    return null;
  };
  const under = new Map<string, T[]>();
  const loose: T[] = [];
  for (const x of items) {
    if (x.kind !== 'comment') continue;
    const review = reviewOf(x);
    if (!review) loose.push(x);
    else under.set(review.externalId, [...(under.get(review.externalId) ?? []), x]);
  }
  return {
    reviews: items
      .filter((x) => x.kind === 'review')
      .map((review) => ({ review, comments: under.get(review.externalId) ?? [] })),
    loose,
  };
}
