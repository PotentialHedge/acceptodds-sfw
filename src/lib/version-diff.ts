/**
 * Reading a version diff (`listing_version_diffs.runs`): the newer text whole, as runs
 * `[op, text, style?]` of unchanged (0), removed (-1) and added (1) words. A run that is only
 * `\n` starts a paragraph, `\n#` a heading, `\n$` a display equation, `\n@` a caption and `\n|`
 * a table row; in a row, `\n&` starts a cell (`\n&3` one over three columns).
 * `style` is `scraper/layout.py`'s bitmask. Two ways to read it: the whole text, and only the
 * changed passages with a little context; both come out as HTML, since a paper is thousands
 * of spans and React elements for each would send the text twice. Client-safe.
 */
import type { DiffRun } from '@/db/schema';

export type Op = -1 | 0 | 1;

export const BOLD = 1;
export const ITALIC = 2;
export const SUP = 4;
export const MATHS = 8;
export const SUB = 16;
/** Set against the run before it, with no space: a subscript after its symbol. */
export const GLUE = 32;

export type Kind = 'p' | 'h' | 'eq' | 'cap' | 'row';

const MARKS: Record<string, Kind> = { '\n': 'p', '\n#': 'h', '\n$': 'eq', '\n@': 'cap', '\n|': 'row' };
const CELL = /^\n&(\d*)$/;

export interface Span {
  op: Op;
  text: string;
  style: number;
  /** Set on a passage's first changed span: its number, from 1, for links and the change list. */
  passage?: number;
}

/** A table cell: the columns it spans, and the index in its row's `spans` where it starts. */
export interface Cell {
  cols: number;
  start: number;
}

export interface Paragraph {
  kind: Kind;
  spans: Span[];
  /** A row's cells, in order. */
  cells?: Cell[];
}

export interface Passage {
  number: number;
  /** The heading it falls under in the newer version, e.g. `4.2 RESULTS`. */
  section: string | null;
  /** It starts and ends inside a paragraph, so "…" goes before and after. */
  cutStart: boolean;
  cutEnd: boolean;
  /** For a change in a table, the table's first row, when it is not among `paragraphs`. */
  head?: Paragraph;
  paragraphs: Paragraph[];
  added: number;
  removed: number;
}

/**
 * Changes fewer than this many unchanged words apart are one passage, as are all the changes in
 * one table row. As `scraper/revisions.py`.
 */
export const JOIN_GAP = 6;

type Item =
  | { mark: Kind }
  | { mark: 'cell'; cols: number }
  | { mark: null; op: Op; word: string; style: number; passage?: number };
type Word = Extract<Item, { mark: null }>;

/** The runs as one stream of words and marks, each passage's first change numbered. */
function items(runs: readonly DiffRun[]): Item[] {
  const out: Item[] = [];
  let gap = JOIN_GAP;
  let passage = 0;
  // The table row each word is in (0: none), and the row of the last change: the changes in one
  // row are one passage, however far apart.
  let row = 0;
  let rows = 0;
  let changedRow = -1;
  for (const [op, text, style = 0] of runs) {
    const kind = MARKS[text];
    const cell = kind ? null : CELL.exec(text);
    if (kind || cell) {
      if (kind) row = kind === 'row' ? ++rows : 0;
      // A removed break is layout, not text: it is not drawn.
      if (op !== -1) out.push(kind ? { mark: kind } : { mark: 'cell', cols: Number(cell![1] || 1) });
      continue;
    }
    text.split(' ').forEach((word, i) => {
      if (word === '') return;
      // Only a run's first word is set against what precedes it.
      const st = i === 0 ? style : style & ~GLUE;
      const counts = !(st & GLUE);
      if (op === 0) {
        if (counts) gap += 1;
        out.push({ mark: null, op, word, style: st });
        return;
      }
      const starts = gap >= JOIN_GAP && !(row > 0 && row === changedRow);
      if (starts) passage += 1;
      gap = 0;
      changedRow = row;
      out.push({ mark: null, op, word, style: st, ...(starts ? { passage } : {}) });
    });
  }
  return out;
}

/** A paragraph break: any mark but a cell's. */
const isBreak = (x: Item): x is { mark: Kind } => x.mark !== null && x.mark !== 'cell';

function paragraphsOf(stream: readonly Item[], kind: Kind = 'p'): Paragraph[] {
  const out: Paragraph[] = [];
  const start = (k: Kind): Paragraph => (k === 'row' ? { kind: k, spans: [], cells: [] } : { kind: k, spans: [] });
  let cur = start(kind);
  let fresh = true; // the next word starts a span of its own (a new cell)
  for (const it of stream) {
    if (it.mark === 'cell') {
      if (cur.kind !== 'row') {
        if (cur.spans.length > 0) out.push(cur);
        cur = start('row');
      }
      cur.cells!.push({ cols: it.cols, start: cur.spans.length });
      fresh = true;
      continue;
    }
    if (it.mark !== null) {
      if (cur.spans.length > 0 || (cur.cells?.length ?? 0) > 0) out.push(cur);
      cur = start(it.mark);
      fresh = true;
      continue;
    }
    // A row cut by a passage's start: its words so far are one cell.
    if (cur.kind === 'row' && cur.cells!.length === 0) cur.cells!.push({ cols: 1, start: 0 });
    const last = fresh ? undefined : cur.spans.at(-1);
    fresh = false;
    if (last && last.op === it.op && last.style === it.style && it.passage === undefined && !(it.style & GLUE)) {
      last.text += ` ${it.word}`;
    } else {
      cur.spans.push({
        op: it.op,
        text: it.word,
        style: it.style,
        ...(it.passage !== undefined ? { passage: it.passage } : {}),
      });
    }
  }
  if (cur.spans.length > 0 || (cur.cells?.length ?? 0) > 0) out.push(cur);
  return out;
}

/** The newer text whole, paragraph by paragraph, the older's removed words in place. */
export function paragraphs(runs: readonly DiffRun[]): Paragraph[] {
  return paragraphsOf(items(runs));
}

/**
 * Each changed passage with up to `context` unchanged words either side, kept within its
 * paragraph. In a table it is the whole of the changed rows, with the table's first row (its
 * header, usually) as `head`: a number means little without its column.
 */
export function passages(runs: readonly DiffRun[], context = 25): Passage[] {
  const stream = items(runs);
  // The heading each item falls under, the kind of paragraph each is in, and for a table row
  // where its table's first row starts.
  const section: (string | null)[] = [];
  const kindAt: Kind[] = [];
  const tableAt: number[] = [];
  let current: string | null = null;
  let collecting: string[] | null = null;
  let kind: Kind = 'p';
  let table = -1;
  stream.forEach((it, n) => {
    if (isBreak(it)) {
      if (collecting) current = collecting.join(' ');
      collecting = it.mark === 'h' ? [] : null;
      if (it.mark === 'row' && kind !== 'row') table = n;
      kind = it.mark;
    } else if (collecting && it.mark === null && it.op !== -1) collecting.push(it.word);
    section.push(current);
    kindAt.push(kind);
    tableAt.push(kind === 'row' ? table : -1);
  });
  const isChange = (x: Item | undefined): x is Word => x !== undefined && x.mark === null && x.op !== 0;
  const out: Passage[] = [];
  let i = 0;
  while (i < stream.length) {
    const it = stream[i]!;
    if (it.mark !== null || it.passage === undefined) {
      i += 1;
      continue;
    }
    let end = i;
    let j = i + 1;
    for (; j < stream.length; j++) {
      const x = stream[j]!;
      if (x.mark === null && x.passage !== undefined) break;
      if (isChange(x)) end = j;
    }
    const inRow = (k: number) => kindAt[k] === 'row';
    let start = i;
    for (let n = 0; start > 0 && (n < context || inRow(start));) {
      const x = stream[start - 1]!;
      if (isBreak(x) || (x.mark === null && x.op !== 0)) break;
      start -= 1;
      if (x.mark === null && !(x.style & GLUE)) n += 1;
    }
    let stop = end + 1;
    for (let n = 0; stop < stream.length && (n < context || inRow(end));) {
      const x = stream[stop]!;
      if (isBreak(x) || (x.mark === null && x.passage !== undefined)) break;
      stop += 1;
      if (x.mark === null && !(x.style & GLUE)) n += 1;
    }
    const slice = stream.slice(start, stop);
    const words = slice.filter((x): x is Word => x.mark === null && !(x.style & GLUE));
    const before = start > 0 ? stream[start - 1] : undefined;
    const after = stop < stream.length ? stream[stop] : undefined;
    // The table's first row, when the passage starts below it.
    let head: Paragraph | undefined;
    const t = tableAt[i] ?? -1;
    if (t >= 0 && t < start - 1) {
      let e = t + 1;
      while (e < stream.length && !isBreak(stream[e]!)) e += 1;
      if (e < start) head = paragraphsOf(stream.slice(t, e))[0];
    }
    out.push({
      number: it.passage,
      section: section[i] ?? null,
      cutStart: before !== undefined && !isBreak(before) && !inRow(start),
      cutEnd: after !== undefined && !isBreak(after) && !inRow(end),
      ...(head ? { head } : {}),
      paragraphs: paragraphsOf(slice, slice[0] && !isBreak(slice[0]) ? (kindAt[start] ?? 'p') : 'p'),
      added: words.filter((x) => x.op === 1).length,
      removed: words.filter((x) => x.op === -1).length,
    });
    i = j;
  }
  return out;
}

// --- HTML -----------------------------------------------------------------------
// Styled by `.vdiff` in globals.css. Every piece of text goes through `esc`.

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]!);

export const changeAnchor = (n: number) => `c${n}`;
export const passageAnchor = (n: number) => `p${n}`;

function spanHtml(s: Span, anchors: boolean): string {
  let h = esc(s.text);
  if (s.style & BOLD) h = `<b>${h}</b>`;
  if (s.style & ITALIC) h = `<i>${h}</i>`;
  if (s.style & MATHS) h = `<var>${h}</var>`;
  if (s.style & SUP) h = `<sup>${h}</sup>`;
  else if (s.style & SUB) h = `<sub>${h}</sub>`;
  if (s.op === 0) return h;
  const tag = s.op === -1 ? 'del' : 'ins';
  const id = anchors && s.passage !== undefined ? ` id="${changeAnchor(s.passage)}" data-change="${s.passage}"` : '';
  return `<${tag}${id}>${h}</${tag}>`;
}

const TAGS: Record<Exclude<Kind, 'row'>, [string, string]> = {
  p: ['<p>', '</p>'],
  h: ['<h4>', '</h4>'],
  eq: ['<p class="eq">', '</p>'],
  cap: ['<p class="cap">', '</p>'],
};

function spansHtml(spans: readonly Span[], anchors: boolean): string {
  return spans.map((s, k) => (k > 0 && !(s.style & GLUE) ? ' ' : '') + spanHtml(s, anchors)).join('');
}

function rowHtml(p: Paragraph, anchors: boolean, cls = ''): string {
  const cells = p.cells?.length ? p.cells : [{ cols: 1, start: 0 }];
  const tds = cells
    .map((c, k) => {
      const body = spansHtml(p.spans.slice(c.start, cells[k + 1]?.start ?? p.spans.length), anchors);
      return `<td${c.cols > 1 ? ` colspan="${c.cols}"` : ''}>${body}</td>`;
    })
    .join('');
  return `<tr${cls ? ` class="${cls}"` : ''}>${tds}</tr>`;
}

/**
 * Paragraphs as HTML: headings in the paper's small caps, tables as tables, changes struck or
 * marked. `head` is a table's first row, set over the rows that follow with a gap between.
 */
export function paragraphsHtml(
  ps: readonly Paragraph[],
  {
    anchors = false,
    cutStart = false,
    cutEnd = false,
    head,
  }: { anchors?: boolean; cutStart?: boolean; cutEnd?: boolean; head?: Paragraph } = {},
): string {
  let html = '';
  let rows = '';
  const flush = () => {
    if (rows) html += `<div class="tab"><table><tbody>${rows}</tbody></table></div>`;
    rows = '';
  };
  ps.forEach((p, i) => {
    if (p.kind === 'row') {
      if (!rows && i === 0 && head)
        rows = rowHtml(head, false, 'head') + '<tr class="gap"><td colspan="99">⋯</td></tr>';
      rows += rowHtml(p, anchors);
      return;
    }
    flush();
    const [open, close] = TAGS[p.kind];
    html += `${open}${cutStart && i === 0 ? '… ' : ''}${spansHtml(p.spans, anchors)}${cutEnd && i === ps.length - 1 ? ' …' : ''}${close}`;
  });
  flush();
  return html;
}

/** The changed passages, each under its section, linked to its place in the whole text. */
export function passagesHtml(ps: readonly Passage[], wholeHref: (n: number) => string): string {
  return ps
    .map((x) => {
      const counts =
        (x.added > 0 ? `<span class="up">+${x.added}</span>` : '') +
        (x.added > 0 && x.removed > 0 ? ' ' : '') +
        (x.removed > 0 ? `<span class="down">−${x.removed}</span>` : '');
      return (
        `<li id="${passageAnchor(x.number)}"><div class="meta"><span>#${x.number} · ${esc(x.section ?? 'Front matter')}</span>` +
        `<span>${counts}<a href="${esc(wholeHref(x.number))}">in the text ↓</a></span></div>` +
        paragraphsHtml(x.paragraphs, { cutStart: x.cutStart, cutEnd: x.cutEnd, ...(x.head ? { head: x.head } : {}) }) +
        '</li>'
      );
    })
    .join('');
}

/** A one-line index of the passages: number, section, first changed words. */
export function indexHtml(ps: readonly Passage[]): string {
  return ps
    .map((x) => {
      const first = x.paragraphs.flatMap((p) => p.spans).find((s) => s.op !== 0);
      const words = first ? first.text.split(' ').slice(0, 8).join(' ') : '';
      const cls = first?.op === -1 ? 'down' : 'up';
      return `<li><a href="#${changeAnchor(x.number)}"><span class="sec">#${x.number} · ${esc(x.section ?? 'Front matter')}</span> <span class="${cls}">${esc(words)}</span></a></li>`;
    })
    .join('');
}
