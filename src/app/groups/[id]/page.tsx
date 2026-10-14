import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { Authors } from '@/components/Authors';
import { GroupActions, NewGroupButton } from '@/components/Groups';
import { ReadingListTable } from '@/components/ReadingList';
import { TitleBlock } from '@/components/TitleBlock';
import { ui } from '@/components/ui';
import { viewerFromHeaders } from '@/server/auth';
import { groupById, groupMembersOf, roleIn } from '@/server/groups';
import { readingList } from '@/server/reading';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A reading group (#25), in the safe for work edition: the market edition
 * set it on the leaderboard (`/leaderboard?group=`), which is not here, so
 * it has a page of its own. Its name as the title, its members as the
 * author line, the description as the abstract, then its reading list.
 */
export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const group = UUID.test(id) ? await groupById(id) : null;
  if (!group) notFound();
  const viewer = await viewerFromHeaders(await headers());
  const [members, role, reading] = await Promise.all([
    groupMembersOf(group.id),
    roleIn(group, viewer?.account.id ?? null),
    readingList(group.id, viewer?.account.id ?? null),
  ]);
  return (
    <main className={ui.page}>
      <TitleBlock
        above="Reading group"
        title={group.name}
        byline={
          <Authors
            authors={members.map((m) => ({ name: m.displayName, isBot: m.isBot, affiliations: m.institutions }))}
          />
        }
        abstract={group.description}
      >
        {role && viewer && (
          <GroupActions
            group={{ id: group.id, name: group.name, description: group.description, inviteCode: group.inviteCode }}
            role={role}
            viewerHandle={viewer.account.handle}
            members={members.map((m) => ({
              handle: m.handle,
              displayName: m.displayName,
              role: m.accountId === group.adminAccountId ? 'admin' : 'member',
            }))}
          />
        )}
      </TitleBlock>
      {viewer && (
        <div className="mt-2 flex justify-end font-sans text-[13px]">
          <NewGroupButton className={ui.linkBtn} label="+ Create another reading group" />
        </div>
      )}
      <ReadingListTable
        groupId={group.id}
        initial={reading}
        canEdit={role !== null}
        signedIn={viewer !== null}
        tableNumber={1}
      />
    </main>
  );
}
