/** Where a paper's share card is drawn. */
export function cardPath(slug: string): string {
  return `/papers/${encodeURIComponent(slug)}/card.png`;
}

/** The share card's size, in pixels: what every network's large preview expects. */
export const CARD = { width: 1200, height: 630 } as const;
