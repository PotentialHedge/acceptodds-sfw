import { describe, expect, it } from 'vitest';
import katex from 'katex';
import { cleanTex, reviewMath } from '@/lib/review-math';

describe('reviewMath', () => {
  it('reads every delimiter as math', () => {
    expect(reviewMath(String.raw`where \(G>E\) holds`)).toBe('where $G>E$ holds');
    expect(reviewMath(String.raw`a \\(d\\)-dimensional`)).toBe('a $d$-dimensional');
    expect(reviewMath('so:\n\n\\[\nT_1=(A,r_1,B)\n\\]\nthen')).toBe('so:\n\n\n\n$$\nT_1=(A,r_1,B)\n$$\n\n\nthen');
    expect(reviewMath('$S$ and $$x^2$$')).toBe('$S$ and $$x^2$$');
  });

  it('undoes Markdown escaping inside math only', () => {
    expect(reviewMath(String.raw`$|a\_{ij}-a^{\\mathrm{pool}}\_{ij}|$ and a\_b`)).toBe(
      String.raw`$|a_{ij}-a^{\mathrm{pool}}_{ij}|$ and a\_b`,
    );
    expect(reviewMath(String.raw`At $1\%$ anchors`)).toBe(String.raw`At $1\%$ anchors`);
  });

  it('leaves escaped brackets and parentheses in prose as they are', () => {
    expect(reviewMath(String.raw`ViDoSeek\[1\] has`)).toBe(String.raw`ViDoSeek\[1\] has`);
    expect(reviewMath(String.raw`\[Smith, 2020\]`)).toBe(String.raw`\[Smith, 2020\]`);
    expect(reviewMath(String.raw`\(see above\)`)).toBe(String.raw`\(see above\)`);
  });

  it('keeps money as money', () => {
    expect(reviewMath('costs $5 and $6 today')).toBe(String.raw`costs \$5 and \$6 today`);
    expect(reviewMath(String.raw`paid \$5 once`)).toBe(String.raw`paid \$5 once`);
  });

  it('leaves code alone', () => {
    expect(reviewMath('`$x\\_y$` and ```\n\\(z\\)\n```')).toBe('`$x\\_y$` and ```\n\\(z\\)\n```');
  });

  it('keeps a line break in an environment, and a real norm', () => {
    const m = String.raw`\begin{aligned}a\\b\end{aligned}`;
    expect(cleanTex(m)).toBe(m);
    expect(cleanTex(String.raw`\|x\|\_2`)).toBe(String.raw`\|x\|_2`);
    expect(() => katex.renderToString(cleanTex(m), { throwOnError: true })).not.toThrow();
  });
});
