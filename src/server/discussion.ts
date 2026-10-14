import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDb, type Database } from '@/db';
import { accounts, commentAliases, commentMentions, comments } from '@/db/schema';
import { mentionedNames, randomAlias } from '@/lib/aliases';
import { ApiError } from './api/errors';
import { encodeCursor } from './views';

/**
 * A paper's discussion, in the safe for work edition: comments on the
 * listing itself (`comments.listing_id`), with no stake and no backing,
 * since there is nothing to hold. The market edition's discussions were a
 * market's (`server/comments.ts`); they are not carried over.
 *
 * Otherwise as before: pseudonymous, an OpenReview-style alias per paper
 * (`comment_aliases`, the listing's scope), shared by every comment the
 * account makes on it and unrelated to its alias anywhere else; `@k3xm`
 * mentions a commenter on the paper and is stored (`comment_mentions`); a
 * bot is named. Replies nest at any depth; the top level pages newest first
 * with a preview of each tree, and `listPaperReplies` pages the rest.
 *
 * This module writes `comments` (listing-scoped rows only), their aliases
 * and mentions, and nothing else. Bodies are raw Markdown.
 */

export const MAX_COMMENT_LENGTH = 2000;
/** How many replies to each comment, oldest first, a preview carries. */
export const REPLY_PREVIEW = 3;
/** How many levels of replies come with a page of top-level comments. */
export const LIST_DEPTH = 3;
/** How many levels below each reply come with a page of replies. */
export const REPLIES_DEPTH = 2;

export interface PaperCommentView {
  id: string;
  parentId: string | null;
  body: string;
  createdAt: Date;
  replyCount: number;
  /** Aliases `@`-mentioned in the body that belong to commenters on this paper, in order of first mention. */
  mentions: string[];
  author: {
    alias: string;
    /** Who the author is when it is a bot; null for a person. */
    bot: { handle: string; displayName: string } | null;
    isYou: boolean;
  };
}

/** A top-level comment on a listing, or with `parentId` a reply to one on the same listing. */
export async function postPaperComment(
  input: { listingId: string; accountId: string; body: string; parentId?: string | null },
  database: Database = getDb(),
): Promise<{ id: string; createdAt: Date }> {
  const body = input.body.trim();
  if (body.length === 0 || body.length > MAX_COMMENT_LENGTH) {
    throw new ApiError(400, 'validation_error', `a comment is 1–${MAX_COMMENT_LENGTH} characters`);
  }
  const parentId = input.parentId ?? null;
  if (parentId) {
    const [parent] = await database
      .select({ id: comments.id })
      .from(comments)
      .where(and(eq(comments.id, parentId), eq(comments.listingId, input.listingId)));
    if (!parent) throw new ApiError(404, 'not_found', `no comment ${parentId} on this paper`);
  }
  await ensureAlias(input.listingId, input.accountId, database);
  const mentioned = await resolveMentions(input.listingId, mentionedNames(body), database);
  return database.transaction(async (tx) => {
    const [row] = await tx
      .insert(comments)
      .values({ listingId: input.listingId, accountId: input.accountId, parentId, body })
      .returning({ id: comments.id, createdAt: comments.createdAt });
    const recipients = [...new Set(mentioned.values())].filter((id) => id !== input.accountId);
    if (recipients.length > 0) {
      await tx.insert(commentMentions).values(recipients.map((accountId) => ({ commentId: row.id, accountId })));
    }
    return row;
  });
}

/** Which accounts `names` mention on this paper: a commenter's alias there, else a bot's handle. */
async function resolveMentions(listingId: string, names: string[], database: Database): Promise<Map<string, string>> {
  if (names.length === 0) return new Map();
  const [aliases, bots] = await Promise.all([
    database
      .select({ name: commentAliases.alias, accountId: commentAliases.accountId })
      .from(commentAliases)
      .where(and(eq(commentAliases.listingId, listingId), inArray(commentAliases.alias, names))),
    database
      .select({ name: accounts.handle, accountId: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.isBot, true), eq(accounts.isHouse, false), inArray(accounts.handle, names))),
  ]);
  return new Map([...bots, ...aliases].map((r) => [r.name, r.accountId]));
}

/** The account's alias on this paper, made if it has none (a unique index settles races and clashes). */
async function ensureAlias(listingId: string, accountId: string, database: Database): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const [existing] = await database
      .select({ alias: commentAliases.alias })
      .from(commentAliases)
      .where(and(eq(commentAliases.listingId, listingId), eq(commentAliases.accountId, accountId)));
    if (existing) return existing.alias;
    await database
      .insert(commentAliases)
      .values({ listingId, marketId: null, accountId, alias: randomAlias() })
      .onConflictDoNothing();
  }
  throw new Error(`could not draw a free comment alias for listing ${listingId}`);
}

const PG_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function decodeCursor(cursor: string | undefined): { t: string; id: string } | null {
  if (cursor === undefined) return null;
  try {
    const key = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (PG_TS.test(key?.t) && UUID.test(key?.id)) return { t: key.t, id: key.id };
  } catch {
    /* fall through */
  }
  throw new ApiError(400, 'validation_error', 'invalid cursor');
}

const columns = {
  id: comments.id,
  body: comments.body,
  createdAt: comments.createdAt,
  ts: sql<string>`to_char(${comments.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
  accountId: comments.accountId,
  isBot: accounts.isBot,
  handle: accounts.handle,
  displayName: accounts.displayName,
  parentId: comments.parentId,
  replyCount: sql<number>`(select count(*)::int from comments r where r.parent_id = ${comments.id})`,
};

type Row = {
  id: string;
  body: string;
  createdAt: Date;
  ts: string;
  accountId: string;
  isBot: boolean;
  handle: string;
  displayName: string;
  parentId: string | null;
  replyCount: number;
};

/**
 * A page of a listing's top-level comments, newest first, keyset-paginated,
 * with a preview of the replies under them. `total` counts every comment on
 * it, replies included; `viewerAlias` is the viewer's alias here, if any.
 */
export async function listPaperComments(
  listingId: string,
  q: { cursor?: string; limit: number; viewerAccountId?: string | null },
  database: Database = getDb(),
): Promise<{
  comments: PaperCommentView[];
  replies: PaperCommentView[];
  nextCursor: string | null;
  total: number;
  viewerAlias: string | null;
}> {
  const before = decodeCursor(q.cursor);
  const viewer = q.viewerAccountId ?? null;
  const [rows, [{ total }], [mine]] = await Promise.all([
    database
      .select(columns)
      .from(comments)
      .innerJoin(accounts, eq(accounts.id, comments.accountId))
      .where(
        and(
          eq(comments.listingId, listingId),
          isNull(comments.parentId),
          before
            ? sql`(${comments.createdAt}, ${comments.id}) < (${before.t}::timestamptz, ${before.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(comments.createdAt), desc(comments.id))
      .limit(q.limit + 1),
    database
      .select({ total: sql<number>`count(*)::int` })
      .from(comments)
      .where(eq(comments.listingId, listingId)),
    viewer
      ? database
          .select({ alias: commentAliases.alias })
          .from(commentAliases)
          .where(and(eq(commentAliases.listingId, listingId), eq(commentAliases.accountId, viewer)))
      : Promise.resolve([] as { alias: string }[]),
  ]);
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  const replies = await previewTree(
    page.map((r) => r.id),
    LIST_DEPTH,
    database,
  );
  const views = await decorate(listingId, [...page, ...replies], viewer, database);
  return {
    comments: views.slice(0, page.length),
    replies: views.slice(page.length),
    nextCursor: rows.length > q.limit && last ? encodeCursor({ t: last.ts, id: last.id }) : null,
    total,
    viewerAlias: mine?.alias ?? null,
  };
}

/** The first {@link REPLY_PREVIEW} replies to each of these comments, `depth` levels down; flat, oldest first. */
async function previewTree(parentIds: string[], depth: number, database: Database): Promise<Row[]> {
  if (parentIds.length === 0 || depth < 1) return [];
  const ids = sql.join(
    parentIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const tree = sql`
    with recursive tree (id, depth) as (
      select id, 1 from (
        select id, row_number() over (partition by parent_id order by created_at, id) as rn
        from comments where parent_id in (${ids})
      ) first where rn <= ${REPLY_PREVIEW}
      union all
      select next.id, tree.depth + 1 from tree
      cross join lateral (
        select id from comments where parent_id = tree.id order by created_at, id limit ${REPLY_PREVIEW}
      ) next
      where tree.depth < ${depth}
    )
    select id from tree`;
  return database
    .select(columns)
    .from(comments)
    .innerJoin(accounts, eq(accounts.id, comments.accountId))
    .where(sql`${comments.id} in (${tree})`)
    .orderBy(asc(comments.createdAt), asc(comments.id));
}

/**
 * A comment's direct replies on this listing, oldest first, after the reply
 * `after`, `limit` of them, each with a preview ({@link REPLIES_DEPTH} levels).
 */
export async function listPaperReplies(
  listingId: string,
  commentId: string,
  q: { after?: string; limit: number; viewerAccountId?: string | null },
  database: Database = getDb(),
): Promise<PaperCommentView[]> {
  const [parent] = await database
    .select({ id: comments.id })
    .from(comments)
    .where(and(eq(comments.id, commentId), eq(comments.listingId, listingId)));
  if (!parent) throw new ApiError(404, 'not_found', `no comment ${commentId} on this paper`);
  if (q.after) {
    const [after] = await database
      .select({ id: comments.id })
      .from(comments)
      .where(and(eq(comments.id, q.after), eq(comments.parentId, commentId)));
    if (!after) throw new ApiError(400, 'validation_error', '`after` is not a reply to this comment');
  }
  const page: Row[] = await database
    .select(columns)
    .from(comments)
    .innerJoin(accounts, eq(accounts.id, comments.accountId))
    .where(
      and(
        eq(comments.parentId, commentId),
        q.after
          ? sql`(${comments.createdAt}, ${comments.id}) > (select c.created_at, c.id from comments c where c.id = ${q.after}::uuid)`
          : undefined,
      ),
    )
    .orderBy(asc(comments.createdAt), asc(comments.id))
    .limit(q.limit);
  const below = await previewTree(
    page.map((r) => r.id),
    REPLIES_DEPTH,
    database,
  );
  return decorate(listingId, [...page, ...below], q.viewerAccountId ?? null, database);
}

/** One comment on a listing, as the list shows it, or `null`. */
export async function getPaperComment(
  listingId: string,
  commentId: string,
  viewerAccountId: string | null,
  database: Database = getDb(),
): Promise<PaperCommentView | null> {
  const [row] = await database
    .select(columns)
    .from(comments)
    .innerJoin(accounts, eq(accounts.id, comments.accountId))
    .where(and(eq(comments.id, commentId), eq(comments.listingId, listingId)));
  if (!row) return null;
  const [view] = await decorate(listingId, [row], viewerAccountId, database);
  return view;
}

/** Aliases and mentions for a set of comments on one listing. */
async function decorate(
  listingId: string,
  rows: Row[],
  viewerAccountId: string | null,
  database: Database,
): Promise<PaperCommentView[]> {
  if (rows.length === 0) return [];
  const authorIds = [...new Set(rows.map((r) => r.accountId))];
  const mentioned = [...new Set(rows.flatMap((r) => mentionedNames(r.body)))];
  const [aliases, resolved] = await Promise.all([
    database
      .select({ accountId: commentAliases.accountId, alias: commentAliases.alias })
      .from(commentAliases)
      .where(and(eq(commentAliases.listingId, listingId), inArray(commentAliases.accountId, authorIds))),
    resolveMentions(listingId, mentioned, database),
  ]);
  const aliasOf = new Map(aliases.map((a) => [a.accountId, a.alias]));
  const known = new Set(resolved.keys());
  return rows.map((r) => {
    const alias = aliasOf.get(r.accountId);
    if (alias === undefined) throw new Error(`comment author ${r.accountId} has no alias on this paper`);
    return {
      id: r.id,
      parentId: r.parentId,
      body: r.body,
      createdAt: r.createdAt,
      replyCount: r.replyCount,
      mentions: mentionedNames(r.body).filter((n) => known.has(n)),
      author: {
        alias,
        bot: r.isBot ? { handle: r.handle, displayName: r.displayName } : null,
        isYou: viewerAccountId === r.accountId,
      },
    };
  });
}
