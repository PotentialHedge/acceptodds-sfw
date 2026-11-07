/**
 * Example searches the home page offers: one in the box's placeholder (Tab fills it in) and another as a
 * link under it, each picked at random per page. Simple, but each shows a different part of the syntax
 * (`lib/query.ts`). Picked for ICLR 2027 (reviews on a 1–4 scale), where each finds 50–500 papers. The id
 * is what Umami counts (`lib/track.ts`): give a changed query a new id, so its numbers start afresh.
 */
export const SEARCH_EXAMPLES = [
  { id: 'e1', q: 'diffusion rating>=3' },
  { id: 'e2', q: 'review:"data leakage"' },
  { id: 'e3', q: '"reward hacking" OR "specification gaming"' },
  { id: 'e4', q: 'area:robotics rating>=3' },
  { id: 'e5', q: 'title:benchmark presentation>=3' },
] as const;

export type SearchExample = (typeof SEARCH_EXAMPLES)[number];

/** Two different examples at random: the placeholder's and the link's. */
export function pickExamples(random: () => number = Math.random): [SearchExample, SearchExample] {
  const n = SEARCH_EXAMPLES.length;
  const a = Math.floor(random() * n);
  const b = (a + 1 + Math.floor(random() * (n - 1))) % n;
  return [SEARCH_EXAMPLES[a], SEARCH_EXAMPLES[b]];
}

/** The example a query is, if it is one exactly (spacing aside). */
export function exampleOf(q: string | null | undefined): SearchExample | null {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ');
  if (!q) return null;
  return SEARCH_EXAMPLES.find((e) => norm(e.q) === norm(q)) ?? null;
}
