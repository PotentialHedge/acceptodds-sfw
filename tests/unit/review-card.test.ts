import { describe, expect, it } from 'vitest';
import { cardPath, previewTags } from '@/lib/preview-tags';
import { cardCurve, plainText } from '@/lib/review-card';

describe('plainText', () => {
  it('flattens TeX', () => {
    expect(plainText('$\\alpha$-NET: on $O(n^2)$ time')).toBe('α-NET: on O(n2) time');
    expect(plainText('A plain   title')).toBe('A plain title');
  });
});

describe('cardCurve', () => {
  const curve = [0, 0.5, 1, 0.5, 0];
  it('places the mean on the scale and on the curve', () => {
    const c = cardCurve(curve, [1, 5], 3, 400, 100);
    expect(c.x).toBe(200);
    expect(c.y).toBe(0);
    expect(c.below.startsWith('M0.0,100.0')).toBe(true);
    expect(c.below.endsWith('L200.0,100L0,100Z')).toBe(true);
  });
  it('interpolates between samples, and holds a mean off the scale to its edge', () => {
    expect(cardCurve(curve, [1, 5], 1.5, 400, 100).y).toBe(75);
    expect(cardCurve(curve, [1, 5], 9, 400, 100).x).toBe(400);
    expect(cardCurve(curve, [1, 5], 0, 400, 100).x).toBe(0);
  });
});

describe('previewTags', () => {
  it('escapes what it is given', () => {
    const tags = previewTags({ title: '"><script>x</script>', description: 'a&b', url: 'u', image: 'i' });
    expect(tags).not.toContain('<script>');
    expect(tags).toContain('&quot;&gt;&lt;script&gt;');
    expect(tags).toContain('a&amp;b');
  });
  it('names a path the gate lets through', () => {
    expect(cardPath('a b')).toBe('/papers/a%20b/card.png');
  });
});
