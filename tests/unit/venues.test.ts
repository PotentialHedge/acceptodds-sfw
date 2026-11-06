import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { headlineLabel, MAX_BAR_OUTCOMES, paletteSlot, shareTitleLine } from '@/lib/headline';
import { marketTemplate, openingPriorVar, openingPrices, openMarketTemplate } from '@/server/market-templates';
import { COLOR_SLOT, runningHead, shareSuffix, venue, venueBySlug, venues, venueSlug } from '@/venues';

describe('venues', () => {
  it('has one venue per kind', () => {
    const kinds = venues().map((v) => v.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it('gives each venue its own short path, `/<slug>`, that no page shadows', () => {
    const slugs = venues().map((v) => venueSlug(v).toLowerCase());
    expect(new Set(slugs).size).toBe(slugs.length);
    const pages = readdirSync(join(__dirname, '../../src/app')).map((f) => f.toLowerCase());
    for (const v of venues()) {
      expect(venueSlug(v)).toMatch(/^[A-Za-z0-9]+$/);
      expect(pages).not.toContain(venueSlug(v).toLowerCase());
      expect(venueBySlug(venueSlug(v).toUpperCase())).toBe(v);
    }
    expect(venueSlug(venue('OpenAI Math')!)).toBe('OpenAIMath');
    expect(venueBySlug('nope')).toBeNull();
  });

  describe.each(venues().map((v) => [v.kind, v] as const))('%s', (kind, v) => {
    const outcomes = v.market.outcomes;

    it('is found by its kind', () => {
      expect(venue(kind)).toBe(v);
      expect(marketTemplate(kind)?.outcomes).toEqual(outcomes.map((o) => o.label));
    });

    it('opens at fallback prices that are prices', () => {
      expect(outcomes.length).toBeGreaterThanOrEqual(2);
      for (const o of outcomes) expect(o.openingPrice).toBeGreaterThan(0);
      expect(outcomes.reduce((s, o) => s + o.openingPrice, 0)).toBeCloseTo(1, 12);
    });

    it('has distinct labels and, if it asks JEV, one criterion each', () => {
      expect(new Set(outcomes.map((o) => o.label)).size).toBe(outcomes.length);
      if (v.market.jev) {
        expect(v.market.jev.criteria).toHaveLength(outcomes.length);
        for (const c of v.market.jev.criteria) expect(c.length).toBeGreaterThan(0);
      }
    });

    // The UI draws an outcome's colour from its place (`paletteSlot`), not from the venue: a venue whose colours
    // differ from that would be drawn in colours it did not ask for.
    it('asks for the colours the outcome bar draws', () => {
      expect(outcomes.length).toBeLessThanOrEqual(MAX_BAR_OUTCOMES);
      outcomes.forEach((o, i) => expect(COLOR_SLOT[o.color]).toBe(paletteSlot(i, outcomes.length)));
    });

    it('keeps the share line Latin, for the OG image', () => {
      expect(v.shareSuffix).toMatch(/^[\x20-\x7e]+$/);
    });
  });

  it('opens OpenAI Math markets with their listings, at 50/50, until 2028', () => {
    const t = openMarketTemplate('OpenAI Math');
    expect(t?.closesAt.toISOString()).toBe('2028-01-01T00:00:00.000Z');
    expect(t?.fallbackPrices).toEqual([0.5, 0.5]);
    expect(t?.jev).toBeNull();
    expect(t?.opensWithListing).toBe(true);
    expect(marketTemplate('ICLR 2027')?.opensWithListing).toBe(false);
  });
});

describe('opening prior from the env', () => {
  afterEach(() => vi.unstubAllEnvs());
  const iclr = venue('ICLR 2027')!;

  it('is named after the venue’s short path', () => {
    expect(openingPriorVar(iclr)).toBe('OPENING_PRIOR_ICLR2027');
  });

  it('defaults to the venue’s own prices, and sets the headline when given', () => {
    vi.stubEnv('OPENING_PRIOR_ICLR2027', undefined);
    expect(openingPrices(iclr)).toEqual([0.32, 0.68]);
    expect(marketTemplate('ICLR 2027')?.fallbackPrices).toEqual([0.32, 0.68]);
    vi.stubEnv('OPENING_PRIOR_ICLR2027', ' 0.25 ');
    expect(openingPrices(iclr)).toEqual([0.25, 0.75]);
    expect(marketTemplate('ICLR 2027')?.fallbackPrices).toEqual([0.25, 0.75]);
    expect(openingPrices(venue('OpenAI Math')!)).toEqual([0.5, 0.5]);
  });

  it.each(['25', 'abc', '0.01', '0.99', '-0.3'])('refuses %s', (value) => {
    vi.stubEnv('OPENING_PRIOR_ICLR2027', value);
    expect(() => openingPrices(iclr)).toThrow('OPENING_PRIOR_ICLR2027');
  });
});

describe('per-venue wording', () => {
  it('names the headline by the listing’s venue', () => {
    expect(headlineLabel(['Accept', 'Reject'], 'ICLR 2027')).toBe('accept');
    expect(headlineLabel(['Verified', 'Not verified'], 'OpenAI Math')).toBe('verified');
    // No listing, or a kind with no venue: the first label, or "not <last>".
    expect(headlineLabel(['YES', 'NO'])).toBe('YES');
    expect(headlineLabel(['Accept', 'Reject'], 'NeurIPS 2027')).toBe('Accept');
    expect(headlineLabel(['a', 'b', 'c'], null)).toBe('not c');
  });

  it('ends the share line with the venue’s suffix', () => {
    expect(shareTitleLine('Catalan’s constant is irrational', 'OpenAI Math', 120)).toBe(
      'Catalan’s constant is irrational verified by 2027?',
    );
    expect(shareSuffix('NeurIPS 2027')).toBe(' @ NeurIPS 2027?');
    expect(shareSuffix(null)).toBe('?');
  });

  it('sets the running head by venue', () => {
    expect(runningHead('ICLR 2027')).toBe('Under review as a conference paper at ICLR 2027');
    expect(runningHead('OpenAI Math')).toBe('Preprint in the OpenAI Math release');
    expect(runningHead('NeurIPS 2027')).toBe('Under review as a conference paper at NeurIPS 2027');
  });
});
