'use client';

import { useState } from 'react';
import { CopyField } from '@/components/CopyField';
import { ui } from '@/components/ui';
import { day } from '@/lib/format';

/** `GET /api/v1/me/tokens`'s rows, as the API serves them. */
export interface ApiKeyRow {
  id: string;
  name: string | null;
  start: string | null;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  enabled: boolean;
}

const MESSAGES: Record<string, string> = {
  validation_error: 'Give the key a name of at most 100 characters.',
  rate_limited: 'Too many requests. Try again in a minute.',
};

async function errorText(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  return MESSAGES[body?.error?.code] ?? 'Something went wrong. Try again.';
}

/**
 * The viewer's API keys as Table `n`, and a form to make one. The secret is
 * shown once, right after it is made; the list only ever has its first
 * characters. Revoked keys are left out. Writes go through `/api/v1/me/tokens`,
 * which takes a session and never a key, so a key cannot mint its successor.
 */
export function ApiKeys({ initial, n }: { initial: ApiKeyRow[]; n: number }) {
  const [rows, setRows] = useState(initial.filter((r) => r.enabled));
  const [name, setName] = useState('');
  const [secret, setSecret] = useState<{ name: string; token: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function reload() {
    const res = await fetch('/api/v1/me/tokens', { cache: 'no-store' });
    if (res.ok) setRows(((await res.json()).tokens as ApiKeyRow[]).filter((r) => r.enabled));
  }

  async function run(call: () => Promise<Response>, onOk: (res: Response) => Promise<void>) {
    setBusy(true);
    setNote(null);
    try {
      const res = await call();
      if (!res.ok) {
        setNote({ ok: false, text: await errorText(res) });
        return;
      }
      await onOk(res);
      await reload();
    } catch {
      setNote({ ok: false, text: 'Could not reach the server. Try again.' });
    } finally {
      setBusy(false);
    }
  }

  function create(keyName: string) {
    return run(
      () =>
        fetch('/api/v1/me/tokens', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: keyName, scopes: ['read'] }),
        }),
      async (res) => {
        const created = await res.json();
        setSecret({ name: keyName, token: created.token });
        setName('');
      },
    );
  }

  function revoke(row: ApiKeyRow) {
    return run(
      () => fetch(`/api/v1/me/tokens/${encodeURIComponent(row.id)}`, { method: 'DELETE' }),
      async () => {
        if (secret && row.start && secret.token.startsWith(row.start)) setSecret(null);
        setNote({ ok: true, text: `Revoked ${row.name ?? 'the key'}. It no longer works.` });
      },
    );
  }

  return (
    <div className="font-sans text-sm">
      {rows.length > 0 && (
        <>
          <div className={ui.tableScroll}>
            <table className={ui.table}>
              <caption className={ui.tableCaption}>
                <b>Table {n}.</b> Your API keys, newest first.
              </caption>
              <thead>
                <tr>
                  <th className={ui.th()}>Name</th>
                  <th className={ui.th()}>Key</th>
                  <th className={ui.th()}>Scopes</th>
                  <th className={ui.th()}>Made</th>
                  <th className={ui.th()}>Last used</th>
                  <th className={ui.th()} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="align-baseline">
                    <td className={`${ui.td} break-all`}>{r.name ?? '—'}</td>
                    <td className={`${ui.td} ${ui.mono} whitespace-nowrap`}>{r.start ? `${r.start}…` : '—'}</td>
                    <td className={ui.td}>{r.scopes.join(', ')}</td>
                    <td className={`${ui.td} whitespace-nowrap`}>{day(r.createdAt)}</td>
                    <td className={`${ui.td} whitespace-nowrap text-muted`}>
                      {r.lastUsedAt ? day(r.lastUsedAt) : 'never'}
                    </td>
                    <td className={`${ui.td} text-right`}>
                      <button type="button" className={ui.linkBtn} disabled={busy} onClick={() => void revoke(r)}>
                        revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {secret && (
        <div className={`${ui.box} mt-3`}>
          <div className="mb-1.5">
            Your new key <b>{secret.name}</b>. Copy it now: it is shown only this once, and anyone who has it can act as
            you.
          </div>
          <CopyField value={secret.token} label={`API key ${secret.name}`} />
        </div>
      )}

      <form
        className="mt-3"
        onSubmit={(e) => {
          e.preventDefault();
          const keyName = name.trim();
          if (keyName) void create(keyName);
        }}
      >
        <div className="flex gap-2">
          <input
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="a name for the key, e.g. my-bot"
            aria-label="Name of the new API key"
            className="min-w-0 flex-1 border border-rule bg-white p-1.5 font-sans text-sm leading-[normal] narrow:text-base"
          />
          <button type="submit" className={ui.btn({ ghost: true, inline: true, flush: true })} disabled={busy}>
            mint key
          </button>
        </div>
      </form>
      {note && <div className={ui.note(note.ok)}>{note.text}</div>}
    </div>
  );
}
