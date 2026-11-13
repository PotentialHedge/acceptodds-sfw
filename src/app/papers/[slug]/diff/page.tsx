import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DiffBody } from '@/components/DiffBody';
import { ChangeStepper, DiffPicker } from '@/components/DiffControls';
import { MathText } from '@/components/MathText';
import { ui } from '@/components/ui';
import type { ListingVersion } from '@/db/schema';
import { day } from '@/lib/format';
import { ApiError } from '@/server/api/errors';
import { siteName } from '@/server/share';
import { versionsOf } from '@/server/versions';
import { resolveListing } from '@/server/views';

export const dynamic = 'force-dynamic';

const CC_BY = 'https://creativecommons.org/licenses/by/4.0/';

type Params = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function load(slug: string) {
  try {
    return await resolveListing(decodeURIComponent(slug));
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const listing = await load((await params).slug);
  return {
    title: `Changes: ${listing.title.replace(/\$/g, '')} | ${siteName()}`,
    // The paper page is the one to find; this is a view of the same text.
    robots: { index: false },
  };
}

function seqParam(raw: string | string[] | undefined, fallback: number, max: number): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : fallback;
}

function when(v: ListingVersion): string {
  return v.at ? day(v.at) : `as of ${day(v.seenAt)}`;
}

/**
 * The versions of a paper's PDF that `../research` has read at OpenReview, and the diff
 * between any two: only the changed passages, or the whole newer text with the changes in
 * place. ICLR submissions are CC BY 4.0, so the whole text may be shown, attributed and
 * marked as changed (an extraction, with the differences drawn in).
 */
export default async function PaperDiffPage({ params, searchParams }: Params) {
  const { slug } = await params;
  const q = await searchParams;
  const listing = await load(slug);
  const { versions, diffs } = await versionsOf(listing.id);
  const paperHref = `/papers/${encodeURIComponent(listing.slug)}`;
  const base = `${paperHref}/diff`;

  const head = (
    <header className="mb-4">
      <p className="font-sans text-[13px]">
        <Link href={paperHref} className="text-accent">
          ← Back to the paper
        </Link>
      </p>
      <h1 className="mt-2 font-serif text-2xl leading-snug">
        <MathText text={listing.title} />
      </h1>
      <h2 className="mt-1 font-sans text-sm text-muted">Changes to the PDF since submission</h2>
    </header>
  );

  if (versions.length < 2) {
    return (
      <main className={ui.page}>
        {head}
        <p className={ui.empty}>
          No revision of this paper seen yet: its PDF on OpenReview is as it was submitted, as far as we know.
        </p>
      </main>
    );
  }

  const last = versions.length - 1;
  let from = seqParam(q.from, 0, last);
  let to = seqParam(q.to, last, last);
  if (from > to) [from, to] = [to, from];
  if (from === to) [from, to] = to > 0 ? [to - 1, to] : [0, 1];
  const view = q.view === 'text' ? 'text' : 'changes';
  // Only the counts here: the text comes from `diff/body`, so it is sent once.
  const d = diffs.find((x) => x.fromSeq === from && x.toSeq === to);
  const older = versions[from]!;
  const newer = versions[to]!;
  const forum = listing.links.find((l) => l.url.includes('openreview.net/forum'))?.url ?? null;
  const history = forum?.replace('/forum?', '/revisions?') ?? null;

  return (
    <main className={ui.page}>
      {head}

      <section className="border border-frame bg-card p-3.5">
        <DiffPicker
          base={base}
          versions={versions.map((v) => ({ seq: v.seq, label: `${v.label} (${when(v)})` }))}
          from={from}
          to={to}
          view={view}
        />
        <table className="mt-3 w-full font-sans text-[13px]">
          <tbody>
            {versions.map((v) => (
              <tr key={v.seq} className={v.seq === from || v.seq === to ? 'text-ink' : 'text-muted'}>
                <td className="py-0.5 pr-2">
                  {v.seq === from ? (
                    <span className="text-down">older</span>
                  ) : v.seq === to ? (
                    <span className="text-up">newer</span>
                  ) : (
                    ''
                  )}
                </td>
                <td className="py-0.5 pr-2">{v.label}</td>
                <td className="py-0.5 pr-2">{when(v)}</td>
                <td className="py-0.5 pr-2 text-right tabular-nums">{v.words.toLocaleString('en-US')} words</td>
                <td className="py-0.5 text-right">
                  {v.url && (
                    <a href={v.url} className="text-accent" rel="noopener noreferrer" target="_blank">
                      [pdf]
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {history && (
          <p className="mt-1 font-sans text-xs text-muted">
            Earlier PDFs:{' '}
            <a href={history} className="underline" rel="noopener noreferrer" target="_blank">
              every version on OpenReview
            </a>
            .
          </p>
        )}
      </section>

      {!d ? (
        <p className={ui.empty}>No diff between these two versions yet.</p>
      ) : (
        <>
          <p className="mt-4 font-sans text-sm">
            From {older.label.toLowerCase()} to {newer.label.toLowerCase()}: {d.passages.toLocaleString('en-US')}{' '}
            {d.passages === 1 ? 'passage' : 'passages'} changed,{' '}
            <span className="text-up">+{d.wordsAdded.toLocaleString('en-US')}</span> and{' '}
            <span className="text-down">−{d.wordsRemoved.toLocaleString('en-US')}</span> words.
          </p>

          <DiffBody key={`${from}-${to}-${view}`} src={`${base}/body?from=${from}&to=${to}&view=${view}`} />
          {view === 'text' && <ChangeStepper total={d.passages} />}
        </>
      )}

      <p className="mt-8 border-t border-rule pt-3 font-sans text-xs text-faint">
        Text extracted from each PDF on OpenReview by {siteName()}, so equations, tables, figures and layout are lost or
        garbled, and some changes may be extraction noise; the differences are drawn in by us. Paper by its authors,{' '}
        <a href={CC_BY} className="underline" rel="license noopener noreferrer" target="_blank">
          CC BY 4.0
        </a>
        {forum && (
          <>
            ;{' '}
            <a href={forum} className="underline" rel="noopener noreferrer" target="_blank">
              its page on OpenReview
            </a>
          </>
        )}
        .
      </p>
    </main>
  );
}
