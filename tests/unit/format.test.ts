import { describe, expect, it } from 'vitest';
import { clip, clock, day, dayMonth, multiple, shares, signedPctOf } from '@/lib/format';

describe('signedPctOf', () => {
  it('signs a change as a share of its base', () => {
    expect(signedPctOf(5_000_000n, 100_000_000n)).toBe('+5.0%');
    expect(signedPctOf(-12_340_000n, 100_000_000n)).toBe('−12.3%');
    expect(signedPctOf(0n, 100_000_000n)).toBe('+0.0%');
  });

  it('has no percentage without a positive base', () => {
    expect(signedPctOf(5_000_000n, 0n)).toBe('—');
    expect(signedPctOf(5_000_000n, -1n)).toBe('—');
  });
});

describe('dates', () => {
  // Spelled out by hand so the server and the browser agree (hydration).
  it('are UTC with a three-letter month', () => {
    const at = '2026-09-13T23:30:00Z';
    expect(dayMonth(at)).toBe('13 Sep');
    expect(clock(at)).toBe('23:30');
    expect(day(at)).toBe('13 Sep 2026');
    expect(clock('2026-01-02T04:05:00Z')).toBe('04:05');
  });
});

describe('shares', () => {
  it('drops trailing zeros', () => {
    expect(shares(40_000_000n)).toBe('40');
    expect(shares('12500000')).toBe('12.5');
    expect(shares(1_234_567_891n)).toBe('1,234.567891');
  });

  it('truncates to maxDecimals, never rounding a holding up', () => {
    expect(shares(12_399_999n, 1)).toBe('12.3');
    expect(shares(12_050_000n, 1)).toBe('12');
    expect(shares(999_999n, 1)).toBe('0.9');
    expect(shares(-12_399_999n, 1)).toBe('−12.3');
  });
});

describe('clip', () => {
  it('leaves text that fits alone', () => {
    expect(clip('ETH Zurich', 10)).toBe('ETH Zurich');
  });

  it('cuts at a word break near the limit, within the limit', () => {
    const out = clip('Swiss Federal Institute of Technology in Zurich', 30);
    expect(out).toBe('Swiss Federal Institute of…');
    expect(Array.from(out).length).toBeLessThanOrEqual(30);
  });

  it('cuts mid-word when no break is near', () => {
    expect(clip('Rechenzentrumsgesellschaft', 10)).toBe('Rechenzen…');
  });

  it('never splits a surrogate pair', () => {
    expect(clip('😀😀😀😀', 3)).toBe('😀😀…');
  });
});

describe('multiple', () => {
  it('is proceeds over cost, to two places', () => {
    expect(multiple(124_000_000n, 100_000_000n)).toBe('×1.24');
    expect(multiple(87_000_000n, 100_000_000n)).toBe('×0.87');
    expect(multiple(1n, 0n)).toBeNull();
  });
});
