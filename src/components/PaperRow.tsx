import Link from 'next/link';
import { MathText } from '@/components/MathText';

type RowMarket = {
  question: string;
  status: string;
  resolvedOutcomeId: string | null;
  outcomes: { id: string; label: string; ordinal: number; price: number }[];
};

/**
 * One paper in a list, as the home page sets it: its link
 * (`lib/paper-link.ts` `rowLink`: its [pdf], else [abs]), title, authors and mean review rating. The whole row is
 * one target: a link (`href`), or a button (`onPick`) for a list that
 * chooses rather than navigates (`/welcome`).
 */
export function PaperRow({
  title,
  authors,
  pdf,
  tldr,
  rating,
  ratingCount = 0,
  withdrawn = false,
  href,
  onPick,
}: {
  title: string;
  authors: string[];
  pdf?: { url: string; label: string };
  /** Shown under the authors when given. */
  tldr?: string | null;
  /** The mean review rating, on the venue's scale, at the row's right; nothing when null. */
  rating?: number | null;
  ratingCount?: number;
  /** Labelled as withdrawn from its venue. */
  withdrawn?: boolean;
  /** Accepted from the market edition's callers and never drawn: no prices in the safe for work edition. */
  market?: RowMarket | null;
  volumeMicro?: bigint | string | null;
  spark?: number[];
  href?: string;
  onPick?: () => void;
}) {
  const target = 'line-clamp-2 after:absolute after:inset-0 hover:no-underline';
  const name = <MathText text={title} />;
  return (
    // Safe for work edition: no market, so no likelihood edge, volume, sparkline or headline.
    <div className="relative grid grid-cols-[34px_1fr_auto] items-center gap-x-3.5 border-b border-dotted border-rule-strong py-2 hover:bg-highlight">
      <span className="font-sans text-xs">
        {pdf && (
          <a href={pdf.url} className="relative z-10 text-accent" rel="noopener noreferrer" target="_blank">
            [{pdf.label}]
          </a>
        )}
      </span>
      <span className="min-w-0 leading-[1.35]">
        {/* At most two lines; the whole title on hover. */}
        {onPick ? (
          <button type="button" className={`${target} cursor-pointer text-left`} title={title} onClick={onPick}>
            {name}
          </button>
        ) : (
          <Link href={href ?? '#'} className={target} title={title}>
            {name}
          </Link>
        )}
        {(withdrawn || authors.length > 0) && (
          <span className="block font-sans text-xs text-muted">
            {withdrawn && <span className="text-down">Withdrawn</span>}
            {withdrawn && authors.length > 0 && ' · '}
            {authorLine(authors)}
          </span>
        )}
        {tldr && (
          <span className="mt-0.5 block text-[13px] leading-snug text-muted">
            <MathText text={tldr} />
          </span>
        )}
      </span>
      <span className="font-mono text-[13px] text-muted">
        {rating != null && (
          <span title={`Mean rating over ${ratingCount === 1 ? 'one review' : `${ratingCount} reviews`}`}>
            {rating.toFixed(2)}
          </span>
        )}
      </span>
    </div>
  );
}

/** "A, B, C et al." — enough to recognise a paper by. */
export function authorLine(names: string[]): string {
  return names.length > 3 ? `${names.slice(0, 3).join(', ')} et al.` : names.join(', ');
}
