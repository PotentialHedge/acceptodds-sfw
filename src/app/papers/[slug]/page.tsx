import { readingGroupIdsForListing, readingStatuses } from '@/server/reading';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { Citations } from '@/components/Citations';
import { RelatedPapers } from '@/components/RelatedPapers';
import { AddToReadingList, ReadEye } from '@/components/ReadingList';
import { groupsOf } from '@/server/groups';
import { FollowStar } from '@/components/FollowStar';
import { MathText } from '@/components/MathText';
import { RememberVenue } from '@/components/RememberVenue';
import { RunningHead } from '@/components/RunningHead';
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
import { shareSubject, siteName, siteUrl } from '@/server/share';
import { listingCitations, listingRelatedTo, listingView, onMap, resolveListing } from '@/server/views';

export const dynamic = 'force-dynamic';

/**
 * The link preview's text (issue #11 §1): the title as a question and no
 * numbers — the image shows which way it leans, the page how far. The image
 * is `opengraph-image.tsx`, which Next adds by itself.
 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const subject = await shareSubject(decodeURIComponent((await params).slug));
  if (!subject) return {};
  const description = subject.listing?.summary?.slice(0, 200) ?? subject.title;
  return {
    title: `${subject.title.replace(/\$/g, '')} | ${siteName()}`,
    description,
    alternates: { canonical: subject.path },
    openGraph: { title: subject.title, description, url: subject.path, type: 'article', siteName: siteName() },
    twitter: { card: 'summary', title: subject.title, description },
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
 * them. Safe for work edition: no markets below them, only the related
 * papers (with the minimap) and the citations.
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
  const [{ markets, followers }, citations, related, mapped] = await Promise.all([
    listingView(listing),
    listingCitations(listing),
    listingRelatedTo(listing),
    onMap(listing),
  ]);

  const viewer = await viewerFromHeaders(await headers());
  const following = viewer ? (await followedListingIds(viewer.account.id)).has(listing.id) : false;
  const [myReadingGroups, alreadyListed] = viewer
    ? await Promise.all([groupsOf(viewer.account.id), readingGroupIdsForListing(viewer.account.id, listing.id)])
    : [[], new Set<string>()];
  const [readStatus] = await readingStatuses([listing.id], viewer?.account.id ?? null);
  const main = markets[0];
  const venueOf = listing.kind ?? main?.market.kind ?? null;
  events.log('listing.read', { accountId: viewer?.account.id ?? null });
  const relatedPapers = (
    <RelatedPapers
      related={related}
      minimapOf={mapped ? listing.slug : null}
      figure={1}
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
      {listing.kind && <RunningHead>{runningHead(listing.kind)}</RunningHead>}
      <TitleBlock
        title={<MathText text={listing.title} />}
        byline={listing.authors.length > 0 ? listing.authors.join(', ') : null}
        abstract={listing.summary}
        abstractMath
      >
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

      {relatedPapers}

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
