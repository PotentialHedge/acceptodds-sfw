'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ui } from './ui';

/** Comments shown before "Show N more". */
const SHOWN = 3;

/** A review comment's element id, which its permalink points at. */
export function reviewCommentAnchor(externalId: string): string {
  return `comment-${externalId}`;
}

/**
 * The comments under one review (or on the paper itself): collapsed behind
 * "N comments", the first {@link SHOWN} once opened and the rest behind
 * "Show N more". `items` are rendered on the server, one per id in `ids`.
 *
 * A link to one of them (`#comment-<id>`, on load or later) opens the list
 * and the rest of it as far as needed, then scrolls to the comment: the
 * browser cannot, since it is hidden when the page arrives.
 */
export function ReviewComments({ ids, items }: { ids: string[]; items: ReactNode[] }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  // The comment a link asked for, scrolled to once the render that reveals it has landed.
  const target = useRef<string | null>(null);

  useEffect(() => {
    const anchors = ids.map(reviewCommentAnchor);
    const follow = () => {
      const id = decodeURIComponent(location.hash.slice(1));
      const i = anchors.indexOf(id);
      if (i < 0) return;
      setOpen(true);
      if (i >= SHOWN) setAll(true);
      target.current = id;
    };
    follow();
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, [ids]);

  useEffect(() => {
    if (!target.current) return;
    document.getElementById(target.current)?.scrollIntoView({ block: 'start' });
    target.current = null;
  }, [open, all]);

  // One more is shown rather than hidden behind a button of its own.
  const hidden = items.length > SHOWN + 1 ? items.length - SHOWN : 0;
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="mt-2">
      <summary className="cursor-pointer font-sans text-[13px] text-accent">
        {items.length === 1 ? '1 comment' : `${items.length} comments`}
      </summary>
      {all || hidden === 0 ? items : items.slice(0, SHOWN)}
      {!all && hidden > 0 && (
        <button type="button" className={`${ui.linkBtn} mt-3 font-sans text-[13px]`} onClick={() => setAll(true)}>
          Show {hidden} more {hidden === 1 ? 'comment' : 'comments'}
        </button>
      )}
    </details>
  );
}
