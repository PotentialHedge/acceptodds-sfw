/**
 * Reads kept warm by a background refresh, so nobody waits on them: the home page's example searches
 * (`lib/search-examples.ts`), which visitors are invited to click. Unlike `ReadCache`, a warm entry is
 * never dropped to be recomputed by a visitor: `refresh` swaps the new value in once it is ready, and the
 * old one is served meanwhile. An entry nobody warms (an example on another venue, or page 2) is an
 * ordinary cached read, `maxAgeMs` long, dropped by a write.
 */
export class WarmCache {
  private entries = new Map<string, { at: number; warm: boolean; value: Promise<unknown> }>();
  private stale: (() => void) | null = null;

  constructor(
    private readonly capacity: number,
    private readonly maxAgeMs: number,
  ) {}

  get<T>(key: string, compute: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && (hit.warm || Date.now() - hit.at < this.maxAgeMs)) return hit.value as Promise<T>;
    const entry = { at: Date.now(), warm: false, value: Promise.resolve().then(compute) };
    this.entries.set(key, entry);
    this.evict();
    entry.value.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
    return entry.value;
  }

  /** Computes `key` afresh and serves it from then on, warm. On an error the old value stays. */
  async refresh<T>(key: string, compute: () => Promise<T>): Promise<void> {
    const value = await compute();
    this.entries.set(key, { at: Date.now(), warm: true, value: Promise.resolve(value) });
    this.evict();
  }

  /** After a write: the cold entries go, and the warm ones are refreshed (by `onStale`'s callback). */
  written(): void {
    for (const [key, entry] of this.entries) if (!entry.warm) this.entries.delete(key);
    this.stale?.();
  }

  /** What `written` calls to refresh the warm entries: the warmer's, set when it starts. */
  onStale(callback: () => void): void {
    this.stale = callback;
  }

  clear(): void {
    this.entries.clear();
  }

  /** Oldest cold entry first; warm ones are few, a fixed set, and kept. */
  private evict(): void {
    if (this.entries.size <= this.capacity) return;
    for (const [key, entry] of this.entries) {
      if (!entry.warm) {
        this.entries.delete(key);
        return;
      }
    }
  }
}
