'use client';

import { useEffect, type ComponentProps, type FormEvent, type KeyboardEvent } from 'react';
import { track } from '@/lib/track';

/**
 * A search box that submits its form when its clear button (the browser's ×) empties it, so the
 * results follow. Typing or deleting down to nothing does not: only a clear, which the browser
 * sends as an input event without an `inputType`.
 *
 * `example`: a search shown as the placeholder ("Search papers, e.g. …"). Tab or → in the empty box
 * fills it in, once; the next Tab moves on as usual.
 */
export function SearchInput({
  example,
  ...props
}: Omit<ComponentProps<'input'>, 'type' | 'onInput' | 'placeholder'> & {
  example?: { id: string; q: string };
}) {
  useEffect(() => {
    if (example) track('search_example_shown', { example: example.id, target: 'placeholder' });
  }, [example]);

  function onInput(e: FormEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const native = e.nativeEvent as Partial<InputEvent>;
    if (input.value === '' && !native.inputType) input.form?.requestSubmit();
  }
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const accept = (e.key === 'Tab' && !e.shiftKey) || e.key === 'ArrowRight';
    if (!example || !accept || input.value !== '' || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    input.value = example.q;
    input.setSelectionRange(example.q.length, example.q.length);
    track('search_example_used', { example: example.id, target: 'placeholder' });
  }
  return (
    <input
      {...props}
      type="search"
      placeholder={example ? `Search papers, e.g. ${example.q}` : 'Search papers'}
      onInput={onInput}
      onKeyDown={onKeyDown}
    />
  );
}
