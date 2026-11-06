'use client';

import { useEffect, useRef, useState } from 'react';

const HEIGHT = 170;
const PAD = { top: 26, right: 12, bottom: 26, left: 12 };
/** Between bars, until a bar is too narrow to spare it: a fine histogram on a phone. */
const GAP = 2;
const NARROW_SLOT = 6;

/**
 * A paper's place in a field of papers: one bar per bin, its bin in the accent
 * and those below it tinted. The drawing only; `VenueStanding` and
 * `ReviewStanding` say what is being measured. A bin's hover is its share of
 * the field, never a count.
 */
export function FieldBars({
  bins,
  mine,
  label,
  ariaLabel,
  ticks,
  binLabel,
}: {
  bins: number[];
  /** The index of the paper's bin. */
  mine: number;
  /** Over its bar, e.g. "this paper, Top 4%". */
  label: string;
  ariaLabel: string;
  /** Along the axis; `at` is the share of the way across, 0 to 1. */
  ticks: readonly { at: number; text: string }[];
  /** What a bin spans, for its hover. */
  binLabel: (i: number) => string;
}) {
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
  const gap = slot < NARROW_SLOT ? 1 : GAP;
  const peak = Math.max(1, ...bins);
  const total = bins.reduce((s, b) => s + b, 0);
  const share = (count: number) => {
    const p = (count / Math.max(1, total)) * 100;
    return count > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`;
  };
  const base = PAD.top + plotH;
  const x0 = (i: number) => PAD.left + i * slot;
  const mineX = x0(mine) + slot / 2;
  const anchor = mineX < width * 0.2 ? 'start' : mineX > width * 0.8 ? 'end' : 'middle';

  return (
    <div ref={box} className="relative mt-2 select-none">
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={ariaLabel}
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
                x={x0(i) + gap / 2}
                y={base - h}
                width={Math.max(1, slot - gap)}
                height={h}
                className={i === mine ? 'fill-accent' : i < mine ? 'fill-accent opacity-25' : 'fill-rule-strong'}
              />
            </g>
          );
        })}
        <line x1={PAD.left} x2={width - PAD.right} y1={base} y2={base} strokeWidth={1} className="stroke-rule-strong" />
        {ticks.map((t) => (
          <text
            key={t.text}
            x={PAD.left + t.at * plotW}
            y={base + 17}
            textAnchor={t.at === 0 ? 'start' : t.at === 1 ? 'end' : 'middle'}
            className="fill-muted font-mono text-[11px]"
          >
            {t.text}
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
          <span className="font-mono">{binLabel(hover)}</span>
          <span className="text-muted"> {share(bins[hover])} of papers</span>
        </div>
      )}
    </div>
  );
}
