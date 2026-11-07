import { describe, expect, it } from 'vitest';
import { parseSearch } from '@/lib/query';
import { exampleOf, pickExamples, SEARCH_EXAMPLES } from '@/lib/search-examples';

describe('search examples', () => {
  it('each parses without an error and has its own id', () => {
    for (const e of SEARCH_EXAMPLES) expect(parseSearch(e.q).errors).toEqual([]);
    expect(new Set(SEARCH_EXAMPLES.map((e) => e.id)).size).toBe(SEARCH_EXAMPLES.length);
  });

  it('picks two different ones, whatever the draw', () => {
    for (const r of [0, 0.2, 0.5, 0.79, 0.99]) {
      const [a, b] = pickExamples(() => r);
      expect(a.id).not.toBe(b.id);
    }
  });

  it('knows a query that is an example, spacing aside', () => {
    expect(exampleOf('  diffusion   rating>=3 ')?.id).toBe('e1');
    expect(exampleOf('diffusion rating>=2')).toBeNull();
    expect(exampleOf(null)).toBeNull();
  });
});
