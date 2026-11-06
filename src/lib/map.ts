import { likelihood, type Likelihood } from './likelihood';
import { parseSearch, type SearchNode } from './query';

/**
 * The paper map's display maths (`/map`). Client-safe and pure. The layout
 * itself is supplied (`PUT /map`); this only scales it to the screen, places
 * the grouping names and picks colours.
 */

/** Map units across the longer side, whatever the supplier's units were. */
export const MAP_SIZE = 1000;

/**
 * Scale points into `[0, MAP_SIZE]` on the longer axis, keeping the aspect,
 * centred on the shorter, y pointing up. Interleaved `[x0, y0, x1, y1, …]`.
 */
export function normalise(points: readonly { x: number; y: number }[]): Float32Array {
  const out = new Float32Array(points.length * 2);
  if (points.length === 0) return out;
  // A loop, not Math.min(...xs): spreading a whole map overflows the call stack.
  const span = (v: (p: { x: number; y: number }) => number) =>
    points.reduce(([lo, hi], p) => [Math.min(lo, v(p)), Math.max(hi, v(p))], [Infinity, -Infinity]);
  const [minX, maxX] = span((p) => p.x);
  const [minY, maxY] = span((p) => p.y);
  const w = maxX - minX;
  const h = maxY - minY;
  const scale = MAP_SIZE / (Math.max(w, h) || 1);
  const offX = (MAP_SIZE - w * scale) / 2;
  const offY = (MAP_SIZE - h * scale) / 2;
  points.forEach((p, i) => {
    out[2 * i] = offX + (p.x - minX) * scale;
    out[2 * i + 1] = offY + (p.y - minY) * scale;
  });
  return out;
}

export interface TopicLabel {
  number: number;
  text: string;
  x: number;
  y: number;
  /** Points in the grouping: the bigger wins a label collision. */
  size: number;
}

/** Words shorter than this pick out no topic label: "a" or "of" would light half of them. */
const MIN_LABEL_TERM = 3;

/**
 * The words in a map search a topic label can match: the positive words and
 * phrases (quotes dropped), and `keyword:`/`area:` values, which name topics.
 * Nothing under a `-`, and no other filter. Lower case.
 */
export function labelTerms(query: string): string[] {
  const out = new Set<string>();
  const walk = (node: SearchNode | null) => {
    if (!node) return;
    if (node.kind === 'and' || node.kind === 'or') node.items.forEach(walk);
    else if (node.kind === 'text') for (const t of node.include) out.add(t.replace(/"/g, ''));
    else if (node.kind === 'match' && node.op === '=' && (node.field === 'keyword' || node.field === 'area'))
      out.add(node.value);
  };
  walk(parseSearch(query).node);
  return [...out].map((t) => t.trim().toLowerCase()).filter((t) => t.length >= MIN_LABEL_TERM);
}

/** Whether a topic label holds one of `terms` at the start of a word, as the search's last word matches as a prefix. */
export function labelMatches(text: string, terms: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return terms.some((t) => {
    for (let at = lower.indexOf(t); at >= 0; at = lower.indexOf(t, at + 1))
      if (at === 0 || !/[\p{L}\p{N}]/u.test(lower[at - 1])) return true;
    return false;
  });
}

/**
 * Where each grouping's name goes: the median of its points on each axis
 * (robust to a few strays far from the rest). Groupings with fewer than
 * `minSize` points, or no name, get no label.
 */
export function topicLabels(
  positions: Float32Array,
  groups: readonly (number | null)[],
  names: ReadonlyMap<number, string>,
  minSize: number,
): TopicLabel[] {
  const xs = new Map<number, number[]>();
  const ys = new Map<number, number[]>();
  groups.forEach((g, i) => {
    if (g === null || !names.has(g)) return;
    if (!xs.has(g)) {
      xs.set(g, []);
      ys.set(g, []);
    }
    xs.get(g)!.push(positions[2 * i]);
    ys.get(g)!.push(positions[2 * i + 1]);
  });
  const median = (a: number[]) => a.sort((u, v) => u - v)[a.length >> 1];
  const out: TopicLabel[] = [];
  for (const [g, x] of xs) {
    if (x.length < minSize) continue;
    out.push({ number: g, text: names.get(g)!, x: median(x), y: median(ys.get(g)!), size: x.length });
  }
  return out;
}

export type Rgb = [number, number, number];

export function hexRgb(hex: string): Rgb {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/**
 * Categorical colours for groupings and areas, cycled. Muted, so the
 * maroon accent (a selection) stays the loud colour.
 */
export const MAP_PALETTE: readonly Rgb[] = [
  '#4e79a7',
  '#e08b3a',
  '#59a14f',
  '#c75a5d',
  '#76b7b2',
  '#b6992d',
  '#9c6fa0',
  '#d4848f',
  '#8a6e58',
  '#5f8fc4',
  '#86bc6c',
  '#a1a1a1',
  '#3f8f86',
  '#c9a46a',
  '#7b6fb0',
  '#9b9a4a',
].map(hexRgb);

export const MAP_NONE: Rgb = hexRgb('#c8c4ba');

export function categoryRgb(n: number | null): Rgb {
  return n === null || n < 0 ? MAP_NONE : MAP_PALETTE[n % MAP_PALETTE.length];
}

/** Mirrors the `accept` / `toss-up` / `reject` tokens in `app/globals.css`, for WebGL. Keep in step. */
export const LIKELIHOOD_RGB: Record<Likelihood, Rgb> = {
  accept: hexRgb('#3d7a4f'),
  'toss-up': hexRgb('#b8ab8c'),
  reject: hexRgb('#a24a3f'),
};

/** A paper coloured by its headline price, in the site's likelihood colours; uncoloured when void or unpriced. */
export function headlineRgb(h: number | null): Rgb {
  return h === null ? MAP_NONE : LIKELIHOOD_RGB[likelihood(h)];
}

/** Blue above a venue's middle and orange below it, grey between: tell apart with any colour vision, and not the selection's maroon. */
export const SCORE_LOW: Rgb = hexRgb('#b0602c');
export const SCORE_MID: Rgb = hexRgb('#aaa79e');
export const SCORE_HIGH: Rgb = hexRgb('#2f6f9f');

/** Where a score's colours are pinned: its 5th percentile, median and 95th percentile. */
export interface ScoreStops {
  lo: number;
  mid: number;
  hi: number;
}

/**
 * The stops of a score's values, `null` when there are none. Pinned to percentiles and not to the scale, since
 * papers' means bunch in the middle of it: a few outliers would otherwise leave the map all one grey.
 */
export function scoreStops(values: readonly (number | null)[]): ScoreStops | null {
  const xs = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const at = (q: number) => xs[Math.round((xs.length - 1) * q)];
  return { lo: at(0.05), mid: at(0.5), hi: at(0.95) };
}

/** A paper's colour on a score: grey at the median, fully blue or orange from the stops out. */
export function scoreRgb(v: number, { lo, mid, hi }: ScoreStops): Rgb {
  const t = v < mid ? (mid - v) / (mid - lo || 1) : (v - mid) / (hi - mid || 1);
  const pole = v < mid ? SCORE_LOW : SCORE_HIGH;
  const k = Math.min(1, t);
  return [0, 1, 2].map((c) => Math.round(SCORE_MID[c] + (pole[c] - SCORE_MID[c]) * k)) as Rgb;
}

/**
 * Dot radius multiplier at a zoom level: about 1.5x per level past the
 * opening view, never smaller than at it, capped so dense regions stay
 * legible.
 */
export function dotScale(zoom: number, openingZoom: number): number {
  return Math.min(6, Math.max(1, 1.5 ** (zoom - openingZoom)));
}

/**
 * Dot radius multiplier for showing `shown` of `total` papers: fewer dots,
 * bigger, so a sparse search does not leave the screen empty. The fourth
 * root keeps it gentle (179 of 30k: about 3.6x; 4k of 30k: about 1.7x),
 * capped at 4x.
 */
export function sparseScale(shown: number, total: number): number {
  if (shown <= 0 || shown >= total) return 1;
  return Math.min(4, (total / shown) ** 0.25);
}

/** Nearest papers a paper's minimap (the paper page's) takes in, besides its related papers. */
export const MINIMAP_NEAREST = 100;
/** Nearest papers on the map a minimap picks its `MINIMAP_NEAREST` from, by vector, when the paper has one. */
export const MINIMAP_CANDIDATES = 400;
/** A related paper this many times the nearest papers' distance or nearer widens a minimap to take it in. */
export const MINIMAP_STRETCH = 2.5;

/**
 * A minimap's radius round its paper: the distance to its
 * `MINIMAP_NEAREST`th nearest paper (`near`), widened to take in each related
 * paper up to `MINIMAP_STRETCH` times that, with a margin. A related paper
 * farther out is left off rather than shrink the rest. Any units.
 */
export function minimapRadius(near: number, related: readonly number[]): number {
  return related.filter((d) => d <= near * MINIMAP_STRETCH).reduce((m, d) => Math.max(m, d * 1.1), near);
}

/**
 * Interleaved positions moved so point `self` is at the centre of the map
 * and `minimapRadius` round it fills half its span, which the canvas fits to
 * the shorter side of its box: sized by its `take` nearest papers (by
 * default `MINIMAP_NEAREST`). `related` are indexes. Points outside stay,
 * past the edge, for a wide box and for panning.
 */
export function frameAround(
  positions: Float32Array,
  self: number,
  related: readonly number[],
  take: number = MINIMAP_NEAREST,
): Float32Array {
  const n = positions.length / 2;
  const sx = positions[2 * self];
  const sy = positions[2 * self + 1];
  const dist = (i: number) => Math.hypot(positions[2 * i] - sx, positions[2 * i + 1] - sy);
  const all = Float64Array.from({ length: n }, (_, i) => dist(i)).sort();
  // `all[0]` is the paper itself; with fewer papers than wanted, the farthest sets it.
  const near = all[Math.max(1, Math.min(take, n - 1))] || 1;
  const scale = MAP_SIZE / 2 / minimapRadius(near, related.map(dist));
  const out = new Float32Array(positions.length);
  for (let i = 0; i < n; i++) {
    out[2 * i] = MAP_SIZE / 2 + (positions[2 * i] - sx) * scale;
    out[2 * i + 1] = MAP_SIZE / 2 + (positions[2 * i + 1] - sy) * scale;
  }
  return out;
}
