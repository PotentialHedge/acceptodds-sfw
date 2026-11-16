'use client';

import { useState, type ReactNode } from 'react';
import { copyText } from '@/components/CopyButton';
import { CheckIcon, LinkIcon } from '@/components/icons';
import { track } from '@/lib/track';

/**
 * A link to `#anchor` on this page, marked with a chain icon. A plain click also copies the full URL and
 * shows a tick for a moment; the link still goes to the anchor, so the address bar shows it too. Clicks
 * with a modifier (new tab, etc.) are left to the browser.
 */
export function Permalink({ anchor, kind, children }: { anchor: string; kind: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <a
      href={`#${anchor}`}
      className="inline-flex items-baseline gap-1 hover:text-accent hover:underline"
      title={copied ? 'Link copied' : `Copy a link to this ${kind}`}
      onClick={async (event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const url = new URL(window.location.href);
        url.hash = anchor;
        if (await copyText(url.toString())) {
          setCopied(true);
          track('share_copied', { target: 'review_link' });
          setTimeout(() => setCopied(false), 1500);
        }
      }}
    >
      {children}
      {copied ? (
        <CheckIcon className="size-[1em] self-center text-accent" />
      ) : (
        <LinkIcon className="size-[1em] self-center" />
      )}
      <span className="sr-only" aria-live="polite">
        {copied ? 'Link copied' : ''}
      </span>
    </a>
  );
}
