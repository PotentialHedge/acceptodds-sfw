/**
 * Reading a version diff (`listing_version_diffs.runs`): the newer text whole, as runs
 * `[op, text, style?]` of unchanged (0), removed (-1) and added (1) words. A run that is only
 * `\n` starts a paragraph, `\n#` a heading, `\n$` a display equation and `\n@` a caption.
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

export type Kind = 'p' | 'h' | 'eq' | 'cap';

const MARKS: Record<string, Kind> = { '\n': 'p', '\n#': 'h', '\n$': 'eq', '\n@': 'cap' };

export interface Span {
  op: Op;
  text: string;
  style: number;
  /** Set on a passage's first changed span: its number, from 1, for links and the change list. */
  passage?: number;
}

export interface Paragraph {
  kind: Kind;
  spans: Span[];
}

export interface Passage {
  number: number;
  /** The heading it falls under in the newer version, e.g. `4.2 RESULTS`. */
  section: string | null;
  /** It starts and ends inside a paragraph, so "…" goes before and after. */
  cutStart: boolean;
  cutEnd: boolean;
  paragraphs: Paragraph[];
  added: number;
  removed: number;
}

/** Changes fewer than this many unchanged words apart are one passage. As `scraper/revisions.py`. */
export const JOIN_GAP = 6;

type Item = { mark: Kind } | { mark: null; op: Op; word: string; style: number; passage?: number };
type Word = Extract<Item, { mark: null }>;

/** The runs as one stream of words and paragraph marks, each passage's first change numbered. */
function items(runs: readonly DiffRun[]): Item[] {
  const out: Item[] = [];
  let gap = JOIN_GAP;
  let passage = 0;
  for (const [op, text, style = 0] of runs) {
    const kind = MARKS[text];
    if (kind) {
      // A removed paragraph break is layout, not text: it is not drawn.
      if (op !== -1) out.push({ mark: kind });
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
      const starts = gap >= JOIN_GAP;
      if (starts) passage += 1;
      gap = 0;
      out.push({ mark: null, op, word, style: st, ...(starts ? { passage } : {}) });
    });
  }
  return out;
}

function paragraphsOf(stream: readonly Item[], kind: Kind = 'p'): Paragraph[] {
  const out: Paragraph[] = [];
  let cur: Paragraph = { kind, spans: [] };
  for (const it of stream) {
    if (it.mark !== null) {
      if (cur.spans.length > 0) out.push(cur);
      cur = { kind: it.mark, spans: [] };
      continue;
    }
    const last = cur.spans.at(-1);
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
  if (cur.spans.length > 0) out.push(cur);
  return out;
}

/** The newer text whole, paragraph by paragraph, the older's removed words in place. */
export function paragraphs(runs: readonly DiffRun[]): Paragraph[] {
  return paragraphsOf(items(runs));
}

/** Each changed passage with up to `context` unchanged words either side, kept within its paragraph. */
export function passages(runs: readonly DiffRun[], context = 25): Passage[] {
  const stream = items(runs);
  // The heading each item falls under, and the kind of paragraph each is in.
  const section: (string | null)[] = [];
  const kindAt: Kind[] = [];
  let current: string | null = null;
  let collecting: string[] | null = null;
  let kind: Kind = 'p';
  for (const it of stream) {
    if (it.mark !== null) {
      if (collecting) current = collecting.join(' ');
      collecting = it.mark === 'h' ? [] : null;
      kind = it.mark;
    } else if (collecting && it.op !== -1) collecting.push(it.word);
    section.push(current);
    kindAt.push(kind);
  }
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
    let start = i;
    for (let n = 0; start > 0 && n < context;) {
      const x = stream[start - 1]!;
      if (x.mark !== null || x.op !== 0) break;
      start -= 1;
      if (!(x.style & GLUE)) n += 1;
    }
    let stop = end + 1;
    for (let n = 0; stop < stream.length && n < context;) {
      const x = stream[stop]!;
      if (x.mark !== null || x.passage !== undefined) break;
      stop += 1;
      if (!(x.style & GLUE)) n += 1;
    }
    const slice = stream.slice(start, stop);
    const words = slice.filter((x): x is Word => x.mark === null && !(x.style & GLUE));
    const before = start > 0 ? stream[start - 1] : undefined;
    const after = stop < stream.length ? stream[stop] : undefined;
    out.push({
      number: it.passage,
      section: section[i] ?? null,
      cutStart: before !== undefined && before.mark === null,
      cutEnd: after !== undefined && after.mark === null,
      paragraphs: paragraphsOf(slice, slice[0]?.mark === null ? (kindAt[start] ?? 'p') : 'p'),
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

const TAGS: Record<Kind, [string, string]> = {
  p: ['<p>', '</p>'],
  h: ['<h4>', '</h4>'],
  eq: ['<p class="eq">', '</p>'],
  cap: ['<p class="cap">', '</p>'],
};

/** Paragraphs as HTML: headings in the paper's small caps, changes struck or marked. */
export function paragraphsHtml(
  ps: readonly Paragraph[],
  { anchors = false, cutStart = false, cutEnd = false } = {},
): string {
  return ps
    .map((p, i) => {
      const body = p.spans.map((s, k) => (k > 0 && !(s.style & GLUE) ? ' ' : '') + spanHtml(s, anchors)).join('');
      const [open, close] = TAGS[p.kind];
      return `${open}${cutStart && i === 0 ? '… ' : ''}${body}${cutEnd && i === ps.length - 1 ? ' …' : ''}${close}`;
    })
    .join('');
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
        paragraphsHtml(x.paragraphs, { cutStart: x.cutStart, cutEnd: x.cutEnd }) +
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
