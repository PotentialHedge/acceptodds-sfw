import { describe, expect, it } from 'vitest';
import { isBot, newBucket, parseBucket, splitShare } from '@/lib/split';

describe('split test', () => {
  it('reads a bucket 0–99 and nothing else', () => {
    expect(parseBucket('0')).toBe(0);
    expect(parseBucket('99')).toBe(99);
    expect(parseBucket('100')).toBeNull();
    expect(parseBucket('-1')).toBeNull();
    expect(parseBucket('x')).toBeNull();
    expect(parseBucket(undefined)).toBeNull();
  });
  it('makes buckets in range', () => {
    for (let i = 0; i < 200; i++) expect(parseBucket(String(newBucket()))).not.toBeNull();
  });
  it('reads the share as a percentage, 0 when unset or garbage', () => {
    expect(splitShare(undefined)).toBe(0);
    expect(splitShare('abc')).toBe(0);
    expect(splitShare('10')).toBe(10);
    expect(splitShare('250')).toBe(100);
  });
  it('tells crawlers from browsers', () => {
    expect(isBot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true);
    expect(isBot('Twitterbot/1.0')).toBe(true);
    expect(isBot(null)).toBe(true);
    expect(
      isBot(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      ),
    ).toBe(false);
    expect(
      isBot(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe(false);
  });
});
