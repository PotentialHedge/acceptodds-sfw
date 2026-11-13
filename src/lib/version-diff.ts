/**
 * Reading a version diff (`listing_version_diffs.runs`): the newer text whole, as runs of
 * unchanged (0), removed (-1) and added (1) words, where a word `\n` starts a paragraph and
 * `\n#` a heading. Two ways to read it: the whole text as paragraphs, and only the changed
 * passages with a little context. Client-safe.
 */
import type { DiffRun } from '@/db/schema';

export type Op = -1 | 0 | 1;

export interface Span {
  op: Op;
  text: string;
  /** Set on a passage's first changed span: its number, from 1, for links and the change list. */
  passage?: number;
}

export interface Paragraph {
  heading: boolean;
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

type Item = { mark: true; heading: boolean } | { mark: false; op: Op; word: string; passage?: number };

/** The runs as one stream of words and paragraph marks, each passage's first change numbered. */
function items(runs: readonly DiffRun[]): Item[] {
  const out: Item[] = [];
  let gap = JOIN_GAP;
  let passage = 0;
  for (const [op, text] of runs) {
    for (const word of text.split(' ')) {
      if (word === '') continue;
      if (word === '\n' || word === '\n#') {
        // A removed paragraph break is layout, not text: it is not drawn.
        if (op !== -1) out.push({ mark: true, heading: word === '\n#' });
        continue;
      }
      if (op === 0) {
        gap += 1;
        out.push({ mark: false, op, word });
      } else {
        const starts = gap >= JOIN_GAP;
        if (starts) passage += 1;
        gap = 0;
        out.push({ mark: false, op, word, ...(starts ? { passage } : {}) });
      }
    }
  }
  return out;
}

function paragraphsOf(stream: readonly Item[], heading = false): Paragraph[] {
  const out: Paragraph[] = [];
  let cur: Paragraph = { heading, spans: [] };
  for (const it of stream) {
    if (it.mark) {
      if (cur.spans.length > 0) out.push(cur);
      cur = { heading: it.heading, spans: [] };
      continue;
    }
    const last = cur.spans.at(-1);
    if (last && last.op === it.op && it.passage === undefined) last.text += ` ${it.word}`;
    else cur.spans.push({ op: it.op, text: it.word, ...(it.passage !== undefined ? { passage: it.passage } : {}) });
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
  // The heading each item falls under, and whether a mark (a paragraph edge) is at each index.
  const section: (string | null)[] = [];
  let current: string | null = null;
  let collecting: string[] | null = null;
  for (const it of stream) {
    if (it.mark) {
      if (collecting) current = collecting.join(' ');
      collecting = it.heading ? [] : null;
    } else if (collecting && it.op !== -1) collecting.push(it.word);
    section.push(current);
  }
  const out: Passage[] = [];
  let i = 0;
  while (i < stream.length) {
    const it = stream[i]!;
    if (it.mark || it.passage === undefined) {
      i += 1;
      continue;
    }
    // This passage's changes run to the last changed word before the next passage starts.
    let end = i;
    let j = i + 1;
    for (; j < stream.length; j++) {
      const x = stream[j]!;
      if (!x.mark && x.passage !== undefined) break;
      if (!x.mark && x.op !== 0) end = j;
    }
    let start = i;
    for (let n = 0; start > 0 && n < context;) {
      const x = stream[start - 1]!;
      if (x.mark || x.op !== 0) break;
      start -= 1;
      n += 1;
    }
    let stop = end + 1;
    for (let n = 0; stop < stream.length && n < context;) {
      const x = stream[stop]!;
      if (x.mark || (x.passage !== undefined && !x.mark)) break;
      stop += 1;
      n += 1;
    }
    const slice = stream.slice(start, stop);
    const words = slice.filter((x): x is Extract<Item, { mark: false }> => !x.mark);
    const before = start > 0 ? stream[start - 1] : undefined;
    const after = stop < stream.length ? stream[stop] : undefined;
    out.push({
      number: it.passage,
      section: section[i] ?? null,
      cutStart: before !== undefined && !before.mark,
      cutEnd: after !== undefined && !after.mark,
      paragraphs: paragraphsOf(slice, slice[0]?.mark === false && headingAt(stream, start)),
      added: words.filter((x) => x.op === 1).length,
      removed: words.filter((x) => x.op === -1).length,
    });
    i = j;
  }
  return out;
}

/** Whether index `at` is inside a heading paragraph. */
function headingAt(stream: readonly Item[], at: number): boolean {
  for (let k = at - 1; k >= 0; k--) {
    const x = stream[k]!;
    if (x.mark) return x.heading;
  }
  return false;
}
