'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import type { z } from 'zod';
import type * as S from '@/server/api/schemas';
import { Confirm, NewGroupButton } from './Groups';
import { ReadingGlassesIcon, TrashIcon } from './icons';
import { MathText } from './MathText';
import { Modal, ModalContent, ModalTrigger } from './Modal';
import { Popover, PopoverContent, PopoverTrigger } from './Popover';
import { TableNotes } from './TableNotes';
import { ui } from './ui';

type Status = z.output<typeof S.ReadingStatus>;
type List = z.output<typeof S.ReadingList>;

async function write(path: string, method: 'PUT' | 'DELETE') {
  const res = await fetch(`/api/v1${path}`, { method });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? 'Could not update the reading list. Try again.');
  }
}

/** No groups: reuse creation; one: add immediately; several: choose a group. */
export function AddToReadingList({
  listingId,
  signedIn,
  groups,
}: {
  listingId: string;
  signedIn: boolean;
  groups: { id: string; name: string; added: boolean }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string } | null>(null);
  const [changes, setChanges] = useState<Record<string, boolean>>({});
  const alreadyAdded = (g: (typeof groups)[number]) => changes[g.id] ?? g.added;
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 2_000);
    return () => clearTimeout(timer);
  }, [notice]);
  const [error, setError] = useState<string | null>(null);
  async function add(group: (typeof groups)[number]) {
    if (busy || alreadyAdded(group)) return;
    setBusy(true);
    setError(null);
    try {
      await write(`/groups/${group.id}/reading-list/${listingId}`, 'PUT');
      setChanges((current) => ({ ...current, [group.id]: true }));
      setNotice({ text: groups.length === 1 ? 'Paper added to reading list!' : `Added to ${group.name}.` });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  async function remove(group: (typeof groups)[number]) {
    await write(`/groups/${group.id}/reading-list/${listingId}`, 'DELETE');
    setChanges((current) => ({ ...current, [group.id]: false }));
    setNotice({ text: groups.length === 1 ? 'Paper removed from reading list.' : `Removed from ${group.name}.` });
    router.refresh();
  }
  function removeButton(group: (typeof groups)[number]) {
    return (
      <Confirm
        trigger="Remove from reading list"
        title="Remove paper from reading list?"
        yes="Remove paper"
        action={() => remove(group)}
      >
        Remove this paper from {group.name}’s reading list?
      </Confirm>
    );
  }
  if (!signedIn) return null;
  if (groups.length === 0) {
    return (
      <span className="font-sans text-[13px]">
        <NewGroupButton addListingId={listingId} label="+ Reading list" />
      </span>
    );
  }
  return (
    <span className="font-sans text-[13px]">
      {groups.length === 1 ? (
        notice ? (
          <span role="status" className="text-muted">
            {notice.text}
          </span>
        ) : alreadyAdded(groups[0]) ? (
          removeButton(groups[0])
        ) : (
          <button className={ui.linkBtn} disabled={busy} onClick={() => add(groups[0])}>
            + Reading list
          </button>
        )
      ) : (
        <Modal open={open} onOpenChange={setOpen}>
          <ModalTrigger className={ui.linkBtn}>+ Reading list</ModalTrigger>
          <ModalContent title="Add to a reading list">
            <p className="mb-3 text-muted">Which reading group?</p>
            <div className="flex flex-col items-start gap-2">
              {groups.map((g) => (
                <div key={g.id} className="flex flex-wrap items-baseline gap-x-2">
                  <button className={ui.linkBtn} disabled={busy || alreadyAdded(g)} onClick={() => add(g)}>
                    {g.name}
                  </button>
                  {alreadyAdded(g) && (
                    <>
                      <span className="text-muted">Paper already in reading list!</span>
                      {removeButton(g)}
                    </>
                  )}
                </div>
              ))}
            </div>
            {error && (
              <p role="alert" className={ui.note(false)}>
                {error}
              </p>
            )}
          </ModalContent>
        </Modal>
      )}
      {notice && groups.length > 1 && (
        <span role="status" className="ml-2 text-muted">
          {notice.text}
        </span>
      )}
      {error && !open && (
        <span role="alert" className="ml-2 text-down">
          {error}
        </span>
      )}
    </span>
  );
}

/** The glasses toggle a global read marker; its panel shows only fellow reading-group members. */
export function ReadEye({
  status,
  signedIn,
  showReaders = true,
}: {
  status: Status;
  signedIn: boolean;
  showReaders?: boolean;
}) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function cancelClose() {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
  }
  function show() {
    cancelClose();
    setOpen(true);
  }
  function hideSoon() {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  }
  useEffect(
    () => () => {
      if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    },
    [],
  );
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function toggle() {
    if (!signedIn || busy || refreshing) return;
    setBusy(true);
    setError(null);
    try {
      await write(`/listings/${status.listingId}/read`, status.read ? 'DELETE' : 'PUT');
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  if (!signedIn) return null;
  const button = (
    <button
      type="button"
      aria-label={signedIn ? (status.read ? 'Mark as unread' : 'Mark as read') : 'Who has read this paper'}
      aria-pressed={status.read}
      title={status.read ? 'Mark as unread' : 'Mark as read'}
      disabled={busy || refreshing}
      className={`inline-flex cursor-pointer items-center gap-2 disabled:opacity-50 ${status.read ? 'text-accent' : 'text-muted'}`}
      onPointerEnter={(e) => {
        if (showReaders && e.pointerType === 'mouse') show();
      }}
      onPointerLeave={(e) => {
        if (showReaders && e.pointerType === 'mouse') hideSoon();
      }}
      onFocus={showReaders ? show : undefined}
      onBlur={showReaders ? hideSoon : undefined}
      onClick={(e) => {
        if (signedIn) {
          e.preventDefault();
          toggle();
        }
      }}
    >
      <ReadingGlassesIcon read={status.read} />
      {/* <span className="font-mono text-xs">
            {status.readers.length}/{status.memberCount}
          </span> */}
    </button>
  );
  if (!showReaders) {
    return (
      <span className="inline-flex items-center gap-2">
        {button}
        {error && (
          <span role="alert" className="font-sans text-[13px] text-down">
            {error}
          </span>
        )}
      </span>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{button}</PopoverTrigger>
      <PopoverContent
        menu
        className="max-w-64 wrap-break-word"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onPointerEnter={cancelClose}
        onPointerLeave={hideSoon}
        onFocusCapture={cancelClose}
        onBlurCapture={hideSoon}
      >
        <b>Read by</b>
        {status.readers.length === 0 ? (
          <p className="text-muted">No readers yet.</p>
        ) : (
          <ul className="max-h-48 overflow-y-auto">
            {status.readers.map((p) => (
              <li key={p.accountId}>{p.displayName}</li>
            ))}
          </ul>
        )}
        {error && (
          <p role="alert" className="text-down">
            {error}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function ReadingListTable({
  groupId,
  initial,
  canEdit,
  signedIn,
  tableNumber,
}: {
  groupId: string;
  initial: List;
  canEdit: boolean;
  signedIn: boolean;
  tableNumber: number;
}) {
  const router = useRouter();
  async function remove(listingId: string) {
    await write(`/groups/${groupId}/reading-list/${listingId}`, 'DELETE');
    router.refresh();
  }
  if (initial.entries.length === 0) {
    return (
      <section className="mt-10">
        <h2 className={`${ui.section} mb-3`}>Reading list</h2>
        <p className="text-muted">
          Add papers to the reading list from the paper page by clicking “+ Reading list” under the title.
        </p>
        <p className="mt-2">
          <Link href="/">Browse papers →</Link>
        </p>
      </section>
    );
  }
  return (
    <section className="mt-10">
      <h2 className={`${ui.section} mb-3`}>Reading list</h2>
      <div className={ui.tableScroll}>
        <table className={ui.table}>
          <caption className={ui.tableCaption}>
            <b>Table {tableNumber}.</b> Papers to read together, newest additions first.
          </caption>
          <thead>
            <tr>
              <th className={ui.th()}>Paper</th>
              <th className={`${ui.th()} w-px whitespace-nowrap`}>Venue</th>
              {signedIn && (
                <th className={`${ui.th(true)} w-px whitespace-nowrap`}>
                  Read<sup className={ui.mark}>a</sup>
                </th>
              )}
              {canEdit && <th className={`${ui.th(true)} w-px whitespace-nowrap`}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {initial.entries.map((entry) => (
              <tr key={entry.listingId}>
                <td className={ui.td}>
                  <Link href={`/papers/${encodeURIComponent(entry.slug)}`} className="block min-w-56">
                    <MathText text={entry.title} />
                  </Link>
                </td>
                <td className={`${ui.td} align-middle font-sans text-[13px] whitespace-nowrap text-muted`}>
                  {entry.venue ?? '—'}
                </td>
                {signedIn && (
                  <td className={`${ui.td} align-middle text-right whitespace-nowrap`}>
                    <div className="flex h-5 items-center justify-end">
                      <ReadEye status={entry.status} signedIn={signedIn} />
                    </div>
                  </td>
                )}
                {canEdit && (
                  <td className={`${ui.td} align-middle text-right whitespace-nowrap`}>
                    <div className="flex h-5 items-center justify-end">
                      <Confirm
                        trigger={<TrashIcon />}
                        triggerLabel={`Remove ${entry.title} from the reading list`}
                        title="Remove paper from reading list?"
                        yes="Remove paper"
                        action={() => remove(entry.listingId)}
                      >
                        <p>
                          Remove{' '}
                          <i>
                            <MathText text={entry.title} />
                          </i>{' '}
                          from this group’s reading list?
                        </p>
                      </Confirm>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {signedIn && <TableNotes notes={[['a', 'Click the glasses to mark as read.']]} />}
      <p className="mt-2">
        <Link href="/">Browse papers →</Link>
      </p>
    </section>
  );
}
