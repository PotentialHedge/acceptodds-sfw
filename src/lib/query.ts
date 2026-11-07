/**
 * The home page's search syntax, parsed into a tree. Pure and client-safe;
 * `views.browseListings` compiles the tree to SQL, always with bound
 * parameters.
 *
 * Modelled on vvzapi.ch's: `key:value` filters, quoted values, `-` to negate a
 * word, phrase, filter or group, `OR` between terms, parentheses to group, and
 * a plain AND between everything else.
 *
 *     graph neural author:hinton accept>=60 -status:settled
 *     (venue:iclr OR venue:neurips) "diffusion model" trades>10
 *     soundness>=2.5 review:"data leakage"
 *     outcome:withdrawn OR outcome:desk_rejected
 *
 * Words and phrases are full-text search, as before: next to each other in
 * one AND they are merged into a single `websearch_to_tsquery` string, so a
 * stop word among them is dropped rather than matching nothing, and the last
 * word still matches as a prefix (`lib/search.ts`). A `key:` that is not a
 * field below is just text, so a title like "BERT: pre-training" searches as
 * one. A known field with a bad value is dropped with an error the page shows.
 */

import { REVIEW_FACTORS } from './reviews';
import { prefixTsquery } from './search';
import { VENUE_STATUSES } from './venue-status';

export const TEXT_FIELDS = ['title', 'author', 'keyword', 'area', 'venue'] as const;
export const NUMBER_FIELDS = ['accept', 'volume', 'trades', 'rating', ...REVIEW_FACTORS] as const;
export const SEARCH_FIELDS = [...TEXT_FIELDS, 'status', 'outcome', 'review', ...NUMBER_FIELDS] as const;
export type SearchField = (typeof SEARCH_FIELDS)[number];

/** Every name a field answers to. The first spelling of each is its own name. */
const ALIASES: Record<string, SearchField> = {
  title: 'title',
  t: 'title',
  author: 'author',
  authors: 'author',
  a: 'author',
  keyword: 'keyword',
  keywords: 'keyword',
  kw: 'keyword',
  area: 'area',
  primaryarea: 'area',
  venue: 'venue',
  kind: 'venue',
  v: 'venue',
  status: 'status',
  s: 'status',
  outcome: 'outcome',
  decision: 'outcome',
  o: 'outcome',
  accept: 'accept',
  p: 'accept',
  chance: 'accept',
  volume: 'volume',
  vol: 'volume',
  trades: 'trades',
  fills: 'trades',
  rating: 'rating',
  score: 'rating',
  soundness: 'soundness',
  sound: 'soundness',
  informativeness: 'informativeness',
  informative: 'informativeness',
  info: 'informativeness',
  presentation: 'presentation',
  confidence: 'confidence',
  conf: 'confidence',
  review: 'review',
  reviews: 'review',
};

/** One line per field, for the syntax help. */
export const FIELD_HELP: { field: SearchField; aliases: string[]; example: string; means: string }[] = [
  { field: 'title', aliases: ['t'], example: 'title:diffusion', means: 'title contains' },
  { field: 'author', aliases: ['a'], example: 'author:"de freitas"', means: 'an author contains' },
  { field: 'keyword', aliases: ['kw'], example: 'keyword:"graph neural"', means: 'a keyword contains' },
  { field: 'area', aliases: ['primaryArea'], example: 'area:optimization', means: 'primary area contains' },
  { field: 'venue', aliases: ['v', 'kind'], example: 'venue:iclr', means: 'venue contains' },
  { field: 'status', aliases: ['s'], example: 'status:settled', means: 'open, closed, settled or void' },
  {
    field: 'outcome',
    aliases: ['o', 'decision'],
    example: 'outcome:withdrawn',
    means: 'withdrawn, desk_rejected, rejected, accepted (or oral, spotlight, poster), or pending',
  },
  {
    field: 'accept',
    aliases: ['p', 'chance'],
    example: 'accept>=70',
    means: 'the chance shown for a paper, in %',
  },
  { field: 'volume', aliases: ['vol'], example: 'volume>100', means: '$rep traded' },
  { field: 'trades', aliases: ['fills'], example: 'trades>=5', means: 'number of fills' },
  {
    field: 'rating',
    aliases: ['score'],
    example: 'rating>=3.5',
    means: 'average review score as shown, on the venue’s scale',
  },
  { field: 'soundness', aliases: ['sound'], example: 'soundness>=2.5', means: 'average soundness score' },
  {
    field: 'informativeness',
    aliases: ['info', 'informative'],
    example: 'informativeness>=2',
    means: 'average informativeness score',
  },
  { field: 'presentation', aliases: [], example: 'presentation>=2', means: 'average presentation score' },
  { field: 'confidence', aliases: ['conf'], example: 'confidence<2', means: 'average reviewer confidence' },
  {
    field: 'review',
    aliases: ['reviews'],
    example: 'review:"data leakage"',
    means: 'a review or comment says this, the words in order',
  },
];

export const STATUS_VALUES = ['open', 'closed', 'settled', 'void'] as const;
export type StatusValue = (typeof STATUS_VALUES)[number];

/**
 * What `outcome:` takes: a venue status (`lib/venue-status.ts`), `accepted` for any accepted tier, or
 * `pending` for a paper still under review. Spellings below; the first of each is its own name.
 */
export const OUTCOME_VALUES = [...VENUE_STATUSES, 'pending'] as const;
export type OutcomeValue = (typeof OUTCOME_VALUES)[number];
const OUTCOME_ALIASES: Record<string, OutcomeValue> = {
  ...Object.fromEntries(VENUE_STATUSES.map((v) => [v, v])),
  desk: 'desk_rejected',
  deskrejected: 'desk_rejected',
  'desk-rejected': 'desk_rejected',
  reject: 'rejected',
  accept: 'accepted',
  pending: 'pending',
  review: 'pending',
  under_review: 'pending',
  'under-review': 'pending',
  none: 'pending',
};

export type CompareOp = '=' | '!=' | '>' | '<' | '>=' | '<=';

export type SearchNode =
  | { kind: 'and'; items: SearchNode[] }
  | { kind: 'or'; items: SearchNode[] }
  | { kind: 'not'; item: SearchNode }
  /**
   * Full text. `include` and `exclude` are `websearch_to_tsquery` fragments
   * — a word, or a `"quoted phrase"` — without their `-`.
   */
  | { kind: 'text'; include: string[]; exclude: string[] }
  /** A text field: contains (`=`) or does not (`!=`), case-insensitively. */
  | { kind: 'match'; field: (typeof TEXT_FIELDS)[number]; op: '=' | '!='; value: string }
  | { kind: 'status'; op: '=' | '!='; value: StatusValue }
  /** The paper's outcome at its venue (`listings.venue_status`). */
  | { kind: 'outcome'; op: '=' | '!='; value: OutcomeValue }
  /** What reviewers wrote contains `value` as a phrase, stemmed (`=`), or nothing does (`!=`). */
  | { kind: 'review'; op: '=' | '!='; value: string }
  /** `value` is a plain decimal string: a percentage, rep, a count, or a mean review score. */
  | { kind: 'compare'; field: (typeof NUMBER_FIELDS)[number]; op: CompareOp; value: string };

export interface ParsedSearch {
  /** `null` when nothing searchable is left. */
  node: SearchNode | null;
  /** One line per term that was dropped, for the page to show. */
  errors: string[];
  /** Fields the query filters on, so the page can step its own filters aside. */
  fields: Set<SearchField>;
}

// ---------------------------------------------------------------------------
// tokens
// ---------------------------------------------------------------------------

type Token =
  | { t: '('; neg: boolean }
  | { t: ')' }
  | { t: 'or' }
  | { t: 'word'; neg: boolean; text: string }
  | { t: 'phrase'; neg: boolean; text: string }
  | { t: 'field'; neg: boolean; key: string; op: string; value: string; raw: string };

const FIELD = /^([A-Za-z]+)(!=|>=|<=|:|=|>|<)/;

function tokenize(input: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = input.length;
  const isSpace = (c: string) => /\s/.test(c);
  // A bare run: up to whitespace or a paren.
  const bare = () => {
    const start = i;
    while (i < n && !isSpace(input[i]) && input[i] !== '(' && input[i] !== ')') i += 1;
    return input.slice(start, i);
  };
  // A quoted run starting at the quote at `i`; unterminated runs to the end.
  const quoted = () => {
    const q = input[i];
    const end = input.indexOf(q, i + 1);
    const text = input.slice(i + 1, end < 0 ? n : end);
    i = end < 0 ? n : end + 1;
    return text;
  };

  while (i < n) {
    const c = input[i];
    if (isSpace(c)) {
      i += 1;
      continue;
    }
    if (c === ')') {
      out.push({ t: ')' });
      i += 1;
      continue;
    }
    let neg = false;
    if (c === '-' && i + 1 < n && !isSpace(input[i + 1])) {
      neg = true;
      i += 1;
    }
    const d = input[i];
    if (d === '(') {
      out.push({ t: '(', neg });
      i += 1;
    } else if (d === '"' || d === '`') {
      out.push({ t: 'phrase', neg, text: quoted() });
    } else {
      const start = i;
      const head = FIELD.exec(input.slice(i));
      if (head && ALIASES[head[1].toLowerCase()] !== undefined) {
        i += head[0].length;
        const value = i < n && (input[i] === '"' || input[i] === '`') ? quoted() : bare();
        out.push({ t: 'field', neg, key: head[1].toLowerCase(), op: head[2], value, raw: input.slice(start, i) });
      } else {
        const text = bare();
        if (!neg && /^or$/i.test(text)) out.push({ t: 'or' });
        else if (text !== '') out.push({ t: 'word', neg, text });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// parsing
// ---------------------------------------------------------------------------

const NUMBER = /^\d{1,12}(\.\d{1,6})?$/;

/**
 * A websearch fragment. Quotes inside it are dropped (they would open a
 * phrase) — in a word without leaving a space, which could start a `-word`
 * the person never wrote — and one with no letter or digit is nothing:
 * websearch would read a lone `-` as an operator.
 */
function fragment(text: string, phrase: boolean): string | null {
  const clean = phrase
    ? text.replace(/["`]/g, ' ').replace(/\s+/g, ' ').trim()
    : text.replace(/["`]/g, '').replace(/^-+/, '');
  if (!/[\p{L}\p{N}]/u.test(clean)) return null;
  return phrase ? `"${clean}"` : clean;
}

function isTextField(f: SearchField): f is (typeof TEXT_FIELDS)[number] {
  return (TEXT_FIELDS as readonly string[]).includes(f);
}

function fieldNode(tok: Extract<Token, { t: 'field' }>, errors: string[]): SearchNode | null {
  const field = ALIASES[tok.key];
  let op = (tok.op === ':' ? '=' : tok.op) as CompareOp;
  let value = tok.value.trim();
  // `volume:>0`, as GitHub writes it, means `volume>0`. Number fields only:
  // a text field's value may start with `<`.
  const colonOp = /^(!=|>=|<=|=|>|<)/.exec(value);
  if (tok.op === ':' && colonOp && (NUMBER_FIELDS as readonly string[]).includes(field)) {
    op = colonOp[1] as CompareOp;
    value = value.slice(colonOp[1].length).trim();
  }
  if (value === '') {
    errors.push(`“${tok.raw}”: no value`);
    return null;
  }
  if (isTextField(field)) {
    if (op !== '=' && op !== '!=') {
      errors.push(`“${tok.raw}”: ${field} takes : or !=`);
      return null;
    }
    return { kind: 'match', field, op, value };
  }
  if (field === 'review') {
    if (op !== '=' && op !== '!=') {
      errors.push(`“${tok.raw}”: review takes : or !=`);
      return null;
    }
    return { kind: 'review', op, value };
  }
  if (field === 'status') {
    const v = value.toLowerCase();
    if (!(STATUS_VALUES as readonly string[]).includes(v)) {
      errors.push(`“${tok.raw}”: status is ${STATUS_VALUES.join(', ')}`);
      return null;
    }
    if (op !== '=' && op !== '!=') {
      errors.push(`“${tok.raw}”: status takes : or !=`);
      return null;
    }
    return { kind: 'status', op, value: v as StatusValue };
  }
  if (field === 'outcome') {
    const v = OUTCOME_ALIASES[value.toLowerCase()];
    if (v === undefined) {
      errors.push(`“${tok.raw}”: outcome is ${OUTCOME_VALUES.join(', ')}`);
      return null;
    }
    if (op !== '=' && op !== '!=') {
      errors.push(`“${tok.raw}”: outcome takes : or !=`);
      return null;
    }
    return { kind: 'outcome', op, value: v };
  }
  const number = field === 'accept' ? value.replace(/%$/, '') : value;
  if (!NUMBER.test(number) || (field === 'trades' && number.includes('.'))) {
    errors.push(`“${tok.raw}”: ${field} takes ${field === 'trades' ? 'a whole number' : 'a number'}`);
    return null;
  }
  if (field === 'accept' && Number(number) > 100) {
    errors.push(`“${tok.raw}”: accept is a percentage, 0–100`);
    return null;
  }
  return { kind: 'compare', field, op, value: number };
}

/**
 * `-node`. A text node is the AND of its fragments, so only a single fragment
 * negates by switching sides: `-(a b)` is "not both", not "neither".
 */
function negate(node: SearchNode): SearchNode {
  if (node.kind === 'text' && node.include.length + node.exclude.length === 1) {
    return { kind: 'text', include: node.exclude, exclude: node.include };
  }
  if (node.kind === 'not') return node.item;
  return { kind: 'not', item: node };
}

/**
 * An AND's children with their text merged into one node, then flattened:
 * one child is itself, none is nothing.
 */
function and(items: SearchNode[]): SearchNode | null {
  const include: string[] = [];
  const exclude: string[] = [];
  const rest: SearchNode[] = [];
  for (const item of items) {
    // A text node is already an AND of its fragments.
    if (item.kind === 'text') {
      include.push(...item.include);
      exclude.push(...item.exclude);
    } else if (item.kind === 'and') rest.push(...item.items);
    else rest.push(item);
  }
  const all = include.length + exclude.length > 0 ? [{ kind: 'text', include, exclude } as SearchNode, ...rest] : rest;
  if (all.length === 0) return null;
  return all.length === 1 ? all[0] : { kind: 'and', items: all };
}

function or(items: SearchNode[]): SearchNode | null {
  const flat = items.flatMap((i) => (i.kind === 'or' ? i.items : [i]));
  if (flat.length === 0) return null;
  return flat.length === 1 ? flat[0] : { kind: 'or', items: flat };
}

/**
 * Most terms a query keeps. Each one past the text every match needs is a
 * predicate checked on every row of the venue (`views.searchPredicate`), so
 * an anonymous 200-character chain of ~40 `OR`ed words cost 6–11 s of
 * database time per request, and ten at once held the whole pool. Words in
 * one AND merge into a single term first, so a long plain query is one.
 */
export const MAX_SEARCH_TERMS = 8;

/** `node` with only its first `max` terms (leaves), in reading order. */
function capTerms(node: SearchNode | null, max: number): { node: SearchNode | null; dropped: number } {
  let kept = 0;
  let dropped = 0;
  const walk = (n: SearchNode): SearchNode | null => {
    switch (n.kind) {
      case 'and':
      case 'or': {
        const items = n.items.map(walk).filter((i): i is SearchNode => i !== null);
        return n.kind === 'and' ? and(items) : or(items);
      }
      case 'not': {
        const item = walk(n.item);
        return item === null ? null : { kind: 'not', item };
      }
      default:
        if (kept >= max) {
          dropped += 1;
          return null;
        }
        kept += 1;
        return n;
    }
  };
  return { node: node === null ? null : walk(node), dropped };
}

/**
 * The query as a tree. Forgiving: an unmatched `)` is ignored, a missing one
 * is implied at the end, a dangling `OR` is dropped, a bad filter is
 * dropped with an error, and so is every term past {@link MAX_SEARCH_TERMS}.
 * Never throws.
 */
export function parseSearch(input: string): ParsedSearch {
  const tokens = tokenize(input);
  const errors: string[] = [];
  const fields = new Set<SearchField>();
  let pos = 0;

  // or := and (OR and)* ; and := unary* ; stops at ')' (consumed by the caller).
  const parseOr = (depth: number): SearchNode | null => {
    const branches: SearchNode[] = [];
    let current: SearchNode[] = [];
    const close = () => {
      const node = and(current);
      if (node) branches.push(node);
      current = [];
    };
    while (pos < tokens.length) {
      const tok = tokens[pos];
      if (tok.t === ')') {
        if (depth > 0) break;
        pos += 1; // unmatched: ignored
        continue;
      }
      pos += 1;
      if (tok.t === 'or') {
        close();
        continue;
      }
      let node: SearchNode | null;
      if (tok.t === '(') {
        node = parseOr(depth + 1);
        if (tokens[pos]?.t === ')') pos += 1;
      } else if (tok.t === 'field') {
        node = fieldNode(tok, errors);
        if (node) fields.add(ALIASES[tok.key]);
      } else {
        const f = fragment(tok.text, tok.t === 'phrase');
        node = f === null ? null : { kind: 'text', include: [f], exclude: [] };
      }
      if (node) current.push('neg' in tok && tok.neg ? negate(node) : node);
    }
    close();
    return or(branches);
  };

  const capped = capTerms(parseOr(0), MAX_SEARCH_TERMS);
  if (capped.dropped > 0) {
    errors.push(`${capped.dropped} more term${capped.dropped === 1 ? '' : 's'}: at most ${MAX_SEARCH_TERMS} are used`);
    // A dropped `venue:` or `status:` no longer moves the page's own filter aside.
    fields.clear();
    const collect = (n: SearchNode) => {
      if (n.kind === 'and' || n.kind === 'or') n.items.forEach(collect);
      else if (n.kind === 'not') collect(n.item);
      else if (n.kind === 'status') fields.add('status');
      else if (n.kind === 'outcome') fields.add('outcome');
      else if (n.kind === 'review') fields.add('review');
      else if (n.kind === 'match' || n.kind === 'compare') fields.add(n.field);
    };
    if (capped.node) collect(capped.node);
  }
  return { node: capped.node, errors, fields };
}

// ---------------------------------------------------------------------------
// reading the tree
// ---------------------------------------------------------------------------

/** A text node's `websearch_to_tsquery` string. */
export function websearchOf(node: { include: string[]; exclude: string[] }): string {
  return [...node.include, ...node.exclude.map((f) => `-${f}`)].join(' ');
}

/**
 * The prefix alternative for a text node (`lib/search.ts`): its words ANDed,
 * the last as a prefix. Only for positive words; a phrase or a negation keeps
 * exact websearch semantics.
 */
export function prefixOf(node: { include: string[]; exclude: string[] }): string | null {
  return node.exclude.length === 0 ? prefixTsquery(node.include.join(' ')) : null;
}

/**
 * The text every match must contain: the root's text, or the text of a root
 * AND. It can drive the GIN-indexed search join and the relevance rank.
 * `null` when there is none (only filters, or text only under an OR or NOT),
 * or when it only excludes.
 */
export function requiredText(node: SearchNode | null): Extract<SearchNode, { kind: 'text' }> | null {
  if (node === null) return null;
  const text =
    node.kind === 'text' ? node : node.kind === 'and' ? node.items.find((i) => i.kind === 'text') : undefined;
  return text?.kind === 'text' && text.include.length > 0 ? text : null;
}

/**
 * The words to look for people by: the query when it is nothing but positive
 * words and phrases, quotes dropped. `null` for anything with a filter, an
 * `OR` or a `-`, which is a question about papers.
 */
export function peopleText(node: SearchNode | null): string | null {
  if (node?.kind !== 'text' || node.exclude.length > 0 || node.include.length === 0) return null;
  return node.include.join(' ').replace(/"/g, '');
}

/** `%value%` for ILIKE, with `\`, `%` and `_` escaped (backslash is ILIKE's default escape). */
export function containsPattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
