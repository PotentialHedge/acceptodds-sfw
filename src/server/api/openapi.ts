import { OpenAPIRegistry, OpenApiGeneratorV31, type RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { MARKET_API, under } from '@/lib/sfw';
import { MAX_GROUPS_PER_ADMIN } from '../groups';
import * as S from './schemas';

/**
 * The OpenAPI 3.1 document for `/api/v1`, generated from the same Zod schemas
 * the handlers parse and validate with. Nothing here is hand-written JSON
 * Schema; a hand-maintained doc rots.
 *
 * When you add or change an endpoint, change it here too — the integration
 * test checks that every route file under `app/api/v1` has an operation here
 * and that the document validates.
 */

type Scope = 'read' | 'trade' | 'admin';

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});

const err = (description: string) => json(S.ErrorResponse, description);

const RATE_LIMIT_HEADERS = {
  'X-RateLimit-Limit': { description: 'Bucket size, in requests.', schema: { type: 'integer' as const } },
  'X-RateLimit-Remaining': { description: 'Requests left in the bucket.', schema: { type: 'integer' as const } },
  'X-RateLimit-Reset': { description: 'Seconds until the bucket is full.', schema: { type: 'integer' as const } },
};

const idParam = z.object({ id: S.MarketRef });

function op(
  config: Omit<RouteConfig, 'responses'> & {
    ok: { status: 200 | 201; schema: z.ZodType; description: string };
    scope?: Scope;
    errors?: Partial<Record<400 | 401 | 403 | 404 | 409 | 422 | 429, string>>;
  },
): RouteConfig {
  const { ok, scope, errors = {}, ...rest } = config;
  const responses: RouteConfig['responses'] = {
    [ok.status]: { ...json(ok.schema, ok.description), headers: RATE_LIMIT_HEADERS },
  };
  const all = {
    400: 'validation_error: the request did not match the schema.',
    ...(scope
      ? {
          401: 'unauthorized: missing, malformed or revoked token.',
          403: `forbidden: the token lacks the "${scope}" scope.`,
        }
      : { 401: 'unauthorized: a token was sent and it is invalid. (No token at all is fine.)' }),
    429: 'rate_limited: this token’s bucket is empty. See Retry-After.',
    ...errors,
  };
  for (const [status, description] of Object.entries(all)) {
    responses[status] = {
      ...err(description),
      ...(status === '429'
        ? { headers: { ...RATE_LIMIT_HEADERS, 'Retry-After': { schema: { type: 'integer' as const } } } }
        : {}),
    };
  }
  return {
    ...rest,
    // A session may read and trade; admin only if its email is in ADMIN_EMAILS.
    security: scope ? [{ bearer: [scope] }, { session: [] }] : [{}, { bearer: [] }, { session: [] }],
    responses,
  };
}

export function buildRegistry(): OpenAPIRegistry {
  const r = new OpenAPIRegistry();

  r.registerComponent('securitySchemes', 'session', {
    type: 'apiKey',
    in: 'cookie',
    name: 'better-auth.session_token',
    description:
      'A signed-in browser session (sign up and sign in at /api/auth, with an email address at an approved institution). Equivalent to the `read` scope, plus `admin` if your email is in the server’s `ADMIN_EMAILS`. Writes must come from our own Origin.',
  });

  r.registerComponent('securitySchemes', 'bearer', {
    type: 'http',
    scheme: 'bearer',
    description:
      'An API token, `pm_live_…`. Scopes: `read` (everything a signed-in account does: the me endpoints, follows, groups, reading lists, comments and reactions), `admin` (supplying listings, their texts, related papers and the map). `trade` is still accepted and grants nothing more. No scope implies another. Every request made with a token counts against that token’s rate-limit bucket.',
  });

  // -- public ---------------------------------------------------------------

  r.registerPath(
    op({
      method: 'get',
      path: '/markets',
      tags: ['markets'],
      summary: 'List markets',
      description:
        'Newest first. Drafts are hidden unless `status=draft`. With `q`, only markets whose question or description — or whose listing’s title, authors or summary — match, best match first.',
      request: { query: S.MarketListQuery },
      ok: { status: 200, schema: S.MarketList, description: 'A page of markets.' },
    }),
  );

  r.registerPath(
    op({
      method: 'get',
      path: '/markets/{id}',
      tags: ['markets'],
      summary: 'Market board',
      description: 'Outcomes, prices, volume and the frozen liquidity parameter `b`.',
      request: { params: idParam },
      ok: { status: 200, schema: S.Market, description: 'The board.' },
      errors: { 404: 'not_found' },
    }),
  );

  r.registerPath(
    op({
      method: 'get',
      path: '/markets/{id}/history',
      tags: ['markets'],
      summary: 'Price history',
      description: 'Every outcome’s price after every fill, oldest first, reconstructed from the fills.',
      request: { params: idParam, query: S.PaginationQuery },
      ok: { status: 200, schema: S.PriceHistory, description: 'A page of price points.' },
      errors: { 404: 'not_found' },
    }),
  );

  r.registerPath(
    op({
      method: 'get',
      path: '/markets/{id}/orders',
      tags: ['markets'],
      summary: 'Public tape',
      description: 'Fills on this market, newest first. Carries no account identities.',
      request: { params: idParam, query: S.PaginationQuery },
      ok: { status: 200, schema: S.Tape, description: 'A page of fills.' },
      errors: { 404: 'not_found' },
    }),
  );

  r.registerPath(
    op({
      method: 'post',
      path: '/markets/{id}/quote',
      tags: ['trading'],
      summary: 'Quote a hypothetical trade',
      description:
        'Prices the whole size, slippage included. Writes nothing. Advisory: an order is re-priced under the market lock, so pass the quoted cost as `maxCostMicro`.',
      request: { params: idParam, body: { content: { 'application/json': { schema: S.QuoteRequest } } } },
      ok: { status: 200, schema: S.Quote, description: 'The quote.' },
      errors: { 404: 'not_found: no such market or outcome.' },
    }),
  );

  r.registerPath(
    op({
      method: 'get',
      path: '/listings',
      tags: ['listings'],
      summary: 'List listings',
      description:
        'Newest first. A listing is a paper, supplied whole by the creating client. With `q`, only listings whose title, authors or summary match, best match first.',
      request: { query: S.ListingListQuery },
      ok: { status: 200, schema: S.ListingList, description: 'A page of listings.' },
    }),
  );

  r.registerPath(
    op({
      method: 'get',
      path: '/listings/{id}',
      tags: ['listings'],
      summary: 'A listing',
      description: 'The listing, with its follower and view counts.',
      request: { params: z.object({ id: S.ListingRef }) },
      ok: { status: 200, schema: S.Listing, description: 'The listing.' },
      errors: { 404: 'not_found' },
    }),
  );

  r.registerPath(
    op({
      method: 'get',
      path: '/listings/{id}/citations',
      tags: ['listings'],
      summary: 'What a listing cites, and what cites it',
      description:
        'The bibliography the creating client supplied, each entry with the listing its slug names when one exists here; and the listings whose bibliography names this one.',
      request: { params: z.object({ id: S.ListingRef }) },
      ok: { status: 200, schema: S.ListingCitations, description: 'The citations.' },
      errors: { 404: 'not_found' },
    }),
  );

  r.registerPath(
    op({
      method: 'get',
      path: '/listings/{id}/related',
      tags: ['listings'],
      summary: 'Listings related to this one',
      description: 'Named by a separate similarity service, best first. The site computes no similarity itself.',
      request: { params: z.object({ id: S.ListingRef }) },
      ok: { status: 200, schema: S.ListingRelated, description: 'The related listings.' },
      errors: { 404: 'not_found' },
    }),
  );

  r.registerPath(
    op({
      method: 'get',
      path: '/listings/{id}/minimap',
      tags: ['listings'],
      summary: 'A listing’s piece of the paper map',
      description:
        'The listing, the papers nearest it on its venue’s map (by the supplied vectors when it has one) and its related papers wherever they lie, with their vectors and the related pairs between them. Public, cached for five minutes.',
      request: { params: z.object({ id: S.ListingRef }) },
      ok: { status: 200, schema: S.Minimap, description: 'The piece of the map.' },
      errors: { 404: 'not_found' },
    }),
  );

  r.registerPath(
    op({
      method: 'get',
      path: '/listings/{id}/text',
      tags: ['listings'],
      summary: 'A listing’s full text',
      description:
        'The full text as the listing’s publisher supplied it (for a paper, its extracted PDF); `text` is `null` while none has been supplied. Never fetched from elsewhere. Any signed-in session or token with `read`.',
      scope: 'read',
      request: { params: z.object({ id: S.ListingRef }) },
      ok: { status: 200, schema: S.ListingText, description: 'The text, or null.' },
      errors: { 404: 'not_found' },
    }),
  );

  r.registerPath(
    op({
      method: 'put',
      path: '/listings/{id}/text',
      tags: ['listings'],
      summary: 'Set a listing’s full text',
      description:
        'Replaces it; `null` or empty clears it. Served by `GET /listings/{id}/text`. Its own call, so a client that writes listings never clears it.',
      scope: 'admin',
      request: {
        params: z.object({ id: S.ListingRef }),
        body: { content: { 'application/json': { schema: S.SetTextRequest } } },
      },
      ok: { status: 200, schema: S.SetTextResult, description: 'The stored length, in characters.' },
      errors: { 400: 'validation_error', 404: 'not_found' },
    }),
  );

  for (const method of ['put', 'delete'] as const) {
    r.registerPath(
      op({
        method,
        path: '/listings/{id}/closed',
        tags: ['listings'],
        summary: method === 'put' ? 'Close a listing' : 'Open a closed listing again',
        description:
          method === 'put'
            ? 'Marks the listing closed (`closedAt`), for a paper that was withdrawn or desk-rejected. Idempotent, and keeps the time it was first closed. Its own call, so re-posting the listing keeps it.'
            : 'Clears `closedAt`. Idempotent.',
        scope: 'admin',
        request: { params: z.object({ id: S.ListingRef }) },
        ok: { status: 200, schema: S.SetClosedResult, description: 'When it was closed, or null.' },
        errors: { 404: 'not_found' },
      }),
    );
  }

  r.registerPath(
    op({
      method: 'put',
      path: '/listings/{id}/related',
      tags: ['listings'],
      summary: 'Set a listing’s related listings',
      description:
        'Replaces the whole list; empty clears it. Slugs are matched when read, so one need not be listed yet. A listing relating to itself and repeated slugs are dropped.',
      scope: 'admin',
      request: {
        params: z.object({ id: S.ListingRef }),
        body: { content: { 'application/json': { schema: S.SetRelatedRequest } } },
      },
      ok: { status: 200, schema: S.SetRelatedResult, description: 'How many were kept.' },
      errors: { 400: 'validation_error', 404: 'not_found' },
    }),
  );

  r.registerPath(
    op({
      method: 'get',
      path: '/map',
      tags: ['listings'],
      summary: 'The paper map',
      description:
        'Every listing on a venue’s supplied 2D layout, by column: its slug, groupings and primary area. Each venue has its own map, or none (then empty). Titles are `GET /map/titles`. Laid out by a separate service; the platform computes no layout. Public, cached for five minutes.',
      request: { query: S.MapQuery },
      ok: { status: 200, schema: S.PaperMap, description: 'The whole map.' },
    }),
  );

  r.registerPath(
    op({
      method: 'get',
      path: '/map/titles',
      tags: ['listings'],
      summary: 'Titles of the papers on the map',
      description:
        'The title of every listing on a venue’s map, by slug: what `GET /map` leaves out, so a client can draw the map before they arrive. Public, cached for five minutes.',
      request: { query: S.MapQuery },
      ok: { status: 200, schema: S.MapTitles, description: 'The titles.' },
    }),
  );

  r.registerPath(
    op({
      method: 'get',
      path: '/map/search',
      tags: ['listings'],
      summary: 'Search the paper map',
      description:
        'The home page’s search syntax over a venue’s listings: words (titles, authors, abstracts), `key:value` filters (`title author keyword area venue`), `OR`, parentheses and `-`. Returns every match’s slug, most relevant first.',
      request: { query: S.MapSearchQuery },
      ok: { status: 200, schema: S.MapSearch, description: 'The matching slugs.' },
      errors: { 400: 'validation_error' },
    }),
  );

  r.registerPath(
    op({
      method: 'get',
      path: '/map/related',
      tags: ['listings'],
      summary: 'Related lists between papers on the map',
      description:
        'Every listing on a venue’s map with its best related entries that are also on it, as index pairs into a slug list. For a client that re-lays out a subset of the map. Public, cached for five minutes.',
      request: { query: S.MapQuery },
      ok: { status: 200, schema: S.MapRelated, description: 'The edges.' },
    }),
  );

  r.registerPath(
    op({
      method: 'get',
      path: '/transitions',
      tags: ['listings'],
      summary: 'Which listings visitors read after which',
      description:
        'Per ordered pair of listings, how many visitors read the second after the first (once per visitor per day, summed), most first. Only totals are kept. For a similarity service; the venue computes nothing from it.',
      scope: 'admin',
      request: { query: S.TransitionsQuery },
      ok: { status: 200, schema: S.Transitions, description: 'The pairs.' },
      errors: { 400: 'validation_error' },
    }),
  );

  r.registerPath(
    op({
      method: 'put',
      path: '/map',
      tags: ['listings'],
      summary: 'Set the paper map',
      description:
        'Replaces one venue’s whole map (`kind`) and its grouping names in one transaction; empty clears it, and the venue then has no map. Other venues’ maps are kept. Slugs are matched when read, so one need not be listed yet.',
      scope: 'admin',
      request: { body: { content: { 'application/json': { schema: S.SetMapRequest } } } },
      ok: { status: 200, schema: S.SetMapResult, description: 'How many points were kept.' },
      errors: { 400: 'validation_error' },
    }),
  );

  r.registerPath(
    op({
      method: 'get',
      path: '/version',
      tags: ['meta'],
      summary: 'Running version',
      description:
        'The package version, the git commit the server was built from, and when its process started. Compare it between sessions: a new `commit` or `startedAt` means a new deploy, and request or response shapes may have changed.',
      ok: { status: 200, schema: S.Version, description: 'What is running.' },
    }),
  );

  r.registerPath(
    op({
      method: 'get',
      path: '/leaderboard',
      tags: ['accounts'],
      summary: 'Leaderboard',
      description: `Every entry carries settled (realized) P&L, liquidation net worth and unrealized P&L; \`basis\` picks the ranking. ${S.LEADERBOARD_BASIS_DESCRIPTION} \`institution\` ranks one institution among itself, \`group\` one group; \`q\` finds traders by name and keeps their rank.`,
      request: { query: S.LeaderboardQuery },
      ok: { status: 200, schema: S.Leaderboard, description: 'A page of the leaderboard.' },
    }),
  );

  r.registerPath(
    op({
      method: 'get',
      path: '/accounts/{handle}',
      tags: ['accounts'],
      summary: 'Public profile',
      request: { params: z.object({ handle: S.Handle }) },
      ok: { status: 200, schema: S.PublicAccount, description: 'The public profile.' },
      errors: { 404: 'not_found' },
    }),
  );

  r.registerPath(
    op({
      method: 'get',
      path: '/accounts/{handle}/positions',
      tags: ['accounts'],
      summary: 'Public positions',
      description:
        'Only the positions this trader chose to make public, newest first, each read live. Nothing else about anyone’s positions is public.',
      request: { params: z.object({ handle: S.Handle }) },
      ok: { status: 200, schema: S.PublicPositionList, description: 'Their public positions.' },
      errors: { 404: 'not_found' },
    }),
  );

  r.registerPath(
    op({
      method: 'get',
      path: '/positions/{id}',
      tags: ['accounts'],
      summary: 'A public position',
      description:
        'A position its holder made public, by its link id: held, sold or settled now, with the exit quote while trading (never a mark). 404 once made private.',
      request: { params: z.object({ id: S.Id }) },
      ok: { status: 200, schema: S.PublicPosition, description: 'The position, now.' },
      errors: { 404: 'not_found' },
    }),
  );

  r.registerPath(
    op({
      method: 'get',
      path: '/markets/{id}/comments',
      tags: ['markets'],
      summary: 'Comments',
      description:
        'Top-level comments, newest first, or by backing with `sort=relevance`, with a preview of the replies under them in `replies` (the rest from `GET /comments/{id}/replies`). Anonymous: each comment shows only whether its author is a bot, their current stake in this market, and how much stake others have put behind it (never by whom). Bodies are raw Markdown with TeX math.',
      request: { params: idParam, query: S.CommentListQuery },
      ok: { status: 200, schema: S.CommentList, description: 'A page of comments.' },
      errors: { 404: 'not_found' },
    }),
  );

  r.registerPath(
    op({
      method: 'post',
      path: '/markets/{id}/comments',
      tags: ['markets'],
      summary: 'Post a comment',
      description:
        'With `parentId`, a reply. Needs the `trade` scope and a trading-eligible (verified or bot) account.',
      scope: 'trade',
      request: { params: idParam, body: { content: { 'application/json': { schema: S.CommentRequest } } } },
      ok: { status: 201, schema: S.Comment, description: 'The comment, as others will see it.' },
      errors: {
        403: 'forbidden | not_verified',
        404: 'not_found: no such market, or `parentId` is not a comment on it.',
      },
    }),
  );

  const commentIdParam = z.object({ id: S.CommentId });

  r.registerPath(
    op({
      method: 'get',
      path: '/comments/{id}/replies',
      tags: ['markets'],
      summary: 'Replies to a comment',
      description:
        'Direct replies, oldest first, after `after` (the last one loaded), each with a preview of the replies under it. Replies nest to any depth.',
      request: { params: commentIdParam, query: S.CommentRepliesQuery },
      ok: { status: 200, schema: S.CommentReplies, description: 'A page of replies.' },
      errors: { 400: 'validation_error: `after` is not a reply to this comment.', 404: 'not_found' },
    }),
  );

  r.registerPath(
    op({
      method: 'post',
      path: '/comments/{id}/backing',
      tags: ['trading'],
      summary: 'Back a comment with shares',
      description:
        "Puts `sharesMicro` of an outcome you hold behind someone else's comment on an open market. No reputation moves; the shares stay in your position. Across all comments, what you back on an outcome never exceeds what you hold of it: selling trims your backings newest first, and buying back does not restore them. Needs the `trade` scope and a trading-eligible account.",
      scope: 'trade',
      request: {
        params: commentIdParam,
        body: { content: { 'application/json': { schema: S.CommentBackingRequest } } },
      },
      ok: { status: 201, schema: S.Comment, description: 'The comment, with its updated backing.' },
      errors: {
        403: 'forbidden | not_verified',
        404: "not_found: no such comment, or the outcome is not on the comment's market.",
        409: 'insufficient_stake | own_comment | market_not_open | market_closed',
      },
    }),
  );

  const unback = op({
    method: 'delete',
    path: '/comments/{id}/backing',
    tags: ['trading'],
    summary: 'Withdraw your backing from a comment',
    description: 'Removes all of your backing from this comment. Idempotent.',
    scope: 'trade',
    request: { params: commentIdParam },
    ok: { status: 200, schema: S.Comment, description: 'unused' },
    errors: { 403: 'forbidden | not_verified', 404: 'not_found' },
  });
  delete unback.responses[200];
  unback.responses[204] = { description: 'Withdrawn (or there was nothing to withdraw).' };
  r.registerPath(unback);

  // -- authenticated --------------------------------------------------------

  r.registerPath(
    op({
      method: 'post',
      path: '/markets/{id}/orders',
      tags: ['trading'],
      summary: 'Place an order (buy, or sell with negative shares)',
      description:
        'Selling is an order with negative `sharesMicro`; you may only sell shares you hold. Send an `Idempotency-Key` header and retry freely: a retry with the same key returns the original fill with `replayed: true`.',
      scope: 'trade',
      request: {
        params: idParam,
        headers: z.object({
          'Idempotency-Key': S.IdempotencyKey.optional().meta({
            description: 'Up to 255 printable ASCII characters, unique per account.',
          }),
        }),
        body: { content: { 'application/json': { schema: S.OrderRequest } } },
      },
      ok: { status: 201, schema: S.Fill, description: 'The fill (or, for a replayed key, the original fill).' },
      errors: {
        403: 'forbidden: the credential lacks the "trade" scope | not_verified: the account has no confirmed institutional email address.',
        404: 'not_found: no such market or outcome.',
        409: 'slippage_exceeded | insufficient_balance | insufficient_shares | market_not_open | market_closed | idempotency_key_reused',
      },
    }),
  );

  r.registerPath(
    op({
      method: 'get',
      path: '/me',
      tags: ['me'],
      summary: 'The authenticated account',
      scope: 'read',
      ok: { status: 200, schema: S.Me, description: 'Account and balance.' },
    }),
  );

  r.registerPath(
    op({
      method: 'get',
      path: '/me/portfolio',
      tags: ['me'],
      summary: 'Holdings',
      request: { query: S.PortfolioQuery },
      description:
        'Each holding carries its **mark** (shares × price) and its **quoted exit value** (what selling it all now would pay) as separate fields. They differ, and only the second is a sale price. `summary` gives cash, liquidation net worth, and unrealized and realized P&L. Optional `marketId` filters the holdings only; summary and unsettled valuation remain account-wide.',
      scope: 'read',
      ok: { status: 200, schema: S.Portfolio, description: 'The portfolio.' },
    }),
  );

  r.registerPath(
    op({
      method: 'get',
      path: '/me/orders',
      tags: ['me'],
      summary: 'Own fills',
      scope: 'read',
      request: { query: S.PaginationQuery },
      ok: { status: 200, schema: S.MyOrders, description: 'A page of your fills, newest first.' },
    }),
  );

  r.registerPath(
    op({
      method: 'patch',
      path: '/me',
      tags: ['me'],
      summary: 'Update your settings',
      description:
        '`digestOptIn` (the daily email about followed papers), `mentionMailOptIn` (the email a comment mentioning you sends) and `displayName`.',
      scope: 'read',
      request: { body: { content: { 'application/json': { schema: S.UpdateMeRequest } } } },
      ok: { status: 200, schema: S.Me, description: 'The account, updated.' },
    }),
  );

  r.registerPath(
    op({
      method: 'get',
      path: '/me/follows',
      tags: ['me'],
      summary: 'Listings you follow',
      description: 'Each followed listing, most recently followed first.',
      scope: 'read',
      ok: { status: 200, schema: S.FollowList, description: 'Your follows, most recent first.' },
    }),
  );
  r.registerPath(
    op({
      method: 'get',
      path: '/me/mentions',
      tags: ['me'],
      summary: 'Comments that mention you',
      description:
        'Every comment that `@`-mentions you, newest first: by your alias on a paper you comment on, or, for a bot, by its handle on any paper. Check it when you start, with `since` the time you last checked; reply with `POST /markets/{id}/comments` and `parentId`.',
      request: { query: S.MentionListQuery },
      scope: 'read',
      ok: { status: 200, schema: S.MentionList, description: 'A page of mentions.' },
    }),
  );

  const groupIdParam = z.object({ id: S.Id });
  const noContent = (config: Parameters<typeof op>[0], description: string): RouteConfig => {
    const c = op(config);
    delete c.responses[config.ok.status];
    c.responses[204] = { description };
    return c;
  };

  r.registerPath(
    op({
      method: 'get',
      path: '/me/groups',
      tags: ['groups'],
      summary: 'Your groups',
      scope: 'read',
      ok: { status: 200, schema: S.GroupList, description: 'Every group you are in, with its invite code.' },
    }),
  );

  r.registerPath(
    op({
      method: 'post',
      path: '/groups',
      tags: ['groups'],
      summary: 'Make a group',
      description: `You become its admin and first member. Share its invite code for others to join. At most ${MAX_GROUPS_PER_ADMIN} groups per admin.`,
      scope: 'read',
      request: { body: { content: { 'application/json': { schema: S.CreateGroupRequest } } } },
      ok: { status: 201, schema: S.Group, description: 'The new group.' },
      errors: { 400: 'validation_error', 409: 'too_many_groups' },
    }),
  );

  r.registerPath(
    op({
      method: 'get',
      path: '/groups/{id}',
      tags: ['groups'],
      summary: 'A group',
      description: 'Its members, each with their institutions. Public by id; the invite code only to members.',
      request: { params: groupIdParam },
      ok: { status: 200, schema: S.Group, description: 'The group.' },
      errors: { 404: 'not_found' },
    }),
  );

  r.registerPath(
    op({
      method: 'patch',
      path: '/groups/{id}',
      tags: ['groups'],
      summary: 'Rename a group',
      description: 'Its name or description. Admin only.',
      scope: 'read',
      request: { params: groupIdParam, body: { content: { 'application/json': { schema: S.UpdateGroupRequest } } } },
      ok: { status: 200, schema: S.Group, description: 'The group.' },
      errors: {
        403: 'forbidden: the token lacks the "read" scope, or you are not the group’s admin.',
        400: 'validation_error',
        404: 'not_found',
      },
    }),
  );

  r.registerPath(
    noContent(
      {
        method: 'delete',
        path: '/groups/{id}',
        tags: ['groups'],
        summary: 'Delete a group',
        description: 'Admin only. Every membership goes with it.',
        scope: 'read',
        request: { params: groupIdParam },
        ok: { status: 200, schema: S.Group, description: 'unused' },
        errors: {
          403: 'forbidden: the token lacks the "read" scope, or you are not the group’s admin.',
          404: 'not_found',
        },
      },
      'Deleted.',
    ),
  );

  r.registerPath(
    op({
      method: 'post',
      path: '/groups/{id}/invite',
      tags: ['groups'],
      summary: 'Rotate the invite code',
      description: 'Admin only. The old invite link stops working; members stay.',
      scope: 'read',
      request: { params: groupIdParam },
      ok: { status: 200, schema: S.Group, description: 'The group, with its new code.' },
      errors: {
        403: 'forbidden: the token lacks the "read" scope, or you are not the group’s admin.',
        404: 'not_found',
      },
    }),
  );

  r.registerPath(
    op({
      method: 'post',
      path: '/groups/join',
      tags: ['groups'],
      summary: 'Join a group',
      description: 'By its current invite code. Idempotent.',
      scope: 'read',
      request: { body: { content: { 'application/json': { schema: S.JoinGroupRequest } } } },
      ok: { status: 200, schema: S.Group, description: 'The group you are now in.' },
      errors: { 400: 'validation_error', 404: 'not_found: no group has this code (it may have been rotated).' },
    }),
  );

  r.registerPath(
    noContent(
      {
        method: 'delete',
        path: '/groups/{id}/members/{handle}',
        tags: ['groups'],
        summary: 'Leave a group, or remove a member',
        description:
          'Your own handle leaves the group; the admin may remove anyone else. The admin cannot leave: they delete the group instead. Idempotent for someone not in it.',
        scope: 'read',
        request: { params: z.object({ id: S.Id, handle: S.Handle }) },
        ok: { status: 200, schema: S.Group, description: 'unused' },
        errors: {
          403: 'forbidden: the token lacks the "read" scope, or you are not the group’s admin.',
          404: 'not_found',
          409: 'group_admin: the admin cannot be removed.',
        },
      },
      'Removed.',
    ),
  );

  const listingIdParam = z.object({ id: S.ListingRef });
  for (const method of ['get', 'put', 'delete'] as const) {
    r.registerPath(
      op({
        method,
        path: '/listings/{id}/read',
        tags: ['listings'],
        summary:
          method === 'get'
            ? 'Read status of a listing'
            : method === 'put'
              ? 'Mark a listing read'
              : 'Mark a listing unread',
        description:
          'Read markers are global per account. Includes only readers who are fellow reading-group members. Writes are idempotent.',
        scope: method === 'get' ? undefined : 'read',
        request: { params: listingIdParam },
        ok: { status: 200, schema: S.ReadingStatus, description: 'Read status.' },
        errors: { 404: 'not_found' },
      }),
    );
  }
  r.registerPath(
    op({
      method: 'get',
      path: '/groups/{id}/reading-list',
      tags: ['groups'],
      summary: 'A reading group’s shared reading list',
      request: { params: groupIdParam },
      ok: {
        status: 200,
        schema: S.ReadingList,
        description: 'Listings, newest additions first, with global read markers.',
      },
      errors: { 404: 'not_found' },
    }),
  );
  for (const method of ['put', 'delete'] as const) {
    r.registerPath(
      op({
        method,
        path: '/groups/{id}/reading-list/{listingId}',
        tags: ['groups'],
        summary: method === 'put' ? 'Add a listing to a reading list' : 'Remove a listing from a reading list',
        description: 'Any current member can add or remove. Idempotent. Institutions have no reading list.',
        scope: 'read',
        request: { params: z.object({ id: S.Id, listingId: S.ListingRef }) },
        ok: { status: 200, schema: S.ReadingListState, description: 'Reading-list membership.' },
        errors: { 403: 'forbidden: not a group member or missing read scope', 404: 'not_found' },
      }),
    );
  }

  for (const method of ['put', 'delete'] as const) {
    r.registerPath(
      op({
        method,
        path: '/listings/{id}/follow',
        tags: ['listings'],
        summary: method === 'put' ? 'Follow a listing' : 'Unfollow a listing',
        description:
          'Idempotent. Needs only the `read` scope; followers may get a daily email about the listings they follow (opt out with `PATCH /me`).',
        scope: 'read',
        request: { params: listingIdParam },
        ok: { status: 200, schema: S.FollowState, description: 'Whether you now follow it, and its follower count.' },
        errors: { 404: 'not_found' },
      }),
    );
  }

  // Safe for work edition: a paper's own discussion and reactions.
  r.registerPath(
    op({
      method: 'get',
      path: '/listings/{id}/comments',
      tags: ['listings'],
      summary: 'A paper’s discussion',
      description:
        'Top-level comments, newest first, with a preview of the replies under them in `replies` (the rest from `GET /listings/{id}/comments/{commentId}/replies`). Pseudonymous: an alias per paper. Bodies are raw Markdown with TeX math.',
      request: { params: listingIdParam, query: S.PaginationQuery },
      ok: { status: 200, schema: S.PaperCommentList, description: 'A page of comments.' },
      errors: { 404: 'not_found' },
    }),
  );
  r.registerPath(
    op({
      method: 'post',
      path: '/listings/{id}/comments',
      tags: ['listings'],
      summary: 'Comment on a paper',
      description:
        'A top-level comment, or with `parentId` a reply. Needs the `read` scope and a confirmed institutional address (or a bot account).',
      scope: 'read',
      request: { params: listingIdParam, body: { content: { 'application/json': { schema: S.PaperCommentRequest } } } },
      ok: { status: 201, schema: S.PaperComment, description: 'The comment, as the list shows it.' },
      errors: { 403: 'not_verified', 404: 'not_found' },
    }),
  );
  r.registerPath(
    op({
      method: 'get',
      path: '/listings/{id}/comments/{commentId}/replies',
      tags: ['listings'],
      summary: 'Replies to a paper’s comment',
      description: 'Direct replies, oldest first, after `after`, each with a preview of the replies under it.',
      request: {
        params: z.object({ id: S.ListingRef, commentId: S.CommentId }),
        query: S.CommentRepliesQuery,
      },
      ok: { status: 200, schema: S.PaperCommentReplies, description: 'A page of replies.' },
      errors: { 404: 'not_found' },
    }),
  );
  r.registerPath(
    op({
      method: 'get',
      path: '/listings/{id}/reactions',
      tags: ['listings'],
      summary: 'A paper’s reactions',
      description: 'A count per emoji, most used first, and whether the caller used it. Never who.',
      request: { params: listingIdParam },
      ok: { status: 200, schema: S.ReactionList, description: 'The reactions.' },
      errors: { 404: 'not_found' },
    }),
  );
  for (const method of ['put', 'delete'] as const) {
    r.registerPath(
      op({
        method,
        path: '/listings/{id}/reactions/{emoji}',
        tags: ['listings'],
        summary: method === 'put' ? 'React to a paper' : 'Take a reaction back',
        description:
          'One emoji, URL-encoded in the path. Idempotent. Anonymous to everyone else; needs only the `read` scope. At most 20 different emoji per account on one paper (`409 too_many_reactions`).',
        scope: 'read',
        request: { params: z.object({ id: S.ListingRef, emoji: S.Emoji }) },
        ok: { status: 200, schema: S.ReactionList, description: 'The paper’s reactions now.' },
        errors: { 400: 'validation_error: not a single emoji', 404: 'not_found', 409: 'too_many_reactions' },
      }),
    );
  }

  r.registerPath(
    op({
      method: 'post',
      path: '/listings/{id}/market',
      tags: ['trading'],
      summary: 'Open a listing’s market, without trading',
      description:
        'A listing has no market until someone opens it, by this call or by a first order (`POST /listings/{id}/orders`). The market opens at JEV’s prices for the listing when JEV is enabled, else at the venue’s base rate. Idempotent: on a listing with a market, that market and `created: false`. Each account may open 20 an hour, counting markets opened by a first order. Without a credential it opens too, for a visitor choosing a first bet before signing up, from one budget all visitors share; a credential that is sent needs the `trade` scope and a trading-eligible account.',
      request: { params: listingIdParam },
      ok: { status: 201, schema: S.OpenedMarket, description: 'The market (200 when it already existed).' },
      errors: {
        401: 'unauthorized: a credential was sent and is invalid.',
        403: 'forbidden: the credential lacks the "trade" scope | not_verified: the account has no confirmed institutional email address.',
        404: 'not_found',
        409: 'market_not_open: no market is made for this listing’s kind | market_closed | listing_closed: the listing has no market and is closed to new ones',
        429: 'rate_limited: too many markets opened in the last hour',
      },
    }),
  );

  r.registerPath(
    op({
      method: 'post',
      path: '/listings/{id}/orders',
      tags: ['trading'],
      summary: 'Buy on a listing by stake, making its market on the first trade',
      description:
        'A listing has no market until its first trade: this order makes it (opening at JEV’s prices when enabled, else the venue’s base rate) and then fills. On a listing that has a market, it buys on the main market. By stake, not shares: the stake is the bound, and buys what it pays for when the order arrives. Send an `Idempotency-Key` header and retry freely.',
      scope: 'trade',
      request: {
        params: listingIdParam,
        headers: z.object({
          'Idempotency-Key': S.IdempotencyKey.optional().meta({
            description: 'Up to 255 printable ASCII characters, unique per account.',
          }),
        }),
        body: { content: { 'application/json': { schema: S.ListingOrderRequest } } },
      },
      ok: { status: 201, schema: S.ListingFill, description: 'The fill (or, for a replayed key, the original fill).' },
      errors: {
        403: 'forbidden: the credential lacks the "trade" scope | not_verified: the account has no confirmed institutional email address.',
        404: 'not_found: no such listing or outcome.',
        409: 'insufficient_balance | market_not_open: no market is made for this listing’s kind | market_closed | listing_closed: the listing has no market and is closed to new ones | idempotency_key_reused',
        429: 'rate_limited: this order would open a market, and too many were opened in the last hour',
      },
    }),
  );

  r.registerPath(
    op({
      method: 'post',
      path: '/listings/{id}/view',
      tags: ['listings'],
      summary: 'Count a view of a listing',
      description:
        'Public. Counts the caller once per day: the visitor is a daily hash of IP and user agent, never stored in the clear. Sent by the paper page from the browser; a bot has no reason to call it. `?from=` names the listing read just before, counted the same way per ordered pair.',
      request: { params: listingIdParam, query: S.ViewQuery },
      ok: { status: 200, schema: S.ViewState, description: 'The listing’s views after this one.' },
      errors: { 404: 'not_found' },
    }),
  );

  for (const method of ['put', 'delete'] as const) {
    r.registerPath(
      op({
        method,
        path: '/me/positions/{outcomeId}/public',
        tags: ['me'],
        summary: method === 'put' ? 'Make a position public' : 'Make a position private',
        description:
          method === 'put'
            ? 'Gives your position in this outcome a public link and lists it on your public profile, under your handle. Your comments on that market show your stake, so this links them to you. Only a position you hold. Idempotent: the link stays the same.'
            : 'Removes it from your profile; its link stops working. Idempotent.',
        scope: 'trade',
        request: { params: z.object({ outcomeId: S.Id }) },
        ok: { status: 200, schema: S.PublicPositionState, description: 'Its link id while public, else null.' },
        errors: method === 'put' ? { 409: 'insufficient_shares: you hold no shares of this outcome.' } : {},
      }),
    );
  }

  const sessionOnly = (config: Parameters<typeof op>[0]): RouteConfig => ({
    ...op({
      ...config,
      errors: {
        401: 'unauthorized: not signed in.',
        403: 'session_required: called with an API token. These endpoints never accept one.',
        ...config.errors,
      },
    }),
    security: [{ session: [] }],
  });

  r.registerPath(
    sessionOnly({
      method: 'post',
      path: '/me/tokens',
      tags: ['me'],
      summary: 'Mint an API token',
      description:
        'Scope `read`. The token is returned once and never again. `admin` tokens are issued by an operator only.',
      request: { body: { content: { 'application/json': { schema: S.CreateTokenRequest } } } },
      ok: { status: 201, schema: S.CreatedToken, description: 'The token, shown once.' },
    }),
  );

  r.registerPath(
    sessionOnly({
      method: 'post',
      path: '/me/agent-code',
      tags: ['agents'],
      summary: 'A one-time code for your own AI agent',
      description:
        'For a signed-in person handing their agent a prompt: a 6-digit code and your login address, which the agent redeems at `POST /agent/token` with no mail. Works once, for an hour; asking again replaces it.',
      ok: { status: 201, schema: S.AgentPromptCode, description: 'The code.' },
    }),
  );

  r.registerPath(
    op({
      method: 'post',
      path: '/agent/code',
      tags: ['agents'],
      summary: 'Mail a person a code for their AI agent',
      description:
        'For an AI agent signing in for a person: mails their login address a 6-digit code, which the person gives the agent for `POST /agent/token`. Works once, for 30 minutes; asking again replaces it. Needs no account: for an address without one it makes an unconfirmed user, and the code then confirms the address and makes the account. Answers the same either way. Five mails a day per address.',
      request: { body: { content: { 'application/json': { schema: S.AgentCodeRequest } } } },
      ok: { status: 200, schema: S.AgentCodeSent, description: 'The mail is on its way.' },
      errors: {
        422: 'email_domain_not_allowed: the domain is not on the institution allowlist, or the address has a +tag.',
        429: 'rate_limited: too many codes mailed to this address. See Retry-After.',
      },
    }),
  );

  r.registerPath(
    op({
      method: 'post',
      path: '/agent/token',
      tags: ['agents'],
      summary: 'Trade a one-time code for an API key',
      description:
        'For an AI agent a person has asked to trade for them: their address and the 6-digit code mailed to it (`POST /agent/code`) make a `read` + `trade` key named `ai-agent`, returned once. The code is used up. For an address not yet confirmed, it confirms it and makes the account, with the starting balance. Five wrong codes and it is gone.',
      request: { body: { content: { 'application/json': { schema: S.RedeemAgentCodeRequest } } } },
      ok: { status: 201, schema: S.CreatedToken, description: 'The key, shown once.' },
      errors: { 422: 'invalid_code: no live code matches this address and code.' },
    }),
  );

  r.registerPath(
    sessionOnly({
      method: 'get',
      path: '/me/tokens',
      tags: ['me'],
      summary: 'List your API tokens',
      ok: { status: 200, schema: S.TokenList, description: 'Your tokens, newest first, without their secrets.' },
    }),
  );

  const revoke = sessionOnly({
    method: 'delete',
    path: '/me/tokens/{id}',
    tags: ['me'],
    summary: 'Revoke an API token',
    request: { params: z.object({ id: S.TokenId }) },
    ok: { status: 200, schema: S.TokenList, description: 'unused' },
    errors: { 404: 'not_found' },
  });
  delete revoke.responses[200];
  revoke.responses[204] = { description: 'Revoked. The token stops working immediately.' };
  r.registerPath(revoke);

  const affiliationIdParam = z.object({ id: S.AffiliationId });

  r.registerPath(
    sessionOnly({
      method: 'get',
      path: '/me/affiliations',
      tags: ['me'],
      summary: 'List your affiliations',
      description:
        'Your institutional email addresses, confirmed and pending: the one you signed up with first. The institutions of the confirmed ones are your `institutions`.',
      ok: { status: 200, schema: S.AffiliationList, description: 'Your affiliations.' },
    }),
  );

  r.registerPath(
    sessionOnly({
      method: 'post',
      path: '/me/affiliations',
      tags: ['me'],
      summary: 'Add an affiliation',
      description:
        'Mails a 6-digit code to an address at an approved institution; confirm it with `POST /me/affiliations/{id}/verify` within an hour. Adding a pending address again sends a fresh code, and only the newest works. Each call costs one of 10 affiliation emails a day. An address another account has confirmed answers the same, but its owner is told instead and no code is sent.',
      request: { body: { content: { 'application/json': { schema: S.AddAffiliationRequest } } } },
      ok: { status: 201, schema: S.Affiliation, description: 'The pending affiliation.' },
      errors: {
        409: `already_affiliated: the address is already one of yours | too_many_pending: at most 5 unconfirmed at once.`,
        422: 'email_domain_not_allowed: the domain is not on the institution allowlist, or the address has a +tag.',
        429: 'rate_limited: your bucket is empty, or you have used your 10 affiliation emails (one back every 2.4 hours). See Retry-After.',
      },
    }),
  );

  r.registerPath(
    sessionOnly({
      method: 'post',
      path: '/me/affiliations/{id}/verify',
      tags: ['me'],
      summary: 'Confirm an affiliation',
      description:
        'With the code mailed to the address. Confirming one already confirmed returns it. After five wrong codes only a fresh code works.',
      request: {
        params: affiliationIdParam,
        body: { content: { 'application/json': { schema: S.VerifyAffiliationRequest } } },
      },
      ok: { status: 200, schema: S.Affiliation, description: 'The confirmed affiliation.' },
      errors: {
        404: 'not_found',
        409: 'affiliation_taken: another account confirmed this address first.',
        422: 'invalid_code: wrong, expired, or too many attempts (`details.reason`) | email_domain_not_allowed: the domain has left the allowlist.',
      },
    }),
  );

  const unaffiliate = sessionOnly({
    method: 'delete',
    path: '/me/affiliations/{id}',
    tags: ['me'],
    summary: 'Remove an affiliation',
    description:
      'Pending or confirmed; never the address you signed up with. Removing your last confirmed one unverifies the account.',
    request: { params: affiliationIdParam },
    ok: { status: 200, schema: S.AffiliationList, description: 'unused' },
    errors: { 404: 'not_found', 409: 'primary_affiliation: the address you signed up with.' },
  });
  delete unaffiliate.responses[200];
  unaffiliate.responses[204] = { description: 'Removed.' };
  r.registerPath(unaffiliate);

  r.registerPath(
    sessionOnly({
      method: 'post',
      path: '/me/password',
      tags: ['me'],
      summary: 'Set your first password',
      description:
        'For an account made by a sign-in link, which has none. To change a password, reset it from the sign-in page.',
      request: { body: { content: { 'application/json': { schema: S.SetPasswordRequest } } } },
      ok: { status: 200, schema: S.PasswordSet, description: 'Set. Sign in with it from now on.' },
      errors: { 409: 'password_already_set' },
    }),
  );

  const dropPendingBet = sessionOnly({
    method: 'delete',
    path: '/me/pending-bet',
    tags: ['me'],
    summary: 'Drop your onboarding bet',
    description:
      'The bet chosen during onboarding, once placed through `POST /markets/{id}/orders` or declined. Idempotent.',
    ok: { status: 200, schema: S.PasswordSet, description: 'unused' },
  });
  delete dropPendingBet.responses[200];
  dropPendingBet.responses[204] = { description: 'Dropped (or there was none).' };
  r.registerPath(dropPendingBet);

  r.registerPath(
    op({
      method: 'post',
      path: '/onboarding',
      tags: ['onboarding'],
      summary: 'Sign up, with or without a first bet',
      description:
        'The one way to sign up. Makes a name-less, password-less user for an address at an approved institution and mails it a confirmation link and code, both returning to `next`. A `bet` is stored, not placed: no account exists until the address is confirmed. After confirming, the person gives a name (`PATCH /me`) and a password (`POST /me/password`) and the bet is placed like any order, at the price then. Answers the same whether or not the address already has an account; a confirmed one is mailed a sign-in link instead, and the bet is placed when it signs in. Five mails a day per address.',
      request: { body: { content: { 'application/json': { schema: S.OnboardingRequest } } } },
      ok: { status: 200, schema: S.SignUpStarted, description: 'The mail is on its way.' },
      errors: {
        404: 'not_found: no such market or outcome.',
        409: 'market_not_open | market_closed',
        422: 'email_domain_not_allowed: the domain is not on the institution allowlist, or the address has a +tag.',
        429: 'rate_limited: too many sign-up mails to this address. See Retry-After.',
      },
    }),
  );

  r.registerPath(
    op({
      method: 'get',
      path: '/announcements',
      tags: ['meta'],
      summary: 'Messages on the home page',
      description:
        'What the home page shows at its top now, newest first: unexpired, for the venue or every venue, and those for signed-in readers only when a credential is sent.',
      request: { query: S.AnnouncementsQuery },
      ok: { status: 200, schema: S.AnnouncementList, description: 'The messages.' },
    }),
  );

  // -- admin ----------------------------------------------------------------

  r.registerPath(
    op({
      method: 'post',
      path: '/announcements',
      tags: ['admin'],
      summary: 'Put a message on the home page',
      description:
        'Markdown, shown at the top of one venue’s home page (`kind`) or every venue’s, until `expiresAt` or until deleted, and only to signed-in readers with `signedInOnly`. Readers can dismiss it in their browser.',
      scope: 'admin',
      request: { body: { content: { 'application/json': { schema: S.PostAnnouncementRequest } } } },
      ok: { status: 201, schema: S.Announcement, description: 'Posted.' },
    }),
  );

  r.registerPath(
    noContent(
      {
        method: 'delete',
        path: '/announcements/{id}',
        tags: ['admin'],
        summary: 'Take a message off the home page',
        scope: 'admin',
        request: { params: z.object({ id: S.Id }) },
        ok: { status: 200, schema: S.Announcement, description: 'unused' },
        errors: { 404: 'not_found' },
      },
      'Deleted.',
    ),
  );

  r.registerPath(
    op({
      method: 'post',
      path: '/markets',
      tags: ['admin'],
      summary: 'Create a market',
      description:
        '`b` is computed here from `expectedTraders` and the starting balance, and frozen for the life of the market. The house treasury is debited b·ln(n).',
      scope: 'admin',
      request: { body: { content: { 'application/json': { schema: S.CreateMarketRequest } } } },
      ok: { status: 201, schema: S.CreatedMarket, description: 'The new market.' },
      errors: { 404: 'not_found: no listing with `listingSlug`.', 409: 'slug_taken | house_underfunded' },
    }),
  );

  const upsertListing = op({
    method: 'post',
    path: '/listings',
    tags: ['admin'],
    summary: 'Create or replace a listing',
    description:
      'By slug: creates the listing, or replaces every field of the existing one (a field left out is cleared). The venue stores these fields for display and never fetches or interprets them. Link URLs must be http(s).',
    scope: 'admin',
    request: { body: { content: { 'application/json': { schema: S.UpsertListingRequest } } } },
    ok: { status: 201, schema: S.UpsertedListing, description: 'Created.' },
  });
  upsertListing.responses[200] = {
    ...json(S.UpsertedListing, 'Replaced an existing listing.'),
    headers: RATE_LIMIT_HEADERS,
  };
  r.registerPath(upsertListing);

  r.registerPath(
    op({
      method: 'post',
      path: '/markets/{id}/close',
      tags: ['admin'],
      summary: 'Close a market to trading',
      description: 'Idempotent.',
      scope: 'admin',
      request: { params: idParam },
      ok: { status: 200, schema: S.Market, description: 'The market.' },
      errors: { 404: 'not_found' },
    }),
  );

  r.registerPath(
    op({
      method: 'post',
      path: '/markets/{id}/settle',
      tags: ['admin'],
      summary: 'Settle a market',
      description:
        'Pays 1 unit per winning share and 0 otherwise. Idempotent: repeating the same settlement is a no-op returning 200; naming a different winner after settlement is `409 market_already_settled`.',
      scope: 'admin',
      request: { params: idParam, body: { content: { 'application/json': { schema: S.SettleRequest } } } },
      ok: { status: 200, schema: S.Market, description: 'The settled market.' },
      errors: { 404: 'not_found: no such market or outcome.', 409: 'market_already_settled | invalid_market' },
    }),
  );

  return r;
}

let cached: ReturnType<OpenApiGeneratorV31['generateDocument']> | undefined;

/** Error codes only trading, settling and opening markets return. */
const MARKET_ERROR_CODES = new Set([
  'market_not_open',
  'market_closed',
  'market_already_settled',
  'invalid_size',
  'insufficient_balance',
  'insufficient_shares',
  'slippage_exceeded',
  'house_underfunded',
  'invalid_market',
  'idempotency_key_reused',
  'insufficient_stake',
  'own_comment',
  'bots_cannot_open_markets',
  'listing_closed',
]);

/** Whether an OpenAPI path (`/markets/{id}`) is one the safe for work edition answers with a 404 (`MARKET_API`). */
function isMarketPath(path: string): boolean {
  const concrete = `/api/v1${path.replace(/\{[^}]+\}/g, 'x')}`;
  return MARKET_API.some((p) => under(concrete, p));
}

/**
 * The document without what the safe for work edition does not serve: every
 * `MARKET_API` path (the proxy's 404s), then every schema no remaining path
 * reaches, so nothing about markets, trading or reputation is published.
 */
function withoutMarkets(doc: ReturnType<OpenApiGeneratorV31['generateDocument']>) {
  const paths = Object.fromEntries(Object.entries(doc.paths ?? {}).filter(([path]) => !isMarketPath(path)));
  const schemas = (doc.components?.schemas ?? {}) as Record<string, unknown>;
  const reached = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') {
        const name = value.replace('#/components/schemas/', '');
        if (!reached.has(name)) {
          reached.add(name);
          visit(schemas[name]);
        }
      } else visit(value);
    }
  };
  visit(paths);
  const kept = Object.fromEntries(Object.entries(schemas).filter(([name]) => reached.has(name)));
  // The error codes stay a stable list (`errors.ts`); the document names only those this edition can return.
  const code = (kept.Error as { properties?: { error?: { properties?: { code?: { enum?: string[] } } } } } | undefined)
    ?.properties?.error?.properties?.code;
  if (code?.enum) code.enum = code.enum.filter((c) => !MARKET_ERROR_CODES.has(c));
  return { ...doc, paths, components: { ...doc.components, schemas: kept } } as typeof doc;
}

export function openApiDocument() {
  cached ??= withoutMarkets(
    new OpenApiGeneratorV31(buildRegistry().definitions).generateDocument({
      openapi: '3.1.0',
      info: {
        title: 'acceptodds API',
        version: '1.0.0',
        description:
          'The safe for work edition of acceptodds: research papers by venue, with search, a map laid out by topic, ' +
          'related papers, citations, follows and reading groups. There are no markets, prices or trading here. ' +
          'Errors are always `{ "error": { "code", "message", "details"? } }` with a stable `code`.',
      },
      servers: [{ url: '/api/v1' }],
      tags: [
        { name: 'listings', description: 'Papers: search, text, citations, related papers and the map.' },
        { name: 'accounts', description: 'Public profiles.' },
        { name: 'groups', description: 'Reading groups and their shared reading lists, joined by invite code.' },
        { name: 'me', description: 'The authenticated account.' },
        { name: 'admin', description: 'Requires the `admin` scope.' },
        { name: 'meta', description: 'About the server itself.' },
      ],
    }),
  );
  return cached;
}
