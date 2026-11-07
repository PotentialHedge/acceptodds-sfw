import { describe, expect, it } from 'vitest';
import { shownKeywords } from '@/components/PaperTopics';

describe('shownKeywords', () => {
  it('splits at semicolons and keeps the authors’ words, each searching for its tag', () => {
    expect(
      shownKeywords(
        ['Large Language Models; Pipeline Parallelism', 'LLMs', 'diffusion model'],
        ['large language models', 'pipeline parallelism', 'large language models', 'diffusion models'],
      ),
    ).toEqual([
      { text: 'Large Language Models', search: 'large language models' },
      { text: 'Pipeline Parallelism', search: 'pipeline parallelism' },
      // "LLMs" is another spelling of the first: left out.
      { text: 'diffusion model', search: 'diffusion models' },
    ]);
  });

  it('ignores tags that do not line up, and drops only exact repeats then', () => {
    expect(shownKeywords(['A; B', ' b ', 'a'], ['x'])).toEqual([
      { text: 'A', search: 'A' },
      { text: 'B', search: 'B' },
    ]);
    expect(shownKeywords([], [])).toEqual([]);
  });
});
