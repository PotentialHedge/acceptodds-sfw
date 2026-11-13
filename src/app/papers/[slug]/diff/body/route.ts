import { changeAnchor, indexHtml, paragraphs, paragraphsHtml, passages, passagesHtml } from '@/lib/version-diff';
import { ApiError } from '@/server/api/errors';
import { versionDiff } from '@/server/versions';
import { resolveListing } from '@/server/views';

export const dynamic = 'force-dynamic';

const seq = (raw: string | null) => {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 99 ? n : null;
};

/**
 * The diff page's text, as an HTML fragment that `DiffBody` puts in place: sent on its own so
 * the paper's text crosses the wire once, not twice (as HTML and again in the page's React
 * payload). `view=changes` is the changed passages, `view=text` the whole text with a list of
 * the changes. Built from the stored diff only, every piece of text escaped.
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let listing;
  try {
    listing = await resolveListing(decodeURIComponent(slug));
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return new Response('not found', { status: 404 });
    throw err;
  }
  const q = new URL(req.url).searchParams;
  const from = seq(q.get('from'));
  const to = seq(q.get('to'));
  const d = from !== null && to !== null ? await versionDiff(listing.id, from, to) : null;
  if (!d) return new Response('no such diff', { status: 404 });
  const ps = passages(d.runs);
  const base = `/papers/${encodeURIComponent(listing.slug)}/diff?from=${from}&to=${to}`;
  const html =
    q.get('view') === 'text'
      ? `<details class="changes"><summary>List of the ${ps.length} changes</summary><ol class="index">${indexHtml(ps)}</ol></details>` +
        `<article>${paragraphsHtml(paragraphs(d.runs), { anchors: true })}</article>`
      : `<ol class="passages">${passagesHtml(ps, (n) => `${base}&view=text#${changeAnchor(n)}`)}</ol>`;
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // A diff never changes once stored; a new version is a new pair.
      'cache-control': 'private, max-age=600',
    },
  });
}
