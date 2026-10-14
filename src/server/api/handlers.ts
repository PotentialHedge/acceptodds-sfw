import { readingList, readingStatuses, setListingRead, setReadingList } from '../reading';
import { isUniqueViolation } from '@/db/errors';
import type { Announcement } from '@/db/schema';
import {
  authenticate,
  requireAuth,
  requireScope,
  requireSession,
  requireTradingEligibility,
  type Principal,
} from '../auth';
import { getPortfolio, setDisplayName, startingBalanceMicro } from '../accounts';
import { walletsOf } from '../wallets';
import { runningVersion } from '../version';
import { defaultMarketKind } from '@/lib/venue';
import * as engine from '../engine';
import { buyOnListing, openListingMarket, openWithListing } from '../market-start';
import * as events from '../events';
import { backComment, withdrawBacking } from '../backings';
import { getComment, listComments, listMentions, listReplies, postComment } from '../comments';
import { getPaperComment, listPaperComments, listPaperReplies, postPaperComment } from '../discussion';
import { parseEmoji, reactionsOf, setReaction } from '../reactions';
import { mailMentions } from '../mentions';
import { follow, followedListings, setDigestOptIn, setMentionMailOptIn, unfollow } from '../follows';
import {
  createGroup,
  deleteGroup as deleteGroupRow,
  groupById,
  groupMembersOf,
  groupsOf,
  joinGroup,
  removeMember,
  roleIn,
  rotateInvite,
  updateGroup,
} from '../groups';
import { setClosed, setRelated, setText, upsertListing } from '../listings';
import { setMap } from '../map';
import { currentAnnouncements, deleteAnnouncement as deleteAnnouncementRow, postAnnouncement } from '../announcements';
import { mapCached } from '../map-cache';
import { countTransition, countView } from '../view-counter';
import { publicPosition, publicPositionsOf, publish, unpublish } from '../public-positions';
import { listTokens, mintToken, revokeToken } from '../tokens';
import { issueAgentCode, redeemAgentCode, requestAgentCode } from '../agent-codes';
import { addAffiliation, listAffiliations, removeAffiliation, verifyAffiliation } from '../affiliations';
import {
  clearPendingBet,
  newBrowserNonce,
  ONBOARDING_BROWSER_COOKIE,
  setFirstPassword,
  startOnboarding,
} from '../onboarding';
import {
  accountOrders,
  isFirstOrder,
  leaderboard as leaderboardView,
  listListings as listListingsView,
  listingCitations,
  listingMinimap,
  listingRelatedTo,
  listingText,
  listingTransitionCounts,
  listMarkets as listMarketsView,
  listingView,
  marketTape,
  marketView,
  mapRelated,
  mapTitles,
  mapSearch,
  paperMap,
  priceHistory,
  publicAccount,
  resolveListing,
  resolveMarket,
} from '../views';
import { ApiError } from './errors';
import {
  clientIp,
  parseBody,
  parseParam,
  parseQuery,
  prepare,
  preparedResponse,
  respond,
  route,
  toIso,
  toIsoOrNull,
} from './http';
import {
  presentFill,
  presentFollowed,
  presentGroup,
  presentGroupSummary,
  presentCitations,
  presentRelated,
  presentListing,
  presentMarket,
  presentAffiliation,
  presentMe,
  presentMyOrder,
  presentPortfolio,
  presentPublicPosition,
  presentQuote,
  presentTapeEntry,
  presentComment,
  presentComments,
  presentPaperComment,
  presentToken,
} from './present';
import * as S from './schemas';
import { marketHref } from '@/lib/links';

/**
 * `/api/v1`, one handler per operation. The files under `app/api/v1/` only
 * re-export these.
 *
 * Handlers read through `views.ts` and write **only** by calling the engine
 * (`quote`, `trade`, `settle`, `closeMarket`, `createMarket`). None of them
 * touches market state directly. (Listings, which are not market state, are
 * written by `listings.ts`; comments by `comments.ts`; comment backings by
 * `backings.ts`, and trimmed by the engine on a sell.) Selling is `POST …/orders` with negative
 * `sharesMicro`; there is no sell endpoint.
 *
 * Every read is logged to `events` with its kind and ids — no payload (§1.4) —
 * after the response is built, and a logging failure never reaches the client.
 */

function accountIdOf(p: Principal | null): string | null {
  return p?.account.id ?? null;
}

// ---------------------------------------------------------------------------
// public
// ---------------------------------------------------------------------------

export const listMarkets = route(async (req) => {
  const principal = await authenticate(req);
  const q = parseQuery(req, S.MarketListQuery);
  const { views, nextCursor } = await listMarketsView(q);
  events.log('market.list', { accountId: accountIdOf(principal) });
  return respond(S.MarketList, { markets: views.map(presentMarket), nextCursor }, { principal });
});

export const getMarket = route(async (req, params) => {
  const principal = await authenticate(req);
  const market = await resolveMarket(parseParam(params.id, S.MarketRef, 'id'));
  const view = await marketView(market);
  events.log('market.read', { accountId: accountIdOf(principal), marketId: market.id });
  return respond(S.Market, presentMarket(view), { principal });
});

export const getHistory = route(async (req, params) => {
  const principal = await authenticate(req);
  const market = await resolveMarket(parseParam(params.id, S.MarketRef, 'id'));
  const q = parseQuery(req, S.PaginationQuery);
  const h = await priceHistory(market, q);
  events.log('market.history.read', { accountId: accountIdOf(principal), marketId: market.id });
  return respond(
    S.PriceHistory,
    {
      marketId: market.id,
      outcomes: h.outcomes.map((o) => ({ id: o.id, label: o.label, ordinal: o.ordinal })),
      points: h.points.map((p) => ({ at: toIso(p.at), prices: p.prices })),
      nextCursor: h.nextCursor,
    },
    { principal },
  );
});

export const getTape = route(async (req, params) => {
  const principal = await authenticate(req);
  const market = await resolveMarket(parseParam(params.id, S.MarketRef, 'id'));
  const q = parseQuery(req, S.PaginationQuery);
  const { rows, nextCursor } = await marketTape(market, q);
  events.log('market.tape.read', { accountId: accountIdOf(principal), marketId: market.id });
  // No identities on the public tape: presentTapeEntry drops account and key.
  return respond(S.Tape, { orders: rows.map(presentTapeEntry), nextCursor }, { principal });
});

export const postQuote = route(async (req, params) => {
  const principal = await authenticate(req);
  const market = await resolveMarket(parseParam(params.id, S.MarketRef, 'id'));
  const body = await parseBody(req, S.QuoteRequest);
  const q = await engine.quote(market.id, body.outcomeId, body.sharesMicro);
  events.log('quote.read', { accountId: accountIdOf(principal), marketId: market.id });
  return respond(S.Quote, presentQuote(q), { principal });
});

export const listListings = route(async (req) => {
  const principal = await authenticate(req);
  const q = parseQuery(req, S.ListingListQuery);
  const { views, nextCursor } = await listListingsView(q);
  events.log('listing.list', { accountId: accountIdOf(principal) });
  return respond(S.ListingList, { listings: views.map(presentListing), nextCursor }, { principal });
});

export const getListing = route(async (req, params) => {
  const principal = await authenticate(req);
  const listing = await resolveListing(parseParam(params.id, S.ListingRef, 'id'));
  const view = await listingView(listing);
  events.log('listing.read', { accountId: accountIdOf(principal) });
  return respond(S.Listing, presentListing(view), { principal });
});

/**
 * Count the caller as having viewed a listing today (unique per visitor per
 * day, `server/view-counter.ts`). Public, sent by the paper page from the
 * browser: a signed-in viewer is counted by account, anyone else by network.
 * Nothing about the visitor is stored but a daily hash. `?from=` names the
 * listing read just before, counted as a transition for the similarity service.
 */
export const postListingView = route(async (req, params) => {
  const principal = await authenticate(req);
  const listing = await resolveListing(parseParam(params.id, S.ListingRef, 'id'));
  const { from } = parseQuery(req, S.ViewQuery);
  const viewer = { accountId: principal?.account.id, ip: clientIp(req) };
  const views = await countView(listing.id, viewer);
  if (views === null) throw new ApiError(404, 'not_found', `no listing ${listing.id}`);
  // A stale or mangled `from` must never cost the view: it is just not counted.
  const fromId = S.Id.safeParse(from);
  if (fromId.success) await countTransition(fromId.data, listing.id, viewer);
  return respond(S.ViewState, { listingId: listing.id, views }, { principal });
});

/** What is running: package version, git commit and process start. Public. */
export const getVersion = route(async (req) => {
  const principal = await authenticate(req);
  const { version, commit, startedAt } = runningVersion();
  return respond(S.Version, { version, commit, startedAt: toIso(startedAt) }, { principal });
});

/** Totals of visitors who read one listing and then another, for the similarity service. */
export const getTransitions = route(async (req) => {
  const principal = await requireAuth(req, 'admin');
  const { min } = parseQuery(req, S.TransitionsQuery);
  return respond(S.Transitions, { transitions: await listingTransitionCounts(min) }, { principal });
});

/** A listing's bibliography and the listings citing it (#38). */
export const getListingCitations = route(async (req, params) => {
  const principal = await authenticate(req);
  const listing = await resolveListing(parseParam(params.id, S.ListingRef, 'id'));
  return respond(S.ListingCitations, presentCitations(await listingCitations(listing)), { principal });
});

/** The listings a similarity service named as related to this one. */
export const getListingRelated = route(async (req, params) => {
  const principal = await authenticate(req);
  const listing = await resolveListing(parseParam(params.id, S.ListingRef, 'id'));
  return respond(S.ListingRelated, presentRelated(await listingRelatedTo(listing)), { principal });
});

/**
 * A listing's full text, as supplied: never fetched here. Any authenticated
 * principal with `read`, so anonymous traffic can't scrape it; `text` is null
 * while none has been supplied.
 */
export const getListingText = route(async (req, params) => {
  const principal = await requireAuth(req, 'read');
  const listing = await resolveListing(parseParam(params.id, S.ListingRef, 'id'));
  const text = await listingText(listing.id);
  events.log('listing.text_read', { accountId: principal.account.id });
  return respond(
    S.ListingText,
    { listingId: listing.id, text: text?.body ?? null, chars: text?.body.length ?? 0, source: text?.source ?? null },
    { principal },
  );
});

/** Replace a listing's full text, which JEV and signed-in clients read. Written by `listings.ts`; not market state. */
export const putListingText = route(async (req, params) => {
  const principal = await requireAuth(req, 'admin');
  const listing = await resolveListing(parseParam(params.id, S.ListingRef, 'id'));
  const body = await parseBody(req, S.SetTextRequest);
  const chars = await setText(listing, body.text, body.source ?? null);
  return respond(S.SetTextResult, { listingId: listing.id, chars }, { principal });
});

/**
 * Close a listing to new markets (`PUT`), or open it again (`DELETE`).
 * Idempotent. Its markets are left alone: closing those is `POST /markets/{id}/close`.
 */
export const putListingClosed = route(async (req, params) => setListingClosed(req, params.id, true));
export const deleteListingClosed = route(async (req, params) => setListingClosed(req, params.id, false));

async function setListingClosed(req: Request, id: string | string[] | undefined, closed: boolean) {
  const principal = await requireAuth(req, 'admin');
  const listing = await resolveListing(parseParam(id, S.ListingRef, 'id'));
  const closedAt = await setClosed(listing, closed);
  return respond(S.SetClosedResult, { listingId: listing.id, closedAt: toIsoOrNull(closedAt) }, { principal });
}

/** Replace a listing's related list. Written by `listings.ts`; not market state. */
export const putListingRelated = route(async (req, params) => {
  const principal = await requireAuth(req, 'admin');
  const listing = await resolveListing(parseParam(params.id, S.ListingRef, 'id'));
  const body = await parseBody(req, S.SetRelatedRequest);
  const count = await setRelated(listing, body.related);
  return respond(S.SetRelatedResult, { listingId: listing.id, count }, { principal });
});

/**
 * How long a cached map response is served. Every write to the map, the
 * related lists or a listing bumps the cache; this covers only what bumps
 * nothing — headlines, which move with trades — and writers in another
 * process. An hour-old headline is fine on the map, on the owner's call.
 */
const MAP_TTL_MS = 60 * 60_000;
/** Public, and the same for everyone; a browser past `max-age` revalidates by ETag, and may show what it holds meanwhile. */
const MAP_CACHE_CONTROL = 'public, max-age=300, stale-while-revalidate=3600';

/** A venue's supplied paper map, drawn whole by `/map`, without its titles. Public, cached in process and by the browser. */
export const getMap = route(async (req) => {
  const principal = await authenticate(req);
  const kind = parseQuery(req, S.MapQuery).kind ?? defaultMarketKind();
  const prepared = await mapCached(`map:${kind}`, MAP_TTL_MS, async () => prepare(S.PaperMap, await paperMap(kind)));
  return preparedResponse(req, prepared, { principal, headers: { 'Cache-Control': MAP_CACHE_CONTROL } });
});

/** The titles `getMap` leaves out, most of the map's bytes, fetched once it is drawn. Public, cached like the map. */
export const getMapTitles = route(async (req) => {
  const principal = await authenticate(req);
  const kind = parseQuery(req, S.MapQuery).kind ?? defaultMarketKind();
  const prepared = await mapCached(`map/titles:${kind}`, MAP_TTL_MS, async () =>
    prepare(S.MapTitles, { titles: await mapTitles(kind) }),
  );
  return preparedResponse(req, prepared, { principal, headers: { 'Cache-Control': MAP_CACHE_CONTROL } });
});

/** The listings the home page's search finds, for the map to light up. Public: a browser may keep it a minute. */
export const getMapSearch = route(async (req) => {
  const principal = await authenticate(req);
  const { q, kind } = parseQuery(req, S.MapSearchQuery);
  return respond(S.MapSearch, await mapSearch(q, kind ?? defaultMarketKind()), {
    principal,
    headers: { 'Cache-Control': 'public, max-age=60' },
  });
});

/** The related lists between papers on the map, compactly. Public, and cached like the map. */
export const getMapRelated = route(async (req) => {
  const principal = await authenticate(req);
  const kind = parseQuery(req, S.MapQuery).kind ?? defaultMarketKind();
  const prepared = await mapCached(`map/related:${kind}`, MAP_TTL_MS, async () => {
    const slugs: string[] = [];
    const index = new Map<string, number>();
    const at = (slug: string) => {
      let i = index.get(slug);
      if (i === undefined) index.set(slug, (i = slugs.push(slug) - 1));
      return i;
    };
    const edges = (await mapRelated(kind)).flatMap((e) => [at(e.from), at(e.to)]);
    return prepare(S.MapRelated, { slugs, edges });
  });
  return preparedResponse(req, prepared, { principal, headers: { 'Cache-Control': MAP_CACHE_CONTROL } });
});

/**
 * A listing's piece of the map, for the paper page's minimap, which asks for
 * it only once it scrolls into view. `404` when the listing is not on the
 * map. Public, and cached like the map.
 */
export const getListingMinimap = route(async (req, params) => {
  const principal = await authenticate(req);
  const listing = await resolveListing(parseParam(params.id, S.ListingRef, 'id'));
  const prepared = await mapCached(`minimap/${listing.id}`, MAP_TTL_MS, async () => {
    const minimap = await listingMinimap(listing, (await listingRelatedTo(listing, { all: true })).related);
    return minimap && prepare(S.Minimap, minimap);
  });
  if (!prepared) throw new ApiError(404, 'not_found', `listing ${listing.id} is not on the map`);
  return preparedResponse(req, prepared, { principal, headers: { 'Cache-Control': MAP_CACHE_CONTROL } });
});

/** Replace one venue's paper map. Written by `map.ts`; not market state. */
export const putMap = route(async (req) => {
  const principal = await requireAuth(req, 'admin');
  const body = await parseBody(req, S.SetMapRequest);
  return respond(S.SetMapResult, { count: await setMap(body) }, { principal });
});

const presentAnnouncement = (a: Announcement) => ({
  id: a.id,
  body: a.body,
  kind: a.kind,
  expiresAt: toIsoOrNull(a.expiresAt),
  signedInOnly: a.signedInOnly,
  createdAt: toIso(a.createdAt),
});

/** The messages the home page shows now, to this caller: those for signed-in readers only with a credential. Public. */
export const getAnnouncements = route(async (req) => {
  const principal = await authenticate(req);
  const { kind } = parseQuery(req, S.AnnouncementsQuery);
  const rows = await currentAnnouncements(kind, principal !== null);
  return respond(S.AnnouncementList, { announcements: rows.map(presentAnnouncement) }, { principal });
});

/** Put a message at the top of the home page. */
export const postAnnouncements = route(async (req) => {
  const principal = await requireAuth(req, 'admin');
  const body = await parseBody(req, S.PostAnnouncementRequest);
  const row = await postAnnouncement({
    body: body.body,
    kind: body.kind,
    expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    signedInOnly: body.signedInOnly,
  });
  events.log('announcement.posted', { accountId: principal.account.id });
  return respond(S.Announcement, presentAnnouncement(row), { principal, status: 201 });
});

export const deleteAnnouncement = route(async (req, params) => {
  const principal = await requireAuth(req, 'admin');
  const id = parseParam(params.id, S.Id, 'id');
  if (!(await deleteAnnouncementRow(id))) throw new ApiError(404, 'not_found', `no announcement ${id}`);
  events.log('announcement.deleted', { accountId: principal.account.id });
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
});

export const getLeaderboard = route(async (req) => {
  const principal = await authenticate(req);
  const q = parseQuery(req, S.LeaderboardQuery);
  const kind = q.kind ?? defaultMarketKind();
  const { rows, nextCursor, fieldSize } = await leaderboardView({ ...q, kind });
  events.log('leaderboard.read', { accountId: accountIdOf(principal) });
  return respond(
    S.Leaderboard,
    {
      kind,
      basis: q.basis,
      fieldSize,
      entries: rows.map((r) => ({
        rank: r.rank,
        handle: r.handle,
        displayName: r.displayName,
        isBot: r.isBot,
        institutions: [...r.institutions],
        settledPnlMicro: r.settledPnlMicro.toString(),
        settledMarkets: r.settledMarkets,
        netWorthMicro: r.netWorthMicro.toString(),
        unrealizedPnlMicro: r.unrealizedPnlMicro.toString(),
      })),
      nextCursor,
    },
    { principal },
  );
});

export const getAccount = route(async (req, params) => {
  const principal = await authenticate(req);
  const handle = parseParam(params.handle, S.Handle, 'handle');
  const { account, settledRecords } = await publicAccount(handle);
  events.log('account.read', { accountId: accountIdOf(principal) });
  return respond(
    S.PublicAccount,
    {
      handle: account.handle,
      displayName: account.displayName,
      isBot: account.isBot,
      institutions: account.institutions,
      rorId: account.rorId,
      verifiedAt: toIsoOrNull(account.verifiedAt),
      createdAt: toIso(account.createdAt),
      settledRecords: settledRecords.map((r) => ({
        kind: r.kind,
        settledPnlMicro: r.settledPnlMicro.toString(),
        settledMarkets: r.settledMarkets,
      })),
    },
    { principal },
  );
});

/** A trader's public positions (#36), newest first: only those they chose to make public. */
export const getAccountPositions = route(async (req, params) => {
  const principal = await authenticate(req);
  const handle = parseParam(params.handle, S.Handle, 'handle');
  const { account } = await publicAccount(handle);
  const positions = await publicPositionsOf(account.id);
  events.log('account.read', { accountId: accountIdOf(principal) });
  return respond(S.PublicPositionList, { positions: positions.map(presentPublicPosition) }, { principal });
});

/** One public position, by its link id. 404 once its holder has made it private. */
export const getPublicPosition = route(async (req, params) => {
  const principal = await authenticate(req);
  const view = await publicPosition(parseParam(params.id, S.Id, 'id'));
  events.log('position.read', { accountId: accountIdOf(principal), marketId: view.market.id });
  return respond(S.PublicPosition, presentPublicPosition(view), { principal });
});

export const getComments = route(async (req, params) => {
  const principal = await authenticate(req);
  const market = await resolveMarket(parseParam(params.id, S.MarketRef, 'id'));
  const q = parseQuery(req, S.CommentListQuery);
  const page = await listComments(market.id, { ...q, viewerAccountId: accountIdOf(principal) });
  events.log('comments.read', { accountId: accountIdOf(principal), marketId: market.id });
  return respond(S.CommentList, presentComments(page), { principal });
});

/** A page of a comment's direct replies, each with a preview of the replies under it. */
export const getCommentReplies = route(async (req, params) => {
  const principal = await authenticate(req);
  const commentId = parseParam(params.id, S.CommentId, 'id');
  const q = parseQuery(req, S.CommentRepliesQuery);
  const page = await listReplies(commentId, { ...q, viewerAccountId: accountIdOf(principal) });
  events.log('comments.read', { accountId: accountIdOf(principal), marketId: page.marketId });
  return respond(S.CommentReplies, { replies: page.replies.map(presentComment) }, { principal });
});

// ---------------------------------------------------------------------------
// authenticated
// ---------------------------------------------------------------------------

/** How an order arrived, for the record: the credential's kind, and the client's own word on a language model. */
function orderOrigin(principal: Principal, isLlm: boolean | undefined): engine.OrderOrigin {
  return { via: principal.method === 'session' ? 'web' : 'api', isLlm: isLlm ?? false };
}

export const postOrder = route(async (req, params) => {
  const principal = await requireAuth(req, 'trade');
  requireTradingEligibility(principal);
  const market = await resolveMarket(parseParam(params.id, S.MarketRef, 'id'));
  const body = await parseBody(req, S.OrderRequest);

  const rawKey = req.headers.get('idempotency-key');
  const idempotencyKey = rawKey === null ? null : parseParam(rawKey, S.IdempotencyKey, 'Idempotency-Key');

  const fill = await engine.trade(
    principal.account.id,
    market.id,
    body.outcomeId,
    body.sharesMicro,
    body.maxCostMicro,
    idempotencyKey,
    undefined,
    orderOrigin(principal, body.isLlm),
  );

  /**
   * The engine returns the original fill for a reused key, whatever this
   * request asked for. If this request asked for something else, the client
   * has a key-generation bug, and answering "filled" would tell it an order
   * went through that never did. Refuse instead.
   */
  if (
    fill.replayed &&
    (fill.marketId !== market.id || fill.outcomeId !== body.outcomeId || fill.sharesMicro !== body.sharesMicro)
  ) {
    throw new ApiError(409, 'idempotency_key_reused', 'this Idempotency-Key was already used for a different order', {
      orderId: fill.orderId,
    });
  }

  return respond(S.Fill, presentFill(fill, await isFirstOrder(principal.account.id, fill.orderId)), {
    status: 201,
    principal,
    headers: fill.replayed ? { 'Idempotent-Replayed': 'true' } : {},
  });
});

/**
 * Open a listing's market at JEV's prices, with no trade
 * (`market-start.openListingMarket`). Idempotent: a listing that has one
 * answers it with `created: false` and a 200. A visitor with no credential
 * may open one too (`/welcome` asks for the price before there is an
 * account), from the visitors' shared budget; a credential that is sent must
 * hold `trade` and be trading-eligible, as for the order that follows.
 */
export const postListingMarket = route(async (req, params) => {
  const principal = await authenticate(req);
  if (principal) {
    requireScope(principal, 'trade');
    requireTradingEligibility(principal);
  }
  const listing = await resolveListing(parseParam(params.id, S.ListingRef, 'id'));
  const { market, created } = await openListingMarket(listing, principal?.account.id ?? null);
  return respond(
    S.OpenedMarket,
    { market: presentMarket(await marketView(market)), created },
    { status: created ? 201 : 200, principal },
  );
});

/**
 * A buy by stake on a listing's main market (`market-start.buyOnListing`),
 * which a listing's first trade makes. Retried with the same
 * `Idempotency-Key`, the original fill; with the same key for an order on
 * another market or outcome, a 409, as on `POST /markets/{id}/orders`.
 */
export const postListingOrder = route(async (req, params) => {
  const principal = await requireAuth(req, 'trade');
  requireTradingEligibility(principal);
  const listing = await resolveListing(parseParam(params.id, S.ListingRef, 'id'));
  const body = await parseBody(req, S.ListingOrderRequest);

  const rawKey = req.headers.get('idempotency-key');
  const idempotencyKey = rawKey === null ? null : parseParam(rawKey, S.IdempotencyKey, 'Idempotency-Key');

  const { fill, marketCreated } = await buyOnListing({
    accountId: principal.account.id,
    listing,
    outcome: body.outcome,
    origin: orderOrigin(principal, body.isLlm),
    stakeMicro: body.stakeMicro,
    idempotencyKey,
  });

  if (fill.replayed) {
    const original = await marketView(await resolveMarket(fill.marketId));
    const label = original.outcomes.find((o) => o.id === fill.outcomeId)?.label;
    if (original.market.listingId !== listing.id || label !== body.outcome || fill.costMicro > body.stakeMicro) {
      throw new ApiError(409, 'idempotency_key_reused', 'this Idempotency-Key was already used for a different order', {
        orderId: fill.orderId,
      });
    }
  }

  return respond(
    S.ListingFill,
    { ...presentFill(fill, await isFirstOrder(principal.account.id, fill.orderId)), marketCreated },
    { status: 201, principal, headers: fill.replayed ? { 'Idempotent-Replayed': 'true' } : {} },
  );
});

/**
 * Commenting is a `trade`-scope action by a trading-eligible account: the
 * point of the feed is that every comment comes with a real stake behind it.
 */
export const postMarketComment = route(async (req, params) => {
  const principal = await requireAuth(req, 'trade');
  requireTradingEligibility(principal);
  const market = await resolveMarket(parseParam(params.id, S.MarketRef, 'id'));
  const body = await parseBody(req, S.CommentRequest);
  const created = await postComment({
    marketId: market.id,
    accountId: principal.account.id,
    body: body.body,
    parentId: body.parentId,
  });
  events.log('comment.posted', { accountId: principal.account.id, marketId: market.id });
  // After the commit and never awaited: a mail failure must not fail the post.
  void mailMentions(created.id).catch((err) => console.error('[mentions] mail failed', err));
  const view = await getComment(created.id, principal.account.id);
  return respond(S.Comment, presentComment(view!), { status: 201, principal });
});

/**
 * Put shares behind a comment. Same gate as posting one. The shares stay in
 * the backer's position; a later sell trims backings newest first.
 */
export const postCommentBacking = route(async (req, params) => {
  const principal = await requireAuth(req, 'trade');
  requireTradingEligibility(principal);
  const commentId = parseParam(params.id, S.CommentId, 'id');
  const body = await parseBody(req, S.CommentBackingRequest);
  const { marketId } = await backComment({
    commentId,
    accountId: principal.account.id,
    outcomeId: body.outcomeId,
    sharesMicro: body.sharesMicro,
  });
  events.log('comment.backed', { accountId: principal.account.id, marketId });
  const view = await getComment(commentId, principal.account.id);
  return respond(S.Comment, presentComment(view!), { status: 201, principal });
});

/** Remove all of the caller's backing from a comment. Idempotent. */
export const deleteCommentBacking = route(async (req, params) => {
  const principal = await requireAuth(req, 'trade');
  requireTradingEligibility(principal);
  const commentId = parseParam(params.id, S.CommentId, 'id');
  const { marketId } = await withdrawBacking({ commentId, accountId: principal.account.id });
  events.log('comment.unbacked', { accountId: principal.account.id, marketId });
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
});

export const getMe = route(async (req) => {
  const principal = await requireAuth(req, 'read');
  events.log('me.read', { accountId: principal.account.id });
  return respond(S.Me, presentMe(principal, await walletsOf(principal.account.id)), { principal });
});

/**
 * Your settings: the two mails' opt-ins and your name. `read` scope, like the rest of
 * `/me`: it moves no money and places no order.
 */
export const patchMe = route(async (req) => {
  const principal = await requireAuth(req, 'read');
  const body = await parseBody(req, S.UpdateMeRequest);
  let account = principal.account;
  if (body.digestOptIn !== undefined) account = await setDigestOptIn(account.id, body.digestOptIn);
  if (body.mentionMailOptIn !== undefined) account = await setMentionMailOptIn(account.id, body.mentionMailOptIn);
  if (body.displayName !== undefined) account = await setDisplayName(account, body.displayName);
  events.log('me.updated', { accountId: account.id });
  return respond(S.Me, presentMe({ ...principal, account }, await walletsOf(account.id)), { principal });
});

/** Listings you follow, each with its main market's headline price now and 24h ago. */
export const getMyFollows = route(async (req) => {
  const principal = await requireAuth(req, 'read');
  const follows = await followedListings(principal.account.id);
  events.log('follows.read', { accountId: principal.account.id });
  return respond(S.FollowList, { follows: follows.map(presentFollowed) }, { principal });
});

/**
 * The comments that `@`-mention the caller: by alias on a paper they comment
 * on, or a bot by handle anywhere. `read` scope, any principal. Agents call
 * it when they start, with `since` the time they last checked.
 */
export const getMyMentions = route(async (req) => {
  const principal = await requireAuth(req, 'read');
  const q = parseQuery(req, S.MentionListQuery);
  const page = await listMentions(principal.account.id, q);
  events.log('mentions.read', { accountId: principal.account.id });
  return respond(
    S.MentionList,
    {
      mentions: page.mentions.map((m) => ({
        commentId: m.commentId,
        parentId: m.parentId,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
        market: {
          id: m.market.id,
          slug: m.market.slug,
          title: m.market.title,
          url: marketHref({ marketSlug: m.market.slug, listingSlug: m.market.listingSlug }),
        },
        author: m.author,
      })),
      nextCursor: page.nextCursor,
    },
    { principal },
  );
});

/**
 * Follow or unfollow a listing. Idempotent both ways. `read` scope: a follow is
 * a preference, not a trade, and needs no verified account. Only listings can
 * be followed; a market without one cannot.
 */
async function setFollow(req: Request, id: unknown, on: boolean) {
  const principal = await requireAuth(req, 'read');
  const ref = await resolveListing(parseParam(id, S.ListingRef, 'id'));
  const changed = on ? await follow(principal.account.id, ref.id) : await unfollow(principal.account.id, ref.id);
  if (changed) events.log(on ? 'listing.followed' : 'listing.unfollowed', { accountId: principal.account.id });
  const view = await listingView(ref);
  return respond(S.FollowState, { listingId: ref.id, following: on, followers: view.followers }, { principal });
}

export const putListingFollow = route((req, params) => setFollow(req, params.id, true));
export const deleteListingFollow = route((req, params) => setFollow(req, params.id, false));

// ---------------------------------------------------------------------------
// a paper's discussion and reactions (safe for work edition)
// ---------------------------------------------------------------------------

/** A page of a paper's top-level comments, newest first, with a preview of the replies under them. Public. */
export const getPaperComments = route(async (req, params) => {
  const principal = await authenticate(req);
  const listing = await resolveListing(parseParam(params.id, S.ListingRef, 'id'));
  const q = parseQuery(req, S.PaginationQuery);
  const page = await listPaperComments(listing.id, { ...q, viewerAccountId: accountIdOf(principal) });
  events.log('paper_comments.read', { accountId: accountIdOf(principal) });
  return respond(
    S.PaperCommentList,
    {
      comments: page.comments.map(presentPaperComment),
      replies: page.replies.map(presentPaperComment),
      nextCursor: page.nextCursor,
      total: page.total,
      viewerAlias: page.viewerAlias,
    },
    { principal },
  );
});

/** A page of a paper comment's direct replies. Public. */
export const getPaperCommentReplies = route(async (req, params) => {
  const principal = await authenticate(req);
  const listing = await resolveListing(parseParam(params.id, S.ListingRef, 'id'));
  const commentId = parseParam(params.commentId, S.CommentId, 'commentId');
  const q = parseQuery(req, S.CommentRepliesQuery);
  const replies = await listPaperReplies(listing.id, commentId, { ...q, viewerAccountId: accountIdOf(principal) });
  events.log('paper_comments.read', { accountId: accountIdOf(principal) });
  return respond(S.PaperCommentReplies, { replies: replies.map(presentPaperComment) }, { principal });
});

/**
 * Comment on a paper. With no stake to stand behind a comment, what stands
 * behind it is a confirmed institutional address (or a bot): the same
 * account check as the market edition's trading gate, under the `read`
 * scope, since keys here are read-only.
 */
export const postListingComment = route(async (req, params) => {
  const principal = await requireAuth(req, 'read');
  if (!principal.account.isBot && !principal.account.verifiedAt) {
    throw new ApiError(403, 'not_verified', 'confirm an institutional email address before commenting');
  }
  const listing = await resolveListing(parseParam(params.id, S.ListingRef, 'id'));
  const body = await parseBody(req, S.PaperCommentRequest);
  const created = await postPaperComment({
    listingId: listing.id,
    accountId: principal.account.id,
    body: body.body,
    parentId: body.parentId,
  });
  events.log('paper_comment.posted', { accountId: principal.account.id });
  const view = await getPaperComment(listing.id, created.id, principal.account.id);
  return respond(S.PaperComment, presentPaperComment(view!), { status: 201, principal });
});

/** A paper's reactions: a count per emoji, and the caller's own. Public. */
export const getReactions = route(async (req, params) => {
  const principal = await authenticate(req);
  const listing = await resolveListing(parseParam(params.id, S.ListingRef, 'id'));
  const reactions = await reactionsOf(listing.id, accountIdOf(principal));
  return respond(S.ReactionList, { listingId: listing.id, reactions }, { principal });
});

/** React to a paper with one emoji, or take it back. Idempotent; `read` scope, like a follow. */
async function react(req: Request, params: Record<string, string | string[]>, on: boolean) {
  const principal = await requireAuth(req, 'read');
  const listing = await resolveListing(parseParam(params.id, S.ListingRef, 'id'));
  const raw = parseParam(params.emoji, S.Emoji, 'emoji');
  // Whether the router has already decoded the segment or not, decode once more only if it still looks encoded.
  let decoded = raw;
  try {
    decoded = /%[0-9a-f]{2}/i.test(raw) ? decodeURIComponent(raw) : raw;
  } catch {
    /* not percent-encoding after all */
  }
  const emoji = parseEmoji(decoded);
  await setReaction(principal.account.id, listing.id, emoji, on);
  events.log(on ? 'reaction.added' : 'reaction.removed', { accountId: principal.account.id });
  const reactions = await reactionsOf(listing.id, principal.account.id);
  return respond(S.ReactionList, { listingId: listing.id, reactions }, { principal });
}

export const putReaction = route((req, params) => react(req, params, true));
export const deleteReaction = route((req, params) => react(req, params, false));

// ---------------------------------------------------------------------------
// groups
// ---------------------------------------------------------------------------

/**
 * Leaderboard groups (#25, `server/groups.ts`). Reading one is public — its
 * members are on the public leaderboard anyway — but its invite code goes to
 * members only. Writes need the `read` scope, like follows: a group moves no
 * money and grants nothing.
 */
async function groupResponse(groupId: string, principal: Principal | null, status = 200) {
  const group = await groupById(groupId);
  if (!group) throw new ApiError(404, 'not_found', `no group ${groupId}`);
  const [members, role] = await Promise.all([groupMembersOf(group.id), roleIn(group, accountIdOf(principal))]);
  return respond(S.Group, presentGroup(group, members, role), { status, principal });
}

export const getGroup = route(async (req, params) => {
  const principal = await authenticate(req);
  const id = parseParam(params.id, S.Id, 'id');
  const res = await groupResponse(id, principal);
  events.log('group.read', { accountId: accountIdOf(principal) });
  return res;
});

export const postGroup = route(async (req) => {
  const principal = await requireAuth(req, 'read');
  const body = await parseBody(req, S.CreateGroupRequest);
  const group = await createGroup(principal.account.id, body);
  events.log('group.created', { accountId: principal.account.id });
  return groupResponse(group.id, principal, 201);
});

export const patchGroup = route(async (req, params) => {
  const principal = await requireAuth(req, 'read');
  const id = parseParam(params.id, S.Id, 'id');
  const body = await parseBody(req, S.UpdateGroupRequest);
  await updateGroup(principal.account.id, id, body);
  events.log('group.updated', { accountId: principal.account.id });
  return groupResponse(id, principal);
});

export const deleteGroup = route(async (req, params) => {
  const principal = await requireAuth(req, 'read');
  const id = parseParam(params.id, S.Id, 'id');
  await deleteGroupRow(principal.account.id, id);
  events.log('group.deleted', { accountId: principal.account.id });
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
});

/** A new invite code; the old link stops working. */
export const postGroupInvite = route(async (req, params) => {
  const principal = await requireAuth(req, 'read');
  const id = parseParam(params.id, S.Id, 'id');
  await rotateInvite(principal.account.id, id);
  events.log('group.invite_rotated', { accountId: principal.account.id });
  return groupResponse(id, principal);
});

export const postGroupJoin = route(async (req) => {
  const principal = await requireAuth(req, 'read');
  const body = await parseBody(req, S.JoinGroupRequest);
  const group = await joinGroup(principal.account.id, body.inviteCode);
  events.log('group.joined', { accountId: principal.account.id });
  return groupResponse(group.id, principal);
});

/** Leave (your own handle), or, as the admin, remove someone. */
export const deleteGroupMember = route(async (req, params) => {
  const principal = await requireAuth(req, 'read');
  const id = parseParam(params.id, S.Id, 'id');
  const handle = parseParam(params.handle, S.Handle, 'handle');
  if (await removeMember(principal.account.id, id, handle)) {
    events.log('group.member_removed', { accountId: principal.account.id });
  }
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
});

export const getMyGroups = route(async (req) => {
  const principal = await requireAuth(req, 'read');
  const groups = await groupsOf(principal.account.id);
  events.log('groups.read', { accountId: principal.account.id });
  return respond(S.GroupList, { groups: groups.map(presentGroupSummary) }, { principal });
});

/**
 * Make one of your positions public, or private again (#36). Idempotent both
 * ways. `trade` scope, not `read`: it names you as the holder, which links
 * you to your comments on that market, so a read-only token must not be
 * able to do it. Only a position you hold can be made public.
 */
async function setPublic(req: Request, outcomeId: unknown, on: boolean) {
  const principal = await requireAuth(req, 'trade');
  const id = parseParam(outcomeId, S.Id, 'outcomeId');
  let publicPositionId: string | null = null;
  if (on) {
    const view = await publish(principal.account.id, id);
    publicPositionId = view.id;
    events.log('position.published', { accountId: principal.account.id, marketId: view.market.id });
  } else if (await unpublish(principal.account.id, id)) {
    events.log('position.unpublished', { accountId: principal.account.id });
  }
  return respond(S.PublicPositionState, { outcomeId: id, publicPositionId }, { principal });
}

export const putMyPositionPublic = route((req, params) => setPublic(req, params.outcomeId, true));
export const deleteMyPositionPublic = route((req, params) => setPublic(req, params.outcomeId, false));

export const getMyPortfolio = route(async (req) => {
  const principal = await requireAuth(req, 'read');
  const { marketId } = parseQuery(req, S.PortfolioQuery);
  const portfolio = await getPortfolio(principal.account.id, undefined, marketId);
  events.log('portfolio.read', { accountId: principal.account.id });
  return respond(S.Portfolio, presentPortfolio(portfolio), { principal });
});

export const getMyOrders = route(async (req) => {
  const principal = await requireAuth(req, 'read');
  const q = parseQuery(req, S.PaginationQuery);
  const { rows, nextCursor } = await accountOrders(principal.account.id, q);
  events.log('me.orders.read', { accountId: principal.account.id });
  return respond(S.MyOrders, { orders: rows.map(presentMyOrder), nextCursor }, { principal });
});

/**
 * Token management. **Session only, never a token** (§7): a leaked token must
 * not be able to mint its successor or hide its own revocation. Bot tokens,
 * and any `admin` token, are minted by an operator with `npm run token:mint`.
 */
function userIdOf(p: Principal): string {
  if (!p.account.userId) throw new ApiError(403, 'session_required', 'this account has no sign-in');
  return p.account.userId;
}

export const postMyToken = route(async (req) => {
  const principal = await requireSession(req);
  const body = await parseBody(req, S.CreateTokenRequest);
  const { token, record } = await mintToken({ account: principal.account, name: body.name, scopes: body.scopes });
  events.log('token.minted', { accountId: principal.account.id });
  return respond(
    S.CreatedToken,
    {
      id: record.id,
      name: record.name,
      start: record.start,
      scopes: record.scopes,
      createdAt: toIso(record.createdAt),
      token,
    },
    { status: 201, principal },
  );
});

/** An agent asks for a code to be mailed to the person it trades for (`server/agent-codes.ts`). Anonymous. */
export const postAgentCode = route(async (req) => {
  const principal = await authenticate(req);
  const body = await parseBody(req, S.AgentCodeRequest);
  await requestAgentCode(body.email);
  return respond(S.AgentCodeSent, { email: body.email }, { principal });
});

/** A signed-in person's code for the prompt they copy: no mail. Session-only, like minting a key. */
export const postMyAgentCode = route(async (req) => {
  const principal = await requireSession(req);
  const { email, code, expiresAt } = await issueAgentCode(principal.account);
  return respond(S.AgentPromptCode, { email, code, expiresAt: toIso(expiresAt) }, { status: 201, principal });
});

/** An agent trades the address and its mailed code for a `read` + `trade` key. No credential needed: the code is one. */
export const postAgentToken = route(async (req) => {
  const principal = await authenticate(req);
  const body = await parseBody(req, S.RedeemAgentCodeRequest);
  const { token, record, accountId } = await redeemAgentCode(body);
  events.log('token.minted', { accountId });
  return respond(
    S.CreatedToken,
    {
      id: record.id,
      name: record.name,
      start: record.start,
      scopes: record.scopes,
      createdAt: toIso(record.createdAt),
      token,
    },
    { status: 201, principal },
  );
});

export const getMyTokens = route(async (req) => {
  const principal = await requireSession(req);
  const tokens = await listTokens(userIdOf(principal));
  return respond(S.TokenList, { tokens: tokens.map(presentToken) }, { principal });
});

export const deleteMyToken = route(async (req, params) => {
  const principal = await requireSession(req);
  const id = parseParam(params.id, S.TokenId, 'id');
  if (!(await revokeToken(userIdOf(principal), id))) {
    throw new ApiError(404, 'not_found', `no token ${id}`);
  }
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
});

/**
 * Affiliations: more institutional addresses, each confirmed by a code mailed
 * to it (`server/affiliations.ts`). **Session only**, like tokens: they decide
 * who may trade, so a leaked token must not be able to change them.
 */
export const getMyAffiliations = route(async (req) => {
  const principal = await requireSession(req);
  const rows = await listAffiliations(principal.account.id);
  return respond(S.AffiliationList, { affiliations: rows.map(presentAffiliation) }, { principal });
});

export const postMyAffiliation = route(async (req) => {
  const principal = await requireSession(req);
  const body = await parseBody(req, S.AddAffiliationRequest);
  const row = await addAffiliation({ account: principal.account, email: body.email });
  events.log('affiliation.requested', { accountId: principal.account.id });
  return respond(S.Affiliation, presentAffiliation(row), { status: 201, principal });
});

export const postMyAffiliationVerify = route(async (req, params) => {
  const principal = await requireSession(req);
  const id = parseParam(params.id, S.AffiliationId, 'id');
  const body = await parseBody(req, S.VerifyAffiliationRequest);
  const row = await verifyAffiliation({ accountId: principal.account.id, id, code: body.code });
  events.log('affiliation.confirmed', { accountId: principal.account.id });
  return respond(S.Affiliation, presentAffiliation(row), { principal });
});

export const deleteMyAffiliation = route(async (req, params) => {
  const principal = await requireSession(req);
  const id = parseParam(params.id, S.AffiliationId, 'id');
  await removeAffiliation({ accountId: principal.account.id, id });
  events.log('affiliation.removed', { accountId: principal.account.id });
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
});

// ---------------------------------------------------------------------------
// onboarding
// ---------------------------------------------------------------------------

/**
 * Sign up (`server/onboarding.ts`), maybe with a first bet: no password, no account yet.
 * Answers the same whether or not the address is taken.
 */
export const postOnboarding = route(async (req) => {
  const principal = await authenticate(req);
  const body = await parseBody(req, S.OnboardingRequest);
  const nonce = newBrowserNonce();
  await startOnboarding(body, nonce);
  events.log('onboarding.started', { accountId: null, marketId: body.bet?.marketId ?? null });
  if (!body.bet) return respond(S.SignUpStarted, { email: body.email }, { principal });
  // Names this browser as the one the bet was chosen in (`choseHere`).
  const cookie =
    `${ONBOARDING_BROWSER_COOKIE}=${nonce}; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax` +
    (process.env.NODE_ENV === 'production' ? '; Secure' : '');
  return respond(S.SignUpStarted, { email: body.email }, { principal, headers: { 'Set-Cookie': cookie } });
});

/** The first password of an account made by onboarding. Session only. */
export const postMyPassword = route(async (req) => {
  const principal = await requireSession(req);
  const body = await parseBody(req, S.SetPasswordRequest);
  await setFirstPassword(req.headers, body.password);
  events.log('password.set', { accountId: principal.account.id });
  return respond(S.PasswordSet, { ok: true }, { principal });
});

/** Drop the bet chosen during onboarding, once placed or declined. Idempotent. */
export const deleteMyPendingBet = route(async (req) => {
  const principal = await requireSession(req);
  await clearPendingBet(userIdOf(principal));
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
});

// ---------------------------------------------------------------------------
// admin
// ---------------------------------------------------------------------------

export const postMarket = route(async (req) => {
  const principal = await requireAuth(req, 'admin');
  const body = await parseBody(req, S.CreateMarketRequest);
  const closesAt = new Date(body.closesAt);
  if (closesAt.getTime() <= Date.now()) {
    throw new ApiError(400, 'validation_error', 'closesAt must be in the future');
  }
  if (body.listingRank !== undefined && body.listingSlug === undefined) {
    throw new ApiError(400, 'validation_error', 'listingRank needs a listingSlug');
  }
  // Listings are never deleted, so one that exists now still exists at the insert.
  const listing = body.listingSlug === undefined ? null : await resolveListing(body.listingSlug);

  let created;
  try {
    created = await engine.createMarket({
      slug: body.slug,
      question: body.question,
      description: body.description ?? null,
      contract: body.contract ?? null,
      kind: body.kind,
      outcomes: body.outcomes,
      closesAt,
      resolutionSource: body.resolutionSource ?? null,
      createdBy: principal.account.id,
      // b is computed from these inside createMarket, once, and frozen (§1.3).
      startingBalanceMicro: startingBalanceMicro(),
      expectedTraders: body.expectedTraders,
      status: 'open',
      listingId: listing?.id ?? null,
      listingRank: body.listingRank ?? 0,
      openingPrices: body.openingPrices,
    });
  } catch (err) {
    // The market's slug, or its maker's `market:<slug>` handle, already exists.
    if (isUniqueViolation(err)) {
      throw new ApiError(409, 'slug_taken', `a market with slug "${body.slug}" already exists`);
    }
    throw err;
  }

  const view = await marketView(await resolveMarket(created.marketId));
  return respond(
    S.CreatedMarket,
    { market: presentMarket(view), subsidyMicro: created.subsidyMicro.toString() },
    { status: 201, principal },
  );
});

/**
 * Create or replace a listing by slug. Not market state: written by
 * `listings.ts` in its own transaction. 201 when created, 200 when replaced.
 * Then, for a venue that opens markets with its listings, the listing's
 * market through the engine (`market-start.openWithListing`).
 */
export const postListing = route(async (req) => {
  const principal = await requireAuth(req, 'admin');
  const body = await parseBody(req, S.UpsertListingRequest);
  const { listing, created } = await upsertListing({
    slug: body.slug,
    title: body.title,
    summary: body.summary ?? null,
    tldr: body.tldr ?? null,
    authors: body.authors ?? [],
    authorIds: body.authorIds ?? [],
    keywords: body.keywords ?? [],
    primaryArea: body.primaryArea ?? null,
    links: body.links ?? [],
    kind: body.kind ?? null,
    references: (body.references ?? []).map((r) => ({
      title: r.title,
      authors: r.authors ?? [],
      year: r.year ?? null,
      venue: r.venue ?? null,
      url: r.url ?? null,
      citedSlug: r.slug ?? null,
    })),
  });
  // A venue that opens a market with every listing (`opensWithListing`) gets it now, so nobody has to open it.
  await openWithListing(listing);
  events.log(created ? 'listing.created' : 'listing.updated', { accountId: principal.account.id });
  return respond(
    S.UpsertedListing,
    { listing: presentListing(await listingView(listing)), created },
    { status: created ? 201 : 200, principal },
  );
});

export const postClose = route(async (req, params) => {
  const principal = await requireAuth(req, 'admin');
  const market = await resolveMarket(parseParam(params.id, S.MarketRef, 'id'));
  await engine.closeMarket(market.id);
  const view = await marketView(await resolveMarket(market.id));
  return respond(S.Market, presentMarket(view), { principal });
});

export const postSettle = route(async (req, params) => {
  const principal = await requireAuth(req, 'admin');
  const market = await resolveMarket(parseParam(params.id, S.MarketRef, 'id'));
  const body = await parseBody(req, S.SettleRequest);

  await engine.settle(market.id, body.winningOutcomeId, { evidenceUrl: body.evidenceUrl });

  // `settle` is idempotent and a second run is a no-op — including one that
  // names a different winner. Say so rather than answer 200 to a settlement
  // that did not happen.
  const after = await resolveMarket(market.id);
  if (after.resolvedOutcomeId !== body.winningOutcomeId) {
    throw new ApiError(409, 'market_already_settled', 'market was already settled with a different outcome', {
      resolvedOutcomeId: after.resolvedOutcomeId,
    });
  }
  return respond(S.Market, presentMarket(await marketView(after)), { principal });
});

export const getListingRead = route(async (req, params) => {
  const principal = await authenticate(req);
  const listing = await resolveListing(parseParam(params.id, S.ListingRef, 'id'));
  const [status] = await readingStatuses([listing.id], accountIdOf(principal));
  return respond(S.ReadingStatus, status, { principal });
});

async function setRead(req: Request, id: unknown, read: boolean) {
  const principal = await requireAuth(req, 'read');
  const listing = await resolveListing(parseParam(id, S.ListingRef, 'id'));
  await setListingRead(principal.account.id, listing.id, read);
  const [status] = await readingStatuses([listing.id], principal.account.id);
  return respond(S.ReadingStatus, status, { principal });
}
export const putListingRead = route((req, params) => setRead(req, params.id, true));
export const deleteListingRead = route((req, params) => setRead(req, params.id, false));

export const getGroupReadingList = route(async (req, params) => {
  const principal = await authenticate(req);
  const id = parseParam(params.id, S.Id, 'id');
  if (!(await groupById(id))) throw new ApiError(404, 'not_found', 'no such reading group');
  return respond(S.ReadingList, await readingList(id, accountIdOf(principal)), { principal });
});

async function setGroupReadingList(req: Request, params: Record<string, string | string[]>, added: boolean) {
  const principal = await requireAuth(req, 'read');
  const id = parseParam(params.id, S.Id, 'id');
  if (!(await groupById(id))) throw new ApiError(404, 'not_found', 'no such reading group');
  const listing = await resolveListing(parseParam(params.listingId, S.ListingRef, 'listingId'));
  await setReadingList(principal.account.id, id, listing.id, added);
  return respond(S.ReadingListState, { groupId: id, listingId: listing.id, added }, { principal });
}
export const putGroupReadingList = route((req, params) => setGroupReadingList(req, params, true));
export const deleteGroupReadingList = route((req, params) => setGroupReadingList(req, params, false));
