import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { Authors } from '@/components/Authors';
import { JoinGroupButton, SignInToJoin } from '@/components/Groups';
import { TitleBlock } from '@/components/TitleBlock';
import { ui } from '@/components/ui';
import { groupPath } from '@/lib/links';
import { viewerFromHeaders } from '@/server/auth';
import { groupByInviteCode, groupMembersOf, roleIn } from '@/server/groups';

export const dynamic = 'force-dynamic';

// The code is the invitation: keep it out of search engines and referrers.
export const metadata: Metadata = { title: 'Join a reading group', robots: { index: false }, referrer: 'no-referrer' };

/**
 * A group's invite link (#25, `lib/links.groupInvitePath`): the group as its
 * board opens, and a button to join. Joining is a POST from that button,
 * never this GET, so following a link joins nothing by itself. A signed-out
 * visitor's button remembers the invite, and they join once signed in or
 * signed up (`components/PendingGroupJoin`).
 */
export default async function JoinGroupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams).code;
  const code = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? '';
  const group = code && code.length <= 64 ? await groupByInviteCode(code) : null;
  const viewer = await viewerFromHeaders(await headers());

  if (!group) {
    return (
      <main className={ui.page}>
        <TitleBlock title="Invite link not valid" />
        <p className="text-center">
          This link does not open any reading group. Its admin may have replaced it with a new one: ask them for the
          current link. <Link href="/">See the papers</Link>.
        </p>
      </main>
    );
  }

  const [members, role] = await Promise.all([groupMembersOf(group.id), roleIn(group, viewer?.account.id ?? null)]);
  return (
    <main className={ui.page}>
      <TitleBlock
        above="You are invited to join the reading group"
        title={group.name}
        byline={
          <Authors
            authors={members.map((m) => ({
              name: m.displayName,
              isBot: m.isBot,
              affiliations: m.institutions,
            }))}
          />
        }
        abstract={group.description}
      >
        <div className="mt-4 flex flex-col items-center font-sans text-sm">
          {role ? (
            <p>
              You are in this reading group. <Link href={groupPath(group.id)}>See its reading list →</Link>
            </p>
          ) : viewer ? (
            <>
              <p className="mb-1 text-muted">
                Everyone can add papers to its shared reading list and mark what they have read.
              </p>
              <JoinGroupButton code={code} groupId={group.id} />
            </>
          ) : (
            <SignInToJoin code={code} />
          )}
        </div>
      </TitleBlock>
    </main>
  );
}
