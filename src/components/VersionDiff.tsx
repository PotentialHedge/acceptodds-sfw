import type { ReactNode } from 'react';
import type { Paragraph, Passage, Span } from '@/lib/version-diff';

/** A change's anchor in the whole-text view, and its passage's in the changes view. */
export const changeAnchor = (n: number) => `c${n}`;
export const passageAnchor = (n: number) => `p${n}`;

function SpanText({ span, anchor }: { span: Span; anchor: boolean }) {
  const id = anchor && span.passage !== undefined ? changeAnchor(span.passage) : undefined;
  if (span.op === 0) return <span>{span.text}</span>;
  if (span.op === -1) {
    return (
      <del
        id={id}
        data-change={id ? span.passage : undefined}
        className="scroll-mt-16 bg-reject-soft text-reject decoration-reject/60"
        title="Only in the older version"
      >
        {span.text}
      </del>
    );
  }
  return (
    <ins
      id={id}
      data-change={id ? span.passage : undefined}
      className="scroll-mt-16 bg-accept-soft text-accept no-underline"
      title="Only in the newer version"
    >
      {span.text}
    </ins>
  );
}

function Spans({ spans, anchors }: { spans: Span[]; anchors: boolean }) {
  const out: ReactNode[] = [];
  spans.forEach((s, i) => {
    if (i > 0) out.push(' ');
    out.push(<SpanText key={i} span={s} anchor={anchors} />);
  });
  return <>{out}</>;
}

/** Paragraphs as text: headings in the paper's small caps, changes struck or marked. */
export function DiffParagraphs({
  paragraphs,
  anchors = false,
  cutStart = false,
  cutEnd = false,
}: {
  paragraphs: Paragraph[];
  /** Give each passage's first change its anchor (the whole-text view). */
  anchors?: boolean;
  cutStart?: boolean;
  cutEnd?: boolean;
}) {
  return (
    <>
      {paragraphs.map((p, i) => {
        const pre = cutStart && i === 0 ? '… ' : '';
        const post = cutEnd && i === paragraphs.length - 1 ? ' …' : '';
        return p.heading ? (
          <h4 key={i} className="mt-5 mb-1 font-serif text-[15px] [font-variant-caps:small-caps]">
            {pre}
            <Spans spans={p.spans} anchors={anchors} />
            {post}
          </h4>
        ) : (
          <p key={i} className="mt-2 text-[15px] leading-relaxed break-words">
            {pre}
            <Spans spans={p.spans} anchors={anchors} />
            {post}
          </p>
        );
      })}
    </>
  );
}

/** The changed passages, each under its section, linked to its place in the whole text. */
export function PassageList({ passages, wholeHref }: { passages: Passage[]; wholeHref: (n: number) => string }) {
  return (
    <ol className="mt-3 list-none p-0">
      {passages.map((x) => (
        <li key={x.number} id={passageAnchor(x.number)} className="mt-3 scroll-mt-4 border-t border-rule-soft pt-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 font-sans text-xs text-muted">
            <span>
              #{x.number} · {x.section ?? 'Front matter'}
            </span>
            <span className="flex gap-3">
              <span>
                {x.added > 0 && <span className="text-up">+{x.added}</span>}
                {x.added > 0 && x.removed > 0 && ' '}
                {x.removed > 0 && <span className="text-down">−{x.removed}</span>}
              </span>
              <a href={wholeHref(x.number)} className="hover:text-accent hover:underline">
                in the text ↓
              </a>
            </span>
          </div>
          <DiffParagraphs paragraphs={x.paragraphs} cutStart={x.cutStart} cutEnd={x.cutEnd} />
        </li>
      ))}
    </ol>
  );
}

/** A one-line index of the passages, for the whole-text view: number, section, first changed words. */
export function ChangeIndex({ passages }: { passages: Passage[] }) {
  return (
    <ol className="mt-2 list-none columns-1 p-0 font-sans text-[13px] sm:columns-2">
      {passages.map((x) => {
        const first = x.paragraphs.flatMap((p) => p.spans).find((s) => s.op !== 0);
        const words = first ? first.text.split(' ').slice(0, 8).join(' ') : '';
        return (
          <li key={x.number} className="truncate break-inside-avoid">
            <a href={`#${changeAnchor(x.number)}`} className="hover:underline">
              <span className="text-muted">
                #{x.number} · {x.section ?? 'Front matter'}
              </span>{' '}
              <span className={first?.op === -1 ? 'text-down line-through' : 'text-up'}>{words}</span>
            </a>
          </li>
        );
      })}
    </ol>
  );
}
