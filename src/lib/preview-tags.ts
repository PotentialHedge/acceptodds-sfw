/** Where a paper's share card is drawn. The `.png` also keeps it clear of the gate (`proxy.ts`), so a crawler can fetch it. */
export function cardPath(slug: string): string {
  return `/papers/${encodeURIComponent(slug)}/card.png`;
}

/** The share card's size, in pixels: what every network's large preview expects. */
export const CARD = { width: 1200, height: 630 } as const;

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * A paper's link preview as plain `<meta>` tags, for the gate, which is outside
 * the root layout and so has no `generateMetadata`. Titles and abstracts are
 * untrusted: everything is escaped.
 */
export function previewTags(p: { title: string; description: string; url: string; image: string }): string {
  const tags: [string, string, string][] = [
    ['property', 'og:type', 'article'],
    ['property', 'og:title', p.title],
    ['property', 'og:description', p.description],
    ['property', 'og:url', p.url],
    ['property', 'og:image', p.image],
    ['property', 'og:image:width', String(CARD.width)],
    ['property', 'og:image:height', String(CARD.height)],
    ['name', 'twitter:card', 'summary_large_image'],
    ['name', 'twitter:title', p.title],
    ['name', 'twitter:description', p.description],
    ['name', 'twitter:image', p.image],
  ];
  return tags.map(([attr, key, value]) => `<meta ${attr}="${key}" content="${escape(value)}" />`).join('\n    ');
}
