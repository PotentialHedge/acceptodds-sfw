/**
 * The arithmetic and threading behind a paper's reviews: pure and client-safe.
 * The field itself is read in `server/review-field.ts`.
 */

/** A mean, rounded so one read in SQL and one summed here compare equal. */
export function roundMean(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

/** The mean of the numbers among `ratings`, or `null` when there are none. */
export function meanRating(ratings: readonly (number | null)[]): number | null {
  const xs = ratings.filter((r): r is number => r !== null);
  return xs.length === 0 ? null : roundMean(xs.reduce((a, b) => a + b, 0) / xs.length);
}

/** What the distribution calls the review's own rating, beside its other scores. */
export const OVERALL = 'Overall';

/**
 * The scores a review gives beside its rating, lower-cased from the venue's labels, in the order they break a tie
 * in the rating: what the paper is, then how it reads, then how sure the reviewer was. On ICLR 2027's
 * reviews the first three rise with the rating (r 0.4 to 0.5) and confidence falls slightly (r -0.15):
 * reviewers are surer of a low score, so it is no mark of quality and only decides what is left.
 */
export const REVIEW_FACTORS = ['soundness', 'informativeness', 'presentation', 'confidence'] as const;
export type ReviewFactor = (typeof REVIEW_FACTORS)[number];

export function isReviewFactor(name: string): name is ReviewFactor {
  return (REVIEW_FACTORS as readonly string[]).includes(name);
}

/** A score's label as one of `REVIEW_FACTORS` (each is also a column of `listing_reviews`), or `null`. */
export function factorOf(label: string): ReviewFactor | null {
  const name = label.toLowerCase();
  return isReviewFactor(name) ? name : null;
}

/** Each score label among `reviews` with its mean and how many gave it: `REVIEW_FACTORS` first, any other by name. */
export function factorMeans(
  reviews: readonly { scores: readonly { label: string; value: number }[] }[],
): { label: string; mean: number; count: number }[] {
  const values = new Map<string, number[]>();
  for (const r of reviews) for (const s of r.scores) values.set(s.label, [...(values.get(s.label) ?? []), s.value]);
  const rank = (label: string) => {
    const factor = factorOf(label);
    return factor === null ? REVIEW_FACTORS.length : REVIEW_FACTORS.indexOf(factor);
  };
  return [...values]
    .map(([label, xs]) => ({ label, mean: meanRating(xs)!, count: xs.length }))
    .sort((a, b) => rank(a.label) - rank(b.label) || a.label.localeCompare(b.label));
}

/** The groups of papers a paper's scores can be placed among besides its whole venue. */
export const REVIEW_COHORTS = ['nearest', 'related'] as const;
export type ReviewCohort = (typeof REVIEW_COHORTS)[number];
/** How many papers nearest in embedding space make up the `nearest` cohort. */
export const NEAREST_COHORT = 100;
/** Fewer reviewed papers than this are too few to draw a shape from. */
export const MIN_COHORT = 5;
/** The kernel's width for a cohort, as a share of the scale. */
export const COHORT_BANDWIDTH = 0.09;

/** Where a curve is sampled across the scale. */
export const CURVE_POINTS = 121;

/**
 * The kernel's width, as a share of the scale. A mean of three whole-number
 * ratings falls on thirds, so anything narrow draws a comb; at this width
 * neighbouring thirds of a 1–4 scale (a ninth of it apart) blend into one
 * shape. The curve is only the shape: the marker and every share read off the
 * chart come from the real means.
 */
const BANDWIDTH_OF_SCALE = 0.06;

/** A distinct mean and the share of the field's papers on it. */
export type Atom = readonly [mean: number, share: number];

/** The distinct values of ascending `means`, each with its share of them. */
export function atomsOf(means: readonly number[]): Atom[] {
  const atoms: [number, number][] = [];
  for (const x of means) {
    const last = atoms[atoms.length - 1];
    if (last && last[0] === x) last[1] += 1;
    else atoms.push([x, 1]);
  }
  return atoms.map(([x, n]) => [x, n / means.length]);
}

/** The share of the field strictly below `x`: ties are not beaten. */
export function shareBelow(atoms: readonly Atom[], x: number): number {
  let sum = 0;
  for (const [mean, share] of atoms) {
    if (mean >= x) break;
    sum += share;
  }
  return sum;
}

/** About this many bins across a scale, at a round width: a 1–4 scale in eighths, a 1–10 one in halves. */
const BINS_PER_SCALE = 24;
const BIN_WIDTHS = [0.1, 0.125, 0.2, 0.25, 0.5, 1, 2, 5, 10];

/**
 * The share of `atoms` in each of equal-width bins across `domain`, each bin
 * closed below and the last also above, so a mean at the top of the scale
 * counts. The width is round (`BIN_WIDTHS`), so a bin's range reads plainly;
 * a domain it does not divide gets a last bin cut short, never a wider one.
 */
export function binShares(
  atoms: readonly Atom[],
  domain: readonly [number, number],
): { width: number; shares: number[] } {
  const [lo, hi] = domain;
  const width = BIN_WIDTHS.find((w) => w >= (hi - lo) / BINS_PER_SCALE) ?? BIN_WIDTHS[BIN_WIDTHS.length - 1];
  const n = Math.max(1, Math.ceil((hi - lo) / width - 1e-9));
  const shares = Array.from({ length: n }, () => 0);
  // A small slack, so a mean of 2.25 stored as 2.2499… lands in the bin it reads as.
  for (const [mean, share] of atoms)
    shares[Math.min(n - 1, Math.max(0, Math.floor((mean - lo) / width + 1e-9)))] += share;
  return { width, shares };
}

/**
 * The Gaussian kernel density of `atoms` at `CURVE_POINTS` even points across `domain`, scaled to peak at 1.
 * `bandwidth`, as a share of the scale: a handful of papers needs a wider kernel than a venue's thousands.
 */
export function densityCurve(
  atoms: readonly Atom[],
  domain: readonly [number, number],
  bandwidth = BANDWIDTH_OF_SCALE,
): number[] {
  const [lo, hi] = domain;
  const h = (hi - lo) * bandwidth;
  const ys = Array.from({ length: CURVE_POINTS }, (_, i) => {
    const x = lo + ((hi - lo) * i) / (CURVE_POINTS - 1);
    return atoms.reduce((sum, [mean, share]) => sum + share * Math.exp(-0.5 * ((x - mean) / h) ** 2), 0);
  });
  const peak = Math.max(...ys);
  return ys.map((y) => (peak > 0 ? y / peak : 0));
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
