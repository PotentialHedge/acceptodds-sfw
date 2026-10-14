import Link from 'next/link';
import { headers } from 'next/headers';
import { NewGroupButton } from '@/components/Groups';
import { TitleBlock } from '@/components/TitleBlock';
import { ui } from '@/components/ui';
import { groupPath } from '@/lib/links';
import { authHref } from '@/lib/return-to';
import { viewerFromHeaders } from '@/server/auth';
import { groupsOf } from '@/server/groups';

export const dynamic = 'force-dynamic';

/**
 * The navbar's "groups", for everyone: the viewer's reading groups and a
 * way to make one, or, signed out, what a reading group is and a way in.
 * A group itself is `/groups/<id>`; joining is by its invite link.
 */
export default async function GroupsPage() {
  const viewer = await viewerFromHeaders(await headers());
  const mine = viewer ? await groupsOf(viewer.account.id) : [];
  return (
    <main className={ui.page}>
      <TitleBlock
        title="Reading groups"
        abstract="A reading group is a shared reading list: everyone in it can add papers, remove them and mark what they have read. Make one and send its invite link to the people you read with."
      />
      {viewer ? (
        <>
          {mine.length === 0 ? (
            <div className={ui.empty}>You are not in any reading group yet.</div>
          ) : (
            <table className={ui.table}>
              <caption className={ui.tableCaption}>
                <b>Table 1.</b> Your reading groups.
              </caption>
              <thead>
                <tr>
                  <th className={ui.th()}>Group</th>
                  <th className={ui.th(true)}>Members</th>
                </tr>
              </thead>
              <tbody>
                {mine.map(({ group, memberCount }) => (
                  <tr key={group.id}>
                    <td className={ui.td}>
                      <Link href={groupPath(group.id)}>{group.name}</Link>
                    </td>
                    <td className={`${ui.td} ${ui.num}`}>{memberCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="mt-3 font-sans text-sm">
            <NewGroupButton className={ui.linkBtn} label="+ Create reading group" />
          </div>
        </>
      ) : (
        <p className="text-center font-sans text-sm">
          <Link href={authHref('/signin', '/groups')}>Sign in</Link> to make a reading group or see yours.
        </p>
      )}
    </main>
  );
}
