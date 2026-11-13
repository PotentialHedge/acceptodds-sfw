import { ui } from '@/components/ui';
import type { ListingRevision, ListingRevisionHunk } from '@/db/schema';
import { day } from '@/lib/format';

/** Passages shown before "Show all". */
const FIRST = 6;

export const REVISION_ANCHOR = 'revisions';

/**
 * What changed in a paper's PDF since it was submitted, as passages of the extracted text: the
 * submitted wording struck through, the current one marked. Only excerpts, cut short by the
 * supplier, and both PDFs are linked at OpenReview, whose terms forbid altering a downloaded
 * submission: this is a comparison of two unaltered versions, not a copy of either.
 */
export function PaperRevision({ revision }: { revision: ListingRevision | null }) {
  if (!revision || revision.passages === 0) return null;
  const { hunks } = revision;
  const first = hunks.slice(0, FIRST);
  const rest = hunks.slice(FIRST);
  const unshown = revision.passages - hunks.length;
  return (
    <section id={REVISION_ANCHOR} className="scroll-mt-4">
      <h3 className={ui.groupHeading}>Changes since submission</h3>
      <p className="font-sans text-sm">
        The PDF on OpenReview was revised after submission
        {revision.revisedAt && (
          <>
            {' '}
            (last change <time dateTime={revision.revisedAt.toISOString()}>{day(revision.revisedAt)}</time>)
          </>
        )}
        : {revision.passages.toLocaleString('en-US')} {revision.passages === 1 ? 'passage' : 'passages'} changed,{' '}
        <span className="text-up">+{revision.wordsAdded.toLocaleString('en-US')}</span> words and{' '}
        <span className="text-down">−{revision.wordsRemoved.toLocaleString('en-US')}</span>; it runs to{' '}
        {revision.wordsAfter.toLocaleString('en-US')} words, from {revision.wordsBefore.toLocaleString('en-US')}.
      </p>
      <p className="mt-1 flex flex-wrap gap-x-3 font-sans text-[13px]">
        {revision.currentUrl && (
          <a href={revision.currentUrl} className="text-accent" rel="noopener noreferrer" target="_blank">
            [current pdf]
          </a>
        )}
        {revision.historyUrl && (
          <a href={revision.historyUrl} className="text-accent" rel="noopener noreferrer" target="_blank">
            [all versions on OpenReview]
          </a>
        )}
      </p>
      <ol className="mt-3 list-none p-0">
        {first.map((h, i) => (
          <Hunk key={i} hunk={h} />
        ))}
      </ol>
      {rest.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer font-sans text-[13px] text-accent">
            Show {rest.length} more {rest.length === 1 ? 'passage' : 'passages'}
          </summary>
          <ol className="list-none p-0">
            {rest.map((h, i) => (
              <Hunk key={i} hunk={h} />
            ))}
          </ol>
        </details>
      )}
      <p className={ui.fine}>
        Compared by the text extracted from each PDF, so equations, tables and figures can show as changed or be missed,
        and long passages are cut short{unshown > 0 ? `; ${unshown} more passages are not shown` : ''}. Excerpts only:
        the papers are their authors’, on OpenReview.
      </p>
    </section>
  );
}

function Hunk({ hunk }: { hunk: ListingRevisionHunk }) {
  return (
    <li className="mt-2 border-t border-rule-soft pt-2">
      {hunk.section && <div className="font-sans text-xs text-muted">{hunk.section}</div>}
      <p className="text-[15px] leading-relaxed break-words">
        {hunk.before && <span className="text-subtle">…{hunk.before} </span>}
        {hunk.removed && (
          <del className="bg-reject-soft text-reject decoration-reject/60" title="Submitted version">
            {hunk.removed}
          </del>
        )}
        {hunk.removed && hunk.added && ' '}
        {hunk.added && (
          <ins className="bg-accept-soft text-accept no-underline" title="Current version">
            {hunk.added}
          </ins>
        )}
        {hunk.after && <span className="text-subtle"> {hunk.after}…</span>}
      </p>
    </li>
  );
}
