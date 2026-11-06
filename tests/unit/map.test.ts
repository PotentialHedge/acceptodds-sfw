import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  dotScale,
  frameAround,
  headlineRgb,
  labelMatches,
  labelTerms,
  LIKELIHOOD_RGB,
  MAP_NONE,
  MAP_SIZE,
  MINIMAP_NEAREST,
  MINIMAP_STRETCH,
  minimapRadius,
  normalise,
  SCORE_HIGH,
  SCORE_LOW,
  SCORE_MID,
  scoreRgb,
  scoreStops,
  topicLabels,
} from '@/lib/map';

describe('normalise', () => {
  it('fills the longer axis, keeps the aspect and centres the shorter', () => {
    const p = normalise([
      { x: 10, y: 0 },
      { x: 30, y: 5 },
    ]);
    expect([...p]).toEqual([0, 375, MAP_SIZE, 625]);
  });

  it('puts every point inside the map, whatever the supplier’s units', () => {
    const point = fc.record({
      x: fc.double({ min: -1e6, max: 1e6, noNaN: true }),
      y: fc.double({ min: -1e6, max: 1e6, noNaN: true }),
    });
    fc.assert(
      fc.property(fc.array(point, { minLength: 1, maxLength: 50 }), (points) => {
        for (const v of normalise(points)) expect(v >= -1e-3 && v <= MAP_SIZE + 1e-3).toBe(true);
      }),
    );
  });

  it('handles a single point and an empty map', () => {
    expect(normalise([])).toHaveLength(0);
    expect([...normalise([{ x: 3, y: 3 }])]).toEqual([MAP_SIZE / 2, MAP_SIZE / 2]);
  });

  it('does not overflow the stack on a large map', () => {
    const points = Array.from({ length: 300_000 }, (_, i) => ({ x: i, y: -i }));
    expect(normalise(points)).toHaveLength(600_000);
  });
});

describe('topicLabels', () => {
  const positions = Float32Array.from([0, 0, 10, 10, 2, 2, 500, 500, 100, 100]);
  const names = new Map([
    [0, 'zero'],
    [1, 'one'],
  ]);

  it('labels a grouping at the median of its points, ignoring a stray', () => {
    const labels = topicLabels(positions, [0, 0, 0, 0, 1], names, 2);
    expect(labels).toEqual([{ number: 0, text: 'zero', x: 10, y: 10, size: 4 }]);
  });

  it('skips groupings without a name or a point', () => {
    expect(topicLabels(positions, [null, 7, null, 7, 1], names, 1)).toEqual([
      { number: 1, text: 'one', x: 100, y: 100, size: 1 },
    ]);
  });
});

describe('colours and dots', () => {
  it('colours by the site’s likelihood bands and leaves an unpriced paper grey', () => {
    expect(headlineRgb(0.8)).toEqual(LIKELIHOOD_RGB.accept);
    expect(headlineRgb(0.5)).toEqual(LIKELIHOOD_RGB['toss-up']);
    expect(headlineRgb(0.1)).toEqual(LIKELIHOOD_RGB.reject);
    expect(headlineRgb(null)).toEqual(MAP_NONE);
  });

  it('grows dots with zoom, never below the opening size, and caps them', () => {
    expect(dotScale(-2, 0)).toBe(1);
    expect(dotScale(0, 0)).toBe(1);
    expect(dotScale(2, 0)).toBeCloseTo(2.25);
    expect(dotScale(20, 0)).toBe(6);
  });
});

describe('minimapRadius', () => {
  it('takes in related papers not far beyond the nearest, with a margin, and leaves the far ones off', () => {
    expect(minimapRadius(10, [])).toBe(10);
    expect(minimapRadius(10, [5])).toBe(10);
    expect(minimapRadius(10, [20])).toBeCloseTo(22);
    expect(minimapRadius(10, [10 * MINIMAP_STRETCH + 1])).toBe(10);
  });
});

describe('frameAround', () => {
  it('centres the paper and puts its radius at half the map', () => {
    const n = MINIMAP_NEAREST + 5;
    // The paper at (3, 4), the others on a line to its right at 1, 2, … n−1.
    const positions = Float32Array.from([3, 4, ...Array.from({ length: n - 1 }, (_, k) => [3 + k + 1, 4]).flat()]);
    const out = frameAround(positions, 0, []);
    expect([out[0], out[1]]).toEqual([MAP_SIZE / 2, MAP_SIZE / 2]);
    // The MINIMAP_NEAREST-th nearest is at distance MINIMAP_NEAREST: it lands on the edge.
    expect(out[2 * MINIMAP_NEAREST]).toBeCloseTo(MAP_SIZE);
    expect(out[2 * MINIMAP_NEAREST + 1]).toBeCloseTo(MAP_SIZE / 2);
  });

  it('keeps every point, past the edge too, and the order of distances', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: -100, max: 100, noNaN: true }), { minLength: 4, maxLength: 60 }), (xs) => {
        const coords = xs.length % 2 ? xs.slice(1) : xs;
        const positions = Float32Array.from(coords);
        const out = frameAround(positions, 0, [1]);
        expect(out).toHaveLength(positions.length);
        const d = (p: Float32Array, i: number) => Math.hypot(p[2 * i] - p[0], p[2 * i + 1] - p[1]);
        for (let i = 2; i < positions.length / 2; i++) {
          if (d(positions, i) < d(positions, 1) - 1e-3) expect(d(out, i)).toBeLessThanOrEqual(d(out, 1) + 1e-2);
        }
      }),
    );
  });
});

describe('labelTerms and labelMatches', () => {
  it('takes positive words, phrases and keyword/area values, never excluded or short ones', () => {
    expect(labelTerms('graph "diffusion model" -vision of keyword:Robotics accept>=60')).toEqual([
      'graph',
      'diffusion model',
      'robotics',
    ]);
    expect(labelTerms('-(graph neural) status:open')).toEqual([]);
    expect(labelTerms('vision OR language')).toEqual(['vision', 'language']);
  });

  it('matches a term at the start of a word, case-insensitively', () => {
    expect(labelMatches('Graph Neural Networks', ['neural'])).toBe(true);
    expect(labelMatches('Graph Neural Networks', ['network'])).toBe(true);
    expect(labelMatches('Paragraphs', ['graph'])).toBe(false);
    expect(labelMatches('Score-based Diffusion Models', ['diffusion model'])).toBe(true);
    expect(labelMatches('Anything', [])).toBe(false);
  });
});

describe('score colours', () => {
  it('pins to the percentiles and skips papers without a score', () => {
    const values = [...Array.from({ length: 101 }, (_, i) => i), null];
    expect(scoreStops(values)).toEqual({ lo: 5, mid: 50, hi: 95 });
    expect(scoreStops([null])).toBeNull();
  });

  it('runs low to high through the middle grey, clamped at the stops', () => {
    const stops = { lo: 1, mid: 2, hi: 3 };
    expect(scoreRgb(0, stops)).toEqual(SCORE_LOW);
    expect(scoreRgb(2, stops)).toEqual(SCORE_MID);
    expect(scoreRgb(4, stops)).toEqual(SCORE_HIGH);
  });

  it('does not divide by zero when every paper has the same score', () => {
    expect(scoreRgb(2, { lo: 2, mid: 2, hi: 2 })).toEqual(SCORE_MID);
  });
});
