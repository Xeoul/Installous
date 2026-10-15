"use client";

import { useSyncExternalStore } from "react";
import { marketStatus, opensLabel, untilLabel } from "@/lib/market-hours";

// The clock reads the time after hydration (the static page can't know it),
// re-rendering every 20 seconds.
const subscribe = (cb: () => void) => {
  const id = setInterval(cb, 20_000);
  return () => clearInterval(id);
};
const snapshot = () => Math.floor(Date.now() / 20_000);

/** Whether the US market is open, and how long until it closes or opens. */
export function MarketClock() {
  const tick = useSyncExternalStore(subscribe, snapshot, () => null);
  if (tick === null) return <span className="w-24 shrink-0" aria-hidden />;
  const now = new Date();
  const { open, next } = marketStatus(now);
  const full = open ? `Open · closes in ${untilLabel(next.getTime() - now.getTime())}` : `Closed · opens ${opensLabel(next, now)} PT`;
  return (
    <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-text-2" title={`US market ${full.toLowerCase()} (Pacific time)`} aria-label={`US market ${full.toLowerCase()}`}>
      {open ? <span className="live-dot" aria-hidden /> : <span className="h-2 w-2 rounded-full bg-muted" aria-hidden />}
      {/* Narrower screens get the short form. */}
      <span className="lg:hidden">{open ? `Open · ${untilLabel(next.getTime() - now.getTime())}` : `Opens ${opensLabel(next, now).replace("tomorrow ", "")} PT`}</span>
      <span className="hidden lg:inline">{full}</span>
    </span>
  );
}
