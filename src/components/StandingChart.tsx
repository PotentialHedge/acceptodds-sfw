'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { countBelow, niceTicks } from '@/lib/distribution';
import { REP } from '@/lib/format';

const HEIGHT = 190;
const PAD = { top: 30, right: 12, bottom: 26, left: 12 };
/** Headroom for a second row of labels, when the viewer and another trader are both marked. */
const LABEL_ROW = 15;
/** How near the pointer, in pixels, a mark must be to be named in the readout. */
const MARK_HIT = 5;

/** Whole units with grouping: axis ticks and the tooltip, not the ledger's figures. */
function units(x: number): string {
  return Math.round(x).toLocaleString('en');
}

/**
 * The field and where the viewer sits in it (the leaderboard's net-worth
 * tab): the kernel density of every trader's net worth at liquidation value
 * from the shared snapshot (`server/field-snapshot.ts`, computed once for
 * everyone) and — for a signed-in viewer — the part below
 * them shaded (its share is the percentile) and a maroon line at them. A
 * second trader (the leaderboard's `?around=`) gets a dashed ink line, no
 * shading, labelled a row above the viewer's so the two never collide. Hover
 * (or arrow keys) reads any point off: how many traders have less. `marks`
 * (the bots, on the global board) are open circles on the curve, unlabelled
 * so they never collide; hovering one names it. One series, so no legend.
 * `format` lets another field of numbers use the same drawing (a paper's mean
 * review rating); left out, it reads as traders' net worth. `bars` draws a
 * histogram in place of the curve, and its `reference` as a dashed outline.
 */
export function StandingChart({
  curve,
  domain,
  values,
  you,
  label,
  other = null,
  marks = [],
  reference,
  bars,
  format,
}: {
  /** The density at evenly spaced points across `domain`, root-scaled to peak at 1. */
  curve: number[];
  /** In units. */
  domain: [number, number];
  /** Every trader's net worth in units, sorted ascending, for the hover counts. Display only. */
  values: number[];
  /** The viewer's, in the same units; `null` for no marker (signed out, or not on the board). */
  you: number | null;
  /** Beside the viewer's line, e.g. "you, Top 4%". */
  label: string | null;
  /** Another trader to mark, in the same units, e.g. the one the leaderboard is focused on. */
  other?: { value: number; label: string } | null;
  /** More traders to mark, in the same units, each named only on hover. */
  marks?: readonly { value: number; label: string }[];
  /** Another density at the same points, drawn dashed behind for comparison. */
  reference?: readonly number[];
  /**
   * Bins of `width` from `domain[0]` in place of the curve (the last cut short at `domain[1]`): each one's
   * height, scaled to peak at 1 or less, and the same for a field to compare with, drawn as a dashed
   * outline. `curve` is then not drawn.
   */
  bars?: { width: number; heights: readonly number[]; reference?: readonly number[] };
  /** What the chart is of: its axis, its hover readout and its name to a screen reader. */
  format?: { tick: (x: number) => string; ticks?: number[]; readout: (x: number) => ReactNode; ariaLabel: string };
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

  const d = useMemo(() => {
    const n = curve.length - 1;
    return { xs: curve.map((_, i) => domain[0] + ((domain[1] - domain[0]) * i) / n), ys: curve, domain };
  }, [curve, domain]);
  // A viewer whose live figure has left the snapshot's range is drawn at its edge.
  const clamp = (x: number) => Math.min(domain[1], Math.max(domain[0], x));
  const at = you === null ? null : clamp(you);
  const otherAt = other ? clamp(other.value) : null;
  const top = PAD.top + (at !== null && otherAt !== null ? LABEL_ROW : 0);
  const height = HEIGHT + top - PAD.top;
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - top - PAD.bottom;
  const sx = (x: number) => PAD.left + ((x - d.domain[0]) / (d.domain[1] - d.domain[0])) * plotW;
  const sy = (y: number) => top + plotH - y * plotH;
  const base = top + plotH;
  const invert = (px: number) => d.domain[0] + ((px - PAD.left) / plotW) * (d.domain[1] - d.domain[0]);

  const line = d.xs.map((x, i) => `${i ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(d.ys[i]).toFixed(1)}`).join('');
  const area = `${line}L${sx(d.domain[1]).toFixed(1)},${base}L${sx(d.domain[0]).toFixed(1)},${base}Z`;
  const binW = bars?.width ?? 1;
  /** Where bin `i` starts and ends, in pixels. */
  const edge = (i: number) => sx(Math.min(d.domain[1], d.domain[0] + i * binW));
  /** The bin `x` falls in, the last closed at the top of the scale. */
  const binOf = (x: number) =>
    Math.min(bars!.heights.length - 1, Math.max(0, Math.floor((x - d.domain[0]) / binW + 1e-9)));
  const heightAt = (x: number) => (bars ? bars.heights[binOf(x)] : yAt(d, x));
  /** An outline over `heights`, a step per bin. */
  const steps = (heights: readonly number[]) =>
    heights
      .map((h, i) => {
        const x0 = edge(i).toFixed(1);
        const x1 = edge(i + 1).toFixed(1);
        const y = sy(h).toFixed(1);
        return `${i ? 'L' : `M${x0},${base}L`}${x0},${y}L${x1},${y}`;
      })
      .join('') + `L${sx(d.domain[1]).toFixed(1)},${base}`;
  const youX = at === null ? null : sx(at);
  const youY = at === null ? null : sy(heightAt(at));
  const ticks = format?.ticks ?? niceTicks(d.domain[0], d.domain[1], Math.max(2, Math.floor(plotW / 140)));
  const otherX = otherAt === null ? null : sx(otherAt);
  const otherY = otherAt === null ? null : sy(heightAt(otherAt));
  // Keep a label inside the chart when its line is near an edge.
  const anchorAt = (x: number) => (x < width * 0.2 ? 'start' : x > width * 0.8 ? 'end' : 'middle');

  const hoverX = hover === null ? null : sx(hover);
  const hoverBelow = hover === null ? 0 : countBelow(values, hover);
  // The marks within a few pixels of the pointer, named in the readout.
  const hoverMarks =
    hoverX === null ? [] : marks.filter((m) => Math.abs(sx(clamp(m.value)) - hoverX) <= MARK_HIT).map((m) => m.label);

  return (
    <div ref={box} className="relative mt-2 select-none">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={
          format?.ariaLabel ?? `Net worth of the field${label ? `; ${label}` : ''}${other ? `; ${other.label}` : ''}`
        }
        tabIndex={0}
        className="block overflow-visible focus:outline-none"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const x = invert(e.clientX - r.left);
          setHover(x >= d.domain[0] && x <= d.domain[1] ? x : null);
        }}
        onPointerLeave={() => setHover(null)}
        onBlur={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          const step = (d.domain[1] - d.domain[0]) / 40;
          const from = hover ?? at ?? otherAt ?? (d.domain[0] + d.domain[1]) / 2;
          setHover(Math.min(d.domain[1], Math.max(d.domain[0], from + (e.key === 'ArrowLeft' ? -step : step))));
        }}
      >
        {bars ? (
          bars.heights.map((h, i) => {
            const x0 = edge(i);
            const w = Math.max(1, edge(i + 1) - x0 - 2);
            // A bin with any papers always shows, however small beside the tallest.
            const y = h > 0 ? Math.min(sy(h), base - 2) : base;
            const below = youX !== null && x0 + w <= youX;
            const mine = at !== null && binOf(at) === i;
            return (
              <rect
                key={i}
                x={x0 + 1}
                y={y}
                width={w}
                height={base - y}
                className={mine ? 'fill-accent opacity-40' : below ? 'fill-accent opacity-15' : 'fill-rule-strong'}
              />
            );
          })
        ) : (
          <>
            <path d={area} className="fill-rule-soft" />
            {youX !== null && (
              <>
                <clipPath id="standing-below">
                  <rect x={0} y={0} width={Math.max(0, youX)} height={height} />
                </clipPath>
                <path d={area} clipPath="url(#standing-below)" className="fill-accent opacity-15" />
              </>
            )}
          </>
        )}
        {bars?.reference && (
          <path
            d={steps(bars.reference)}
            fill="none"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            className="stroke-muted"
          />
        )}
        {!bars && reference && (
          <path
            d={reference.map((y, i) => `${i ? 'L' : 'M'}${sx(d.xs[i]).toFixed(1)},${sy(y).toFixed(1)}`).join('')}
            fill="none"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            className="stroke-muted"
          />
        )}
        {!bars && <path d={line} fill="none" strokeWidth={2} strokeLinejoin="round" className="stroke-subtle" />}
        <line x1={PAD.left} x2={width - PAD.right} y1={base} y2={base} strokeWidth={1} className="stroke-rule-strong" />
        {ticks.map((t) => (
          <text key={t} x={sx(t)} y={base + 17} textAnchor="middle" className="fill-muted font-mono text-[11px]">
            {format ? format.tick(t) : units(t)}
          </text>
        ))}
        {marks.map((m) => {
          const x = clamp(m.value);
          return (
            <circle
              key={m.label}
              cx={sx(x)}
              cy={sy(heightAt(x))}
              r={3.5}
              strokeWidth={1.5}
              className="fill-card stroke-ink"
            />
          );
        })}
        {otherX !== null && otherY !== null && other && (
          <>
            {/* Another trader: above the viewer's label row, when there is one. */}
            <line
              x1={otherX}
              x2={otherX}
              y1={base}
              y2={PAD.top - 6}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              className="stroke-ink"
            />
            <circle cx={otherX} cy={otherY} r={3.5} strokeWidth={2} className="fill-ink stroke-card" />
            <text x={otherX} y={PAD.top - 12} textAnchor={anchorAt(otherX)} className="fill-ink font-sans text-xs">
              {other.label}
            </text>
          </>
        )}
        {youX !== null && youY !== null && (
          <>
            {/* The viewer. */}
            <line
              x1={youX}
              x2={youX}
              y1={base}
              y2={Math.min(youY, top - 6)}
              strokeWidth={2}
              className="stroke-accent"
            />
            <circle cx={youX} cy={youY} r={4} strokeWidth={2} className="fill-accent stroke-card" />
            {label && (
              <text
                x={youX}
                y={top - 12}
                textAnchor={anchorAt(youX)}
                strokeWidth={4}
                paintOrder="stroke"
                className="fill-ink stroke-card font-sans text-xs font-semibold"
              >
                {label}
              </text>
            )}
          </>
        )}
        {hoverX !== null && (
          <line
            x1={hoverX}
            x2={hoverX}
            y1={top}
            y2={base}
            strokeWidth={1}
            className="stroke-rule-strong"
            pointerEvents="none"
          />
        )}
      </svg>
      {hover !== null && hoverX !== null && (
        <div
          className="pointer-events-none absolute top-1 z-10 border border-frame bg-card px-2 py-1 font-sans text-xs whitespace-nowrap text-ink shadow-sm"
          style={hoverX > width / 2 ? { right: width - hoverX + 8 } : { left: hoverX + 8 }}
        >
          {format ? (
            format.readout(hover)
          ) : (
            <>
              <span className="font-mono">
                {units(hover)} {REP}
              </span>
              <span className="text-muted">
                {' '}
                {Math.floor((100 * hoverBelow) / values.length)}% of traders have less
              </span>
            </>
          )}
          {hoverMarks.length > 0 && <div>{hoverMarks.join(', ')}</div>}
        </div>
      )}
    </div>
  );
}

/** The density at `x`, linearly interpolated between the sampled points. */
function yAt(d: { xs: number[]; ys: number[] }, x: number): number {
  const i = d.xs.findIndex((v) => v >= x);
  if (i <= 0) return d.ys[Math.max(0, i)];
  const t = (x - d.xs[i - 1]) / (d.xs[i] - d.xs[i - 1]);
  return d.ys[i - 1] + (d.ys[i] - d.ys[i - 1]) * t;
}
