"use client";

import { useEffect, useState } from "react";
import { MarketHours, type PriceTick } from "./pricing";
import { priceStream } from "./stream";

/** The latest streamed tick for a ticker (null until one arrives). */
export function useLivePrice(ticker: string | null | undefined, enabled = true): PriceTick | null {
  const [tick, setTick] = useState<{ ticker: string; tick: PriceTick } | null>(null);
  useEffect(() => {
    if (!ticker || !enabled) return;
    return priceStream().watch(ticker, (t) => setTick({ ticker: ticker.toUpperCase(), tick: t }));
  }, [ticker, enabled]);
  // Ignore a tick left over from a previous ticker.
  return tick && ticker && tick.ticker === ticker.toUpperCase() ? tick.tick : null;
}

/** Latest ticks for several tickers, keyed by ticker. */
export function useLivePrices(tickers: string[]): Record<string, PriceTick> {
  const [ticks, setTicks] = useState<Record<string, PriceTick>>({});
  const key = [...new Set(tickers.map((t) => t.toUpperCase()))].sort().join(",");
  useEffect(() => {
    if (!key) return;
    const stops = key.split(",").map((t) => priceStream().watch(t, (tick) => setTicks((m) => ({ ...m, [t]: tick }))));
    return () => stops.forEach((stop) => stop());
  }, [key]);
  return ticks;
}

export interface TailPoint {
  t: number;
  close: number;
}

/** Fold one regular-session tick into the tail, merging ticks within `bucketMs` into one point. */
export function addTick(points: TailPoint[], tick: PriceTick, bucketMs: number): TailPoint[] {
  if (tick.marketHours !== MarketHours.Regular) return points;
  const prev = points[points.length - 1];
  if (prev && tick.time < prev.t) return points;
  if (prev && tick.time - prev.t < bucketMs) return [...points.slice(0, -1), { t: prev.t, close: tick.price }];
  return [...points, { t: tick.time, close: tick.price }];
}

/** Regular-session ticks streamed since the page opened, one point per `bucketMs`. */
export function useLiveTail(ticker: string | null | undefined, bucketMs: number): TailPoint[] {
  const [tail, setTail] = useState<{ ticker: string; points: TailPoint[] } | null>(null);
  useEffect(() => {
    if (!ticker) return;
    const key = ticker.toUpperCase();
    return priceStream().watch(key, (tick) =>
      setTail((cur) => {
        const pts = cur?.ticker === key ? cur.points : [];
        const next = addTick(pts, tick, bucketMs);
        return next === pts && cur?.ticker === key ? cur : { ticker: key, points: next };
      }),
    );
  }, [ticker, bucketMs]);
  return tail && ticker && tail.ticker === ticker.toUpperCase() ? tail.points : EMPTY;
}

const EMPTY: TailPoint[] = [];
