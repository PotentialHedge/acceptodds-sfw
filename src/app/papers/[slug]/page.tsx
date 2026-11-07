import { readingGroupIdsForListing, readingStatuses } from '@/server/reading';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { Citations } from '@/components/Citations';
import { RelatedPapers } from '@/components/RelatedPapers';
import { AddToReadingList, ReadEye } from '@/components/ReadingList';
import { groupsOf } from '@/server/groups';
import { FollowStar } from '@/components/FollowStar';
import { PaperDiscussion } from '@/components/PaperDiscussion';
import { PaperReviews } from '@/components/PaperReviews';
import { PAPER_COMMENT_PAGE } from '@/lib/discussion-page';
import { presentPaperComment } from '@/server/api/present';
import { listPaperComments } from '@/server/discussion';
import { reviewFactorFields, reviewField } from '@/server/review-field';
import { reviewsOf } from '@/server/reviews';
import { factorMeans, meanRating } from '@/lib/reviews';
import { CARD, cardPath } from '@/lib/preview-tags';
import { MathText } from '@/components/MathText';
import { RememberVenue } from '@/components/RememberVenue';
import { RunningHead } from '@/components/RunningHead';
import { PaperTopics } from '@/components/PaperTopics';
import { TitleBlock } from '@/components/TitleBlock';
import { ViewCount } from '@/components/ViewCount';
import { ui } from '@/components/ui';
import type { Listing } from '@/db/schema';
import { ApiError } from '@/server/api/errors';
import { viewerFromHeaders } from '@/server/auth';
import { currentVenue } from '@/server/current-venue';
import * as events from '@/server/events';
import { followedListingIds } from '@/server/follows';
import { runningHead } from '@/venues';
import { isOut, venueStatusLabel, venueStatusLine } from '@/lib/venue-status';
import { shareSubject, siteName, siteUrl } from '@/server/share';
import { listingCitations, listingRelatedTo, listingView, onMap, resolveListing } from '@/server/views';

export const dynamic = 'force-dynamic';

/**
 * The link preview: the title and the abstract, and a card showing where the
 * paper's rating sits (`card.png`). A crawler has no cookie, so it reads the
 * same preview from the gate (`app/gate/route.ts`).
 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const subject = await shareSubject(decodeURIComponent((await params).slug));
  if (!subject) return {};
  const description = subject.listing?.summary?.slice(0, 200) ?? subject.title;
  const image = subject.listing ? cardPath(subject.listing.slug) : undefined;
  return {
    title: `${subject.title.replace(/\$/g, '')} | ${siteName()}`,
    description,
    alternates: { canonical: subject.path },
    openGraph: {
      title: subject.title,
      description,
      url: subject.path,
      type: 'article',
      siteName: siteName(),
      ...(image ? { images: [{ url: image, ...CARD }] } : {}),
    },
    twitter: { card: image ? 'summary_large_image' : 'summary', title: subject.title, description, images: image },
  };
}

/** schema.org description of the paper itself: only what `../research` supplied, no prices. */
function paperJsonLd(l: Listing) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ScholarlyArticle',
    name: l.title,
    url: `${siteUrl()}/papers/${encodeURIComponent(l.slug)}`,
    ...(l.summary ? { abstract: l.summary } : {}),
    ...(l.authors.length > 0 ? { author: l.authors.map((name) => ({ '@type': 'Person', name })) } : {}),
    ...(l.keywords.length > 0 ? { keywords: l.keywords.join(', ') } : {}),
    ...(l.primaryArea ? { about: l.primaryArea } : {}),
    sameAs: l.links.map((x) => x.url),
  };
}

/**
 * A listing's page. The platform calls it a listing and knows nothing about
 * what it is; the UI calls it a paper, because that is what `../research`
 * lists. Title, names, links and summary are shown as the client supplied
 * them. Safe for work edition: no markets below them, only its reviews, the
 * related papers (with the minimap) and the citations.
 */
export default async function PaperPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let listing;
  try {
    listing = await resolveListing(decodeURIComponent(slug));
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
  // The minimap itself is the browser's to fetch, once it scrolls into view: here only whether there is one.
  const [{ markets, followers }, citations, related, mapped, reviews] = await Promise.all([
    listingView(listing),
    listingCitations(listing),
    listingRelatedTo(listing),
    onMap(listing),
    reviewsOf(listing.id),
  ]);
  const reviewStanding = await reviewField(
    listing.kind,
    meanRating(reviews.flatMap((r) => (r.kind === 'review' ? [r.rating] : []))),
  );
  const reviewFactors = await reviewFactorFields(listing.kind, factorMeans(reviews.filter((r) => r.kind === 'review')));

  const viewer = await viewerFromHeaders(await headers());
  const following = viewer ? (await followedListingIds(viewer.account.id)).has(listing.id) : false;
  const [myReadingGroups, alreadyListed] = viewer
    ? await Promise.all([groupsOf(viewer.account.id), readingGroupIdsForListing(viewer.account.id, listing.id)])
    : [[], new Set<string>()];
  const [[readStatus], discussion] = await Promise.all([
    readingStatuses([listing.id], viewer?.account.id ?? null),
    listPaperComments(listing.id, { limit: PAPER_COMMENT_PAGE, viewerAccountId: viewer?.account.id ?? null }),
  ]);
  const main = markets[0];
  const venueOf = listing.kind ?? main?.market.kind ?? null;
  events.log('listing.read', { accountId: viewer?.account.id ?? null });
  const relatedPapers = (
    <RelatedPapers
      related={related}
      minimapOf={mapped ? listing.slug : null}
      figure={reviewStanding ? 2 : 1}
      unlock={null}
      venue={listing.kind}
    />
  );

  return (
    <main className={ui.page}>
      <script
        type="application/ld+json"
        // `<` escaped so a title can never close the tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(paperJsonLd(listing)).replace(/</g, '\\u003c') }}
      />
      {/* The paper's venue becomes the navbar's. */}
      {venueOf && <RememberVenue kind={venueOf} stale={venueOf !== (await currentVenue())} />}
      {listing.kind && (
        <RunningHead>
          {listing.venueStatus ? venueStatusLine(listing.venueStatus, listing.kind) : runningHead(listing.kind)}
        </RunningHead>
      )}
      <TitleBlock
        title={<MathText text={listing.title} />}
        byline={listing.authors.length > 0 ? listing.authors.join(', ') : null}
        abstract={listing.summary}
        abstractMath
        afterAbstract={<PaperTopics area={listing.primaryArea} keywords={listing.keywords} kind={listing.kind} />}
      >
        {listing.venueStatus && isOut(listing.venueStatus) && (
          <p className="mb-2 font-sans text-[13px] text-down">
            {listing.kind ? venueStatusLine(listing.venueStatus, listing.kind) : venueStatusLabel(listing.venueStatus)},
            so left out of the paper lists and the map.
          </p>
        )}
        {listing.links.length > 0 && (
          <div className="mt-1.5 flex flex-wrap justify-center gap-x-3 font-sans text-[13px]">
            {listing.links.map((l) => (
              <a key={l.url} href={l.url} className="text-accent" rel="noopener noreferrer" target="_blank">
                [{l.label}]
              </a>
            ))}
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center justify-center gap-4">
          <ViewCount listingId={listing.id} views={listing.viewCount} />
          {viewer && (
            <>
              <FollowStar
                listingId={listing.id}
                following={following}
                followers={followers}
                showCount
                className="text-[15px]"
              />
              <ReadEye key={`read:${listing.id}`} status={readStatus} showReaders={false} signedIn={viewer !== null} />
              <AddToReadingList
                key={listing.id}
                listingId={listing.id}
                signedIn={viewer !== null}
                groups={myReadingGroups.map(({ group }) => ({
                  id: group.id,
                  name: group.name,
                  added: alreadyListed.has(group.id),
                }))}
              />
            </>
          )}
        </div>
      </TitleBlock>

      <PaperReviews
        items={reviews}
        field={reviewStanding}
        factors={reviewFactors}
        sourceUrl={listing.links.find((l) => l.url.includes('openreview.net/forum'))?.url ?? null}
        figure={1}
        slug={listing.slug}
      />

      {relatedPapers}

      <PaperDiscussion
        listingId={listing.id}
        initial={{
          comments: discussion.comments.map(presentPaperComment),
          replies: discussion.replies.map(presentPaperComment),
          nextCursor: discussion.nextCursor,
          total: discussion.total,
          viewerAlias: discussion.viewerAlias,
        }}
        viewer={{
          signedIn: viewer !== null,
          canComment: viewer !== null && (viewer.account.isBot || viewer.account.verifiedAt !== null),
        }}
      />

      <Citations citations={citations} />

      <footer className="mt-12 border-t border-rule pt-3 text-center font-sans text-[13px] text-muted">
        <a
          href={reportHref(listing.title, `${siteUrl()}/papers/${encodeURIComponent(listing.slug)}`)}
          className="text-muted underline"
        >
          Report a problem with this page
        </a>
      </footer>
    </main>
  );
}

/** Where problem reports go. */
const REPORT_EMAIL = 'office@acceptodds.com';

/** A mailto: link: "[Issue] <title, cut>" as the subject, the paper's link in the body. */
function reportHref(title: string, url: string): string {
  const short = title.length > 60 ? `${title.slice(0, 59).trimEnd()}…` : title;
  const body = `${title}\n${url}\n\nWhat's the problem?\n`;
  return `mailto:${REPORT_EMAIL}?subject=${encodeURIComponent(`[Issue] ${short}`)}&body=${encodeURIComponent(body)}`;
}
