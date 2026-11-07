'use client';

import Link from 'next/link';
import { useEffect, type ReactNode } from 'react';
import { track } from '@/lib/track';

/** One example search as a link under the box (`lib/search-examples.ts`). */
export function ExampleLink({ id, q, href }: { id: string; q: string; href: string }) {
  useEffect(() => {
    track('search_example_shown', { example: id, target: 'link' });
  }, [id]);
  return (
    <Link
      href={href}
      className="font-mono text-accent"
      onClick={() => track('search_example_used', { example: id, target: 'link' })}
    >
      {q}
    </Link>
  );
}

/** Results of an example search: counts a paper opened from them, whichever way it was reached. */
export function ExampleResults({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div
      onClickCapture={(e) => {
        const a = (e.target as HTMLElement).closest('a');
        if (a?.getAttribute('href')?.startsWith('/papers/')) track('search_example_result_opened', { example: id });
      }}
    >
      {children}
    </div>
  );
}
