import type { Metadata } from 'next';
import type { ComponentProps } from 'react';
import Link from 'next/link';
import { cookies, headers } from 'next/headers';
import { Collapsible } from '@/components/Collapsible';
import { FilterIcon, MoreIcon } from '@/components/icons';
import { Pager } from '@/components/Pager';
import { SearchSyntax } from '@/components/SearchSyntax';
import { SearchInput } from '@/components/SearchInput';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/Popover';
import { PaperRow } from '@/components/PaperRow';
import { ScrollingLink } from '@/components/ScrollLink';
import { RememberVenue, VenueInUrl } from '@/components/RememberVenue';
import { RememberHomeSearch } from '@/components/HomeLink';
import { TitleBlock } from '@/components/TitleBlock';
import { Announcements } from '@/components/Announcements';
import { currentAnnouncements } from '@/server/announcements';
import { DISMISSED_COOKIE, parseDismissed } from '@/lib/announcements';
import { Wordmark } from '@/components/Wordmark';
import { ui } from '@/components/ui';
import { REPO_URL } from '@/lib/links';
import { parseSearch } from '@/lib/query';
import { normalizeSearch, SEARCH_MAX_LENGTH } from '@/lib/search';
import { viewerFromHeaders } from '@/server/auth';
import { currentVenue } from '@/server/current-venue';
import { siteName } from '@/server/share';
import * as events from '@/server/events';
import { browseListings, marketKinds, type BrowsePage, type BrowseRow, type BrowseSort } from '@/server/views';
import { canRecommend } from '@/server/recommendations';
import { rowLink } from '@/lib/paper-link';

export const dynamic = 'force-dynamic';

/** The selected filter link. */
const ON = ui.on;

/** Safe for work edition: a paper's status was its market's, so every list is every status. */
type Status = 'all';

/** Papers per page in the main list; `?page=` pages it. */
const PAGE = 50;
/** Followed papers per page in the "Following" section; `?fpage=` pages it. */
const FOLLOWING_PAGE = 10;
/** The cookie remembering whether that section was left collapsed. */
const FOLLOWING_COOKIE = 'home_following_open';

/** What the site is, above the search. Hidden while searching. */
const abstract = (
  <>
    The safe for work edition of acceptodds: the submissions, without the markets. Search them, browse them on a map
    laid out by what they are about, follow the ones you care about, keep reading lists with your group, and get
    recommendations from what you read. There are no odds, no bets and no reputation here. acceptodds is not affiliated
    with any organisation or institution. acceptodds is an open source project, open to contributions, at{' '}
    <a href={REPO_URL} className={ui.hyperref}>
      {REPO_URL.replace(/^https:\/\//, '')}
    </a>
    .
    <sup>
      <a href="#footnote-1" id="footnote-1-ref" className="text-accent">
        1
      </a>
    </sup>
  </>
);

/** The abstract's footnote, set at the foot of the page as a paper's is. */
const FOOTNOTE = (
  <div id="footnote-1" className="mt-10 text-sm leading-normal text-subtle">
    <hr className="mb-2 w-1/3 border-rule" />
    <sup className="text-accent">1</sup> If this project is interesting to you, reach out at{' '}
    <a href="mailto:hello@acceptodds.com" className={ui.hyperref}>
      hello@acceptodds.com
    </a>
    .
  </div>
);

/** The home page's sorts, default first. None reads a market. */
const SORTS: readonly BrowseSort[] = ['newest', 'popular'];
/** Sorts kept out of the row, in the ⋯ menu. */
const MENU_SORTS: readonly BrowseSort[] = [];
const sortLabel = (s: BrowseSort) => (s === 'popular' ? 'most read' : s);

/** The page's title after the wordmark. */
function homeTitle(kind: string | null): string {
  return kind ? `the papers of ${kind}` : 'the papers';
}

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Page `requested` (1-based) of a list, `size` rows a page. Past the end it
 * serves the last page, so a stale link after the list shrank still shows
 * something.
 */
async function pageOf(
  requested: string | string[] | undefined,
  size: number,
  query: Omit<Parameters<typeof browseListings>[0], 'offset' | 'limit'>,
): Promise<BrowsePage & { page: number; pages: number }> {
  const page = Math.max(1, Number.parseInt(one(requested) ?? '1', 10) || 1);
  let result = await browseListings({ ...query, offset: (page - 1) * size, limit: size });
  const pages = Math.max(1, Math.ceil(result.total / size));
  if (page <= pages) return { ...result, page, pages };
  result = await browseListings({ ...query, offset: (pages - 1) * size, limit: size });
  return { ...result, page: pages, pages };
}

/**
 * The venue the list shows: `?kind=` if given (`all` is none: a search of
 * every venue), else the navbar's (`currentVenue()`) if it has papers.
 */
function selectedKind(wanted: string | undefined, kinds: { kind: string }[], navVenue: string): string | null {
  if (wanted === 'all') return null;
  return wanted ?? (kinds.some((k) => k.kind === navVenue) ? navVenue : null);
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const kind = selectedKind(one((await searchParams).kind), await marketKinds(), await currentVenue());
  const title = `acceptodds: ${homeTitle(kind)}`;
  const description = 'Search, map and follow research papers: the safe for work edition of acceptodds.';
  return {
    title,
    openGraph: {
      title,
      description,
      url: kind ? `/?${new URLSearchParams({ kind })}` : '/',
      type: 'website',
      siteName: siteName(),
    },
    twitter: { card: 'summary', title, description },
  };
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const kinds = await marketKinds();
  const wanted = one(sp.kind);
  // The venue the navbar was drawn in: the list's, unless the URL names another.
  const navVenue = await currentVenue();
  const kind = selectedKind(wanted, kinds, navVenue);
  const status: Status = 'all';
  // A search keeps the venue and status filters (the form carries them) and
  // sorts by relevance unless another sort is asked for.
  const q = normalizeSearch(one(sp.q));
  // The search syntax (`lib/query.ts`). A `venue:` or `status:` in the query
  // says where to look, so the page's own filter of that kind steps aside.
  const parsed = q ? parseSearch(q) : null;
  const kindFilter = parsed?.fields.has('venue') ? null : kind;
  const statusFilter: Status = status;
  const viewer = await viewerFromHeaders(await headers());
  const me = viewer?.account.id ?? null;
  // `recommended` once the viewer has done enough for it to mean something (`server/recommendations.ts`).
  const recommends = me !== null && (await canRecommend(me));
  // It is then the default, listed first.
  const offered: readonly BrowseSort[] = recommends ? ['recommended', ...SORTS] : SORTS;
  const sorts: readonly BrowseSort[] = q ? ['relevance', ...offered] : offered;
  const sort: BrowseSort = (sorts as readonly string[]).includes(one(sp.sort) ?? '')
    ? (one(sp.sort) as BrowseSort)
    : q
      ? 'relevance'
      : offered[0];

  // One row per listing (a paper), read from its main market; plus one per
  // market that belongs to no listing. Each section is paged in the database.
  // ?following=1: only papers the signed-in viewer follows.
  const onlyFollowed = viewer !== null && one(sp.following) === '1';
  // ?tldr=1: each paper's TLDR under its authors.
  const showTldr = one(sp.tldr) === '1';
  // Papers the viewer follows are pinned above the list: same venue and sort,
  // paged on their own, and not repeated. Not while searching, nor when the
  // list is already only followed papers.
  const pins = me !== null && !q && !onlyFollowed;
  const browse = { kind, status, sort };
  const [all, followed, notes] = await Promise.all([
    pageOf(sp.page, PAGE, {
      ...browse,
      kind: kindFilter,
      status: statusFilter,
      q,
      followedBy: onlyFollowed ? me : null,
      exceptFollowedBy: pins ? me : null,
      recommendFor: me,
    }),
    pins ? pageOf(sp.fpage, FOLLOWING_PAGE, { ...browse, followedBy: me }) : null,
    // The admin's messages: this venue's and every venue's, or all of them when the list is every venue;
    // those for signed-in readers only to a signed-in viewer.
    currentAnnouncements(kind ?? undefined, viewer !== null),
  ]);
  const cookieJar = await cookies();
  const followingOpen = cookieJar.get(FOLLOWING_COOKIE)?.value !== '0';
  // Those this browser dismissed are left out here, never hidden after drawing.
  const dismissed = new Set(parseDismissed(cookieJar.get(DISMISSED_COOKIE)?.value));
  const announcements = notes.filter((a) => !dismissed.has(a.id));
  events.log('market.list', { accountId: me });

  // Filter links keep the search; `q: ''` drops it (and its relevance sort).
  // They go back to page 1: pages are kept only by the pagers' own links.
  // Every link names the venue, so a copied URL opens the same list for anyone,
  // whatever venue their own browser last picked.
  const href = (patch: Record<string, string>) => {
    const params = new URLSearchParams({
      kind: kind ?? 'all',
      sort,
      ...(q ? { q } : {}),
      ...(onlyFollowed ? { following: '1' } : {}),
      ...(showTldr ? { tldr: '1' } : {}),
      ...patch,
    });
    if (!params.get('q')) {
      params.delete('q');
      if (params.get('sort') === 'relevance') params.delete('sort');
    }
    if (params.get('following') === '0') params.delete('following');
    if (params.get('tldr') === '0') params.delete('tldr');
    for (const key of ['page', 'fpage']) if (params.get(key) === '1') params.delete(key);
    return `/?${params}`;
  };
  // A pager's link to page `p` of its section, keeping the other sections' pages.
  const pages = { page: String(all.page), fpage: String(followed?.page ?? 1) };
  const pageHref = (key: keyof typeof pages, anchor: string) => (p: number) =>
    `${href({ ...pages, [key]: String(p) })}${anchor}`;
  const filtered = kindFilter !== null;
  const pinnedCount = followed?.total ?? 0;
  // Shown on the ⋯ trigger when not the defaults.
  const activeFilters = [onlyFollowed && '★', showTldr && 'tldr'].filter(Boolean).join(', ');
  // The ⋯ trigger also names a sort picked from its menu, since the row doesn't show it.
  const menuSort = MENU_SORTS.includes(sort) ? sortLabel(sort) : null;
  const moreLabel = [menuSort, activeFilters].filter(Boolean).join(', ');

  return (
    <main className={ui.page}>
      {/* A venue named in the URL (a link from elsewhere) becomes the navbar's, and the one `/welcome` searches first. */}
      {wanted && kinds.some((k) => k.kind === wanted) && <RememberVenue kind={wanted} stale={wanted !== navVenue} />}
      {/* A venue taken from the cookie is written into the address bar, so sharing it shares the venue. */}
      {wanted === undefined && <VenueInUrl kind={kind ?? 'all'} />}
      {/* The logo, from any other page, comes back to this list as it is now. */}
      <RememberHomeSearch />
      <Announcements items={announcements} />
      <TitleBlock
        title={
          <>
            <Wordmark />: {homeTitle(kind)}
          </>
        }
        abstract={q ? null : abstract}
        abstractFull
      />
      {/* A plain GET form, so search works without JavaScript. */}
      <form action="/" method="get" role="search" className="mt-5 flex gap-2">
        <input type="hidden" name="kind" value={kind ?? 'all'} />
        {onlyFollowed && <input type="hidden" name="following" value="1" />}
        {showTldr && <input type="hidden" name="tldr" value="1" />}
        <SearchInput
          name="q"
          defaultValue={q ?? ''}
          maxLength={SEARCH_MAX_LENGTH}
          aria-label="Search papers"
          placeholder="Search papers"
          className={ui.searchInput}
        />
        <button type="submit" className={ui.searchBtn}>
          Search
        </button>
        <SearchHelp />
        {/* On a phone the filters fold into this one menu, with the search syntax. */}
        <Popover>
          <PopoverTrigger
            type="button"
            title="Filters and search syntax"
            aria-label="Filters and search syntax"
            className="relative hidden cursor-pointer px-2.5 text-muted hover:text-accent narrow:flex narrow:items-center"
          >
            <FilterIcon className="size-5" />
            {activeFilters && <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-accent" />}
          </PopoverTrigger>
          <PopoverContent align="end" className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto text-[13px]">
            <div>
              <h3 className={ui.boxHeading}>Sort</h3>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {sorts.map((s) => (
                  <PopoverClose key={s} asChild>
                    <SortLink pinned={pinnedCount > 0} href={href({ sort: s })} className={s === sort ? ON : ''}>
                      {sortLabel(s)}
                    </SortLink>
                  </PopoverClose>
                ))}
              </div>
            </div>
            {viewer && (
              <PopoverClose asChild>
                <Link href={href({ following: onlyFollowed ? '0' : '1' })} className={onlyFollowed ? ON : ''}>
                  ★ following only
                </Link>
              </PopoverClose>
            )}
            <PopoverClose asChild>
              <Link href={href({ tldr: showTldr ? '0' : '1' })} className={showTldr ? ON : ''}>
                show TLDRs
              </Link>
            </PopoverClose>
            <details className="border-t border-rule pt-2.5">
              <summary className={`${ui.runIn} cursor-pointer`}>Search syntax</summary>
              <div className="mt-2 text-xs leading-normal text-muted">
                <SearchSyntax />
              </div>
            </details>
          </PopoverContent>
        </Popover>
      </form>

      {parsed && parsed.errors.length > 0 && (
        <div className="mt-2 font-sans text-[13px] text-down">Ignored: {parsed.errors.join('; ')}</div>
      )}

      {q && (
        <div className="mt-2 font-sans text-[13px] text-muted">
          {all.total.toLocaleString('en')} {all.total === 1 ? 'result' : 'results'} for “{q}”
          {filtered && <> in {kindFilter ?? 'all venues'}.</>} <Link href={href({ q: '' })}>clear</Link>
        </div>
      )}

      <div className="mt-2 mb-1 flex flex-wrap items-baseline gap-x-4.5 gap-y-1.5 font-sans text-[13px] text-muted narrow:hidden">
        <span className="flex-1" />
        <span className="flex flex-wrap gap-x-3 gap-y-1">
          sort:
          {sorts
            .filter((s) => !MENU_SORTS.includes(s))
            .map((s) => (
              <SortLink key={s} pinned={pinnedCount > 0} href={href({ sort: s })} className={s === sort ? ON : ''}>
                {sortLabel(s)}
              </SortLink>
            ))}
        </span>
        {/* The rarer sorts, status and following, out of the way. */}
        <Popover>
          {/* Not a flex box: an icon alone gives a flex item no text baseline, and the row aligns on
              baselines. Inline, `align-middle` centres the dots on the text's x-height. */}
          <PopoverTrigger
            title="More filters: following, TLDRs"
            className="-my-1 cursor-pointer px-1 py-1 text-ink hover:text-accent"
          >
            {moreLabel}
            <MoreIcon className={`inline-block size-5 align-middle ${moreLabel ? 'ml-1' : ''}`} />
          </PopoverTrigger>
          <PopoverContent menu align="end" className="text-[13px]">
            {MENU_SORTS.map((s) => (
              <PopoverClose key={s} asChild>
                <SortLink pinned={pinnedCount > 0} href={href({ sort: s })} className={s === sort ? ON : ''}>
                  sort: {sortLabel(s)}
                </SortLink>
              </PopoverClose>
            ))}
            {viewer && (
              <PopoverClose asChild>
                <Link href={href({ following: onlyFollowed ? '0' : '1' })} className={onlyFollowed ? ON : ''}>
                  ★ following
                </Link>
              </PopoverClose>
            )}
            <PopoverClose asChild>
              <Link href={href({ tldr: showTldr ? '0' : '1' })} className={showTldr ? ON : ''}>
                show TLDRs
              </Link>
            </PopoverClose>
          </PopoverContent>
        </Popover>
      </div>

      {all.total + pinnedCount === 0 &&
        (q ? (
          <div className={ui.empty}>
            No {onlyFollowed ? 'papers you follow' : 'papers'} match “{q}”.
          </div>
        ) : onlyFollowed ? (
          <div className={ui.empty}>No papers you follow here. Follow one with ☆ on its page.</div>
        ) : (
          <div className={ui.empty}>Nothing here yet.</div>
        ))}

      {followed && followed.total > 0 && (
        <Collapsible
          id="following"
          cookie={FOLLOWING_COOKIE}
          open={followingOpen}
          className="group"
          summary={
            <>
              Following <span className="font-normal">({followed.total})</span>
            </>
          }
        >
          {followed.rows.map((r) => (
            <Row key={rowKey(r)} r={r} tldr={showTldr} />
          ))}
          <Pager page={followed.page} pages={followed.pages} href={pageHref('fpage', '#following')} />
        </Collapsible>
      )}

      {all.total > 0 && (
        <section id="all">
          {pinnedCount > 0 ? (
            <h2 className={`mt-7 mb-2 ${ui.section}`}>
              All papers <span className="font-normal">({all.total.toLocaleString('en')})</span>
            </h2>
          ) : (
            <div className="h-3.5" />
          )}
          {all.rows.map((r) => (
            <Row key={rowKey(r)} r={r} tldr={showTldr} />
          ))}
          <Pager page={all.page} pages={all.pages} href={pageHref('page', pinnedCount > 0 ? '#all' : '')} />
        </section>
      )}

      {!q && FOOTNOTE}
      <p className="mt-6 font-sans text-xs text-muted">
        <Link href="/privacy" className="text-muted">
          Privacy
        </Link>
      </p>
    </main>
  );
}

/** The search syntax (`lib/query.ts`), behind a `?` beside the Search button. */
function SearchHelp() {
  return (
    <Popover>
      <PopoverTrigger
        type="button"
        title="Search syntax"
        aria-label="Search syntax"
        className="cursor-pointer px-1 font-sans text-sm text-muted hover:text-accent narrow:hidden"
      >
        ?
      </PopoverTrigger>
      <PopoverContent align="end" className="text-xs leading-normal text-muted">
        <SearchSyntax />
      </PopoverContent>
    </Popover>
  );
}

/**
 * One paper (or unlisted market) in a list. The whole row opens it: the
 * title's link is stretched over the row (`after:inset-0`), since a row that
 * is itself a link could not hold the paper's own PDF link, which sits above
 * the stretched one, in a column of its own at the left so titles align.
 */
function Row({ r, tldr }: { r: BrowseRow; tldr: boolean }) {
  const pdf = rowLink(r.listing?.links ?? []);
  return (
    <PaperRow
      title={r.listing?.title ?? r.main?.market.question ?? ''}
      authors={r.listing?.authors ?? []}
      pdf={pdf}
      tldr={tldr ? r.listing?.tldr : null}
      href={r.listing ? `/papers/${r.listing.slug}` : `/markets/${r.main?.market.slug}`}
    />
  );
}

/** A row's key: its listing, or its standalone market. */
function rowKey(r: BrowseRow): string {
  return r.listing?.id ?? r.main?.market.id ?? '';
}

/**
 * A sort's link. A sort reorders the list, not the sections pinned above it,
 * so with any shown it scrolls slowly to "All papers", a quarter down the
 * window, and the re-sorted page keeps that place.
 */
function SortLink({ pinned, ...props }: ComponentProps<typeof Link> & { pinned: boolean }) {
  return pinned ? <ScrollingLink to="all" at={0.25} {...props} /> : <Link {...props} />;
}
