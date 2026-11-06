'use client';

import { useState } from 'react';
import { standingBand } from '@/lib/leaderboard';
import { OVERALL, shareBelow } from '@/lib/reviews';
import type { ReviewField, ReviewSeries } from '@/server/review-field';
import { StandingChart } from './StandingChart';
import { ui } from './ui';

/**
 * The review distribution, numbered as a figure: the paper's overall rating
 * among the reviewed papers at its venue, with a switch to any of its other
 * scores. `series` is never empty and starts with the overall.
 */
export function ReviewFigure({ figure, series }: { figure: number; series: readonly ReviewSeries[] }) {
  const [selected, setSelected] = useState(series[0].label);
  const at = series.find((s) => s.label === selected) ?? series[0];
  const name = at.label === OVERALL ? 'review rating' : at.label.toLowerCase();
  return (
    <figure className="my-3">
      {series.length > 1 && (
        <div className="flex flex-wrap justify-end gap-x-3 font-sans text-xs text-muted">
          {series.map((s) => (
            <button
              key={s.label}
              type="button"
              aria-pressed={s === at}
              className={`cursor-pointer ${s === at ? ui.on : 'hover:underline'}`}
              onClick={() => setSelected(s.label)}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
      <ReviewStanding key={at.label} field={at.field} mean={at.mean} name={name} />
      <figcaption className={ui.caption}>
        <b>Figure {figure}.</b> Mean {name} of the reviewed papers at {at.field.kind}. This paper averages{' '}
        <span className="font-mono">{at.mean.toFixed(2)}</span> over{' '}
        {at.count === 1 ? 'one review' : `${at.count} reviews`}
        {at.field.ahead !== null && <>, above {at.field.ahead}% of the others</>}.
      </figcaption>
    </figure>
  );
}

/**
 * A paper's mean on one score among the reviewed papers at its venue: the
 * shape of the field, the part below the paper shaded, and a line at its exact
 * mean. Means pile onto thirds, so bars show a comb; the curve shows the shape,
 * and hovering reads the exact share below any point.
 */
function ReviewStanding({ field, mean, name }: { field: ReviewField; mean: number; name: string }) {
  const [lo, hi] = field.domain;
  // Every whole rating on a short scale; a long one is left to the chart, by its width.
  const ticks = hi - lo <= 6 ? Array.from({ length: hi - lo + 1 }, (_, i) => lo + i) : undefined;
  const label = field.ahead === null ? 'this paper' : `this paper, ${standingBand(field.ahead)}`;
  return (
    <StandingChart
      curve={field.curve}
      domain={field.domain}
      values={[]}
      you={mean}
      label={label}
      format={{
        tick: (x) => String(x),
        ticks,
        ariaLabel: `Mean ${name} of the reviewed papers at ${field.kind}; ${label}, at ${mean.toFixed(2)}`,
        readout: (x) => (
          <>
            <span className="font-mono">{x.toFixed(2)}</span>
            <span className="text-muted"> {Math.floor(shareBelow(field.atoms, x) * 100)}% of papers are lower</span>
          </>
        ),
      }}
    />
  );
}
