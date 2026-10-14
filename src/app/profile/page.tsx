import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { EditName } from '@/components/EditName';
import { FollowStar } from '@/components/FollowStar';
import { MathText } from '@/components/MathText';
import { SignOut } from '@/components/SignOut';
import { TraderHeader } from '@/components/TraderHeader';
import { ui } from '@/components/ui';
import { viewerFromHeaders } from '@/server/auth';
import * as events from '@/server/events';
import { followedListings } from '@/server/follows';
import { presentAffiliation, presentToken } from '@/server/api/present';
import { listAffiliations } from '@/server/affiliations';
import { listTokens } from '@/server/tokens';
import { ApiKeys } from './ApiKeys';
import { Affiliations } from './Affiliations';

export const dynamic = 'force-dynamic';

/** The signed-in viewer's own account. Read-only; signing out goes through Better Auth's client. */
export default async function ProfilePage() {
  const viewer = await viewerFromHeaders(await headers());
  if (!viewer) redirect('/signin?next=/profile');
  const a = viewer.account;
  const follows = await followedListings(a.id);
  const affiliations = (await listAffiliations(a.id)).map(presentAffiliation);
  const apiKeys = a.userId ? (await listTokens(a.userId)).map(presentToken) : [];
  // Tables are numbered by hand in page order: affiliations (not for bots), follows (when any), then API keys.
  const followsTable = 1 + (a.isBot ? 0 : 1);
  const keysTable = followsTable + (follows.length > 0 ? 1 : 0);
  events.log('me.read', { accountId: a.id });

  return (
    <main className={`${ui.page} max-w-[560px]`}>
      <TraderHeader account={a} email={viewer.email} admin={viewer.isAdmin} />

      <div className="mt-3 flex items-center justify-center gap-4.5 font-sans text-sm">
        <EditName displayName={a.displayName} handle={a.handle} />
      </div>

      {!a.isBot && (
        <section id="affiliations">
          <h2 className={ui.groupHeading}>Affiliations</h2>
          <p className="mt-1 mb-2 text-[15px] text-subtle">
            The institutional email addresses that verify you. A confirmed address&apos;s institution appears next to
            your name.
          </p>
          <Affiliations initial={affiliations} n={1} />
        </section>
      )}

      <section>
        <h2 className={ui.groupHeading}>Following</h2>
        <p className="mt-1 mb-2 text-[15px] text-subtle">
          Papers you have starred, so you can find them again. They also shape your recommendations.
        </p>
        {follows.length === 0 && (
          <div className="py-2 text-[15px] text-muted italic">
            Star a paper to follow it: <span className="not-italic">☆</span> on its page or in the list.
          </div>
        )}
        {follows.length > 0 && (
          <>
            <table className={ui.table}>
              <caption className={ui.tableCaption}>
                <b>Table {followsTable}.</b> Papers you follow, most recently followed first.
              </caption>
              <thead>
                <tr>
                  <th className={ui.th()} />
                  <th className={ui.th()}>Paper</th>
                </tr>
              </thead>
              <tbody>
                {follows.map((f) => {
                  return (
                    <tr key={f.view.listing.id} className="align-baseline">
                      <td className={`${ui.td} w-[18px]`}>
                        <FollowStar listingId={f.view.listing.id} following />
                      </td>
                      <td className={ui.td}>
                        <Link
                          href={`/papers/${encodeURIComponent(f.view.listing.slug)}`}
                          className="line-clamp-2 leading-[1.35]"
                          title={f.view.listing.title}
                        >
                          <MathText text={f.view.listing.title} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
        {follows.length > 0 && (
          <div className="mt-2 font-sans text-sm">
            <Link href="/?following=1&kind=all">followed papers on the home page →</Link>
          </div>
        )}
      </section>

      <section id="api-keys">
        <h2 className={ui.groupHeading}>API keys</h2>
        <p className="mt-1 mb-2 text-[15px] text-subtle">
          For a script that reads as you. Send the key as <code className={ui.mono}>Authorization: Bearer</code>; the
          endpoints are in the{' '}
          <Link className="underline" href="/docs">
            API reference
          </Link>
          .
        </p>
        <ApiKeys initial={apiKeys} n={keysTable} canTrade={a.isBot || a.verifiedAt !== null} />
      </section>

      <hr className="my-10 border-rule-soft" />
      <div className="flex justify-end gap-2">
        <SignOut className={ui.btn({ ghost: true, inline: true, flush: true })} />
      </div>
    </main>
  );
}
