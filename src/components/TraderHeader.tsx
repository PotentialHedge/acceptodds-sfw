import type { ReactNode } from 'react';
import type { Account } from '@/db/schema';
import { day } from '@/lib/format';
import { TitleBlock } from './TitleBlock';
import { ui } from './ui';

/**
 * A trader's name set as a paper's title block (`TitleBlock`): the name as
 * the title, then an author line (`@handle, Institution; Institution`, one
 * per confirmed affiliation, as a paper lists them) and a one-paragraph
 * abstract of who they are. `/profile` and `/people/<handle>` both open with
 * it; only the profile passes `email` and `admin`, which are not public.
 * `children` go between the author line and the abstract.
 */
export function TraderHeader({
  account: a,
  email,
  admin = false,
  children,
}: {
  account: Pick<Account, 'displayName' | 'handle' | 'isBot' | 'institutions' | 'createdAt' | 'verifiedAt'>;
  email?: string;
  admin?: boolean;
  children?: ReactNode;
}) {
  return (
    <TitleBlock
      title={
        <>
          {a.displayName}
          {a.isBot && <span className={ui.badge}>bot</span>}
        </>
      }
      byline={
        <>
          @{a.handle}
          {a.institutions.map((name, i) => (
            <span key={name}>
              {i === 0 ? ', ' : '; '}
              <i>{name}</i>
            </span>
          ))}
        </>
      }
      abstract={abstract(a, admin)}
    >
      {email && <div className="mt-1 font-mono text-[13px] text-subtle">{email}</div>}
      {children}
    </TitleBlock>
  );
}

/** Who the trader is, in a sentence or two, from the account row alone. */
function abstract(a: Parameters<typeof TraderHeader>[0]['account'], admin: boolean): string {
  const at = a.institutions.length ? ` of ${andList(a.institutions)}` : '';
  const parts = [
    a.isBot
      ? `${a.displayName} is a bot, here since ${day(a.createdAt)}.`
      : `${a.displayName} is a member ${at}, here since ${day(a.createdAt)}.`,
  ];
  // Bots trade without verification, so it says nothing about them.
  if (!a.isBot) {
    parts.push(a.verifiedAt ? `Verified by institutional email on ${day(a.verifiedAt)}.` : 'Not yet verified.');
  }
  if (admin) parts.push('Also an administrator.');
  return parts.join(' ');
}

/** "A", "A and B", "A, B and C". */
function andList(items: readonly string[]): string {
  return items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
