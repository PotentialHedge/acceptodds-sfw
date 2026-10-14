import { siteName, siteUrl } from '@/server/share';
import { topPapers } from '@/server/seo';

export const dynamic = 'force-dynamic';

/**
 * `/llms.txt` (llmstxt.org): a plain Markdown map of the site for language-
 * model agents. Written from the same public data the pages show; prices
 * only ever as the pages show them, never as a sale value (§1.1).
 */
export async function GET() {
  const origin = siteUrl();
  const name = siteName();
  // A failed read is a 500, never an empty list the edge would cache.
  const papers = await topPapers(25);
  const body = `# ${name}

> The safe for work edition of acceptodds: research papers by venue, with search, a map laid out by topic, related papers and citations. There are no markets, prices or trading here.

## Read the site

- [Home](${origin}/): papers by venue, newest or most read first; search with \`?q=\`
- [Map](${origin}/map): every paper of a venue placed near the papers most like it

## API

- [API reference](${origin}/docs): interactive documentation
- [OpenAPI document](${origin}/api/v1/openapi.json): the full machine-readable contract
- Reads are public and need no key: \`GET ${origin}/api/v1/listings\`; \`?q=\` searches.

## Some papers
${papers.map((p) => `\n- [${p.title.replace(/[\[\]]/g, '')}](${origin}/papers/${encodeURIComponent(p.slug)})${p.kind ? `: ${p.kind}` : ''}`).join('')}

## Optional

- [Sitemap](${origin}/sitemap.xml): every paper
`;
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  });
}
