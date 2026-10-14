import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { Analytics } from '@/components/Analytics';
import { AuthNavLink } from '@/components/AuthLinks';
import { ConfirmBanner } from '@/components/ConfirmBanner';
import { HomeLink } from '@/components/HomeLink';
import { LogoMark } from '@/components/Logo';
import { NameBanner } from '@/components/NameBanner';
import { PendingGroupJoin } from '@/components/PendingGroupJoin';
import { viewerFromHeaders } from '@/server/auth';
import { currentVenue } from '@/server/current-venue';
import { siteName, siteUrl } from '@/server/share';
import { mapKinds, marketKinds } from '@/server/views';
import { VenueSwitcher } from '@/components/VenueSwitcher';
import { Wordmark } from '@/components/Wordmark';
import 'katex/dist/katex.min.css';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  return {
    // Absolute URLs for the link previews (issue #11).
    metadataBase: new URL(siteUrl()),
    title: 'acceptodds',
    description: 'Search, map and follow research papers: the safe for work edition of acceptodds.',
    applicationName: siteName(),
    openGraph: { siteName: siteName(), type: 'website' },
    twitter: { card: 'summary' },
    // Agents find the machine-readable docs from any page.
    alternates: { types: { 'application/json': '/api/v1/openapi.json' } },
  };
}

/**
 * Page analytics, when `UMAMI_URL` and `UMAMI_WEBSITE_ID` are both set: read
 * per request, so turning it on or off is an env change and a restart, not a
 * rebuild. Counts only on `APP_URL`'s host.
 */
function analytics(): { src: string; websiteId: string; domain: string } | null {
  const url = process.env.UMAMI_URL?.trim().replace(/\/+$/, '');
  const websiteId = process.env.UMAMI_WEBSITE_ID?.trim();
  if (!url || !websiteId) return null;
  return { src: `${url}/script.js`, websiteId, domain: new URL(siteUrl()).hostname };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const viewer = await viewerFromHeaders(await headers());
  const [kind, kinds, mapped] = await Promise.all([currentVenue(), marketKinds(), mapKinds()]);
  // Each venue has its own map, or none: no link to a map that is not there.
  const hasMap = mapped.includes(kind);
  const tracker = analytics();
  return (
    <html lang="en">
      <body>
        {/* On a phone, keep the mini distribution beside a menu containing every navigation link. */}
        <header className="flex flex-wrap items-baseline gap-x-4.5 gap-y-1.5 px-6 pt-4 pb-2.5 narrow:px-4">
          {/* The venue beside the logo, set like a journal's name and volume: it scopes the whole site —
              lists and the map. */}
          <span className="flex min-w-0 items-baseline gap-x-2">
            <HomeLink className="text-[22px]">
              <LogoMark />
              <span className="ml-2 narrow:hidden">
                <Wordmark />
              </span>
            </HomeLink>
            {/* Raised a little off the shared baseline: at 18px beside the 22px wordmark it otherwise reads low. */}
            <span className="relative -top-0.5 flex items-baseline gap-x-2">
              <span aria-hidden className="text-lg text-rule-strong">
                /
              </span>
              <VenueSwitcher current={kind} kinds={kinds.map((k) => k.kind)} />
            </span>
          </span>
          <span className="flex-1" />
          <nav
            aria-label="Main navigation"
            className="flex flex-wrap items-baseline gap-x-4.5 gap-y-1 text-sm narrow:gap-x-3.5"
          >
            {/* Safe for work edition: no leaderboard, portfolio or net worth. */}
            {hasMap && <Link href="/map">map</Link>}
            {/* For everyone: signed out, the page says what a group is. */}
            <Link href="/groups">groups</Link>
            {viewer ? <Link href="/profile">profile</Link> : <AuthNavLink />}
          </nav>
        </header>
        <ConfirmBanner signedIn={viewer !== null} />
        <PendingGroupJoin signedIn={viewer !== null} />
        {viewer && (
          <NameBanner
            needsName={viewer.needsName}
            displayName={viewer.account.displayName}
            handle={viewer.account.handle}
          />
        )}
        {children}
        {tracker && <Analytics {...tracker} />}
      </body>
    </html>
  );
}
