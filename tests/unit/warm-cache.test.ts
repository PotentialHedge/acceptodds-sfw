import { describe, expect, it, vi } from 'vitest';
import { WarmCache } from '@/server/warm-cache';

describe('WarmCache', () => {
  it('serves a warm entry until a refresh is ready, and through a write', async () => {
    const cache = new WarmCache(10, 1_000);
    await cache.refresh('k', async () => 'old');
    let release!: (v: string) => void;
    const refreshing = cache.refresh('k', () => new Promise<string>((r) => (release = r)));
    expect(await cache.get('k', async () => 'cold')).toBe('old');
    const stale = vi.fn();
    cache.onStale(stale);
    cache.written();
    expect(stale).toHaveBeenCalledOnce();
    expect(await cache.get('k', async () => 'cold')).toBe('old');
    release('new');
    await refreshing;
    expect(await cache.get('k', async () => 'cold')).toBe('new');
  });

  it('keeps the old value when a refresh fails', async () => {
    const cache = new WarmCache(10, 1_000);
    await cache.refresh('k', async () => 'old');
    await expect(cache.refresh('k', async () => Promise.reject(new Error('down')))).rejects.toThrow('down');
    expect(await cache.get('k', async () => 'cold')).toBe('old');
  });

  it('drops a cold entry on a write, past its age, or to make room, never a warm one', async () => {
    vi.useFakeTimers();
    try {
      const cache = new WarmCache(2, 1_000);
      await cache.refresh('warm', async () => 'w');
      expect(await cache.get('a', async () => 'a1')).toBe('a1');
      expect(await cache.get('a', async () => 'a2')).toBe('a1');
      vi.advanceTimersByTime(1_001);
      expect(await cache.get('a', async () => 'a3')).toBe('a3');
      cache.written();
      expect(await cache.get('a', async () => 'a4')).toBe('a4');
      await cache.get('b', async () => 'b1');
      expect(await cache.get('a', async () => 'a5')).toBe('a5');
      expect(await cache.get('warm', async () => 'cold')).toBe('w');
    } finally {
      vi.useRealTimers();
    }
  });
});
