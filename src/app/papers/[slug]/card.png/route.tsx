import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ImageResponse } from 'next/og';
import { CARD } from '@/lib/preview-tags';
import { cardCurve, plainText } from '@/lib/review-card';
import { meanRating } from '@/lib/reviews';
import { ReadCache } from '@/server/read-cache';
import { reviewField, type ReviewField } from '@/server/review-field';
import { reviewsOf } from '@/server/reviews';
import { shareSubject, siteName } from '@/server/share';
import { authorLine } from '@/components/PaperRow';
import { standingBand } from '@/lib/leaderboard';

export const dynamic = 'force-dynamic';

const INK = '#1d1d1d';
const MUTED = '#777777';
const ACCENT = '#b31b1b';
const PAPER = '#fbfaf7';
const FIELD = '#e7e3d9';
const CURVE = '#555555';
const RULE = '#bdb8ac';

const PAD = 56;
const CHART = { width: CARD.width - 2 * PAD, height: 140 };
const HEADROOM = 10;

const font = readFile(path.join(process.cwd(), 'assets/fonts/LiberationSerif-Regular.ttf'));

/** Cards are drawn at most once an hour per paper: drawing is the expensive part, and it is anonymous. */
const cards = new ReadCache(200);
const TTL_MS = 3_600_000;

/**
 * A paper's share card, `/papers/<slug>/card.png`: its title and authors, and
 * where its mean review rating sits among the venue's papers. A paper with no
 * placed rating shows its abstract instead. Public: a crawler has no cookie,
 * and the path's `.png` keeps it clear of the gate (`proxy.ts`).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const slug = decodeURIComponent((await params).slug);
  const subject = await shareSubject(slug);
  const listing = subject?.listing;
  if (!subject || !listing) return new Response('Not found', { status: 404 });
  const png = await cards.get(listing.id, TTL_MS, async () => {
    const reviews = await reviewsOf(listing.id);
    const rated = reviews.flatMap((r) => (r.kind === 'review' && r.rating !== null ? [r.rating] : []));
    const mean = meanRating(rated);
    const field = await reviewField(listing.kind, mean);
    const image = new ImageResponse(
      <Card
        title={plainText(listing.title)}
        authors={authorLine(listing.authors)}
        summary={plainText(listing.summary ?? '')}
        venue={subject.kind}
        placed={field && mean !== null ? { field, mean, count: rated.length } : null}
      />,
      { ...CARD, fonts: [{ name: 'Serif', data: await font, weight: 400, style: 'normal' }] },
    );
    return new Uint8Array(await image.arrayBuffer());
  });
  return new Response(png, {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600, s-maxage=3600' },
  });
}

function Card({
  title,
  authors,
  summary,
  venue,
  placed,
}: {
  title: string;
  authors: string;
  summary: string;
  venue: string | null;
  placed: { field: ReviewField; mean: number; count: number } | null;
}) {
  const name = siteName();
  const split = name.endsWith('odds') ? name.length - 'odds'.length : name.length;
  return (
    <div
      style={{
        ...CARD,
        display: 'flex',
        flexDirection: 'column',
        padding: `40px ${PAD}px 36px`,
        background: PAPER,
        color: INK,
        fontFamily: 'Serif',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 26 }}>
        <div style={{ display: 'flex' }}>
          <span>{name.slice(0, split)}</span>
          <span style={{ color: ACCENT }}>{name.slice(split)}</span>
        </div>
        <span style={{ color: MUTED }}>{venue ?? ''}</span>
      </div>
      <div
        style={{
          display: 'block',
          marginTop: 22,
          fontSize: 46,
          lineHeight: 1.16,
          lineClamp: placed ? 2 : 3,
          textOverflow: 'ellipsis',
        }}
      >
        {title}
      </div>
      {authors && (
        <div style={{ display: 'block', marginTop: 10, fontSize: 25, color: MUTED, lineClamp: 1 }}>{authors}</div>
      )}
      {placed ? (
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
          {placed.field.ahead !== null && (
            <div style={{ display: 'flex', flexGrow: 1, alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ display: 'flex', alignItems: 'baseline', fontSize: 68, lineHeight: 1 }}>
                <span style={{ color: ACCENT }}>{standingBand(placed.field.ahead)}</span>
                <span style={{ fontSize: 40, color: MUTED, marginLeft: 18 }}>of {placed.field.kind}</span>
              </span>
            </div>
          )}
          <Chart {...placed} />
        </div>
      ) : (
        <div
          style={{ display: 'block', marginTop: 24, fontSize: 27, lineHeight: 1.35, color: '#444444', lineClamp: 7 }}
        >
          {summary}
        </div>
      )}
    </div>
  );
}

function Chart({ field, mean, count }: { field: ReviewField; mean: number; count: number }) {
  const { width, height } = CHART;
  const c = cardCurve(field.curve, field.domain, mean, width, height);
  const [lo, hi] = field.domain;
  const ticks = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const reviews = count === 1 ? 'one review' : `${count} reviews`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', marginTop: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', fontSize: 30, marginBottom: 12 }}>
        <span style={{ color: ACCENT, fontSize: 40, marginRight: 12 }}>{mean.toFixed(2)}</span>
        <span>mean rating over {reviews}</span>
      </div>
      {/* Headroom: at the curve's peak the marker would be cut off at the top. */}
      <svg width={width} height={height + HEADROOM} viewBox={`0 ${-HEADROOM} ${width} ${height + HEADROOM}`}>
        <path d={c.area} fill={FIELD} />
        <path d={c.below} fill={ACCENT} fillOpacity={0.2} />
        <path d={c.line} fill="none" stroke={CURVE} strokeWidth={3} strokeLinejoin="round" />
        <line x1={c.x} x2={c.x} y1={height} y2={Math.min(c.y, 8)} stroke={ACCENT} strokeWidth={3} />
        <circle cx={c.x} cy={c.y} r={7} fill={ACCENT} stroke={PAPER} strokeWidth={3} />
        <line x1={0} x2={width} y1={height - 1} y2={height - 1} stroke={RULE} strokeWidth={2} />
      </svg>
      <div style={{ display: 'flex', position: 'relative', height: 30, marginTop: 6, fontSize: 23, color: MUTED }}>
        {ticks.map((t) => {
          const at = ((t - lo) / (hi - lo)) * width;
          const edge = t === lo ? { left: 0 } : t === hi ? { right: 0 } : { left: at - 6 };
          return (
            <span key={t} style={{ position: 'absolute', ...edge }}>
              {t}
            </span>
          );
        })}
      </div>
    </div>
  );
}
