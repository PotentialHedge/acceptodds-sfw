'use client';

import { useState, type FormEvent } from 'react';
import useSWR from 'swr';
import type { z } from 'zod';
import { standingBand } from '@/lib/leaderboard';
import { NEAREST_COHORT, OVERALL, shareBelow, type ReviewCohort } from '@/lib/reviews';
import type * as S from '@/server/api/schemas';
import { SEARCH_MAX_LENGTH } from '@/lib/search';
import type { ReviewField, ReviewSeries } from '@/server/review-field';
import { Popover, PopoverContent, PopoverTrigger } from './Popover';
import { SearchSyntax } from './SearchSyntax';
import { StandingChart } from './StandingChart';
import { ui } from './ui';

type ReviewCohorts = z.output<typeof S.ReviewCohorts>;
type ReviewQuery = z.output<typeof S.ReviewQuery>;
/** `search`: the papers at the venue a query in the home page's search syntax finds. */
type Among = 'venue' | ReviewCohort | 'search';
/** A cohort as the chart draws it: what it is, and the paper's scores among it. */
type Shown = { cohort: ReviewCohort | 'search'; series: readonly ReviewSeries[] };

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
 * space, among its related papers, or among the papers at its venue that a
 * search in the home page's syntax finds instead, fetched only then and drawn
 * over the venue's shape. `series` is never empty and starts with the overall.
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
  /** The query submitted, trimmed; empty before one is. */
  const [query, setQuery] = useState('');
  const base = `/api/v1/listings/${encodeURIComponent(slug)}`;
  const cohorts = useSWR<ReviewCohorts>(
    among === 'nearest' || among === 'related' ? `${base}/review-cohorts` : null,
    json,
    { revalidateOnFocus: false },
  );
  const found = useSWR<ReviewQuery>(
    among === 'search' && query ? `${base}/review-query?q=${encodeURIComponent(query)}` : null,
    json,
    { revalidateOnFocus: false },
  );
  const { error, isLoading } = among === 'search' ? found : cohorts;
  const cohort: Shown | undefined =
    among === 'venue'
      ? undefined
      : among === 'search'
        ? found.data && found.data.series.length > 0
          ? { cohort: 'search', series: found.data.series }
          : undefined
        : cohorts.data?.cohorts.find((c) => c.cohort === among);
  const shown: readonly ReviewSeries[] = cohort?.series ?? series;
  const at = shown.find((s) => s.label === selected) ?? shown[0];
  const name = at.label === OVERALL ? 'review rating' : at.label.toLowerCase();
  const others = cohort ? 'them' : 'the others';
  const matched = found.data?.papers ?? 0;
  const note =
    among === 'venue' || (among === 'search' && !query)
      ? null
      : isLoading
        ? 'Loading…'
        : error
          ? 'That could not be loaded.'
          : cohort
            ? null
            : among === 'search' && matched === 0
              ? 'No other reviewed papers match.'
              : `Too few of these papers have reviews to draw${among === 'search' ? ` (${matched} found)` : ''}.`;
  function search(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = String(new FormData(e.currentTarget).get('q') ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    setQuery(q);
  }
  return (
    <figure className="my-3">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 font-sans text-xs text-muted">
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
          <Pick on={among === 'search'} onClick={() => setAmong('search')}>
            a search
          </Pick>
          {note && <span className="italic">{note}</span>}
        </div>
        {shown.length > 1 && (
          <select
            aria-label="Score"
            value={at.label}
            onChange={(e) => setSelected(e.target.value)}
            className="cursor-pointer border border-rule bg-card px-1.5 py-0.5 text-ink"
          >
            {shown.map((s) => (
              <option key={s.label} value={s.label}>
                {s.label}
              </option>
            ))}
          </select>
        )}
      </div>
      {among === 'search' && (
        <SearchCohort query={query} onSubmit={search} errors={found.data?.errors ?? []} kind={series[0].field.kind} />
      )}
      {cohort && <CohortKey cohort={cohort.cohort} field={at.field} query={query} />}
      <ReviewStanding
        key={`${among}:${among === 'search' ? query : ''}:${at.label}`}
        field={at.field}
        mean={at.mean}
        name={name}
        within={!!cohort}
      />
      <figcaption className={ui.caption}>
        <b>Figure {figure}.</b> Mean {name} of {cohortPhrase(cohort?.cohort, at.field, query)}. This paper averages{' '}
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

/**
 * The search a `search` cohort is of: the home page's syntax, within the
 * paper's venue, submitted on Enter. Terms the parser dropped are listed
 * under it, as on the home page.
 */
function SearchCohort({
  query,
  onSubmit,
  errors,
  kind,
}: {
  query: string;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  errors: readonly string[];
  kind: string;
}) {
  return (
    <>
      <form role="search" onSubmit={onSubmit} className="mt-2 flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query}
          maxLength={SEARCH_MAX_LENGTH}
          aria-label={`Search papers at ${kind} to compare with`}
          placeholder="e.g. keyword:diffusion rating>=3"
          // Only shown once chosen: the reader just asked for it.
          autoFocus={query === ''}
          className={ui.searchInput}
        />
        <button type="submit" className={ui.searchBtn}>
          Compare
        </button>
        <Popover>
          <PopoverTrigger
            type="button"
            title="Search syntax"
            aria-label="Search syntax"
            className="cursor-pointer px-1 font-sans text-sm text-muted hover:text-accent"
          >
            ?
          </PopoverTrigger>
          <PopoverContent align="end" className="text-xs leading-normal text-muted">
            <SearchSyntax />
          </PopoverContent>
        </Popover>
      </form>
      {errors.length > 0 && <div className="mt-1 font-sans text-xs text-down">Ignored: {errors.join('; ')}</div>}
    </>
  );
}

/**
 * What each mark on a cohort's chart is. Its swatches are drawn as the chart draws them. A search's
 * key ends with the same search on the home page, in a new tab, to see the papers themselves.
 */
function CohortKey({ cohort, field, query }: { cohort: Shown['cohort']; field: ReviewField; query: string }) {
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
    <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-0.5 font-sans text-xs text-subtle">
      <li>
        {line(false, 'stroke-subtle')}
        {field.papers} {{ nearest: 'nearest', related: 'related', search: 'matching' }[cohort]} papers
      </li>
      <li>
        {line(true, 'stroke-muted')}
        all reviewed papers at {field.kind}
      </li>
      {cohort === 'search' && (
        <li className="ml-auto">
          <a
            href={`/?${new URLSearchParams({ kind: field.kind, q: query })}`}
            target="_blank"
            rel="noopener"
            className={ui.linkBtn}
          >
            Open search <span aria-hidden>↗</span>
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </li>
      )}
    </ul>
  );
}

function cohortPhrase(cohort: Shown['cohort'] | undefined, field: ReviewField, query: string): string {
  if (cohort === 'search')
    return `the ${field.papers === 1 ? 'one reviewed paper' : `${field.papers} reviewed papers`} at ${field.kind} that \u201c${query}\u201d finds, this one left out`;
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
