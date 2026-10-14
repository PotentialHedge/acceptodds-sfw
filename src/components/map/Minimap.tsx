'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import type { z } from 'zod';
import { ui } from '@/components/ui';
import { categoryRgb, frameAround, topicLabels } from '@/lib/map';
import type { LayoutFrame, LayoutRequest } from '@/lib/map-layout.worker';
import type * as S from '@/server/api/schemas';

const MapCanvas = dynamic(() => import('./MapCanvas'), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center italic text-muted">Loading the map…</div>,
});

/** Smallest cluster that gets its name on the minimap. */
const MIN_LABELLED = 6;
const DOT_RADIUS = 3.2;
/** Papers that are neither this one nor related to it: there, but behind. */
const CONTEXT_OPACITY = 0.45;
/** Share of a redrawn piece the view fits: all of it, since the layout is compact. */
const REDRAWN_FIT = 1;
/** How far below the window the figure starts loading, so it is there by the time it is scrolled to. */
const LOAD_AHEAD = '600px';

type MinimapView = z.output<typeof S.Minimap>;

/**
 * The paper page's minimap, loaded lazily: nothing is fetched, and neither
 * deck.gl nor the layout worker is loaded, until the figure comes near the
 * window (`GET /listings/{slug}/minimap`, public and cached). A reader who
 * never scrolls to it, and a crawler, costs the server nothing.
 */
export function Minimap({ slug, figure }: { slug: string; figure: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el || near) return;
    const seen = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), {
      rootMargin: LOAD_AHEAD,
    });
    seen.observe(el);
    return () => seen.disconnect();
  }, [near]);
  const { data, error } = useSWR<MinimapView>(
    near ? `/api/v1/listings/${encodeURIComponent(slug)}/minimap` : null,
    publicJson,
    { revalidateOnFocus: false },
  );
  if (data) return <MinimapFigure minimap={data} figure={figure} />;
  return (
    <figure className="mb-4">
      <Frame ref={box}>
        <div className="grid h-full place-items-center italic text-muted">
          {error ? 'The map could not be loaded.' : 'Loading the map…'}
        </div>
      </Frame>
    </figure>
  );
}

/** Public reads go anonymously, as on `/map`, so they spend no one's rate limit. */
async function publicJson(url: string) {
  const r = await fetch(url, { credentials: 'omit' });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

/** The figure's box: the same size loading as loaded, so nothing below it jumps. */
function Frame({ ref, children }: { ref?: Ref<HTMLDivElement>; children: ReactNode }) {
  return (
    <div ref={ref} className="relative h-[380px] overflow-hidden border border-rule bg-bg narrow:h-[300px]">
      {children}
    </div>
  );
}

/**
 * A paper's piece of the map (`views.listingMinimap`), drawn by `/map`'s own
 * canvas: the paper, its nearest papers and its related papers,
 * coloured by cluster and named as there, with this paper selected and
 * lines to its related papers, as `/map` draws a selection. Redrawn by
 * default, in a worker like `/map`'s search, when every paper has a
 * supplied vector: `embedAround` lays the piece out again by UMAP over the
 * vectors, related pairs drawn closer, starting from the map; animated from
 * the map, framed round the paper (`frameAround`). Display only.
 * Hover names a paper; a click opens the full map on it, selected. Drag pans; ⌘ or Ctrl + scroll, a
 * pinch or a double click zooms. On a touch screen one finger scrolls the page and two move the map.
 */
function MinimapFigure({ minimap, figure }: { minimap: MinimapView; figure: number }) {
  const router = useRouter();
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null);
  const [redraw, setRedraw] = useState(true);
  const { points, vectors, self, related, relatedElsewhere, edges } = minimap;
  const redrawable = vectors !== null && points.length >= 4;

  const supplied = useMemo(() => Float32Array.from(points.flatMap((p) => [p.x, p.y])), [points]);
  const colours = useMemo(() => {
    const out = new Uint8Array(points.length * 4);
    points.forEach((p, i) => {
      out.set(categoryRgb(p.cluster), 4 * i);
      out[4 * i + 3] = 220;
    });
    return out;
  }, [points]);

  // The redraw, frame by frame; `null` until the worker sends its first.
  const [layout, setLayout] = useState<{ positions: Float32Array; settled: boolean } | null>(null);
  useEffect(() => {
    if (!redraw || !vectors || points.length < 4) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const worker = new Worker(new URL('../../lib/map-layout.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<LayoutFrame>) => {
      if (still && !e.data.settled) return;
      setLayout({ positions: e.data.positions, settled: e.data.settled });
    };
    const start = Float32Array.from(supplied);
    worker.postMessage(
      { id: 1, start, around: { vectors, self, ranked: related, related: edges } } satisfies LayoutRequest,
      { transfer: [start.buffer] },
    );
    return () => {
      worker.terminate();
      setLayout(null);
    };
  }, [redraw, points, vectors, supplied, self, related, edges]);

  const shown = redraw && layout ? layout : { positions: supplied, settled: true };
  // Redrawn, the piece is compact round the paper: fit nearly all of it, not only the nearest.
  const take = redraw && layout ? Math.floor((points.length - 1) * REDRAWN_FIT) : undefined;
  const positions = useMemo(
    () => frameAround(shown.positions, self, related, take),
    [shown.positions, self, related, take],
  );
  const settled = shown.settled;
  // Named once it stops moving: labels chasing a settling layout only flicker.
  const clusters = useMemo(() => {
    if (!settled) return [];
    const names = new Map(minimap.clusters.map((c) => [c.number, c.label]));
    return topicLabels(
      positions,
      points.map((p) => p.cluster),
      names,
      MIN_LABELLED,
    );
  }, [settled, positions, points, minimap.clusters]);
  const none = useMemo<number[]>(() => [], []);

  const hovered = hover ? points[hover.index] : null;
  const shownRelated = related.length;
  return (
    <figure className="mb-4">
      <Frame>
        <MapCanvas
          positions={positions}
          colours={colours}
          shown={null}
          starred={none}
          held={none}
          regions={[]}
          clusters={clusters}
          labelMode="cluster"
          selected={self}
          neighbours={related}
          focus={null}
          onHover={setHover}
          onSelect={(i) => {
            if (i !== null) router.push(mapHref(points[i].slug));
          }}
          dotRadius={DOT_RADIUS}
          dimmed={CONTEXT_OPACITY}
          embedded
        />
        {hover && hovered && (
          <div
            className="pointer-events-none absolute z-20 max-w-[340px] bg-ink px-2 py-1 font-sans text-xs text-white"
            style={{ left: hover.x + 14, top: hover.y + 10 }}
          >
            {hover.index === self ? <i>This paper</i> : hovered.title}
          </div>
        )}
        <div className="pointer-events-none absolute right-2 bottom-2 left-2 z-10 flex items-end justify-between gap-2 font-sans text-xs">
          {redrawable ? (
            <span className="pointer-events-auto border border-frame bg-card/95 px-2 py-0.5 text-subtle">
              <Choice on={redraw} onClick={() => setRedraw(true)}>
                redrawn
              </Choice>
              {' · '}
              <Choice on={!redraw} onClick={() => setRedraw(false)}>
                as on the map
              </Choice>
            </span>
          ) : (
            <span />
          )}
          <Link
            href={mapHref(points[self].slug)}
            className="pointer-events-auto border border-frame bg-card/95 px-2 py-0.5"
          >
            Open the full map
          </Link>
        </div>
      </Frame>
      <figcaption className="mt-1 text-[13px] text-subtle">
        <b>Figure {figure}.</b> This paper (maroon) with its related papers and the papers nearest it on the map of
        papers, coloured by cluster.{' '}
        {redraw && redrawable
          ? 'Redrawn from the papers’ embeddings alone, so that papers close in content, and above all related ones, lie close; turned as on the map. '
          : 'Placed as on the map, where a related paper may lie off the edge. '}
        {shownRelated > 0 &&
          `Lines go to ${shownRelated === 1 ? 'the one related paper' : `the ${shownRelated} related papers`}${relatedElsewhere > 0 ? ` (${relatedElsewhere} more are not on the map)` : ''}. `}
        Drag to pan, ⌘/Ctrl + scroll or double-click to zoom (on a touch screen, two fingers pan and zoom), click a
        paper to find it on the full map.
      </figcaption>
    </figure>
  );
}

/** The full map, opened on a paper, selected. */
function mapHref(slug: string): string {
  return `/map?paper=${encodeURIComponent(slug)}`;
}

/** One of the layout switch's two words: the current one marked, the other a button. */
function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  if (on) return <span className={ui.on}>{children}</span>;
  return (
    <button type="button" className={ui.linkBtn} onClick={onClick}>
      {children}
    </button>
  );
}
