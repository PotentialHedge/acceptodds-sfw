import { describe, expect, it } from 'vitest';
import type { DiffRun } from '@/db/schema';
import { GLUE, ITALIC, MATHS, SUB, paragraphs, paragraphsHtml, passages, passagesHtml } from '@/lib/version-diff';

const runs: DiffRun[] = [
  [0, '\n#'],
  [0, '1 INTRODUCTION'],
  [0, '\n'],
  [0, 'We study a thing and it works'],
  [-1, 'well.'],
  [1, 'better than before.'],
  [0, '\n'],
  [0, 'Second paragraph starts here and goes on'],
  [0, '\n#'],
  [0, '2 METHOD'],
  [0, '\n'],
  [0, 'The method sets'],
  [0, 'S', MATHS],
  [0, 't−1', MATHS | SUB | GLUE],
  [-1, 'old'],
  [-1, '\n'],
  [1, 'new', ITALIC],
  [0, 'and simple.'],
];

describe('version diffs', () => {
  it('draws the newer text in paragraphs, the removed words in place and removed breaks dropped', () => {
    const ps = paragraphs(runs);
    expect(ps.map((p) => p.kind)).toEqual(['h', 'p', 'p', 'h', 'p']);
    expect(ps[1]!.spans).toEqual([
      { op: 0, text: 'We study a thing and it works', style: 0 },
      { op: -1, text: 'well.', style: 0, passage: 1 },
      { op: 1, text: 'better than before.', style: 0 },
    ]);
  });

  it('sets styles, glues a subscript to its symbol, and escapes the text', () => {
    const html = paragraphsHtml(paragraphs([...runs.slice(11), [0, '<b> & "x"']]), { anchors: true });
    expect(html).toBe(
      '<p>The method sets <var>S</var><sub><var>t−1</var></sub> <del id="c1" data-change="1">old</del> <ins><i>new</i></ins> and simple. &lt;b&gt; &amp; &quot;x&quot;</p>',
    );
  });

  it('lists each passage under its heading, cut at its paragraph', () => {
    const ps = passages(runs, 3);
    expect(ps.map((p) => [p.number, p.section, p.added, p.removed])).toEqual([
      [1, '1 INTRODUCTION', 3, 1],
      [2, '2 METHOD', 1, 1],
    ]);
    expect(ps[0]!.cutStart).toBe(true);
    expect(ps[0]!.cutEnd).toBe(false);
    expect(ps[0]!.paragraphs[0]!.spans[0]).toEqual({ op: 0, text: 'and it works', style: 0 });
  });

  it('sets a table as rows of cells, and a change in it with its first row over it', () => {
    const table: DiffRun[] = [
      [0, 'Results follow.'],
      [0, '\n|'],
      [0, '\n&'],
      [0, '\n&2'],
      [0, 'Accuracy'],
      [0, '\n|'],
      [0, '\n&'],
      [0, 'Method'],
      [0, '\n&'],
      [0, 'top-1'],
      [0, '\n&'],
      [0, 'top-5'],
      [0, '\n|'],
      [0, '\n&'],
      [0, 'Ours'],
      [0, '\n&'],
      [-1, '59.61'],
      [1, '61.20'],
      [0, '\n&'],
      [0, '80.1'],
      [0, '\n'],
      [0, 'After the table the text goes on.'],
    ];
    const ps = paragraphs(table);
    expect(ps.map((p) => p.kind)).toEqual(['p', 'row', 'row', 'row', 'p']);
    expect(paragraphsHtml(ps.slice(1, 2))).toBe(
      '<div class="tab"><table><tbody><tr><td></td><td colspan="2">Accuracy</td></tr></tbody></table></div>',
    );
    const [x] = passages(table);
    expect(x!.paragraphs.map((p) => p.kind)).toEqual(['row']);
    expect(x!.paragraphs[0]!.spans.map((s) => s.text)).toEqual(['Ours', '59.61', '61.20', '80.1']);
    expect(x!.head!.spans.map((s) => s.text)).toEqual(['Accuracy']);
    expect([x!.cutStart, x!.cutEnd]).toEqual([false, false]);
    expect(passagesHtml([x!], () => '#')).toContain(
      '<tr class="head"><td></td><td colspan="2">Accuracy</td></tr><tr class="gap"><td colspan="99">⋯</td></tr><tr><td>Ours</td><td><del>59.61</del> <ins>61.20</ins></td><td>80.1</td></tr>',
    );
  });

  it('makes all the changes in one table row one passage', () => {
    const cells = (xs: string[]): DiffRun[] =>
      xs.flatMap((x): DiffRun[] => [
        [0, '\n&'],
        [0, x],
      ]);
    const row: DiffRun[] = [
      [0, '\n|'],
      ...cells(['Ours', '1', '2', '3', '4', '5', '6', '7']),
      [0, '\n&'],
      [-1, '8'],
      [1, '9'],
      ...cells(['a', 'b', 'c', 'd', 'e', 'f', 'g']),
      [0, '\n&'],
      [1, '10'],
    ];
    const ps = passages([[0, '\n|'], ...cells(['Method', 'x']), ...row, ...row]);
    expect(ps.map((x) => [x.number, x.added, x.removed])).toEqual([
      [1, 2, 1],
      [2, 2, 1],
    ]);
  });
});
