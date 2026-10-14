'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { pageHasVenue, rememberVenue } from '@/lib/venue';
import { Popover, PopoverContent, PopoverTrigger } from './Popover';
import { ui } from './ui';

/**
 * The navbar's venue, beside the logo: the one every venue-less page shows
 * (`currentVenue()`), and so the wallet, curve and board the viewer is in
 * (§1.8). It is the site's only venue picker: a page whose URL names a
 * venue (`?kind=`) is shown in the new one and a page that belongs to a
 * venue (`pageHasVenue`) is left for the new venue's home page, both making
 * it the navbar's by `RememberVenue`; any other page sets the cookie and is
 * drawn again. One venue: a label, no menu.
 */
export function VenueSwitcher({ current, kinds }: { current: string; kinds: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [open, setOpen] = useState(false);
  const options = [...new Set([current, ...kinds])];
  if (options.length < 2) return <span className="text-lg text-faint">{current}</span>;

  const pick = (kind: string) => {
    setOpen(false);
    // The current venue again: only a list of every venue (`?kind=all`) has anywhere to go.
    if (kind === current && (pageHasVenue(pathname) || !search.has('kind'))) return;
    // Where the URL changes, the next page's `RememberVenue` sets the cookie: it sees the navbar drawn
    // in another venue and refreshes it, which a client navigation alone would not (the root layout is kept).
    if (pageHasVenue(pathname)) {
      router.push(`/?${new URLSearchParams({ kind })}`);
    } else if (search.has('kind')) {
      const params = new URLSearchParams(search);
      params.set('kind', kind);
      // A page number, a trader to centre on or a paper on the map belongs to the old venue's.
      for (const key of ['page', 'fpage', 'hpage', 'around', 'paper']) params.delete(key);
      router.push(`${pathname}?${params}`);
    } else {
      rememberVenue(kind);
      router.refresh();
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`Venue: ${current}. Choose another venue`}
        className={`${ui.picker} text-lg text-faint hover:text-accent`}
      >
        {current}{' '}
        <span aria-hidden className="text-xs">
          ▾
        </span>
      </PopoverTrigger>
      <PopoverContent menu align="start" className="max-w-72 font-serif">
        {options.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => pick(k)}
            aria-current={k === current ? 'true' : undefined}
            className={`cursor-pointer py-1 text-left break-words hover:text-accent narrow:min-h-11 narrow:py-2 ${k === current ? ui.on : ''}`}
          >
            {k}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
