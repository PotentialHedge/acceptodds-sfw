'use client';

import { standingBand } from '@/lib/leaderboard';
import { shareBelow } from '@/lib/reviews';
import type { ReviewField } from '@/server/review-field';
import { StandingChart } from './StandingChart';

/**
 * A paper's mean review rating among the reviewed papers at its venue: the
 * shape of the field, the part below the paper shaded, and a line at its exact
 * mean. Means pile onto thirds, so bars show a comb; the curve shows the shape,
 * and hovering reads the exact share below any point.
 */
export function ReviewStanding({ field, mean }: { field: ReviewField; mean: number }) {
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
        ariaLabel: `Mean review rating of the reviewed papers at ${field.kind}; ${label}, at ${mean.toFixed(2)}`,
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
