import { Markdown } from '@/components/Markdown';
import { MathText } from '@/components/MathText';
import { Permalink } from '@/components/Permalink';
import { ReviewCollapsed } from '@/components/ReviewCollapsed';
import { ReviewComments } from '@/components/ReviewComments';
import { ReviewFigure } from '@/components/ReviewStanding';
import { ui } from '@/components/ui';
import type { ListingReview } from '@/db/schema';
import { day } from '@/lib/format';
import { reviewMath } from '@/lib/review-math';
import { meanRating, OVERALL, reviewAnchor, reviewCommentAnchor, scoreMove, threadReviews } from '@/lib/reviews';
import type { ReviewField, ReviewSeries } from '@/server/review-field';

/**
 * What a paper's reviewers and commenters wrote at its venue, and where its
 * mean rating sits there. Attribution is shown because it is owed: reviews are
 * licensed writing, by default CC BY 4.0. The scores show at once and the
 * writing is a click away, since a paper's reviews can run to pages. `figure` is the number of the
 * distribution, drawn only when there is a `field`.
 */
export function PaperReviews({
  items,
  field,
  factors,
  sourceUrl,
  figure,
  slug,
}: {
  items: ListingReview[];
  field: ReviewField | null;
  /** The paper's other scores, for the distribution to switch to. */
  factors: ReviewSeries[];
  sourceUrl: string | null;
  figure: number;
  /** The paper's slug, to fetch its nearest and related papers' scores with. */
  slug: string;
}) {
  if (items.length === 0) return null;
  const { reviews, loose } = threadReviews(items);
  const mean = meanRating(reviews.map((r) => r.review.rating));
  const rated = reviews.filter((r) => r.review.rating !== null).length;
  const licenses = [...new Set(items.flatMap((x) => (x.license ? [x.license] : [])))];
  return (
    <section>
      <h3 className={ui.groupHeading}>Reviews</h3>
      {field && mean !== null && (
        <ReviewFigure
          figure={figure}
          slug={slug}
          series={[{ label: OVERALL, mean, count: rated, field }, ...factors]}
        />
      )}
      {reviews.map(({ review, comments }) => (
        <article
          key={review.externalId}
          id={reviewAnchor(review.externalId)}
          className="mt-5 scroll-mt-4 border-t border-rule pt-3"
        >
          <Heading item={review} anchor={reviewAnchor(review.externalId)} source={sourceUrl} />
          <Scores item={review} />
          <ReviewCollapsed anchor={reviewAnchor(review.externalId)} summary="Read review">
            <Sections item={review} />
          </ReviewCollapsed>
          <Comments comments={comments} source={sourceUrl} on="review" />
        </article>
      ))}
      {loose.length > 0 && (
        <div className="mt-5 border-t border-rule pt-3">
          <h4 className={ui.runIn}>Comments on the paper</h4>
          <Comments comments={loose} source={sourceUrl} on="paper" />
        </div>
      )}
      <p className={ui.fine}>
        {sourceUrl ? (
          <a href={sourceUrl} className="underline" rel="noopener noreferrer" target="_blank">
            From OpenReview
          </a>
        ) : (
          'From the venue'
        )}
        {licenses.length > 0 && `, ${licenses.join(', ')}`}. Authors as signed there; shown unedited.
      </p>
    </section>
  );
}

/**
 * Who wrote it and when; the date (or "link", undated) is the item's permalink, `#anchor`, copied on click. Beside it, the item
 * itself on OpenReview, when the paper's forum there is known.
 */
function Heading({ item, anchor, source }: { item: ListingReview; anchor: string; source: string | null }) {
  const venue = source ? noteUrl(source, item.externalId) : null;
  return (
    <header className="flex flex-wrap items-baseline justify-between gap-x-3">
      <span className={ui.runIn}>{item.author ?? 'Anonymous'}</span>
      <span className="flex gap-3 font-sans text-xs text-muted">
        {venue && (
          <a href={venue} className="hover:text-accent hover:underline" rel="noopener noreferrer" target="_blank">
            OpenReview ↗
          </a>
        )}
        <Permalink anchor={anchor} kind={item.kind}>
          {item.postedAt ? <time>{day(item.postedAt)}</time> : 'link'}
        </Permalink>
      </span>
    </header>
  );
}

/** A note on its OpenReview forum page (`forum?id=…&noteId=…`), or `null` when `forum` is not one. */
function noteUrl(forum: string, noteId: string): string | null {
  try {
    const url = new URL(forum);
    if (url.hostname !== 'openreview.net' || url.pathname !== '/forum' || !url.searchParams.has('id')) return null;
    url.searchParams.set('noteId', noteId);
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * A review's scores, each with how far the reviewer has moved it since posting, `(+1)`, explained on hover.
 * Confidence is how sure the reviewer is, not a verdict on the paper, so its move is not coloured.
 */
function Scores({ item }: { item: ListingReview }) {
  const scores = [...(item.rating === null ? [] : [{ label: 'Rating', value: item.rating }]), ...item.scores];
  if (scores.length === 0) return null;
  const changes = new Map(item.scoreChanges.map((c) => [c.label, c]));
  return (
    <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 font-sans text-[13px]">
      {scores.map((s) => {
        const change = changes.get(s.label);
        const move = change ? scoreMove(s.label, s.value, change) : null;
        const tone = !move || s.label === 'Confidence' ? 'text-muted' : move.delta > 0 ? 'text-up' : 'text-down';
        return (
          <div key={s.label} className="flex gap-1">
            <dt className="text-muted">{s.label}</dt>
            <dd className="font-mono">
              {s.value}
              {move && (
                <span className={`ml-1 cursor-help ${tone}`} title={move.title}>
                  {move.mark}
                </span>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function Sections({ item }: { item: ListingReview }) {
  return (
    <>
      {item.sections.map((s, i) => (
        <div key={i} className="mt-2 text-[15px]">
          {s.label && <h5 className="font-sans text-[13px] font-semibold text-subtle">{s.label}</h5>}
          <Markdown>{reviewMath(s.text)}</Markdown>
        </div>
      ))}
    </>
  );
}

function Comments({
  comments,
  source,
  on,
}: {
  comments: ListingReview[];
  source: string | null;
  on: 'review' | 'paper';
}) {
  if (comments.length === 0) return null;
  return (
    <ReviewComments
      on={on}
      ids={comments.map((c) => c.externalId)}
      items={comments.map((c) => (
        <CommentItem key={c.externalId} item={c} source={source} />
      ))}
    />
  );
}

/**
 * One comment as a card of its own, headed on a tinted strip, so a long
 * exchange reads as separate turns. The one a link points at is outlined (`:target`, or `data-linked` from `ReviewComments`).
 */
function CommentItem({ item, source }: { item: ListingReview; source: string | null }) {
  const anchor = reviewCommentAnchor(item.externalId);
  return (
    <div
      id={anchor}
      className="mt-3 scroll-mt-4 border border-rule bg-card target:border-accent target:ring-1 target:ring-accent data-linked:border-accent data-linked:ring-1 data-linked:ring-accent"
    >
      <div className="border-b border-rule-soft bg-highlight px-3 py-1.5">
        <Heading item={item} anchor={anchor} source={source} />
        {item.title && (
          <p className="mt-0.5 text-[15px] font-semibold">
            <MathText text={item.title} />
          </p>
        )}
      </div>
      <div className="px-3 pb-2.5">
        <Sections item={item} />
      </div>
    </div>
  );
}
