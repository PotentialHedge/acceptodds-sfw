'use client';

import { useState } from 'react';
import type { z } from 'zod';
import { SignInLink } from '@/components/AuthLinks';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/Popover';
import { ui } from '@/components/ui';
import { canonicalEmoji, displayEmoji, SUGGESTED_REACTIONS } from '@/lib/reactions';
import type * as S from '@/server/api/schemas';

type Reaction = z.output<typeof S.Reaction>;

/**
 * A paper's emoji reactions, under its quick actions: each emoji used so
 * far, its count set small above it, the viewer's own outlined in the
 * accent; a click adds or takes back the viewer's. "+" opens a picker of
 * GitHub's reactions and a box for any other single emoji. Anonymous: only
 * counts are ever shown (`server/reactions.ts`). Writes go through the API.
 */
export function Reactions({
  listingId,
  initial,
  signedIn,
}: {
  listingId: string;
  initial: Reaction[];
  signedIn: boolean;
}) {
  const [reactions, setReactions] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [other, setOther] = useState('');

  async function toggle(raw: string) {
    const emoji = canonicalEmoji(raw);
    if (!emoji) return setError('That is not a single emoji.');
    if (!signedIn) return setError('signin');
    const on = !reactions.some((r) => r.emoji === emoji && r.mine);
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/listings/${listingId}/reactions/${encodeURIComponent(emoji)}`, {
      method: on ? 'PUT' : 'DELETE',
    });
    setBusy(false);
    if (res.ok) {
      setReactions((await res.json()).reactions);
      setOther('');
    } else {
      const e = await res.json().catch(() => null);
      setError(e?.error?.message ?? 'Could not react. Try again.');
    }
  }

  return (
    <div className="mt-3 flex flex-col items-center gap-1">
      <div className="flex flex-wrap items-end justify-center gap-1.5" aria-label="Reactions">
        {reactions.map((r) => (
          <button
            key={r.emoji}
            type="button"
            disabled={busy}
            onClick={() => void toggle(r.emoji)}
            aria-pressed={r.mine}
            aria-label={`${displayEmoji(r.emoji)} ${r.count}${r.mine ? ', yours' : ''}`}
            className={`flex cursor-pointer flex-col items-center rounded-[3px] border px-1.5 pt-0.5 pb-1 leading-none hover:border-accent disabled:cursor-wait ${
              r.mine ? 'border-accent bg-tint' : 'border-rule bg-card'
            }`}
          >
            <span className="font-mono text-[10px] text-muted">{r.count}</span>
            <span className="mt-0.5 text-lg">{displayEmoji(r.emoji)}</span>
          </button>
        ))}
        <Popover>
          <PopoverTrigger
            title="Add a reaction"
            aria-label="Add a reaction"
            className="flex h-[42px] cursor-pointer items-center rounded-[3px] border border-dashed border-rule px-2 font-sans text-sm text-muted hover:border-accent hover:text-accent"
          >
            <span aria-hidden>☺+</span>
          </PopoverTrigger>
          <PopoverContent align="center" className="w-60">
            <div className="grid grid-cols-4 gap-1">
              {SUGGESTED_REACTIONS.map((e) => (
                <PopoverClose key={e} asChild>
                  <button
                    type="button"
                    onClick={() => void toggle(e)}
                    className={`cursor-pointer rounded-[3px] py-1 text-xl hover:bg-highlight ${
                      reactions.some((r) => r.emoji === e && r.mine) ? 'bg-tint' : ''
                    }`}
                  >
                    {displayEmoji(e)}
                  </button>
                </PopoverClose>
              ))}
            </div>
            <form
              className="mt-2 flex gap-1.5 border-t border-rule pt-2"
              onSubmit={(ev) => {
                ev.preventDefault();
                void toggle(other);
              }}
            >
              <input
                value={other}
                onChange={(ev) => setOther(ev.target.value)}
                placeholder="any other emoji"
                aria-label="Any other emoji"
                maxLength={32}
                className="min-w-0 flex-1 border border-rule bg-white p-1.5 text-center font-sans text-sm leading-[normal] narrow:text-base"
              />
              <button type="submit" className={ui.btn({ inline: true, ghost: true, flush: true })} disabled={busy}>
                add
              </button>
            </form>
          </PopoverContent>
        </Popover>
      </div>
      {error === 'signin' ? (
        <p className="font-sans text-xs text-muted">
          <SignInLink>Sign in</SignInLink> to react.
        </p>
      ) : (
        error && <p className="font-sans text-xs text-down">{error}</p>
      )}
    </div>
  );
}
