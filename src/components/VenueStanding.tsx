'use client';

import { countBelow } from '@/lib/distribution';
import { percentAhead, standingBand } from '@/lib/leaderboard';
import type { VenueField } from '@/server/venue-field';
import { FieldBars } from './FieldBars';

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
  const label = ahead === null ? 'this paper' : `this paper, ${standingBand(ahead)}`;
  const n = field.bins.length;
  const step = 100 / n;
  return (
    <FieldBars
      bins={field.bins}
      mine={Math.min(n - 1, Math.floor((percent / 100) * n))}
      label={label}
      ariaLabel={`Chance of acceptance of ${among}; ${label}`}
      ticks={[0, 25, 50, 75, 100].map((t) => ({ at: t / 100, text: `${t}%` }))}
      binLabel={(i) => `${Math.round(i * step)}–${Math.round((i + 1) * step)}%`}
    />
  );
}
