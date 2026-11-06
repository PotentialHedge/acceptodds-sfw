'use client';

import { useEffect, useRef, useState } from 'react';
import { countBelow } from '@/lib/distribution';
import { percentAhead, standingBand } from '@/lib/leaderboard';
import type { VenueField } from '@/server/venue-field';

/**
 * A paper's place among the papers at its venue: the distribution of their
 * headlines (the chance of acceptance) with this paper's marked and the share
 * of papers below it shaded. Prices, never values (§1.1). The field is the
 * server's, a minute old at most; the marker is the live headline. The chart
 * alone: the paper page sets it as panel (a) of its Stats figure, which
 * captions it.
 *
 * Shares only, never how many papers: a bin's hover is its share of the
 * venue, and the caption names no count. `among` names the field for a
 * screen reader: the venue's papers by default, or a subset (its peers).
 */
export function VenueStanding({
  field,
  headline,
  among = `papers at ${field.kind}`,
}: {
  field: VenueField;
  headline: number;
  among?: string;
}) {
  const percent = headline * 100;
  const ahead = percentAhead(countBelow(field.values, percent), field.values.length);
  return (
    <Bars
      bins={field.bins}
      you={percent}
      label={ahead === null ? 'this paper' : `this paper, ${standingBand(ahead)}`}
      among={among}
    />
  );
}

const HEIGHT = 170;
const PAD = { top: 26, right: 12, bottom: 26, left: 12 };
const GAP = 2;

/** One bar per bin of the venue's headlines; the paper's bin in the accent, those below it tinted. */
function Bars({ bins, you, label, among }: { bins: number[]; you: number; label: string; among: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = bins.length;
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const slot = plotW / n;
  const peak = Math.max(1, ...bins);
  const total = bins.reduce((s, b) => s + b, 0);
  const share = (count: number) => {
    const p = (count / Math.max(1, total)) * 100;
    return count > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`;
  };
  const base = PAD.top + plotH;
  const mine = Math.min(n - 1, Math.floor((you / 100) * n));
  const x0 = (i: number) => PAD.left + i * slot;
  const mineX = x0(mine) + slot / 2;
  const anchor = mineX < width * 0.2 ? 'start' : mineX > width * 0.8 ? 'end' : 'middle';
  const step = 100 / n;
  const range = (i: number) => `${Math.round(i * step)}–${Math.round((i + 1) * step)}%`;

  return (
    <div ref={box} className="relative mt-2 select-none">
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={`Chance of acceptance of ${among}; ${label}`}
        className="block overflow-visible"
        onPointerLeave={() => setHover(null)}
      >
        {bins.map((count, i) => {
          // A bin with any papers always shows, however small beside the tallest.
          const h = count === 0 ? 0 : Math.max(2, (count / peak) * plotH);
          return (
            <g key={i} onPointerMove={() => setHover(i)}>
              {/* A full-height target, so an empty bin can still be read. */}
              <rect x={x0(i)} y={PAD.top} width={slot} height={plotH} fill="transparent" />
              <rect
                x={x0(i) + GAP / 2}
                y={base - h}
                width={Math.max(1, slot - GAP)}
                height={h}
                className={i === mine ? 'fill-accent' : i < mine ? 'fill-accent opacity-25' : 'fill-rule-strong'}
              />
            </g>
          );
        })}
        <line x1={PAD.left} x2={width - PAD.right} y1={base} y2={base} strokeWidth={1} className="stroke-rule-strong" />
        {[0, 25, 50, 75, 100].map((t) => (
          <text
            key={t}
            x={PAD.left + (t / 100) * plotW}
            y={base + 17}
            textAnchor={t === 0 ? 'start' : t === 100 ? 'end' : 'middle'}
            className="fill-muted font-mono text-[11px]"
          >
            {t}%
          </text>
        ))}
        <text
          x={mineX}
          y={PAD.top - 10}
          textAnchor={anchor}
          strokeWidth={4}
          paintOrder="stroke"
          className="fill-ink stroke-card font-sans text-xs font-semibold"
        >
          {label}
        </text>
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-1 z-10 border border-frame bg-card px-2 py-1 font-sans text-xs whitespace-nowrap text-ink shadow-sm"
          style={x0(hover) > width / 2 ? { right: width - x0(hover) + 8 } : { left: x0(hover) + slot + 8 }}
        >
          <span className="font-mono">{range(hover)}</span>
          <span className="text-muted"> {share(bins[hover])} of papers</span>
        </div>
      )}
    </div>
  );
}
