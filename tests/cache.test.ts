import { describe, expect, it, vi } from "vitest";
import { createCache } from "@/lib/cache";

describe("createCache", () => {
  it("shares one in-flight load between concurrent callers", async () => {
    const { cached } = createCache();
    const load = vi.fn(async () => 42);
    const [a, b] = await Promise.all([cached("k", 1000, load), cached("k", 1000, load)]);
    expect([a, b]).toEqual([42, 42]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("reloads after the TTL", async () => {
    let t = 0;
    const { cached } = createCache({ now: () => t });
    const load = vi.fn(async () => t);
    await cached("k", 100, load);
    t = 50;
    await cached("k", 100, load);
    expect(load).toHaveBeenCalledTimes(1);
    t = 150;
    expect(await cached("k", 100, load)).toBe(150);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("doesn't cache failures", async () => {
    const { cached } = createCache();
    const load = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce("ok");
    await expect(cached("k", 1000, load)).rejects.toThrow("down");
    expect(await cached("k", 1000, load)).toBe("ok");
  });

  it("keeps at most maxEntries, dropping the oldest", async () => {
    const cache = createCache({ maxEntries: 3 });
    for (const k of ["a", "b", "c", "d", "e"]) await cache.cached(k, 60_000, async () => k);
    expect(cache.size).toBe(3);
    const load = vi.fn(async () => "a2");
    expect(await cache.cached("a", 60_000, load)).toBe("a2"); // evicted, so loaded again
    expect(load).toHaveBeenCalledTimes(1);
  });
});
