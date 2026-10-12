// A small in-memory TTL cache for upstream data.
//
// - Concurrent requests for the same key share one in-flight load, so a page
//   load and the advisor asking for the same stock don't fetch it twice.
// - Failed loads aren't cached; the next caller retries.
// - It holds at most `maxEntries`, dropping expired and then oldest entries,
//   so a long-running server doesn't grow without bound (search queries
//   alone are effectively unlimited keys).

interface Entry {
  expires: number;
  value: Promise<unknown>;
}

export function createCache({ maxEntries = 2000, now = () => Date.now() } = {}) {
  const entries = new Map<string, Entry>();

  function evict() {
    const t = now();
    for (const [k, e] of entries) if (e.expires <= t) entries.delete(k);
    // Maps iterate in insertion order, so the first keys are the oldest.
    for (const k of entries.keys()) {
      if (entries.size <= maxEntries) break;
      entries.delete(k);
    }
  }

  return {
    cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
      const hit = entries.get(key);
      if (hit && hit.expires > now()) return hit.value as Promise<T>;
      const value = load();
      entries.set(key, { expires: now() + ttlMs, value });
      value.catch(() => {
        if (entries.get(key)?.value === value) entries.delete(key);
      });
      if (entries.size > maxEntries) evict();
      return value;
    },
    get size() {
      return entries.size;
    },
  };
}
