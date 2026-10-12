// One shared connection to Yahoo Finance's free streaming feed, used by every
// component on the page that wants live prices. It connects when the first
// ticker is watched, subscribes and unsubscribes as components come and go,
// reconnects with backoff, and disconnects shortly after nothing is watched.
// It runs in the browser, so it works the same in the full app and the
// static demo.
import { decodePricing, type PriceTick } from "./pricing";

const STREAM_URL = "wss://streamer.finance.yahoo.com/";
type Listener = (tick: PriceTick) => void;

export class PriceStream {
  constructor(private url = STREAM_URL) {}

  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private last = new Map<string, PriceTick>();
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  /** Watch a ticker; returns a function that stops watching. */
  watch(ticker: string, fn: Listener): () => void {
    const t = ticker.toUpperCase();
    let set = this.listeners.get(t);
    const isNew = !set;
    if (!set) {
      set = new Set();
      this.listeners.set(t, set);
    }
    set.add(fn);
    const cached = this.last.get(t);
    if (cached) fn(cached);
    clearTimeout(this.idleTimer);
    if (!this.ws) this.connect();
    else if (isNew) this.send({ subscribe: [t] });

    return () => {
      const s = this.listeners.get(t);
      if (!s) return;
      s.delete(fn);
      if (s.size === 0) {
        this.listeners.delete(t);
        this.send({ unsubscribe: [t] });
      }
      if (this.listeners.size === 0) {
        clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(() => this.disconnect(), 5_000);
      }
    };
  }

  private send(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private connect() {
    clearTimeout(this.retryTimer); // a watch during backoff connects now instead
    if (this.ws || typeof WebSocket === "undefined" || this.listeners.size === 0) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => this.send({ subscribe: [...this.listeners.keys()] });
    ws.onmessage = (e) => {
      if (typeof e.data !== "string") return;
      const tick = decodePricing(e.data);
      if (!tick) return;
      this.retry = 0;
      this.last.set(tick.ticker, tick);
      this.listeners.get(tick.ticker)?.forEach((fn) => fn(tick));
    };
    ws.onclose = () => {
      if (this.ws !== ws) return; // replaced or closed on purpose
      this.ws = null;
      if (this.listeners.size === 0) return;
      // 1s, 2s, 4s ... capped at 30s.
      const delay = Math.min(30_000, 1_000 * 2 ** this.retry++);
      this.retryTimer = setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => ws.close();
  }

  private disconnect() {
    clearTimeout(this.retryTimer);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }
}

let stream: PriceStream | null = null;

export function priceStream(): PriceStream {
  stream ??= new PriceStream();
  return stream;
}
