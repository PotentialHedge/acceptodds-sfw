'use client';

import type { ReactNode } from 'react';
import { track } from '@/lib/track';

/** A review's text behind "Read review"; opening it is counted (`review_opened`), closing it is not. */
export function ReviewCollapsed({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="mt-2">
      <summary
        className="cursor-pointer font-sans text-[13px] text-accent"
        onClick={(e) => {
          if (!(e.currentTarget.parentElement as HTMLDetailsElement).open) track('review_opened');
        }}
      >
        {summary}
      </summary>
      {children}
    </details>
  );
}
