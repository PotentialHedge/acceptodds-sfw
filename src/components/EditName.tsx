'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Modal, ModalContent, ModalTrigger } from './Modal';
import { ui } from './ui';

/**
 * "edit name" on `/profile`: a dialog with the viewer's name, saved through
 * `PATCH /api/v1/me` like every other client. The handle never changes, except
 * once: an account with no name yet (made by a sign-in link) has a placeholder
 * `trader-xxxx` handle, and its first name makes the real one
 * (`accounts.setDisplayName`). Such an account's display name *is* its handle.
 */
export function EditName({
  displayName,
  handle,
  label = 'edit name',
  triggerClassName = `${ui.linkBtn} inline-flex items-center`,
}: {
  displayName: string;
  handle: string;
  label?: string;
  triggerClassName?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const placeholder = displayName === handle;
  const [name, setName] = useState(placeholder ? '' : displayName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = name.trim() !== displayName && name.trim() !== '';

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/me', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: name }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.message ?? 'Could not save. Try again.');
      setOpen(false);
      router.refresh(); // the title block, the leaderboard's name
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setName(placeholder ? '' : displayName);
          setError(null);
        }
      }}
    >
      <ModalTrigger className={triggerClassName}>{label}</ModalTrigger>
      <ModalContent title="Edit name">
        <form onSubmit={save}>
          <label htmlFor="display-name" className="mb-1 block text-muted">
            The name your reading groups see
          </label>
          <input
            id="display-name"
            className={ui.input}
            value={name}
            maxLength={100}
            required
            autoFocus
            autoComplete="name"
            onChange={(e) => setName(e.target.value)}
          />
          <div className="text-xs text-muted">
            {placeholder
              ? `Your handle, @${handle}, is made from your first name, once. After that it does not change.`
              : `Your handle, @${handle}, does not change.`}
          </div>
          <button type="submit" className={ui.btn()} disabled={busy || !changed}>
            Save
          </button>
          {error && <div className={ui.note(false)}>{error}</div>}
        </form>
      </ModalContent>
    </Modal>
  );
}
