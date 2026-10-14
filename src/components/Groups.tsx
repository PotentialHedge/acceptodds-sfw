'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';
import { CopyButton } from '@/components/CopyButton';
import { CopyField } from '@/components/CopyField';
import { Modal, ModalClose, ModalContent, ModalTrigger } from '@/components/Modal';
import { ui } from '@/components/ui';
import { groupInvitePath, groupPath } from '@/lib/links';
import { rememberInvite } from '@/lib/pending-invite';

/**
 * Leaderboard groups in the UI (#25): making one, joining by invite link,
 * and a group board's actions. Everything writes through `/api/v1/groups`,
 * as every other client does; the page then re-reads (`router.refresh`).
 */

/** Calls the groups API as the viewer; the parsed body, or throws the API's message. */
async function call(method: string, path: string, body?: unknown): Promise<{ id?: string } | null> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null;
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error?.message ?? 'Something went wrong. Try again.');
  return json;
}

/** Runs one write at a time, keeping its error to show. */
function useWrite() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(write: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await write();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run, reset: () => setError(null) };
}

/** A group's name and description, for making or editing one. */
function GroupForm({
  initial,
  submit,
  onSubmit,
}: {
  initial: { name: string; description: string | null };
  submit: string;
  onSubmit: (v: { name: string; description: string | null }) => Promise<void>;
}) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description ?? '');
  const { busy, error, run } = useWrite();
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        run(() => onSubmit({ name, description: description.trim() || null }));
      }}
    >
      <label className="mb-1 block text-muted" htmlFor="group-name">
        Name
      </label>
      <input
        id="group-name"
        className={ui.input}
        value={name}
        maxLength={80}
        required
        autoFocus
        onChange={(e) => setName(e.target.value)}
      />
      <label className="mb-1 block text-muted" htmlFor="group-description">
        Description <span className="text-faint">(optional, shown as its abstract)</span>
      </label>
      <textarea
        id="group-description"
        className={`${ui.input} min-h-20`}
        value={description}
        maxLength={500}
        onChange={(e) => setDescription(e.target.value)}
      />
      <button type="submit" className={ui.btn()} disabled={busy || name.trim() === ''}>
        {submit}
      </button>
      {error && <div className={ui.note(false)}>{error}</div>}
    </form>
  );
}

/** "New group": makes one with the viewer as admin, then opens its board. */
export function NewGroupButton({
  className = ui.linkBtn,
  onCreated,
  addListingId,
  label = '+ Create reading group',
}: {
  className?: string;
  addListingId?: string;
  label?: string;
  /** After the group is made, before its board opens. */
  onCreated?: () => void;
}) {
  const router = useRouter();
  // Controlled: the new board is the same page with another `?group=`, so nothing unmounts the modal for us.
  const [open, setOpen] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  return (
    <Modal open={open} onOpenChange={setOpen}>
      <ModalTrigger className={className}>{label}</ModalTrigger>
      <ModalContent title="Create reading group">
        <p className="mb-3 text-muted">
          A shared reading list of your own. Everyone who joins with your invite link can add papers, remove them and
          mark what they have read.
        </p>
        <GroupForm
          initial={{ name: '', description: null }}
          submit="Create reading group"
          onSubmit={async (v) => {
            const id = createdId ?? (await call('POST', '/groups', v))!.id!;
            setCreatedId(id);
            if (addListingId) await call('PUT', `/groups/${id}/reading-list/${addListingId}`);
            setOpen(false);
            setCreatedId(null);
            onCreated?.();
            router.push(groupPath(id));
            router.refresh();
          }}
        />
      </ModalContent>
    </Modal>
  );
}

/**
 * On an invite page, signed out: sign in or up, remembering the invite so
 * they join once they have an account (`PendingGroupJoin`), wherever the
 * way in ends.
 */
export function SignInToJoin({ code }: { code: string }) {
  return (
    <Link
      href={`/signin?next=${encodeURIComponent(groupInvitePath(code))}`}
      className={ui.btn({ inline: true })}
      onClick={() => rememberInvite(code)}
    >
      Sign in / Sign up
    </Link>
  );
}

/** On an invite page: join, then open the group's board. */
export function JoinGroupButton({ code, groupId }: { code: string; groupId: string }) {
  const router = useRouter();
  const { busy, error, run } = useWrite();
  return (
    <>
      <button
        className={ui.btn({ inline: true })}
        disabled={busy}
        onClick={() =>
          run(async () => {
            await call('POST', '/groups/join', { inviteCode: code });
            router.push(groupPath(groupId));
            router.refresh();
          })
        }
      >
        Join the reading group
      </button>
      {error && <div className={ui.note(false)}>{error}</div>}
    </>
  );
}

export interface GroupActionsProps {
  group: { id: string; name: string; description: string | null; inviteCode: string };
  role: 'admin' | 'member';
  viewerHandle: string;
  members: { handle: string; displayName: string; role: 'admin' | 'member' }[];
}

/** A confirming modal behind a link-like button: `action` runs on "yes". */
export function Confirm({
  trigger,
  triggerLabel,
  title,
  children,
  yes,
  action,
}: {
  trigger: ReactNode;
  triggerLabel?: string;
  title: string;
  children: ReactNode;
  yes: string;
  action: () => Promise<void>;
}) {
  const { busy, error, run, reset } = useWrite();
  const [open, setOpen] = useState(false);
  return (
    <Modal
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        reset();
      }}
    >
      <ModalTrigger className={ui.linkBtn} aria-label={triggerLabel}>
        {trigger}
      </ModalTrigger>
      <ModalContent title={title}>
        <div className="mb-2">{children}</div>
        <div className="flex gap-2">
          <button
            className={ui.btn({ inline: true })}
            disabled={busy}
            onClick={() =>
              run(async () => {
                await action();
                setOpen(false);
              })
            }
          >
            {yes}
          </button>
          <ModalClose className={ui.btn({ ghost: true, inline: true })}>Cancel</ModalClose>
        </div>
        {error && <div className={ui.note(false)}>{error}</div>}
      </ModalContent>
    </Modal>
  );
}

/**
 * Under a group board's title: the invite link for every member, "leave"
 * for a member, and for the admin edit, members (remove, new invite link)
 * and delete.
 */
export function GroupActions({ group, role, viewerHandle, members }: GroupActionsProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const { busy, error, run } = useWrite();
  const invite =
    typeof window === 'undefined'
      ? groupInvitePath(group.inviteCode)
      : new URL(groupInvitePath(group.inviteCode), window.location.origin).href;
  const base = `/groups/${group.id}`;

  return (
    <div className="mt-3 flex flex-wrap items-baseline justify-center gap-x-4 gap-y-1 font-sans text-[13px]">
      <CopyButton value={invite} label="Copy invite link" className={ui.linkBtn} />
      {role === 'member' && (
        <Confirm
          trigger="Leave"
          title={`Leave ${group.name}?`}
          yes="Leave"
          action={async () => {
            await call('DELETE', `${base}/members/${encodeURIComponent(viewerHandle)}`);
            router.push('/');
            router.refresh();
          }}
        >
          You can join again with its invite link.
        </Confirm>
      )}
      {role === 'admin' && (
        <>
          <Modal open={editing} onOpenChange={setEditing}>
            <ModalTrigger className={ui.linkBtn}>Edit</ModalTrigger>
            <ModalContent title="Edit reading group">
              <GroupForm
                initial={group}
                submit="Save"
                onSubmit={async (v) => {
                  await call('PATCH', base, v);
                  setEditing(false);
                  router.refresh();
                }}
              />
            </ModalContent>
          </Modal>
          <Modal>
            <ModalTrigger className={ui.linkBtn}>Members</ModalTrigger>
            <ModalContent title={`Members of ${group.name}`}>
              <ul className="mb-3 max-h-72 overflow-y-auto">
                {members.map((m) => (
                  <li key={m.handle} className="flex items-baseline justify-between gap-3 py-0.5">
                    <span>
                      {m.displayName} <span className="text-muted">@{m.handle}</span>
                    </span>
                    {m.role === 'admin' ? (
                      <span className="text-muted">admin</span>
                    ) : (
                      <button
                        className={ui.linkBtn}
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            await call('DELETE', `${base}/members/${encodeURIComponent(m.handle)}`);
                            router.refresh();
                          })
                        }
                      >
                        remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <CopyField value={invite} label={`Invite link to ${group.name}`} className="mb-2" />
              <p className="mb-1 text-muted">
                A new invite link stops the old one working. Nobody already in the group is removed.
              </p>
              <button
                className={ui.btn({ ghost: true, inline: true })}
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await call('POST', `${base}/invite`);
                    router.refresh();
                  })
                }
              >
                New invite link
              </button>
              {error && <div className={ui.note(false)}>{error}</div>}
            </ModalContent>
          </Modal>
          <Confirm
            trigger="Delete"
            title={`Delete ${group.name}?`}
            yes="Delete reading group"
            action={async () => {
              await call('DELETE', base);
              router.push('/');
              router.refresh();
            }}
          >
            The group and its board go for everyone in it. Nobody’s reputation or positions change.
          </Confirm>
        </>
      )}
    </div>
  );
}
