import { describe, expect, it } from 'vitest';
import type { DiffRun } from '@/db/schema';
import { paragraphs, passages } from '@/lib/version-diff';

const runs: DiffRun[] = [
  [0, '\n# 1 INTRODUCTION \n We study a thing and it works'],
  [-1, 'well.'],
  [1, 'better than before.'],
  [0, '\n Second paragraph starts here and goes on \n# 2 METHOD \n The method is'],
  [-1, 'old \n'],
  [1, 'new'],
  [0, 'and simple.'],
];

describe('version diffs', () => {
  it('draws the newer text in paragraphs, the removed words in place and removed breaks dropped', () => {
    const ps = paragraphs(runs);
    expect(ps.map((p) => p.heading)).toEqual([true, false, false, true, false]);
    expect(ps[1]!.spans).toEqual([
      { op: 0, text: 'We study a thing and it works' },
      { op: -1, text: 'well.', passage: 1 },
      { op: 1, text: 'better than before.' },
    ]);
    expect(ps[4]!.spans.map((s) => s.op)).toEqual([0, -1, 1, 0]);
  });

  it('lists each passage under its heading, cut at its paragraph', () => {
    const ps = passages(runs, 3);
    expect(ps.map((p) => [p.number, p.section, p.added, p.removed])).toEqual([
      [1, '1 INTRODUCTION', 3, 1],
      [2, '2 METHOD', 1, 1],
    ]);
    expect(ps[0]!.cutStart).toBe(true);
    expect(ps[0]!.cutEnd).toBe(false);
    expect(ps[0]!.paragraphs[0]!.spans[0]).toEqual({ op: 0, text: 'and it works' });
  });
});
