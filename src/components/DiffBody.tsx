'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The diff page's text, fetched as HTML (`diff/body`) and put in place, so the paper's text is
 * sent once. Keyed by `src`, so a new choice starts afresh. Once it is in, the address's `#c12` (a change) or `#p12` (a passage) is scrolled to.
 */
export function DiffBody({ src }: { src: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    const ctl = new AbortController();
    fetch(src, { signal: ctl.signal })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((html) => {
        if (!ref.current) return;
        ref.current.innerHTML = html;
        setState('ready');
        const id = decodeURIComponent(location.hash.slice(1));
        if (id) document.getElementById(id)?.scrollIntoView({ block: 'start' });
      })
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === 'AbortError')) setState('failed');
      });
    return () => ctl.abort();
  }, [src]);

  return (
    <>
      {state !== 'ready' && (
        <p className="py-7.5 font-sans text-sm text-muted italic">
          {state === 'loading' ? 'Loading the text…' : 'The text did not load. Reload the page to try again.'}
        </p>
      )}
      <div ref={ref} className="vdiff" />
    </>
  );
}
