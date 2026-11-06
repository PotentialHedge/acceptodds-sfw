'use client';

import { binOf } from '@/lib/reviews';
import { standingBand } from '@/lib/leaderboard';
import type { ReviewField } from '@/server/review-field';
import { FieldBars } from './FieldBars';

/** A paper's mean review rating among the reviewed papers at its venue: `FieldBars` on the venue's own scale. */
export function ReviewStanding({ field, mean }: { field: ReviewField; mean: number }) {
  const [lo, hi] = field.domain;
  const n = field.bins.length;
  const step = (hi - lo) / n;
  const label = field.ahead === null ? 'this paper' : `this paper, ${standingBand(field.ahead)}`;
  const ticks = Array.from({ length: hi - lo + 1 }, (_, i) => ({ at: i / (hi - lo), text: String(lo + i) }));
  return (
    <FieldBars
      bins={field.bins}
      mine={binOf(mean, field.domain, n)}
      label={label}
      ariaLabel={`Mean review rating of the reviewed papers at ${field.kind}; ${label}, at ${mean.toFixed(2)}`}
      ticks={ticks}
      binLabel={(i) => `${(lo + i * step).toFixed(2)}–${(lo + (i + 1) * step).toFixed(2)}`}
    />
  );
}
