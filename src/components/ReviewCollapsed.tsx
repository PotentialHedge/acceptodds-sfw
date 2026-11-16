'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { track } from '@/lib/track';

/**
 * A review's text behind "Read review". A link to the review (`#anchor`, on load or later) opens it, since
 * the reader followed a link to read it. Opening it by hand is counted (`review_opened`); a link opening it,
 * or closing it, is not.
 */
export function ReviewCollapsed({
  anchor,
  summary,
  children,
}: {
  anchor: string;
  summary: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const follow = () => {
      if (decodeURIComponent(location.hash.slice(1)) === anchor) setOpen(true);
    };
    follow();
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, [anchor]);

  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="mt-2">
      <summary
        className="cursor-pointer font-sans text-[13px] text-accent"
        onClick={() => {
          if (!open) track('review_opened');
        }}
      >
        {summary}
      </summary>
      {children}
    </details>
  );
}
