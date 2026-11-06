import { Markdown } from '@/components/Markdown';
import { ReviewStanding } from '@/components/ReviewStanding';
import { ui } from '@/components/ui';
import type { ListingReview } from '@/db/schema';
import { day } from '@/lib/format';
import { meanRating, threadReviews } from '@/lib/reviews';
import type { ReviewField } from '@/server/review-field';

/**
 * What a paper's reviewers and commenters wrote at its venue, and where its
 * mean rating sits there. Attribution is shown because it is owed: reviews are
 * licensed writing, by default CC BY 4.0. `figure` is the number of the
 * distribution, drawn only when there is a `field`.
 */
export function PaperReviews({
  items,
  field,
  sourceUrl,
  figure,
}: {
  items: ListingReview[];
  field: ReviewField | null;
  sourceUrl: string | null;
  figure: number;
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
        <figure className="my-3">
          <ReviewStanding field={field} mean={mean} />
          <figcaption className={ui.caption}>
            <b>Figure {figure}.</b> Mean review rating of the reviewed papers at {field.kind}. This paper averages{' '}
            <span className="font-mono">{mean.toFixed(2)}</span> over {rated === 1 ? 'one review' : `${rated} reviews`}
            {field.ahead !== null && <>, above {field.ahead}% of the others</>}.
          </figcaption>
        </figure>
      )}
      {reviews.map(({ review, comments }) => (
        <article key={review.externalId} className="mt-5 border-t border-rule pt-3">
          <Heading item={review} />
          <Scores item={review} />
          <Sections item={review} />
          <Comments comments={comments} />
        </article>
      ))}
      {loose.length > 0 && (
        <div className="mt-5 border-t border-rule pt-3">
          <h4 className={ui.runIn}>Comments on the paper</h4>
          {loose.map((c) => (
            <CommentItem key={c.externalId} item={c} />
          ))}
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

function Heading({ item }: { item: ListingReview }) {
  return (
    <header className="flex flex-wrap items-baseline justify-between gap-x-3">
      <span className={ui.runIn}>{item.author ?? 'Anonymous'}</span>
      {item.postedAt && <time className="font-sans text-xs text-muted">{day(item.postedAt)}</time>}
    </header>
  );
}

function Scores({ item }: { item: ListingReview }) {
  const scores = [...(item.rating === null ? [] : [{ label: 'Rating', value: item.rating }]), ...item.scores];
  if (scores.length === 0) return null;
  return (
    <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 font-sans text-[13px]">
      {scores.map((s) => (
        <div key={s.label} className="flex gap-1">
          <dt className="text-muted">{s.label}</dt>
          <dd className="font-mono">{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Sections({ item }: { item: ListingReview }) {
  return (
    <>
      {item.sections.map((s, i) => (
        <div key={i} className="mt-2 text-[15px]">
          {s.label && <h5 className="font-sans text-[13px] font-semibold text-subtle">{s.label}</h5>}
          <Markdown>{s.text}</Markdown>
        </div>
      ))}
    </>
  );
}

function Comments({ comments }: { comments: ListingReview[] }) {
  if (comments.length === 0) return null;
  return (
    <details className="mt-3">
      <summary className="cursor-pointer font-sans text-[13px] text-accent">
        {comments.length === 1 ? '1 comment' : `${comments.length} comments`}
      </summary>
      {comments.map((c) => (
        <CommentItem key={c.externalId} item={c} />
      ))}
    </details>
  );
}

function CommentItem({ item }: { item: ListingReview }) {
  return (
    <div className="mt-3 border-l-2 border-rule pl-3">
      <Heading item={item} />
      {item.title && <p className="mt-0.5 text-[15px] font-semibold">{item.title}</p>}
      <Sections item={item} />
    </div>
  );
}
