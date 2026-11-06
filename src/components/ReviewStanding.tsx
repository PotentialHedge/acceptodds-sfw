'use client';

import { useState } from 'react';
import useSWR from 'swr';
import type { z } from 'zod';
import { standingBand } from '@/lib/leaderboard';
import { NEAREST_COHORT, OVERALL, shareBelow, type ReviewCohort } from '@/lib/reviews';
import type * as S from '@/server/api/schemas';
import type { ReviewField, ReviewSeries } from '@/server/review-field';
import { StandingChart } from './StandingChart';
import { ui } from './ui';

type ReviewCohorts = z.output<typeof S.ReviewCohorts>;
type Among = 'venue' | ReviewCohort;

/** Not anonymous, unlike the map's reads: staging's basic auth has to come along. */
async function json(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

/** A switch's button, marked when it is the current choice. */
function Pick({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      className={`cursor-pointer ${on ? ui.on : 'hover:underline'}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * The review distribution, numbered as a figure: the paper's overall rating
 * among the reviewed papers at its venue, with a switch to any of its other
 * scores, and another to place it among the papers nearest it in embedding
 * space or among its related papers instead, fetched only then and drawn over the venue's
 * shape. `series` is never empty and starts with the overall.
 */
export function ReviewFigure({
  figure,
  series,
  slug,
}: {
  figure: number;
  series: readonly ReviewSeries[];
  slug: string;
}) {
  const [selected, setSelected] = useState(series[0].label);
  const [among, setAmong] = useState<Among>('venue');
  const { data, error, isLoading } = useSWR<ReviewCohorts>(
    among === 'venue' ? null : `/api/v1/listings/${encodeURIComponent(slug)}/review-cohorts`,
    json,
    { revalidateOnFocus: false },
  );
  const cohort = among === 'venue' ? undefined : data?.cohorts.find((c) => c.cohort === among);
  const shown: readonly ReviewSeries[] = cohort?.series ?? series;
  const at = shown.find((s) => s.label === selected) ?? shown[0];
  const name = at.label === OVERALL ? 'review rating' : at.label.toLowerCase();
  const others = cohort ? 'them' : 'the others';
  const note =
    among === 'venue' || cohort
      ? null
      : isLoading
        ? 'Loading…'
        : error
          ? 'That could not be loaded.'
          : 'Too few of these papers have reviews to draw.';
  return (
    <figure className="my-3">
      <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 font-sans text-xs text-muted">
        <div className="flex flex-wrap gap-x-3">
          <span>Among:</span>
          <Pick on={among === 'venue'} onClick={() => setAmong('venue')}>
            {`all of ${series[0].field.kind}`}
          </Pick>
          <Pick on={among === 'nearest'} onClick={() => setAmong('nearest')}>
            {`${NEAREST_COHORT} nearest`}
          </Pick>
          <Pick on={among === 'related'} onClick={() => setAmong('related')}>
            related papers
          </Pick>
          {note && <span className="italic">{note}</span>}
        </div>
        {shown.length > 1 && (
          <div className="flex flex-wrap gap-x-3">
            {shown.map((s) => (
              <Pick key={s.label} on={s === at} onClick={() => setSelected(s.label)}>
                {s.label}
              </Pick>
            ))}
          </div>
        )}
      </div>
      {cohort && <CohortKey cohort={cohort.cohort} field={at.field} />}
      <ReviewStanding key={`${among}:${at.label}`} field={at.field} mean={at.mean} name={name} within={!!cohort} />
      <figcaption className={ui.caption}>
        <b>Figure {figure}.</b> Mean {name} of {cohortPhrase(cohort?.cohort, at.field)}. This paper averages{' '}
        <span className="font-mono">{at.mean.toFixed(2)}</span> over{' '}
        {at.count === 1 ? 'one review' : `${at.count} reviews`}
        {at.field.ahead !== null && (
          <>
            , above {at.field.ahead}% of {others}
          </>
        )}
        .{cohort && ' The two curves show shapes, each scaled to the same height, not numbers of papers.'}
      </figcaption>
    </figure>
  );
}

/** What each mark on a cohort's chart is. Its swatches are drawn as the chart draws them. */
function CohortKey({ cohort, field }: { cohort: ReviewCohort; field: ReviewField }) {
  const line = (dashed: boolean, className: string) => (
    <svg width="22" height="8" aria-hidden className="mr-1.5 inline-block">
      <line
        x1="0"
        x2="22"
        y1="4"
        y2="4"
        strokeWidth={dashed ? 1.5 : 2}
        strokeDasharray={dashed ? '4 3' : undefined}
        className={className}
      />
    </svg>
  );
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 font-sans text-xs text-subtle">
      <li>
        {line(false, 'stroke-subtle')}
        {field.papers} {cohort === 'nearest' ? 'nearest' : 'related'} papers
      </li>
      <li>
        {line(true, 'stroke-muted')}
        all reviewed papers at {field.kind}
      </li>
    </ul>
  );
}

function cohortPhrase(cohort: ReviewCohort | undefined, field: ReviewField): string {
  if (cohort === 'nearest')
    return `the ${field.papers} reviewed papers among the ${NEAREST_COHORT} nearest this one in embedding space`;
  if (cohort === 'related')
    return `${field.papers === 1 ? 'the one reviewed paper' : `the ${field.papers} reviewed papers`} related to this one`;
  return `the reviewed papers at ${field.kind}`;
}

/**
 * A paper's mean on one score among the reviewed papers at its venue: the
 * shape of the field, the part below the paper shaded, and a line at its exact
 * mean. Means pile onto thirds, so bars show a comb; the curve shows the shape,
 * and hovering reads the exact share below any point.
 */
function ReviewStanding({
  field,
  mean,
  name,
  within,
}: {
  field: ReviewField;
  mean: number;
  name: string;
  /** A cohort rather than the whole venue. */
  within: boolean;
}) {
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
      reference={field.reference}
      label={label}
      format={{
        tick: (x) => String(x),
        ticks,
        ariaLabel: `Mean ${name} of ${within ? 'similar reviewed papers' : `the reviewed papers at ${field.kind}`}; ${label}, at ${mean.toFixed(2)}`,
        readout: (x) => (
          <>
            <span className="font-mono">{x.toFixed(2)}</span>
            <span className="text-muted">
              {' '}
              {Math.floor(shareBelow(field.atoms, x) * 100)}% of {within ? 'these papers' : 'papers'} are lower
            </span>
          </>
        ),
      }}
    />
  );
}
