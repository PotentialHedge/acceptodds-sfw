'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export interface VersionOption {
  seq: number;
  label: string;
}

/**
 * Which two versions to compare and how to show them. Each choice is a link (the page is
 * server-rendered from its query), so the browser's back button walks the choices.
 */
export function DiffPicker({
  base,
  versions,
  from,
  to,
  view,
}: {
  /** The diff page's path, without a query. */
  base: string;
  versions: VersionOption[];
  from: number;
  to: number;
  view: 'changes' | 'text';
}) {
  const router = useRouter();
  const go = (f: number, t: number, v: string) => {
    const [a, b] = f <= t ? [f, t] : [t, f];
    router.push(`${base}?from=${a}&to=${b}&view=${v}`, { scroll: false });
  };
  const select = 'border border-rule bg-white px-1.5 py-1 font-sans text-sm narrow:text-base';
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 font-sans text-sm">
      <label className="flex items-center gap-1.5">
        <span className="text-muted">Compare</span>
        <select className={select} value={from} onChange={(e) => go(Number(e.target.value), to, view)}>
          {versions.map((v) => (
            <option key={v.seq} value={v.seq} disabled={v.seq === to}>
              {v.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5">
        <span className="text-muted">with</span>
        <select className={select} value={to} onChange={(e) => go(from, Number(e.target.value), view)}>
          {versions.map((v) => (
            <option key={v.seq} value={v.seq} disabled={v.seq === from}>
              {v.label}
            </option>
          ))}
        </select>
      </label>
      <span className="ml-auto flex overflow-hidden rounded-[3px] border border-rule" role="group" aria-label="View">
        {(
          [
            ['changes', 'Changes only'],
            ['text', 'Whole text'],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => go(from, to, v)}
            className={`px-2.5 py-1 ${view === v ? 'bg-ink text-white' : 'bg-card text-ink hover:bg-highlight'}`}
          >
            {label}
          </button>
        ))}
      </span>
    </div>
  );
}

/**
 * Previous and next change, pinned to the bottom of the window in the whole-text view: the
 * changes are `[data-change]` elements, in order. Keys `j` and `k` do the same.
 */
export function ChangeStepper({ total }: { total: number }) {
  const [at, setAt] = useState(0);

  const step = (by: number) => {
    const els = [...document.querySelectorAll<HTMLElement>('[data-change]')];
    if (els.length === 0) return;
    // From where the reader is, not from the last button press: they may have scrolled.
    const line = 80;
    const current = els.findIndex((el) => el.getBoundingClientRect().top > line + 1);
    const here = current === -1 ? els.length : current;
    const next = by > 0 ? here : here - 2;
    const target = els[Math.max(0, Math.min(els.length - 1, next))]!;
    target.scrollIntoView({ block: 'start', behavior: 'smooth' });
    setAt(Number(target.dataset.change));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select')) return;
      if (e.key === 'j') step(1);
      if (e.key === 'k') step(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (total === 0) return null;
  const button = 'px-3 py-1.5 hover:bg-highlight';
  return (
    <div className="fixed right-4 bottom-4 z-20 flex items-center border border-frame bg-card font-sans text-sm shadow-sm">
      <button type="button" className={button} onClick={() => step(-1)} title="Previous change (k)">
        ↑
      </button>
      <span className="px-1 text-muted tabular-nums">{at > 0 ? `${at} / ${total}` : `${total} changes`}</span>
      <button type="button" className={button} onClick={() => step(1)} title="Next change (j)">
        ↓
      </button>
    </div>
  );
}
