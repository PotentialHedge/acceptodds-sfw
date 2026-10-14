import { z } from 'zod';
import { SEARCH_MAX_LENGTH } from '@/lib/search';
import { TOKEN_SCOPES } from '../tokens';
import { API_ERROR_CODES } from './errors';

/**
 * The `/api/v1` contract, as Zod. **One schema per boundary**, used three ways:
 * to parse requests, to validate every response on its way out, and to
 * generate the OpenAPI document (`server/api/openapi.ts`). A field that is not
 * here does not exist in the API.
 *
 * Conventions:
 * - Money and share quantities are integer **micro-units** (1 unit =
 *   1,000,000), named `…Micro`, and serialised as decimal strings so that no
 *   client parses them into a float (invariant §1.6). Requests accept a string
 *   or a JSON integer.
 * - Prices are probabilities in (0, 1), as JSON numbers.
 * - Timestamps are ISO 8601 strings in UTC.
 */

// ---------------------------------------------------------------------------
// primitives
// ---------------------------------------------------------------------------

const MICRO_DESCRIPTION = 'Integer micro-units (1 unit = 1,000,000), as a decimal string.';

/** Output: a bigint rendered as a decimal string. */
export const Micro = z
  .string()
  .regex(/^-?\d+$/)
  .meta({ description: MICRO_DESCRIPTION, example: '1500000' });

const MAX_INT64 = 9_223_372_036_854_775_807n;

/** Input: a decimal string or a JSON integer, parsed to a `bigint`. */
export const MicroInput = z
  .union([z.string().regex(/^-?\d{1,19}$/), z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER)])
  .transform((v, ctx) => {
    const n = BigInt(v);
    if (n > MAX_INT64 || n < -MAX_INT64) {
      ctx.addIssue({ code: 'custom', message: 'out of range' });
      return z.NEVER;
    }
    return n;
  })
  .meta({
    description: `${MICRO_DESCRIPTION} A JSON integer is also accepted.`,
    example: '10000000',
  });

export const Id = z.uuid();
export const Timestamp = z.iso.datetime({ offset: true });
export const Price = z.number().min(0).max(1).meta({ description: 'Implied probability.' });
export const Cursor = z.string().nullable().meta({
  description: 'Opaque. Pass as `cursor` to get the next page; `null` on the last page.',
});

export const PaginationQuery = z.object({
  cursor: z.string().max(512).optional().meta({ description: 'From a previous page’s `nextCursor`.' }),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Path parameter: a market's uuid or its slug. */
export const MarketRef = z
  .string()
  .min(1)
  .max(100)
  .meta({ description: 'The market’s id (uuid) or its slug.', example: 'example-binary' });

// ---------------------------------------------------------------------------
// errors
// ---------------------------------------------------------------------------

export const ErrorResponse = z
  .object({
    error: z.object({
      code: z.enum(API_ERROR_CODES).meta({
        description: 'Stable and machine-readable. Branch on this, not on `message`.',
      }),
      message: z.string(),
      details: z.record(z.string(), z.unknown()).optional(),
    }),
  })
  .meta({ id: 'Error' });

// ---------------------------------------------------------------------------
// markets
// ---------------------------------------------------------------------------

export const MarketStatus = z.enum(['draft', 'open', 'closed', 'settled', 'void']);

export const OutcomeOnBoard = z
  .object({
    id: Id,
    label: z.string(),
    ordinal: z.number().int(),
    sharesMicro: Micro.meta({ description: 'Outstanding shares of this outcome (the `q_i` of the cost function).' }),
    price: Price,
  })
  .meta({ id: 'Outcome' });

export const Market = z
  .object({
    id: Id,
    slug: z.string(),
    question: z.string(),
    description: z
      .string()
      .nullable()
      .meta({ description: 'The subtitle: one line shown under the question, which stays short.' }),
    contract: z
      .string()
      .nullable()
      .meta({ description: 'How the market resolves, in detail. Markdown, supplied by the creating client.' }),
    kind: z.string().meta({ description: 'Opaque to the venue; whatever the creating client groups by.' }),
    status: MarketStatus,
    b: z.number().positive().meta({
      description: 'LMSR liquidity parameter, in micro-units. Computed once at creation and frozen: it never changes.',
    }),
    outcomes: z.array(OutcomeOnBoard),
    volumeMicro: Micro.meta({ description: 'Sum of |cost| over every fill.' }),
    orderCount: z.number().int(),
    opensAt: Timestamp.nullable(),
    closesAt: Timestamp,
    createdAt: Timestamp,
    resolutionSource: z.string().nullable(),
    resolvedOutcomeId: Id.nullable(),
    resolutionEvidenceUrl: z.string().nullable(),
    settledAt: Timestamp.nullable(),
    listingId: Id.nullable().meta({ description: 'The listing this market belongs to, if any.' }),
    listingRank: z.number().int().meta({
      description: 'Order within its listing. The lowest (0) is the listing’s main market.',
    }),
  })
  .meta({ id: 'Market' });

/** Free-text search, shared by the list endpoints. Blank is the same as absent. */
export const SearchQuery = z.string().max(SEARCH_MAX_LENGTH).optional().meta({
  description:
    'Free-text search (Postgres full text, English stemming). Web-search syntax: `"a phrase"`, `a OR b`, `-word`; without those, the last word also matches as a prefix. With `q`, results are ordered by relevance, best first, and `nextCursor` pages in that order (a cursor from an unsearched page is refused). Blank is ignored.',
  example: 'transformer attention',
});

export const MarketListQuery = PaginationQuery.extend({
  status: MarketStatus.optional().meta({
    description: 'Filter by status. Without it, every market except drafts.',
  }),
  kind: z.string().max(100).optional().meta({ description: 'Filter by the opaque `kind` string.' }),
  q: SearchQuery,
});

export const MarketList = z.object({ markets: z.array(Market), nextCursor: Cursor }).meta({ id: 'MarketList' });

// ---------------------------------------------------------------------------
// listings — opaque subjects that group markets
// ---------------------------------------------------------------------------

/** Path parameter: a listing's uuid or its slug. */
export const ListingRef = z
  .string()
  .min(1)
  .max(100)
  .meta({ description: 'The listing’s id (uuid) or its slug.', example: 'example-listing' });

export const ListingLink = z
  .object({
    label: z.string().min(1).max(100),
    url: z.url({ protocol: /^https?$/ }).max(2000),
  })
  .meta({ id: 'ListingLink' });

const ListingFields = {
  id: Id,
  slug: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  tldr: z.string().nullable().meta({ description: 'A one-line summary.' }),
  authors: z.array(z.string()),
  authorIds: z.array(z.string()).meta({
    description: 'One opaque id per name in `authors`, in the same order, or empty. Never resolved by the venue.',
  }),
  keywords: z.array(z.string()),
  primaryArea: z.string().nullable().meta({ description: 'Opaque.' }),
  links: z.array(ListingLink),
  kind: z.string().nullable().meta({ description: 'Opaque to the venue; whatever the creating client groups by.' }),
  closedAt: Timestamp.nullable().meta({
    description:
      'When the creating client closed it (`PUT /listings/{id}/closed`), else `null`. No new market opens on a closed listing; its existing markets are unaffected.',
  }),
  createdAt: Timestamp,
};

export const Listing = z
  .object({
    ...ListingFields,
    followers: z.number().int().min(0).meta({ description: 'How many accounts follow this listing. Never who.' }),
    views: z.number().int().min(0).meta({ description: 'Unique viewers per day, summed over every day so far.' }),
    markets: z.array(Market).meta({
      description: 'Its markets, drafts excluded, by `listingRank` ascending: the first is the main market.',
    }),
  })
  .meta({
    id: 'Listing',
    description:
      'An opaque subject that markets are grouped under, supplied whole by the creating client. The venue never fetches or interprets any of it.',
  });

/** A listing as cited or citing (#38): enough to name it, and its main market for the odds. */
export const CitedListing = z
  .object({
    id: Id,
    slug: z.string(),
    title: z.string(),
    authors: z.array(z.string()),
    kind: z.string().nullable(),
    market: Market.nullable().meta({ description: 'Its main market; `null` when it has no visible one.' }),
  })
  .meta({ id: 'CitedListing' });

export const ListingReferenceEntry = z
  .object({
    title: z.string(),
    authors: z.array(z.string()),
    year: z.number().int().nullable(),
    venue: z.string().nullable(),
    url: z.string().nullable(),
    slug: z.string().nullable().meta({ description: 'The cited work’s listing slug, as the creating client gave it.' }),
    listing: CitedListing.nullable().meta({
      description: 'The listing that `slug` names, when there is one here now. Matched on every read.',
    }),
  })
  .meta({ id: 'ListingReference' });

export const ListingCitations = z
  .object({
    references: z.array(ListingReferenceEntry).meta({ description: 'The listing’s bibliography, in its own order.' }),
    citedBy: z.array(CitedListing).meta({
      description: 'Listings whose bibliography names this one, newest first, at most 100.',
    }),
    citedByTotal: z.number().int().min(0),
  })
  .meta({
    id: 'ListingCitations',
    description:
      'Supplied by the creating client with the listing; the venue extracts nothing. A listing citing itself is left out.',
  });

export const ListingRelated = z
  .object({
    related: z
      .array(CitedListing)
      .meta({ description: 'Best match first. Entries with no listing here are left out.' }),
    hidden: z.number().int().min(0).meta({
      description:
        'How many more were named but are not sent: until the listing has a bet, only the first 3 are. A bet on any of its markets shows the rest.',
    }),
  })
  .meta({
    id: 'ListingRelated',
    description: 'Listings a separate similarity service named as related. The venue computes no similarity.',
  });

export const SetRelatedResult = z
  .object({ listingId: Id, count: z.number().int().min(0) })
  .meta({ id: 'SetRelatedResult' });

const Kind = z.string().min(1).max(200);

const MapTopic = z.object({ number: z.number().int(), label: z.string() }).meta({ id: 'MapTopic' });

const MapPoint = z
  .object({
    slug: z.string(),
    title: z.string(),
    primaryArea: z.string().nullable(),
    x: z.number(),
    y: z.number(),
    region: z.number().int().nullable(),
    cluster: z.number().int().nullable(),
    headline: z.number().nullable().meta({
      description:
        'The main market’s headline price (accepted in any form, for a paper); 1/0 once settled; `null` when void or there is no market. A price, never a value.',
    }),
  })
  .meta({ id: 'MapPoint' });

const column = <T extends z.ZodType>(item: T, description: string) => z.array(item).meta({ description });

/** Which venue's map: every map read but the minimap, which is its listing's venue's. */
export const MapQuery = z.object({
  kind: Kind.optional().meta({
    description:
      'The venue (a market `kind`) whose map to read. Each venue has its own map, or none. Defaults to the site’s default venue.',
    example: 'ICLR 2027',
  }),
});

export const PaperMap = z
  .object({
    kind: Kind.meta({ description: 'The venue the map is of.' }),
    slugs: column(
      z.string(),
      'Every listing on the map, by slug, sorted. Index `i` of every other column is this listing.',
    ),
    x: column(z.number(), 'Horizontal coordinate, in the layout’s own units.'),
    y: column(z.number(), 'Vertical coordinate, in the layout’s own units.'),
    region: column(z.number().int().nullable(), 'Coarse grouping (`regions`).'),
    cluster: column(z.number().int().nullable(), 'Fine grouping (`clusters`).'),
    area: column(z.number().int().min(0).nullable(), 'Index into `areas` of the listing’s primary area.'),
    areas: column(z.string(), 'The distinct primary areas, sorted.'),
    headline: column(
      z.number().nullable(),
      'The main market’s headline price (accepted in any form, for a paper); 1/0 once settled; `null` when void or there is no market. A price, never a value.',
    ),
    regions: z.array(MapTopic).meta({ description: 'Names of the coarse groupings.' }),
    clusters: z.array(MapTopic).meta({ description: 'Names of the fine groupings.' }),
  })
  .meta({
    id: 'PaperMap',
    description:
      'A venue’s 2D layout of its listings, supplied by a separate service, by column, without titles (`GET /map/titles`). Coordinates are in its own units; the platform computes no layout. Empty when the venue has no map.',
  });

export const MapTitles = z
  .object({ titles: z.record(z.string(), z.string()).meta({ description: 'Each listing’s title, by slug.' }) })
  .meta({ id: 'MapTitles', description: 'The title of every listing on the paper map.' });

export const Minimap = z
  .object({
    points: z.array(MapPoint).meta({ description: 'The listing, the papers nearest it and its related papers.' }),
    vectors: z.array(z.array(z.number())).nullable().meta({
      description: 'The supplied vector of each point, in `points`’ order; `null` unless every point has one.',
    }),
    self: z.number().int().min(0).meta({ description: 'Index of the listing itself in `points`.' }),
    related: z.array(z.number().int().min(0)).meta({ description: 'Indexes of its related papers, best first.' }),
    relatedElsewhere: z
      .number()
      .int()
      .min(0)
      .meta({ description: 'Related papers that are listed but not on the map.' }),
    edges: z
      .array(z.tuple([z.number().int().min(0), z.number().int().min(0)]))
      .meta({ description: 'Every related pair between `points`, as indexes.' }),
    clusters: z.array(MapTopic).meta({ description: 'Names of the fine groupings among `points`.' }),
  })
  .meta({
    id: 'Minimap',
    description:
      'A listing’s piece of the paper map, with what a client needs to lay it out again round the listing. All supplied by other services.',
  });

export const MapSearchQuery = MapQuery.extend({
  q: SearchQuery.meta({ description: 'The home page’s search syntax (see `/map/search`). Blank finds nothing.' }),
});

export const MapSearch = z
  .object({
    slugs: z.array(z.string()).meta({ description: 'Every matching listing’s slug, most relevant first.' }),
    errors: z.array(z.string()).meta({ description: 'Terms the parser could not use and left out.' }),
  })
  .meta({
    id: 'MapSearch',
    description:
      'The home page’s search syntax (words, `key:value` filters, `OR`, groups, `-` negation) over one venue’s listings, for its map to highlight. Every status unless the query names one.',
  });

export const MapRelated = z
  .object({
    slugs: z.array(z.string()).meta({ description: 'The listings the edges name, each once.' }),
    edges: z.array(z.number().int().min(0)).meta({
      description:
        'Flattened pairs `[from, to, from, to, …]` of indexes into `slugs`: each listing’s best related entries, directional, in the supplier’s order.',
    }),
  })
  .meta({
    id: 'MapRelated',
    description:
      'The related lists between papers on the map, compactly, for a client that re-lays out a subset. Supplied by the similarity service; the venue computes none.',
  });

export const SetMapResult = z.object({ count: z.number().int().min(0) }).meta({ id: 'SetMapResult' });

export const ListingListQuery = PaginationQuery.extend({
  kind: z.string().max(100).optional().meta({ description: 'Filter by the opaque `kind` string.' }),
  q: SearchQuery,
});

export const ListingList = z.object({ listings: z.array(Listing), nextCursor: Cursor }).meta({ id: 'ListingList' });

export const FollowState = z
  .object({
    listingId: Id,
    following: z.boolean().meta({ description: 'Whether the caller now follows the listing.' }),
    followers: z.number().int().min(0),
  })
  .meta({ id: 'FollowState' });

export const ViewState = z
  .object({
    listingId: Id,
    views: z.number().int().min(0).meta({ description: 'Unique viewers per day, summed over every day so far.' }),
  })
  .meta({ id: 'ViewState' });

export const ViewQuery = z.object({
  from: z.string().max(100).optional().meta({
    description:
      'The id of the listing the visitor read just before, if any. Counted as a transition (`GET /transitions`); ignored when it is not a listing id.',
  }),
});

export const TransitionsQuery = z.object({
  min: z.coerce.number().int().min(1).default(1).meta({ description: 'Leave out pairs counted fewer times.' }),
});

export const Version = z
  .object({
    version: z.string().meta({ description: 'The platform’s package version.', example: '0.1.0' }),
    commit: z.string().nullable().meta({
      description: 'The git commit the server was built from; null when the build did not record one.',
    }),
    startedAt: Timestamp.meta({
      description: 'When the server process started. A deploy restarts it, so this changes with every deploy.',
    }),
  })
  .meta({ id: 'Version' });

export const Transitions = z
  .object({
    transitions: z.array(
      z.object({
        from: z.string().meta({ description: 'Slug of the listing read first.' }),
        to: z.string().meta({ description: 'Slug of the listing read next.' }),
        count: z.number().int().min(1).meta({ description: 'Unique visitors per day who did, summed.' }),
      }),
    ),
  })
  .meta({
    id: 'Transitions',
    description:
      'How many visitors read one listing and then another, per ordered pair, most first. Totals only: no visitor, time or sequence is kept. For a similarity service; the venue interprets none of it.',
  });

export const HeadlineMove = z
  .object({
    marketId: Id,
    outcomeId: Id,
    outcomeLabel: z.string(),
    negated: z.boolean().meta({
      description:
        'True when the headline is `1 − P(outcome)` (a market with more than two outcomes), false when it is `P(outcome)`.',
    }),
    price: Price.meta({ description: 'The headline now.' }),
    price24hAgo: Price.meta({
      description: 'The headline 24 hours ago, replayed exactly from the fills (the opening price for a newer market).',
    }),
  })
  .meta({
    id: 'HeadlineMove',
    description:
      'The main market’s headline: the first outcome’s price of a binary market; for more outcomes, which are ordered best first and worst last, `1 − P(last outcome)` (for a paper, accepted in any form). A probability, not a value.',
  });

export const FollowedListing = z
  .object({
    listing: Listing,
    followedAt: Timestamp,
    headline: HeadlineMove.nullable().meta({ description: '`null` when the listing has no visible market.' }),
  })
  .meta({ id: 'FollowedListing' });

export const FollowList = z
  .object({ follows: z.array(FollowedListing).meta({ description: 'Most recently followed first.' }) })
  .meta({ id: 'FollowList' });

export const MentionListQuery = PaginationQuery.extend({
  since: Timestamp.optional().meta({
    description: 'Only mentions in comments posted after this instant: pass the time you last checked.',
  }),
});

export const Mention = z
  .object({
    commentId: Id,
    parentId: Id.nullable().meta({ description: 'The comment it replies to; `null` on a top-level comment.' }),
    body: z.string().meta({ description: 'The comment as posted (Markdown).' }),
    createdAt: Timestamp,
    market: z.object({
      id: Id,
      slug: z.string(),
      title: z.string().meta({ description: 'The paper’s title, or an unlisted market’s question.' }),
      url: z.string().meta({ description: 'Where the discussion is read, a path on this site.' }),
    }),
    author: z
      .object({
        alias: z.string(),
        bot: z.object({ handle: z.string(), displayName: z.string() }).nullable(),
      })
      .meta({ description: 'As the discussion shows the author: an alias on that paper, a bot by name.' }),
  })
  .meta({ id: 'Mention' });

export const MentionList = z
  .object({
    mentions: z.array(Mention).meta({ description: 'Newest first.' }),
    nextCursor: Cursor,
  })
  .meta({ id: 'MentionList' });

export const HistoryPoint = z.object({
  at: Timestamp,
  prices: z.array(Price).meta({ description: 'Every outcome’s price, indexed by `ordinal`.' }),
});

export const PriceHistory = z
  .object({
    marketId: Id,
    outcomes: z.array(z.object({ id: Id, label: z.string(), ordinal: z.number().int() })),
    points: z.array(HistoryPoint).meta({
      description:
        'Oldest first. One point per fill, plus the opening point on the first page. Reconstructed from the fills, not sampled.',
    }),
    nextCursor: Cursor,
  })
  .meta({ id: 'PriceHistory' });

export const TapeEntry = z
  .object({
    id: Id,
    outcomeId: Id,
    sharesMicro: Micro.meta({ description: 'Signed: negative is a sell.' }),
    costMicro: Micro.meta({ description: 'Signed: negative is proceeds paid to the seller.' }),
    priceBefore: Price,
    priceAfter: Price,
    createdAt: Timestamp,
  })
  .meta({ id: 'TapeEntry', description: 'A fill, without the identity of who made it.' });

export const Tape = z
  .object({ orders: z.array(TapeEntry).meta({ description: 'Newest first.' }), nextCursor: Cursor })
  .meta({ id: 'Tape' });

// ---------------------------------------------------------------------------
// quote and trade
// ---------------------------------------------------------------------------

export const QuoteRequest = z
  .object({
    outcomeId: Id,
    sharesMicro: MicroInput.meta({
      description: 'Shares to trade, in micro-shares. Negative to sell. Must not be zero.',
    }),
  })
  .meta({ id: 'QuoteRequest' });

export const Quote = z
  .object({
    marketId: Id,
    outcomeId: Id,
    outcomeLabel: z.string(),
    sharesMicro: Micro,
    costMicro: Micro.meta({
      description:
        'Priced for the whole size, slippage included — not shares × price. Positive is paid; negative is received. Advisory: a trade re-prices.',
    }),
    priceBefore: Price,
    priceAfter: Price,
  })
  .meta({ id: 'Quote' });

export const OrderRequest = z
  .object({
    outcomeId: Id,
    sharesMicro: MicroInput.meta({
      description: 'Shares to trade, in micro-shares. Negative to sell; you may only sell what you hold.',
    }),
    maxCostMicro: MicroInput.meta({
      description:
        'Slippage limit, same sign convention as `costMicro`. The order is re-priced under the market lock and refused with `slippage_exceeded` if the cost is above this. For a sell, pass minus the least proceeds you will accept.',
    }),
    isLlm: z.boolean().optional().meta({
      description:
        'Say that a language model is placing this order (an AI agent trading for you). Voluntary and unchecked: it is only recorded, and changes nothing about the order.',
    }),
  })
  .meta({ id: 'OrderRequest' });

export const Fill = z
  .object({
    orderId: Id,
    marketId: Id,
    outcomeId: Id,
    sharesMicro: Micro,
    costMicro: Micro,
    priceBefore: Price,
    priceAfter: Price,
    balanceAfterMicro: Micro,
    positionAfterMicro: Micro,
    createdAt: Timestamp,
    replayed: z.boolean().meta({
      description: 'True when this is the original fill returned for a retried `Idempotency-Key`.',
    }),
    firstTrade: z.boolean().meta({ description: 'True when this is the first order the account ever placed.' }),
  })
  .meta({ id: 'Fill' });

export const ListingOrderRequest = z
  .object({
    outcome: z.string().min(1).max(200).meta({ description: 'The outcome’s label, e.g. "Accept".' }),
    stakeMicro: MicroInput.meta({
      description:
        'What to spend, in micro-units: also the order’s bound. It buys as many shares as it pays for on the board when the order arrives, and never costs more.',
    }),
    isLlm: z.boolean().optional().meta({
      description:
        'Say that a language model is placing this order (an AI agent trading for you). Voluntary and unchecked: it is only recorded, and changes nothing about the order.',
    }),
  })
  .meta({ id: 'ListingOrderRequest' });

export const OpenedMarket = z
  .object({
    market: Market,
    created: z
      .boolean()
      .meta({ description: 'True when this request made the market; false when it already had one.' }),
  })
  .meta({ id: 'OpenedMarket' });

export const ListingFill = Fill.extend({
  marketCreated: z.boolean().meta({
    description: 'True when this order made the listing’s market: its first trade.',
  }),
}).meta({ id: 'ListingFill' });

// ---------------------------------------------------------------------------
// accounts and leaderboard
// ---------------------------------------------------------------------------

const Institutions = z.array(z.string()).meta({
  description:
    'Every institution the trader has a confirmed email address at, the one they signed up with first. Empty for a bot or an unverified account.',
});

export const SettledRecord = z
  .object({
    kind: Kind.meta({ description: 'The venue: a wallet of its own, with its own record.' }),
    settledPnlMicro: Micro.meta({
      description: 'Net reputation from trading and settlement, over settled markets only.',
    }),
    settledMarkets: z.number().int(),
  })
  .meta({ id: 'SettledRecord' });

export const LeaderboardEntry = z
  .object({
    rank: z.number().int().min(1).meta({ description: 'Ties share a rank.' }),
    handle: z.string(),
    displayName: z.string(),
    isBot: z.boolean(),
    institutions: Institutions,
    settledPnlMicro: Micro.meta({
      description: 'Realized: net reputation from trading and settlement, over settled markets only.',
    }),
    settledMarkets: z.number().int(),
    netWorthMicro: Micro.meta({
      description:
        'Liquidation value: cash + what selling every open holding now would actually pay (real quotes, slippage included). Not a mark.',
    }),
    unrealizedPnlMicro: Micro.meta({
      description:
        'What selling every open holding now would pay, minus what those markets’ trades cost net of sales, over markets not yet settled.',
    }),
  })
  .meta({ id: 'LeaderboardEntry' });

export const LEADERBOARD_BASIS_DESCRIPTION =
  '`settled_pnl` (the default): P&L over settled markets only; accounts with no settled market are not listed. ' +
  '`net_worth`: every trader, by liquidation value — cash plus what selling every open holding now would actually pay. ' +
  'That cannot be inflated by the trader’s own price impact, because the exit quote walks back down the curve the buy walked up. ' +
  'Mark-based (mid-market) net worth can be, and is never a ranking basis.';

export const LeaderboardBasis = z
  .enum(['settled_pnl', 'net_worth'])
  .meta({ description: LEADERBOARD_BASIS_DESCRIPTION });

export const LeaderboardQuery = PaginationQuery.extend({
  kind: Kind.optional().meta({
    description:
      'The venue (a market `kind`) to rank. Each venue is a wallet of its own, and its board ranks the traders who have traded in it on what they did there. Defaults to the site’s default venue.',
    example: 'ICLR 2027',
  }),
  basis: LeaderboardBasis.default('settled_pnl'),
  institution: z.string().max(200).optional().meta({
    description:
      'Only traders with a confirmed affiliation at this institution (exactly one of their `institutions`), ranked among themselves.',
    example: 'ETH Zurich',
  }),
  group: Id.optional().meta({
    description:
      'Only the members of this group (`GET /groups/{id}`), ranked among themselves. Combines with `institution`.',
  }),
  q: z.string().max(SEARCH_MAX_LENGTH).optional().meta({
    description:
      'Only traders whose handle or display name matches, fuzzily: a case-insensitive substring, or a word close to one (trigram similarity). Each keeps their rank on the board. Blank is ignored.',
    example: 'hinton',
  }),
});

export const Leaderboard = z
  .object({
    kind: Kind,
    basis: LeaderboardBasis,
    fieldSize: z.number().int().min(0).meta({
      description: 'Traders on this board, after `institution` and `group`, before `q`: what a rank is out of.',
    }),
    entries: z.array(LeaderboardEntry),
    nextCursor: Cursor,
  })
  .meta({ id: 'Leaderboard' });

// ---------------------------------------------------------------------------
// groups
// ---------------------------------------------------------------------------

export const GroupRole = z.enum(['admin', 'member']).meta({
  description: 'The admin made the group and may rename it, rotate its invite code, remove members and delete it.',
});

const InviteCode = z.string().min(1).max(64);

const GroupName = z.string().trim().min(1).max(80);
const GroupDescription = z.string().trim().max(500);

export const GroupMember = z
  .object({
    handle: z.string(),
    displayName: z.string(),
    isBot: z.boolean(),
    institutions: Institutions,
    role: GroupRole,
    joinedAt: Timestamp,
  })
  .meta({ id: 'GroupMember' });

export const Group = z
  .object({
    id: Id,
    name: z.string(),
    description: z.string().nullable(),
    createdAt: Timestamp,
    memberCount: z.number().int().min(1),
    members: z.array(GroupMember).meta({ description: 'In the order they joined, the admin first.' }),
    role: GroupRole.nullable().meta({ description: 'The caller’s role; null when not a member, or anonymous.' }),
    inviteCode: InviteCode.nullable().meta({
      description: 'What `POST /groups/join` takes. Shown to members only; null to anyone else.',
    }),
  })
  .meta({ id: 'Group' });

export const GroupSummary = z
  .object({
    id: Id,
    name: z.string(),
    description: z.string().nullable(),
    memberCount: z.number().int().min(1),
    role: GroupRole,
    inviteCode: InviteCode,
  })
  .meta({ id: 'GroupSummary' });

export const GroupList = z
  .object({ groups: z.array(GroupSummary).meta({ description: 'By name.' }) })
  .meta({ id: 'GroupList' });

export const CreateGroupRequest = z
  .object({ name: GroupName, description: GroupDescription.nullable().optional() })
  .strict()
  .meta({ id: 'CreateGroupRequest' });

export const UpdateGroupRequest = z
  .object({
    name: GroupName.optional(),
    description: GroupDescription.nullable().optional().meta({ description: 'Null or blank clears it.' }),
  })
  .strict()
  .meta({ id: 'UpdateGroupRequest' });

export const JoinGroupRequest = z
  .object({ inviteCode: InviteCode.meta({ description: 'From the group’s invite link.' }) })
  .strict()
  .meta({ id: 'JoinGroupRequest' });

export const PublicAccount = z
  .object({
    handle: z.string(),
    displayName: z.string(),
    isBot: z.boolean(),
    institutions: Institutions,
    rorId: z.string().nullable(),
    verifiedAt: Timestamp.nullable(),
    createdAt: Timestamp,
    settledRecords: z.array(SettledRecord).meta({
      description: 'One per venue the trader has traded in, venues by name.',
    }),
  })
  .meta({ id: 'PublicAccount' });

export const WalletBalance = z
  .object({
    kind: Kind.meta({ description: 'The venue. Its markets trade only against this wallet.' }),
    balanceMicro: Micro,
  })
  .meta({ id: 'WalletBalance' });

export const Me = z
  .object({
    id: Id,
    handle: z.string(),
    displayName: z.string(),
    isBot: z.boolean(),
    institutions: Institutions,
    verifiedAt: Timestamp.nullable().meta({
      description: 'When the first of your current institutional email addresses was confirmed; null when none is.',
    }),
    canTrade: z.boolean().meta({
      description:
        'True for a verified account or a bot. Unverified accounts may browse and quote but not place orders.',
    }),
    wallets: z.array(WalletBalance).meta({
      description:
        'Your reputation, one wallet per venue, venues by name. Your first trade in a venue opens its wallet with the starting balance; a venue not listed has none yet.',
    }),
    createdAt: Timestamp,
    digestOptIn: z.boolean().meta({
      description: 'Whether the daily email about followed papers whose price moved may be sent to you. On by default.',
    }),
    mentionMailOptIn: z.boolean().meta({
      description: 'Whether you are emailed when a comment `@`-mentions your alias. On by default.',
    }),
    auth: z.object({
      method: z.enum(['token', 'session']),
      scopes: z.array(z.enum(TOKEN_SCOPES)),
    }),
  })
  .meta({ id: 'Me' });

export const Holding = z
  .object({
    marketId: Id,
    marketSlug: z.string(),
    listingSlug: z.string().nullable().meta({ description: 'The slug of the market’s listing, if it has one.' }),
    listingTitle: z.string().nullable().meta({ description: 'The title of the market’s listing, if it has one.' }),
    question: z.string(),
    kind: Kind.meta({ description: 'The market’s venue: the wallet the holding was bought from.' }),
    marketStatus: MarketStatus,
    outcomeId: Id,
    outcomeLabel: z.string(),
    outcomeOrdinal: z.number().int().nonnegative().meta({
      description: 'The outcome’s place in its market, 0 = first. Outcomes are ordered best first, worst last.',
    }),
    outcomeCount: z.number().int().positive().meta({ description: 'How many outcomes its market has.' }),
    sharesMicro: Micro,
    price: Price,
    markMicro: Micro.meta({
      description:
        'shares × current price. A MARK, NOT A SALE PRICE: closing the position pays `quotedExitMicro`, which is less.',
    }),
    quotedExitMicro: Micro.meta({
      description:
        'What selling the whole holding now would pay: a real quote for the full size, slippage included. Always ≤ `markMicro`.',
    }),
    costBasisMicro: Micro.meta({
      description:
        'What the shares held cost, by the average-cost method: buys add their cost, a sell removes its fraction of the basis. How the position was entered — not a value.',
    }),
    publicPositionId: Id.nullable().meta({
      description: 'The id of its public link (`GET /positions/{id}`) when you have made it public, else null.',
    }),
  })
  .meta({ id: 'Holding' });

export const PublicPosition = z
  .object({
    id: Id,
    createdAt: Timestamp.meta({ description: 'When it was made public.' }),
    trader: z.object({ handle: z.string(), displayName: z.string(), isBot: z.boolean() }),
    market: z.object({
      id: Id,
      slug: z.string(),
      question: z.string(),
      kind: z.string(),
      status: MarketStatus,
      listingSlug: z.string().nullable(),
      listingTitle: z.string().nullable(),
    }),
    outcome: z.object({
      id: Id,
      label: z.string(),
      ordinal: z.number().int().nonnegative(),
      count: z.number().int().positive().meta({ description: 'How many outcomes its market has.' }),
    }),
    price: Price.meta({ description: 'The outcome’s price now.' }),
    state: z.enum(['held', 'sold', 'won', 'lost', 'void']).meta({
      description:
        '`held`: shares are held now. `sold`: none are. `won`/`lost`: held into settlement. `void`: the market was voided.',
    }),
    sharedSharesMicro: Micro.meta({ description: 'Shares held when it was made public.' }),
    heldMicro: Micro.meta({ description: 'Shares held now; once settled, those held into settlement.' }),
    boughtMicro: Micro.meta({ description: 'Σ shares bought, over every fill.' }),
    paidMicro: Micro.meta({ description: 'Σ cost of the buys.' }),
    soldMicro: Micro.meta({ description: 'Σ proceeds of the sells.' }),
    costBasisMicro: Micro.meta({ description: 'What the shares held cost, by average cost. Not a value.' }),
    quotedExitMicro: Micro.nullable().meta({
      description:
        'What selling the shares held would pay now, slippage included; null unless the market trades and shares are held. Never a mark.',
    }),
    payoutMicro: Micro.meta({ description: '1 per share held into settlement if this outcome won, else 0.' }),
    pnlMicro: Micro.meta({ description: 'soldMicro + payoutMicro + quotedExitMicro − paidMicro.' }),
  })
  .meta({
    id: 'PublicPosition',
    description:
      'A position its holder chose to make public, read live: it follows the position as it is sold or settled.',
  });

export const PublicPositionList = z.object({ positions: z.array(PublicPosition) }).meta({ id: 'PublicPositionList' });

export const PublicPositionState = z
  .object({
    outcomeId: Id,
    publicPositionId: Id.nullable().meta({ description: 'The link id while public; null once private.' }),
  })
  .meta({ id: 'PublicPositionState' });

/** Filtering holdings never changes the wallets' totals. */
export const PortfolioQuery = z.object({ marketId: Id.optional() });

export const WalletSummary = z
  .object({
    kind: Kind.meta({ description: 'The venue. Every figure here is this wallet and the venue’s markets alone.' }),
    cashMicro: Micro.meta({ description: 'The wallet’s balance.' }),
    holdingsValueMicro: Micro.meta({ description: 'Σ quotedExitMicro over your holdings in the venue.' }),
    netWorthMicro: Micro.meta({
      description:
        'cash + holdings value: liquidation value, what you would hold in the venue if you sold everything there now. The venue leaderboard’s `net_worth` basis.',
    }),
    unrealizedPnlMicro: Micro.meta({
      description:
        'holdings value + the net of your trades on the venue’s markets not yet settled: what liquidating now would make or lose.',
    }),
    realizedPnlMicro: Micro.meta({
      description: 'Net of your trades and settlement payouts on the venue’s settled markets.',
    }),
    midMarketNetWorthMicro: Micro.meta({
      description: 'cash + Σ markMicro in the venue. Noise before settlement: see `midMarketCaveat`. Never a score.',
    }),
  })
  .meta({ id: 'WalletSummary' });

export const Portfolio = z
  .object({
    accountId: Id,
    holdings: z.array(Holding),
    wallets: z.array(WalletSummary).meta({
      description:
        'One per venue you have traded in, venues by name. Each venue is a wallet of its own: nothing is summed across them.',
    }),
    midMarketCaveat: z.string(),
  })
  .meta({ id: 'Portfolio' });

export const MyOrder = TapeEntry.extend({
  marketId: Id,
  idempotencyKey: z.string().nullable(),
}).meta({ id: 'MyOrder' });

export const MyOrders = z
  .object({ orders: z.array(MyOrder).meta({ description: 'Newest first.' }), nextCursor: Cursor })
  .meta({ id: 'MyOrders' });

export const UpdateMeRequest = z
  .object({
    digestOptIn: z.boolean().optional().meta({ description: 'Turn the daily followed-papers email on or off.' }),
    mentionMailOptIn: z
      .boolean()
      .optional()
      .meta({ description: 'Turn the email on or off that a comment mentioning you sends.' }),
    displayName: z.string().trim().min(1).max(100).optional().meta({
      description: 'The name shown for you on the leaderboard and your public page. Your handle does not change.',
    }),
  })
  .strict()
  .meta({ id: 'UpdateMeRequest' });

export const CreateTokenRequest = z
  .object({
    name: z.string().min(1).max(100),
    scopes: z
      .array(z.enum(['read', 'trade']))
      .min(1)
      .meta({
        description: 'A signed-in user may mint `read` and `trade` tokens. `admin` is issued by an operator only.',
      }),
  })
  .meta({ id: 'CreateTokenRequest' });

const TokenFields = {
  id: z.string(),
  name: z.string().nullable(),
  start: z.string().nullable().meta({ description: 'The first 16 characters, to recognise a token by. Not usable.' }),
  scopes: z.array(z.enum(TOKEN_SCOPES)),
  createdAt: Timestamp,
};

export const CreatedToken = z
  .object({
    ...TokenFields,
    token: z.string().meta({ description: 'The secret. Shown once, never again.' }),
  })
  .meta({ id: 'CreatedToken' });

export const AgentCodeRequest = z
  .object({ email: z.email().max(320).meta({ description: 'The person’s login address.' }) })
  .meta({ id: 'AgentCodeRequest' });

export const AgentCodeSent = z
  .object({ email: z.string().meta({ description: 'Where the code went, if the address has an account.' }) })
  .meta({ id: 'AgentCodeSent' });

export const AgentPromptCode = z
  .object({
    email: z.string().meta({ description: 'Your login address, which the agent sends with the code.' }),
    code: z.string().meta({ description: 'Six digits. Works once, until `expiresAt`; asking again replaces it.' }),
    expiresAt: Timestamp,
  })
  .meta({ id: 'AgentPromptCode' });

export const RedeemAgentCodeRequest = z
  .object({
    email: z.email().max(320),
    code: z
      .string()
      .regex(/^\s*\d{6}\s*$/)
      .meta({ description: 'The 6-digit code from the mail.', example: '123456' }),
  })
  .meta({ id: 'RedeemAgentCodeRequest' });

export const TokenInfo = z
  .object({ ...TokenFields, lastUsedAt: Timestamp.nullable(), enabled: z.boolean() })
  .meta({ id: 'TokenInfo' });

export const TokenList = z.object({ tokens: z.array(TokenInfo) }).meta({ id: 'TokenList' });

export const AffiliationId = Id.meta({ description: 'An affiliation id.' });

export const Affiliation = z
  .object({
    id: AffiliationId,
    email: z.string(),
    institutionName: z.string().meta({ description: 'The allowlist’s name for the address’s domain.' }),
    primary: z.boolean().meta({ description: 'The address you signed up with. It cannot be removed.' }),
    verifiedAt: Timestamp.nullable().meta({
      description: 'When the address was confirmed; null while a code is outstanding.',
    }),
    codeExpiresAt: Timestamp.nullable().meta({
      description: 'When the outstanding code stops working, if there is one.',
    }),
    createdAt: Timestamp,
  })
  .meta({ id: 'Affiliation' });

export const AffiliationList = z.object({ affiliations: z.array(Affiliation) }).meta({ id: 'AffiliationList' });

export const AddAffiliationRequest = z
  .object({
    email: z.email().max(254).meta({ description: 'An address at an approved institution.', example: 'ada@ethz.ch' }),
  })
  .strict()
  .meta({ id: 'AddAffiliationRequest' });

export const VerifyAffiliationRequest = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/)
      .meta({ description: 'The 6-digit code mailed to the address.', example: '042317' }),
  })
  .strict()
  .meta({ id: 'VerifyAffiliationRequest' });

// ---------------------------------------------------------------------------
// admin
// ---------------------------------------------------------------------------

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const Slug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,99}$/, 'lowercase letters, digits and hyphens')
  .refine((s) => !UUID_SHAPE.test(s), 'a slug must not look like a uuid');

export const CreateMarketRequest = z
  .object({
    slug: Slug,
    question: z.string().min(1).max(500),
    description: z.string().max(10_000).nullish().meta({
      description: 'The subtitle: one line shown under the question. Keep the question short and put the detail here.',
    }),
    contract: z.string().max(50_000).nullish().meta({
      description: 'The resolution contract: how the market settles, edge cases included. Markdown, shown to traders.',
    }),
    kind: z.string().min(1).max(100).optional().meta({ description: 'Opaque. Defaults to "binary".' }),
    outcomes: z
      .array(z.string().min(1).max(200))
      .min(2)
      .max(20)
      .refine((o) => new Set(o).size === o.length, 'outcome labels must be distinct'),
    closesAt: Timestamp,
    resolutionSource: z.string().max(1000).nullish().meta({ description: 'Opaque to the venue.' }),
    expectedTraders: z.number().int().min(1).max(1_000_000).meta({
      description:
        'The expected field size. With STARTING_BALANCE_MICRO it sizes `b`, once; `b` is then frozen for the life of the market.',
    }),
    openingPrices: z.array(z.number().gt(0).lt(1)).min(2).max(20).optional().meta({
      description:
        'The prices the market opens at, one per outcome in order, summing to 1; left out, every outcome opens at 1/n. The house pays for a prior: the subsidy is `b·ln(1/min price)` instead of `b·ln(n)`.',
    }),
    listingSlug: Slug.optional().meta({
      description: 'Attach the market to this listing, which must already exist (`POST /listings`).',
    }),
    listingRank: z.number().int().min(0).max(1000).optional().meta({
      description: 'Order within the listing; defaults to 0, the main market.',
    }),
  })
  .meta({ id: 'CreateMarketRequest' });

export const ReferenceRequest = z
  .object({
    title: z.string().trim().min(1).max(1000),
    authors: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
    year: z.number().int().min(1000).max(3000).nullish(),
    venue: z.string().trim().min(1).max(500).nullish().meta({
      description:
        'Where it appeared, as a bibliography sets it, e.g. "International Conference on Learning Representations". Opaque.',
    }),
    url: z
      .url({ protocol: /^https?$/ })
      .max(2000)
      .nullish(),
    slug: Slug.nullish().meta({
      description:
        'The cited work’s listing slug, if it has one here or may get one. Matched when read, so it need not exist yet.',
    }),
  })
  .meta({ id: 'ReferenceRequest' });

/** A full text's longest, in characters: a long paper with appendices is about 300k. */
const FULL_TEXT_MAX = 1_000_000;

/** Where a full text came from: an opaque label from its supplier. */
const TextSource = z.string().trim().min(1).max(100);

export const UpsertListingRequest = z
  .object({
    slug: Slug,
    title: z.string().trim().min(1).max(500),
    summary: z.string().max(20_000).nullish(),
    tldr: z.string().max(2_000).nullish().meta({ description: 'A one-line summary.' }),
    authors: z.array(z.string().trim().min(1).max(200)).max(200).optional(),
    authorIds: z.array(z.string().trim().min(1).max(200)).max(200).optional().meta({
      description: 'One opaque id per name in `authors`, in the same order. Left out or empty when there are none.',
    }),
    keywords: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
    primaryArea: z.string().trim().min(1).max(200).nullish().meta({ description: 'Opaque.' }),
    links: z.array(ListingLink).max(20).optional(),
    kind: z.string().min(1).max(100).nullish().meta({ description: 'Opaque.' }),
    references: z.array(ReferenceRequest).max(1000).optional().meta({
      description: 'The bibliography, in order. Replaced whole; left out, it is cleared.',
    }),
  })
  .refine((b) => !b.authorIds?.length || b.authorIds.length === (b.authors?.length ?? 0), {
    path: ['authorIds'],
    message: 'one id per author, or none',
  })
  .meta({
    id: 'UpsertListingRequest',
    description: 'Creates the listing, or replaces every field of the one with this slug. A field left out is cleared.',
  });

export const SetTextRequest = z
  .object({
    text: z.string().max(FULL_TEXT_MAX).nullable().meta({
      description:
        'The full text of the subject (for a paper, its extracted PDF). Read to set a new market’s opening prices, and served to signed-in clients by `GET /listings/{id}/text`. `null` or empty clears it.',
    }),
    source: TextSource.nullish().meta({
      description:
        'Where the text came from, e.g. `openreview` or `arxiv`. Opaque. Replaced with the text; left out, there is none.',
    }),
  })
  .meta({ id: 'SetTextRequest' });

export const SetClosedResult = z
  .object({
    listingId: Id,
    closedAt: Timestamp.nullable().meta({ description: 'When it was first closed; `null` once opened again.' }),
  })
  .meta({ id: 'SetClosedResult' });

export const SetTextResult = z.object({ listingId: Id, chars: z.number().int().min(0) }).meta({ id: 'SetTextResult' });

export const ListingText = z
  .object({
    listingId: Id,
    text: z.string().nullable().meta({
      description:
        'The full text as supplied by the listing’s publisher (for a paper, its extracted PDF), or `null` when none has been supplied yet. Never fetched from elsewhere.',
    }),
    chars: z.number().int().min(0).meta({ description: 'Its length in characters; 0 when there is none.' }),
    source: TextSource.nullable().meta({
      description:
        'Where the supplier got it (e.g. `openreview`, `arxiv`), as it said; `null` when it did not, or there is no text.',
    }),
  })
  .meta({ id: 'ListingText' });

export const SetRelatedRequest = z
  .object({
    related: z
      .array(
        z.object({
          slug: Slug,
          score: z.number().finite().meta({ description: 'The service’s own similarity. Not interpreted.' }),
        }),
      )
      .max(200)
      .meta({ description: 'Best match first. Replaced whole; empty clears it.' }),
  })
  .meta({ id: 'SetRelatedRequest' });

/** Longest map vector: compressed, it is sent to the browser for every paper in a minimap. */
const MAX_MAP_VECTOR = 256;

const MapTopicInput = z.object({ number: z.number().int().min(0), label: z.string().min(1).max(200) });

export const SetMapRequest = z
  .object({
    kind: Kind.meta({
      description:
        'The venue (a market `kind`) this is the map of. Only its map is replaced; every other venue’s is kept.',
      example: 'ICLR 2027',
    }),
    points: z
      .array(
        z.object({
          slug: Slug,
          x: z.number().finite(),
          y: z.number().finite(),
          region: z.number().int().min(0).nullable().optional(),
          cluster: z.number().int().min(0).nullable().optional(),
          vector: z.array(z.number().finite()).min(2).max(MAX_MAP_VECTOR).nullable().optional().meta({
            description:
              'The paper’s embedding, compressed to a few dozen dimensions (int8-range integers keep pages small). Any scale: only cosine distances are read, to lay out a paper’s neighbourhood.',
          }),
        }),
      )
      .max(200_000)
      .refine((points) => new Set(points.flatMap((p) => (p.vector ? [p.vector.length] : []))).size <= 1, {
        message: 'every vector must have the same length',
      })
      .meta({
        description: 'One per listing; a repeated slug keeps its first point. Replaced whole; empty clears it.',
      }),
    regions: z.array(MapTopicInput).max(1000).default([]).meta({ description: 'Names of the coarse groupings.' }),
    clusters: z.array(MapTopicInput).max(10_000).default([]).meta({ description: 'Names of the fine groupings.' }),
  })
  .meta({ id: 'SetMapRequest' });

export const UpsertedListing = z.object({ listing: Listing, created: z.boolean() }).meta({ id: 'UpsertedListing' });

export const CreatedMarket = z
  .object({
    market: Market,
    subsidyMicro: Micro.meta({ description: 'b·ln(n), debited from the house treasury.' }),
  })
  .meta({ id: 'CreatedMarket' });

export const SettleRequest = z
  .object({
    winningOutcomeId: Id,
    evidenceUrl: z.url({ protocol: /^https?$/ }).max(2000),
  })
  .meta({ id: 'SettleRequest' });

export const IdempotencyKey = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[\x21-\x7e]+$/, 'printable ASCII');

export const Handle = z.string().min(1).max(100).meta({ description: 'An account handle.', example: 'alice' });

export const TokenId = z.string().min(1).max(100);

// ---------------------------------------------------------------------------
// comments
// ---------------------------------------------------------------------------

export const CommentBacking = z
  .object({
    totalMicro: Micro.meta({
      description:
        'Σ `valueMicro`: the relevance weight. A **mark** (backed shares × current price), not a sale price; after settlement, 1 per winning share and 0 otherwise.',
    }),
    byOutcome: z
      .array(z.object({ outcomeId: Id, outcomeLabel: z.string(), sharesMicro: Micro, valueMicro: Micro }))
      .meta({ description: 'Backed shares per outcome, in ordinal order. Outcomes with none are left out.' }),
    backers: z.number().int().min(0).meta({ description: 'How many accounts back it. Never who.' }),
    yours: z
      .array(z.object({ outcomeId: Id, sharesMicro: Micro }))
      .meta({ description: "The caller's own backing on this comment. Empty when anonymous." }),
  })
  .meta({ id: 'CommentBacking', description: 'Shares traders have put behind this comment.' });

export const Comment = z
  .object({
    id: Id,
    parentId: Id.nullable().meta({ description: 'The comment this replies to; `null` on a top-level comment.' }),
    body: z
      .string()
      .meta({ description: 'Raw text, as posted. Clients render it as Markdown (GFM) with $…$ / $$…$$ TeX math.' }),
    createdAt: Timestamp,
    replyCount: z.number().int().min(0).meta({
      description: 'Direct replies to this comment. More than are loaded: fetch `GET /comments/{id}/replies`.',
    }),
    mentions: z.array(z.string()).meta({
      description:
        'Aliases `@`-mentioned in `body` (`@k3xm`, case-insensitive) that belong to a commenter on this paper, lower case, in order of first mention.',
    }),
    author: z
      .object({
        alias: z.string().meta({
          description:
            "The author's pseudonym on this paper, OpenReview-style (shown as `User k3xm`): the same on all their comments on the paper's markets, unrelated to their alias on any other paper.",
          example: 'k3xm',
        }),
        bot: z.object({ handle: z.string(), displayName: z.string() }).nullable().meta({
          description:
            'Set when the author is a bot: bots are named, the one exception to pseudonymity (their alias still works for `@`-mentions). Always `null` for a person.',
        }),
        isYou: z.boolean().meta({ description: 'True when the authenticated caller wrote this comment.' }),
        stake: z.array(z.object({ outcomeId: Id, outcomeLabel: z.string(), sharesMicro: Micro })).meta({
          description:
            "The author's current holdings in this market, each rounded down to two significant figures so it cannot be matched against the tape. Empty once it settles.",
        }),
      })
      .meta({
        description:
          "Pseudonymous by design: an alias per paper, never a person's handle or account id. Bots are named.",
      }),
    backing: CommentBacking,
  })
  .meta({ id: 'Comment' });

export const CommentViewer = z
  .object({
    alias: z.string().nullable().meta({
      description: "The caller's alias on this paper; `null` until they first comment on it.",
    }),
    available: z
      .array(z.object({ outcomeId: Id, outcomeLabel: z.string(), heldMicro: Micro, allocatedMicro: Micro }))
      .meta({
        description:
          'Outcomes of this market the caller holds, with how much is already backing comments. `heldMicro − allocatedMicro` is what can still be put behind one.',
      }),
  })
  .meta({ id: 'CommentViewer' });

export const COMMENT_SORTS = ['newest', 'relevance'] as const;

export const CommentListQuery = PaginationQuery.extend({
  sort: z.enum(COMMENT_SORTS).default('newest').meta({
    description:
      '`newest` (default): newest first, paginated. `relevance`: by backing value, highest first, ties newest first — over the 200 most recent comments only, one page (`nextCursor` is always null, and `cursor` is refused).',
  }),
});

export const CommentList = z
  .object({
    comments: z.array(Comment).meta({ description: 'Top-level comments, in the requested `sort` order.' }),
    replies: z.array(Comment).meta({
      description:
        'A preview of the replies under them, flat, oldest first: the first 3 replies to each comment, 3 levels down. `parentId` makes the tree.',
    }),
    nextCursor: Cursor,
    total: z.number().int().min(0).meta({ description: 'Every comment on the market, replies included.' }),
    viewer: CommentViewer.nullable().meta({
      description: "The caller's stake available for backing. `null` when anonymous.",
    }),
  })
  .meta({ id: 'CommentList' });

export const CommentRequest = z
  .object({
    body: z.string().trim().min(1).max(2000),
    parentId: Id.optional().meta({
      description: 'Reply to this comment, on the same market, at any depth.',
    }),
  })
  .meta({ id: 'CommentRequest' });

export const CommentRepliesQuery = z.object({
  after: Id.optional().meta({
    description: 'A direct reply to this comment: start after it. Usually the last one loaded.',
  }),
  limit: z.coerce.number().int().min(1).max(200).default(20),
});

export const CommentReplies = z
  .object({
    replies: z.array(Comment).meta({
      description:
        'Up to `limit` direct replies, oldest first, then a preview of the replies under each (3 per comment, 2 levels down). Flat: `parentId` makes the tree. More remain while `replyCount` exceeds the direct replies loaded.',
    }),
  })
  .meta({ id: 'CommentReplies' });

export const CommentBackingRequest = z
  .object({
    outcomeId: Id.meta({ description: "An outcome of the comment's market that you hold." }),
    sharesMicro: MicroInput.refine((v) => v > 0n, 'must be positive'),
  })
  .meta({ id: 'CommentBackingRequest' });

export const CommentId = Id.meta({ description: 'A comment id.' });

// Safe for work edition: a paper's own discussion, with no stake or backing.

export const PaperComment = z
  .object({
    id: Id,
    parentId: Id.nullable().meta({ description: 'The comment this replies to; `null` on a top-level comment.' }),
    body: z
      .string()
      .meta({ description: 'Raw text, as posted. Clients render it as Markdown (GFM) with $…$ / $$…$$ TeX math.' }),
    createdAt: Timestamp,
    replyCount: z.number().int().min(0).meta({
      description:
        'Direct replies to this comment. More than are loaded: fetch `GET /listings/{id}/comments/{commentId}/replies`.',
    }),
    mentions: z.array(z.string()).meta({
      description:
        'Aliases `@`-mentioned in `body` that belong to a commenter on this paper, in order of first mention.',
    }),
    author: z
      .object({
        alias: z.string().meta({
          description:
            "The author's pseudonym on this paper (shown as `User k3xm`): the same on all their comments on it, unrelated to their alias on any other paper.",
          example: 'k3xm',
        }),
        bot: z.object({ handle: z.string(), displayName: z.string() }).nullable().meta({
          description: 'Set when the author is a bot; always `null` for a person.',
        }),
        isYou: z.boolean().meta({ description: 'True when the authenticated caller wrote this comment.' }),
      })
      .meta({ description: "Pseudonymous: an alias per paper, never a person's handle or account id." }),
  })
  .meta({ id: 'PaperComment' });

export const PaperCommentList = z
  .object({
    comments: z.array(PaperComment).meta({ description: 'Top-level comments, newest first.' }),
    replies: z.array(PaperComment).meta({
      description:
        'A preview of the replies under them, flat, oldest first: the first 3 replies to each comment, 3 levels down. `parentId` makes the tree.',
    }),
    nextCursor: Cursor,
    total: z.number().int().min(0).meta({ description: 'Every comment on the paper, replies included.' }),
    viewerAlias: z.string().nullable().meta({
      description: "The caller's alias on this paper; `null` until they first comment on it, or when anonymous.",
    }),
  })
  .meta({ id: 'PaperCommentList' });

export const PaperCommentRequest = z
  .object({
    body: z.string().trim().min(1).max(2000),
    parentId: Id.optional().meta({ description: 'Reply to this comment, on the same paper, at any depth.' }),
  })
  .meta({ id: 'PaperCommentRequest' });

export const PaperCommentReplies = z
  .object({
    replies: z.array(PaperComment).meta({
      description:
        'Up to `limit` direct replies, oldest first, then a preview of the replies under each (3 per comment, 2 levels down). Flat: `parentId` makes the tree.',
    }),
  })
  .meta({ id: 'PaperCommentReplies' });

export const Reaction = z
  .object({
    emoji: z.string().meta({ description: 'One emoji, without the U+FE0F presentation selector.', example: '🚀' }),
    count: z.number().int().min(1).meta({ description: 'How many accounts reacted with it. Never who.' }),
    mine: z.boolean().meta({ description: 'Whether the caller reacted with it; `false` when anonymous.' }),
  })
  .meta({ id: 'Reaction' });

export const ReactionList = z
  .object({
    listingId: Id,
    reactions: z.array(Reaction).meta({ description: 'Most used first.' }),
  })
  .meta({ id: 'ReactionList' });

export const Emoji = z
  .string()
  .min(1)
  .max(64)
  .meta({ description: 'One emoji, URL-encoded.', example: '%F0%9F%9A%80' });

// ---------------------------------------------------------------------------
// onboarding
// ---------------------------------------------------------------------------

export const OnboardingRequest = z
  .object({
    email: z.email().max(254).meta({ description: 'An address at an approved institution.', example: 'ada@ethz.ch' }),
    bet: z
      .object({
        marketId: Id,
        outcomeId: Id,
        stakeMicro: MicroInput.meta({ description: 'What to spend, at most the starting balance. Not a share count.' }),
        seenOrderCount: z.number().int().nonnegative().meta({
          description:
            "The market's `orderCount` on the board the bet was chosen from. Unchanged at confirmation, the bet is placed without asking again.",
        }),
      })
      .strict()
      .optional()
      .meta({
        description: 'A first bet, stored and placed once the address is confirmed. Left out, a plain sign-up.',
      }),
    next: z.string().max(2000).optional().meta({
      description: 'A same-site path to return to after confirming (`/verify-email?next=`). Anything else is `/`.',
      example: '/papers/attention-is-all-you-need?price=jev',
    }),
  })
  .strict()
  .meta({ id: 'OnboardingRequest' });

export const SignUpStarted = z
  .object({ email: z.string().meta({ description: 'Where the confirmation mail went.' }) })
  .meta({ id: 'SignUpStarted' });

export const SetPasswordRequest = z
  .object({ password: z.string().min(12).max(128) })
  .strict()
  .meta({ id: 'SetPasswordRequest' });

export const PasswordSet = z.object({ ok: z.literal(true) }).meta({ id: 'PasswordSet' });

const ReadingPerson = z.object({ accountId: Id, handle: z.string(), displayName: z.string() });
export const ReadingStatus = z
  .object({
    listingId: Id,
    read: z.boolean(),
    readers: z.array(ReadingPerson).meta({ description: 'Reading-group members with a global read marker.' }),
    memberCount: z.number().int().min(0).meta({ description: 'Number of members in the reading group or groups.' }),
  })
  .meta({ id: 'ReadingStatus' });
export const ReadingList = z
  .object({
    entries: z.array(
      z.object({
        listingId: Id,
        slug: z.string(),
        title: z.string(),
        venue: z.string().nullable().meta({ description: 'The paper’s venue (its opaque `kind`), if any.' }),
        status: ReadingStatus,
      }),
    ),
  })
  .meta({ id: 'ReadingList' });
export const ReadingListState = z
  .object({ groupId: Id, listingId: Id, added: z.boolean() })
  .meta({ id: 'ReadingListState' });

export const Announcement = z
  .object({
    id: Id,
    body: z.string().meta({ description: 'Markdown, rendered as a comment is: no raw HTML, http(s) links only.' }),
    kind: z.string().nullable().meta({ description: 'The venue whose home page shows it; null for every venue.' }),
    expiresAt: Timestamp.nullable().meta({ description: 'When it stops showing; null for never.' }),
    signedInOnly: z.boolean().meta({ description: 'Shown only to signed-in readers.' }),
    createdAt: Timestamp,
  })
  .meta({ id: 'Announcement', description: 'A message at the top of the home page.' });

export const AnnouncementList = z
  .object({ announcements: z.array(Announcement) })
  .meta({ id: 'AnnouncementList', description: 'What the home page shows now, newest first.' });

export const AnnouncementsQuery = z.object({
  kind: Kind.optional().meta({ description: 'Only those a venue’s home page shows: its own and every venue’s.' }),
});

export const PostAnnouncementRequest = z
  .object({
    body: z.string().trim().min(1).max(2000),
    kind: Kind.nullable().optional().meta({
      description: 'Show it only on this venue’s home page. Left out or null: every venue’s.',
      example: 'ICLR 2027',
    }),
    expiresAt: Timestamp.nullable().optional().meta({ description: 'Stop showing it then. Left out: until deleted.' }),
    signedInOnly: z
      .boolean()
      .default(false)
      .meta({ description: 'Show it only to signed-in readers. Left out: to everyone.' }),
  })
  .meta({ id: 'PostAnnouncementRequest' });
