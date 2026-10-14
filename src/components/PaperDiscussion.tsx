'use client';

import { useState } from 'react';
import useSWRInfinite from 'swr/infinite';
import type { z } from 'zod';
import { SignInLink } from '@/components/AuthLinks';
import { Markdown } from '@/components/Markdown';
import { MARKDOWN_HINT, MarkdownEditor } from '@/components/MarkdownEditor';
import { ui } from '@/components/ui';
import { userName } from '@/lib/aliases';
import { PAPER_COMMENT_PAGE } from '@/lib/discussion-page';
import { ago } from '@/lib/format';
import type * as S from '@/server/api/schemas';

type CommentList = z.output<typeof S.PaperCommentList>;
type Comment = z.output<typeof S.PaperComment>;
type Replies = z.output<typeof S.PaperCommentReplies>;

/** Replies fetched per "more replies". */
const REPLY_PAGE = 20;

const fetchJson = (url: string) => fetch(url).then((r) => r.json());

const MESSAGES: Record<string, string> = {
  not_verified: 'Confirm an institutional email address on your profile to comment.',
  rate_limited: 'Too many requests. Wait a moment.',
};

async function errorText(res: Response, fallback: string): Promise<string> {
  const e = await res.json().catch(() => null);
  return MESSAGES[e?.error?.code] ?? e?.error?.message ?? fallback;
}

/**
 * A paper's discussion (safe for work edition): the market edition's
 * comments with no stake and no backing. Pseudonymous as OpenReview is —
 * each comment shows its author's alias on this paper ("User k3xm", "(you)"
 * on the viewer's own) and nothing else; `@k3xm` mentions them. Only
 * accounts with a confirmed institutional address may post.
 *
 * Replies nest, each level indented. Top-level comments come
 * {@link PAPER_COMMENT_PAGE} at a time with a preview of the replies under
 * them (flat; `parentId` makes the tree), and "more replies" on a comment
 * fetches its next {@link REPLY_PAGE}.
 */
export function PaperDiscussion({
  listingId,
  initial,
  viewer,
}: {
  listingId: string;
  initial: CommentList;
  viewer: { signedIn: boolean; canComment: boolean };
}) {
  const base = `/api/v1/listings/${listingId}/comments?limit=${PAPER_COMMENT_PAGE}`;
  const { data, mutate, size, setSize, isValidating } = useSWRInfinite<CommentList>(
    (i, previous: CommentList | null) =>
      i === 0 ? base : previous?.nextCursor ? `${base}&cursor=${encodeURIComponent(previous.nextCursor)}` : null,
    fetchJson,
    { fallbackData: [initial], refreshInterval: 30_000, revalidateOnMount: false },
  );

  const pages = data ?? [];
  const first = pages[0];
  const last = pages[pages.length - 1];
  const threads = pages.flatMap((p) => p.comments);

  // Replies fetched by "more replies" or posted here, merged with the polled ones (which win: fresher).
  const [extra, setExtra] = useState<Map<string, Comment>>(new Map());
  // Replies posted here, which can land past a gap: "more replies" must not continue after one.
  const [posted, setPosted] = useState<Set<string>>(new Set());
  const known = new Map(extra);
  for (const p of pages) for (const c of [...p.comments, ...p.replies]) known.set(c.id, c);
  const children = new Map<string, Comment[]>();
  for (const c of known.values()) {
    if (c.parentId) children.set(c.parentId, [...(children.get(c.parentId) ?? []), c]);
  }
  for (const list of children.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const add = (cs: Comment[]) =>
    setExtra((m) => {
      const next = new Map(m);
      for (const c of cs) next.set(c.id, c);
      return next;
    });

  const you = first?.viewerAlias ?? null;
  const aliases = new Set([...known.values()].map((c) => c.author.bot?.handle ?? c.author.alias));
  const tree: Tree = {
    listingId,
    canReply: viewer.canComment,
    you,
    aliases,
    children: (id) => children.get(id) ?? [],
    loaded: add,
    posted: (c) => {
      setPosted((xs) => new Set(xs).add(c.id));
      add([c]);
    },
    isPosted: (id) => posted.has(id),
  };

  return (
    <section className="mt-12">
      <h3 className={`${ui.section} mb-2`}>Discussion{first ? ` (${first.total})` : ''}</h3>

      {viewer.canComment ? (
        <CommentForm
          listingId={listingId}
          placeholder="What do you make of this paper?"
          you={you}
          aliases={aliases}
          onPosted={() => void mutate()}
        />
      ) : (
        <div className={ui.fine}>
          {viewer.signedIn ? (
            'Confirm an institutional email address on your profile to comment.'
          ) : (
            <>
              <SignInLink>Sign in</SignInLink> to comment.
            </>
          )}
        </div>
      )}

      {threads.map((t) => (
        <div key={t.id} className="border-b border-dotted border-rule-strong">
          <Thread c={t} tree={tree} />
        </div>
      ))}

      {last?.nextCursor && size === pages.length && (
        <button
          type="button"
          className={`mt-3 ${ui.btn({ inline: true, ghost: true })}`}
          disabled={isValidating}
          onClick={() => void setSize(size + 1)}
        >
          Load more comments
        </button>
      )}
    </section>
  );
}

/** What every comment in the tree needs from the discussion. */
interface Tree {
  listingId: string;
  canReply: boolean;
  you: string | null;
  aliases: ReadonlySet<string>;
  children: (id: string) => Comment[];
  loaded: (cs: Comment[]) => void;
  posted: (c: Comment) => void;
  isPosted: (id: string) => boolean;
}

/** A comment and, indented under it, its replies, each a `Thread` of its own. */
function Thread({ c, tree }: { c: Comment; tree: Tree }) {
  const [busy, setBusy] = useState(false);
  const [replying, setReplying] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const replies = tree.children(c.id);
  const remaining = Math.max(0, c.replyCount - replies.length);

  async function more() {
    setBusy(true);
    setNote(null);
    const after = replies.filter((r) => !tree.isPosted(r.id)).at(-1);
    const res = await fetch(
      `/api/v1/listings/${tree.listingId}/comments/${c.id}/replies?limit=${REPLY_PAGE}${after ? `&after=${after.id}` : ''}`,
    );
    setBusy(false);
    if (!res.ok) return setNote(await errorText(res, 'Could not load replies.'));
    const page: Replies = await res.json();
    tree.loaded(page.replies);
  }

  return (
    <>
      <div className="py-2.5">
        <div className="flex flex-wrap items-baseline gap-x-2 text-[13px] text-muted">
          <span className={ui.runIn}>
            {c.author.bot ? c.author.bot.displayName : userName(c.author.alias)}
            {c.author.isYou && ' (you)'}
          </span>
          {c.author.bot && <span className={ui.badge}>bot</span>}
          <span suppressHydrationWarning>{ago(c.createdAt)} ago</span>
        </div>
        <Markdown className="mt-1" mentions={new Set(c.mentions)} you={tree.you}>
          {c.body}
        </Markdown>
        {tree.canReply && (
          <div className="mt-1 font-sans text-xs text-muted">
            <button type="button" className="cursor-pointer underline" onClick={() => setReplying(true)}>
              reply
            </button>
          </div>
        )}
      </div>
      {(replies.length > 0 || replying || remaining > 0 || note) && (
        <div className="mb-2 ml-1.5 border-l-2 border-rule-strong pl-5 narrow:pl-3">
          {replies.map((r) => (
            <Thread key={r.id} c={r} tree={tree} />
          ))}
          {remaining > 0 && (
            <button
              type="button"
              className="cursor-pointer py-1.5 font-sans text-xs text-muted underline disabled:opacity-50"
              disabled={busy}
              onClick={more}
            >
              {remaining === 1 ? '1 more reply' : `${remaining} more replies`}
            </button>
          )}
          {note && <div className={ui.note(false)}>{note}</div>}
          {replying && (
            <div className="py-2">
              <CommentForm
                listingId={tree.listingId}
                parentId={c.id}
                placeholder={`Reply to ${c.author.bot?.displayName ?? userName(c.author.alias)}`}
                you={tree.you}
                aliases={tree.aliases}
                autoFocus
                onPosted={(r) => {
                  tree.posted(r);
                  setReplying(false);
                }}
                onCancel={() => setReplying(false)}
              />
            </div>
          )}
        </div>
      )}
    </>
  );
}

function CommentForm({
  listingId,
  parentId,
  placeholder,
  you,
  aliases,
  autoFocus,
  onPosted,
  onCancel,
}: {
  listingId: string;
  parentId?: string;
  placeholder: string;
  you: string | null;
  aliases: ReadonlySet<string>;
  autoFocus?: boolean;
  onPosted: (c: Comment) => void;
  onCancel?: () => void;
}) {
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function post() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/listings/${listingId}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body, parentId }),
    });
    setBusy(false);
    if (res.ok) {
      setBody('');
      setPreview(false);
      onPosted(await res.json());
    } else {
      setError(await errorText(res, 'Could not post.'));
    }
  }

  return (
    <div>
      <MarkdownEditor
        value={body}
        onChange={setBody}
        preview={preview}
        placeholder={placeholder}
        autoFocus={autoFocus}
        mentions={aliases}
        you={you}
      />
      <div className="flex items-center justify-between gap-3">
        <span className={ui.fine}>
          Shown as {you ? userName(you) : 'a user id of its own on this paper'}; @id mentions a user. {MARKDOWN_HINT}
        </span>
        <span className="flex gap-2">
          {onCancel && (
            <button className={ui.btn({ inline: true, ghost: true })} disabled={busy} onClick={onCancel}>
              Cancel
            </button>
          )}
          <button
            className={ui.btn({ inline: true, ghost: true })}
            disabled={body.trim().length === 0 && !preview}
            onClick={() => setPreview((p) => !p)}
          >
            {preview ? 'Edit' : 'Preview'}
          </button>
          <button className={ui.btn({ inline: true })} disabled={busy || body.trim().length === 0} onClick={post}>
            {parentId ? 'Reply' : 'Post'}
          </button>
        </span>
      </div>
      {error && <div className={ui.note(false)}>{error}</div>}
    </div>
  );
}
