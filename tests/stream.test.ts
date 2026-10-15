import { afterEach, describe, expect, it, vi } from "vitest";
import { PriceStream, feedSymbol } from "@/lib/live/stream";

// A stand-in WebSocket that records what the stream sends and lets the test push messages.
class FakeSocket {
  static OPEN = 1;
  static last: FakeSocket;
  readyState = FakeSocket.OPEN;
  sent: unknown[] = [];
  onopen?: () => void;
  onmessage?: (e: { data: string }) => void;
  onclose?: () => void;
  onerror?: () => void;
  constructor(public url: string) {
    FakeSocket.last = this;
  }
  send(msg: string) {
    this.sent.push(JSON.parse(msg));
  }
  close() {}
}

describe("PriceStream", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("streams the S&P 500 index from the feed's ^SPX symbol", () => {
    expect(feedSymbol("^gspc")).toBe("^SPX");
    expect(feedSymbol("spy")).toBe("SPY");

    vi.stubGlobal("WebSocket", FakeSocket);
    const stream = new PriceStream("wss://test");
    const ticks: number[] = [];
    stream.watch("^GSPC", (t) => ticks.push(t.price));
    const ws = FakeSocket.last;
    ws.onopen!();
    expect(ws.sent).toEqual([{ subscribe: ["^SPX"] }]);

    // A real ^SPX tick from Yahoo's feed (S&P 500 at 7726.97).
    ws.onmessage!({ data: "CgReU1BYFcN38UUY4KCHhKhoKgNXQ0IwCTgBRXMP1T1lAHwAQdgBBPUCAHwAQf0Ccw/VPQ==" });
    expect(ticks).toHaveLength(1);
    expect(ticks[0]).toBeCloseTo(7726.97, 2);
  });
});
