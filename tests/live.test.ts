import { afterEach, describe, expect, it, vi } from "vitest";
import { decodePricing, MarketHours, type PriceTick } from "@/lib/live/pricing";
import { PriceStream } from "@/lib/live/stream";
import { addTick } from "@/lib/live/useLivePrice";

// A real message captured from wss://streamer.finance.yahoo.com/ (SPY, overnight session).
const SPY = "CgNTUFkVUjhDRBigt63mpWgqA1BDWDAUOARFu+iXPmUA1xNA2AEE9QIA1xNA/QK76Jc+";

/** Minimal protobuf encoder for PricingData, to build test messages. */
function encode(fields: { id: string; price: number; time: number; marketHours: number; change?: number; changePercent?: number }): string {
  const out: number[] = [];
  const varint = (n: number) => {
    while (n >= 128) {
      out.push((n % 128) + 128);
      n = Math.floor(n / 128);
    }
    out.push(n);
  };
  const float = (tag: number, v: number) => {
    varint((tag << 3) | 5);
    const b = new DataView(new ArrayBuffer(4));
    b.setFloat32(0, v, true);
    for (let i = 0; i < 4; i++) out.push(b.getUint8(i));
  };
  varint((1 << 3) | 2);
  const id = new TextEncoder().encode(fields.id);
  varint(id.length);
  out.push(...id);
  float(2, fields.price);
  varint(3 << 3);
  varint(fields.time * 2); // zigzag of a positive number
  varint(7 << 3);
  varint(fields.marketHours);
  if (fields.changePercent !== undefined) float(8, fields.changePercent);
  if (fields.change !== undefined) float(12, fields.change);
  return btoa(String.fromCharCode(...out));
}

describe("decodePricing", () => {
  it("decodes a captured Yahoo message", () => {
    const tick = decodePricing(SPY)!;
    expect(tick.ticker).toBe("SPY");
    expect(tick.price).toBeCloseTo(780.88, 2);
    expect(tick.marketHours).toBe(MarketHours.Overnight);
    expect(tick.time).toBeGreaterThan(Date.UTC(2025, 0, 1));
  });

  it("round-trips the fields the app uses", () => {
    const time = Date.UTC(2026, 9, 12, 15, 30);
    const tick = decodePricing(encode({ id: "AAPL", price: 231.5, time, marketHours: 1, change: -1.25, changePercent: -0.54 }))!;
    expect(tick).toMatchObject({ ticker: "AAPL", time, marketHours: MarketHours.Regular });
    expect(tick.price).toBeCloseTo(231.5, 4);
    expect(tick.change).toBeCloseTo(-1.25, 4);
    expect(tick.changePercent).toBeCloseTo(-0.54, 4);
  });

  it("returns null for garbage instead of throwing", () => {
    expect(decodePricing("not base64!!")).toBeNull();
    expect(decodePricing("")).toBeNull();
  });
});

describe("addTick", () => {
  const tick = (time: number, price: number, marketHours = MarketHours.Regular) =>
    ({ ticker: "X", time, price, marketHours, change: null, changePercent: null, previousClose: null }) as PriceTick;

  it("merges ticks inside a bucket and appends after it", () => {
    let pts = addTick([], tick(0, 10), 5000);
    pts = addTick(pts, tick(2000, 11), 5000);
    expect(pts).toEqual([{ t: 0, close: 11 }]);
    pts = addTick(pts, tick(6000, 12), 5000);
    expect(pts).toEqual([{ t: 0, close: 11 }, { t: 6000, close: 12 }]);
  });

  it("ignores out-of-order and extended-hours ticks", () => {
    const pts = addTick([], tick(10_000, 10), 5000);
    expect(addTick(pts, tick(5000, 9), 5000)).toBe(pts);
    expect(addTick(pts, tick(20_000, 9, MarketHours.PostMarket), 5000)).toBe(pts);
  });
});

describe("PriceStream", () => {
  class FakeSocket {
    static OPEN = 1;
    static all: FakeSocket[] = [];
    readyState = 0;
    sent: unknown[] = [];
    onopen?: () => void;
    onmessage?: (e: { data: string }) => void;
    onclose?: () => void;
    onerror?: () => void;
    constructor(public url: string) {
      FakeSocket.all.push(this);
    }
    send(s: string) {
      this.sent.push(JSON.parse(s));
    }
    close() {
      this.readyState = 3;
      this.onclose?.();
    }
    open() {
      this.readyState = 1;
      this.onopen?.();
    }
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    FakeSocket.all = [];
  });

  it("shares one socket, delivers ticks, and replays the last one to new watchers", () => {
    vi.stubGlobal("WebSocket", FakeSocket);
    const s = new PriceStream("ws://test");
    const a = vi.fn();
    s.watch("spy", a);
    const ws = FakeSocket.all[0];
    ws.open();
    expect(ws.sent).toEqual([{ subscribe: ["SPY"] }]);
    ws.onmessage!({ data: SPY });
    expect(a).toHaveBeenCalledWith(expect.objectContaining({ ticker: "SPY" }));

    const b = vi.fn();
    s.watch("SPY", b);
    expect(b).toHaveBeenCalledTimes(1);
    s.watch("QQQ", () => {});
    expect(FakeSocket.all).toHaveLength(1);
    expect(ws.sent).toContainEqual({ subscribe: ["QQQ"] });
  });

  it("reconnects with backoff, without doubling up when watched mid-backoff", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeSocket);
    const s = new PriceStream("ws://test");
    s.watch("SPY", () => {});
    FakeSocket.all[0].close();
    expect(FakeSocket.all).toHaveLength(1);
    s.watch("QQQ", () => {}); // connects right away
    expect(FakeSocket.all).toHaveLength(2);
    vi.advanceTimersByTime(60_000); // the old retry timer must not open a third
    expect(FakeSocket.all).toHaveLength(2);
  });

  it("disconnects a few seconds after the last watcher leaves", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeSocket);
    const s = new PriceStream("ws://test");
    const stop = s.watch("SPY", () => {});
    const ws = FakeSocket.all[0];
    ws.open();
    stop();
    expect(ws.sent).toContainEqual({ unsubscribe: ["SPY"] });
    vi.advanceTimersByTime(5_000);
    expect(ws.readyState).toBe(3);
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(1);
  });
});
