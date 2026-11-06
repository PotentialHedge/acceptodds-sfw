import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { PaperMapView } from '@/components/map/PaperMapView';
import { RememberVenue, VenueInUrl } from '@/components/RememberVenue';
import { viewerFromHeaders } from '@/server/auth';
import { currentVenue } from '@/server/current-venue';
import { siteName } from '@/server/share';
import { listingVenue, mapKinds, resolveListing } from '@/server/views';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || null;

/**
 * Whose map: `?kind=`, else the venue of `?paper=` (the paper page's minimap
 * links here by paper alone), else the navbar's (`currentVenue()`). Each
 * venue has its own map, or none.
 */
async function mapVenue(sp: Awaited<SearchParams>): Promise<string> {
  const named = first(sp.kind);
  if (named) return named;
  const paper = first(sp.paper);
  const listing = paper ? await resolveListing(paper).catch(() => null) : null;
  return (listing && (await listingVenue(listing))) ?? (await currentVenue());
}

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const kind = await mapVenue(await searchParams);
  const title = 'Map of papers | acceptodds';
  const description = `Every ${kind} paper on one map, placed near the papers most like it, coloured by topic.`;
  const url = `/map?${new URLSearchParams({ kind })}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: 'website', siteName: siteName() },
    twitter: { card: 'summary', title, description },
  };
}

/**
 * A venue's paper map, full screen under the navbar. Nothing but the map: it
 * is fetched by the client from `GET /api/v1/map?kind=` (tens of thousands of
 * points are too many to put in the HTML) and drawn in WebGL. `?paper=<slug>`
 * opens it on that paper, selected. A venue with no map has no page: it goes
 * to that venue's home page instead, which is also where the navbar's venue
 * switcher lands from here when the new venue has none.
 */
export default async function MapPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const kind = await mapVenue(sp);
  if (!(await mapKinds()).includes(kind)) redirect(`/?${new URLSearchParams({ kind })}`);
  // Only whether there is a viewer: the client then fetches their stars and holdings itself.
  const viewer = await viewerFromHeaders(await headers());
  return (
    <main>
      {/* The map is one venue's: make it the navbar's, and name it in the URL so a shared link opens it. */}
      <RememberVenue kind={kind} stale={kind !== (await currentVenue())} />
      <VenueInUrl kind={kind} />
      <PaperMapView key={kind} kind={kind} signedIn={viewer !== null} initialPaper={first(sp.paper)} />
    </main>
  );
}
