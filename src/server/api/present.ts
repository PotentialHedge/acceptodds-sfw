import type { z } from 'zod';
import type { Account, Affiliation, Group } from '@/db/schema';
import type { Principal } from '../auth';
import type { Portfolio as PortfolioModel } from '../accounts';
import type { Fill as FillModel, Quote as QuoteModel } from '../engine';
import type { CommentView, ViewerStake } from '../comments';
import type { PaperCommentView } from '../discussion';
import type { FollowedListing } from '../follows';
import type { GroupMember, GroupRole, GroupSummary } from '../groups';
import type { PublicPositionView } from '../public-positions';
import type { TokenRecord } from '../tokens';
import type { CitedListing, ListingCitations, ListingView, MarketView, OrderRow, RelatedList } from '../views';
import { toIso, toIsoOrNull } from './http';
import type * as S from './schemas';

/**
 * Domain objects → wire shapes. Every `bigint` becomes a decimal string here
 * and nowhere else; the result is then checked against its schema by
 * `respond()` before it leaves.
 */

export function presentMarket(v: MarketView): z.input<typeof S.Market> {
  const m = v.market;
  return {
    id: m.id,
    slug: m.slug,
    question: m.question,
    description: m.description,
    contract: m.contract,
    kind: m.kind,
    status: m.status,
    b: m.b,
    outcomes: v.outcomes.map((o) => ({
      id: o.id,
      label: o.label,
      ordinal: o.ordinal,
      sharesMicro: o.sharesMicro.toString(),
      price: o.price,
    })),
    volumeMicro: v.volumeMicro.toString(),
    orderCount: v.orderCount,
    opensAt: toIsoOrNull(m.opensAt),
    closesAt: toIso(m.closesAt),
    createdAt: toIso(m.createdAt),
    resolutionSource: m.resolutionSource,
    resolvedOutcomeId: m.resolvedOutcomeId,
    resolutionEvidenceUrl: m.resolutionEvidenceUrl,
    settledAt: toIsoOrNull(m.settledAt),
    listingId: m.listingId,
    listingRank: m.listingRank,
  };
}

export function presentListing(v: ListingView): z.input<typeof S.Listing> {
  const l = v.listing;
  return {
    id: l.id,
    slug: l.slug,
    title: l.title,
    summary: l.summary,
    tldr: l.tldr,
    authors: l.authors,
    authorIds: l.authorIds,
    keywords: l.keywords,
    primaryArea: l.primaryArea,
    links: l.links.map((k) => ({ label: k.label, url: k.url })),
    kind: l.kind,
    closedAt: toIsoOrNull(l.closedAt),
    createdAt: toIso(l.createdAt),
    followers: v.followers,
    views: l.viewCount,
  };
}

function presentCited(c: CitedListing): z.input<typeof S.CitedListing> {
  return {
    id: c.listing.id,
    slug: c.listing.slug,
    title: c.listing.title,
    authors: c.listing.authors,
    kind: c.listing.kind,
  };
}

export function presentRelated(r: RelatedList): z.input<typeof S.ListingRelated> {
  return { related: r.related.map(presentCited) };
}

export function presentCitations(c: ListingCitations): z.input<typeof S.ListingCitations> {
  return {
    references: c.references.map(({ reference: r, cited }) => ({
      title: r.title,
      authors: r.authors,
      year: r.year,
      venue: r.venue,
      url: r.url,
      slug: r.citedSlug,
      listing: cited ? presentCited(cited) : null,
    })),
    citedBy: c.citedBy.map(presentCited),
    citedByTotal: c.citedByTotal,
  };
}

export function presentFollowed(f: FollowedListing): z.input<typeof S.FollowedListing> {
  return { listing: presentListing(f.view), followedAt: toIso(f.followedAt) };
}

/** The public tape entry. No account, no idempotency key: no identities. */
export function presentTapeEntry(o: OrderRow): z.input<typeof S.TapeEntry> {
  return {
    id: o.id,
    outcomeId: o.outcomeId,
    sharesMicro: o.sharesMicro.toString(),
    costMicro: o.costMicro.toString(),
    priceBefore: o.priceBefore,
    priceAfter: o.priceAfter,
    createdAt: toIso(o.createdAt),
  };
}

export function presentMyOrder(o: OrderRow): z.input<typeof S.MyOrder> {
  return { ...presentTapeEntry(o), marketId: o.marketId, idempotencyKey: o.idempotencyKey };
}

export function presentQuote(q: QuoteModel): z.input<typeof S.Quote> {
  return {
    marketId: q.marketId,
    outcomeId: q.outcomeId,
    outcomeLabel: q.outcomeLabel,
    sharesMicro: q.sharesMicro.toString(),
    costMicro: q.costMicro.toString(),
    priceBefore: q.priceBefore,
    priceAfter: q.priceAfter,
  };
}

export function presentFill(f: FillModel, firstTrade: boolean): z.input<typeof S.Fill> {
  return {
    orderId: f.orderId,
    marketId: f.marketId,
    outcomeId: f.outcomeId,
    sharesMicro: f.sharesMicro.toString(),
    costMicro: f.costMicro.toString(),
    priceBefore: f.priceBefore,
    priceAfter: f.priceAfter,
    balanceAfterMicro: f.balanceAfterMicro.toString(),
    positionAfterMicro: f.positionAfterMicro.toString(),
    createdAt: toIso(f.createdAt),
    replayed: f.replayed,
    firstTrade,
  };
}

export function presentMe(p: Principal): z.input<typeof S.Me> {
  const a: Account = p.account;
  return {
    id: a.id,
    handle: a.handle,
    displayName: a.displayName,
    isBot: a.isBot,
    institutions: [...a.institutions],
    verifiedAt: toIsoOrNull(a.verifiedAt),
    createdAt: toIso(a.createdAt),
    digestOptIn: a.digestOptIn,
    mentionMailOptIn: a.mentionMailOptIn,
    auth: { method: p.method, scopes: [...p.scopes] },
  };
}

export const NET_WORTH_CAVEAT =
  'Mid-market net worth marks open positions at the current price, which includes your own price impact: ' +
  'a trader can show a profit while holding only losing positions. It is correct at settlement and ' +
  'meaningless before it. It is not a score and nothing is ranked on it: the leaderboard ranks on settled P&L, ' +
  'or on liquidation value (a wallet’s `netWorthMicro`), which prices every holding at a real exit quote.';

export function presentPortfolio(p: PortfolioModel): z.input<typeof S.Portfolio> {
  return {
    accountId: p.accountId,
    holdings: p.holdings.map((h) => ({
      marketId: h.marketId,
      marketSlug: h.marketSlug,
      listingSlug: h.listingSlug,
      listingTitle: h.listingTitle,
      question: h.question,
      kind: h.kind,
      marketStatus: h.marketStatus,
      outcomeId: h.outcomeId,
      outcomeLabel: h.outcomeLabel,
      outcomeOrdinal: h.outcomeOrdinal,
      outcomeCount: h.outcomeCount,
      sharesMicro: h.sharesMicro.toString(),
      price: h.price,
      markMicro: h.markMicro.toString(),
      quotedExitMicro: h.quotedExitMicro.toString(),
      costBasisMicro: h.costBasisMicro.toString(),
      publicPositionId: h.publicPositionId,
    })),
    wallets: p.wallets.map((w) => ({
      kind: w.kind,
      cashMicro: w.cashMicro.toString(),
      holdingsValueMicro: w.holdingsValueMicro.toString(),
      netWorthMicro: w.netWorthMicro.toString(),
      unrealizedPnlMicro: w.unrealizedPnlMicro.toString(),
      realizedPnlMicro: w.realizedPnlMicro.toString(),
      midMarketNetWorthMicro: w.markedNetWorthMicro.toString(),
    })),
    midMarketCaveat: NET_WORTH_CAVEAT,
  };
}

export function presentAffiliation(f: Affiliation): z.input<typeof S.Affiliation> {
  return {
    id: f.id,
    email: f.email,
    institutionName: f.institutionName,
    primary: f.isPrimary,
    verifiedAt: toIsoOrNull(f.verifiedAt),
    codeExpiresAt: f.verifiedAt ? null : toIsoOrNull(f.codeExpiresAt),
    createdAt: toIso(f.createdAt),
  };
}

export function presentToken(t: TokenRecord): z.input<typeof S.TokenInfo> {
  return {
    id: t.id,
    name: t.name,
    start: t.start,
    scopes: t.scopes,
    createdAt: toIso(t.createdAt),
    lastUsedAt: toIsoOrNull(t.lastUsedAt),
    enabled: t.enabled,
  };
}

export function presentComment(c: CommentView): z.input<typeof S.Comment> {
  return {
    id: c.id,
    parentId: c.parentId,
    body: c.body,
    createdAt: toIso(c.createdAt),
    replyCount: c.replyCount,
    mentions: c.mentions,
    author: {
      alias: c.author.alias,
      bot: c.author.bot,
      isYou: c.author.isYou,
      stake: c.author.stake.map((s) => ({ ...s, sharesMicro: s.sharesMicro.toString() })),
    },
    backing: {
      totalMicro: c.backing.totalMicro.toString(),
      byOutcome: c.backing.byOutcome.map((o) => ({
        ...o,
        sharesMicro: o.sharesMicro.toString(),
        valueMicro: o.valueMicro.toString(),
      })),
      backers: c.backing.backers,
      yours: c.backing.yours.map((y) => ({ ...y, sharesMicro: y.sharesMicro.toString() })),
    },
  };
}

export function presentPaperComment(c: PaperCommentView): z.input<typeof S.PaperComment> {
  return {
    id: c.id,
    parentId: c.parentId,
    body: c.body,
    createdAt: toIso(c.createdAt),
    replyCount: c.replyCount,
    mentions: c.mentions,
    author: c.author,
  };
}

export function presentComments(page: {
  comments: CommentView[];
  replies: CommentView[];
  nextCursor: string | null;
  total: number;
  viewer: ViewerStake | null;
}): z.input<typeof S.CommentList> {
  return {
    comments: page.comments.map(presentComment),
    replies: page.replies.map(presentComment),
    nextCursor: page.nextCursor,
    total: page.total,
    viewer: page.viewer
      ? {
          alias: page.viewer.alias,
          available: page.viewer.available.map((a) => ({
            ...a,
            heldMicro: a.heldMicro.toString(),
            allocatedMicro: a.allocatedMicro.toString(),
          })),
        }
      : null,
  };
}

export function presentPublicPosition(p: PublicPositionView): z.input<typeof S.PublicPosition> {
  return {
    id: p.id,
    createdAt: toIso(p.createdAt),
    trader: p.trader,
    market: p.market,
    outcome: p.outcome,
    price: p.price,
    state: p.state,
    sharedSharesMicro: p.sharedSharesMicro.toString(),
    heldMicro: p.heldMicro.toString(),
    boughtMicro: p.boughtMicro.toString(),
    paidMicro: p.paidMicro.toString(),
    soldMicro: p.soldMicro.toString(),
    costBasisMicro: p.costBasisMicro.toString(),
    quotedExitMicro: p.quotedExitMicro?.toString() ?? null,
    payoutMicro: p.payoutMicro.toString(),
    pnlMicro: p.pnlMicro.toString(),
  };
}

/** A group as anyone sees it: its invite code only for a member (`role`). */
export function presentGroup(group: Group, members: GroupMember[], role: GroupRole | null): z.input<typeof S.Group> {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    createdAt: toIso(group.createdAt),
    memberCount: members.length,
    members: members.map((m) => ({
      handle: m.handle,
      displayName: m.displayName,
      isBot: m.isBot,
      institutions: [...m.institutions],
      role: m.accountId === group.adminAccountId ? 'admin' : 'member',
      joinedAt: toIso(m.joinedAt),
    })),
    role,
    inviteCode: role === null ? null : group.inviteCode,
  };
}

export function presentGroupSummary(g: GroupSummary): z.input<typeof S.GroupSummary> {
  return {
    id: g.group.id,
    name: g.group.name,
    description: g.group.description,
    memberCount: g.memberCount,
    role: g.role,
    inviteCode: g.group.inviteCode,
  };
}
