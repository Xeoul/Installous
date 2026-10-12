"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CHART_RANGES, formatPointTime, nearestIndex, type ChartData, type ChartRange } from "@/lib/chart";
import { DEMO, getHistory } from "@/lib/client-data";
import { money } from "@/lib/format";
import { MarketHours, sessionLabel } from "@/lib/live/pricing";
import { useLivePrice, useLiveTail } from "@/lib/live/useLivePrice";
import { RollingNumber } from "./RollingNumber";

const HEIGHT = 280;
const PAD_Y = 16;

/** Live ticks closer together than this are merged into one chart point. */
const LIVE_BUCKET_MS = 5_000;
/** A streamed price older than this no longer counts as live. */
const STALE_MS = 2 * 60_000;

/**
 * Robinhood-style price chart: the big price above the chart follows your cursor
 * (or finger) as you scrub, with digits that roll to each new value, and the line
 * is green or red depending on whether the stock is up or down over the range.
 * While the market is open, streamed prices extend the 1D line every second.
 */
export function StockChart({ ticker, currency = "USD" }: { ticker: string; currency?: string }) {
  const [range, setRange] = useState<ChartRange>("1d");
  const [data, setData] = useState<ChartData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const live = useLivePrice(ticker);
  const liveTail = useLiveTail(ticker, LIVE_BUCKET_MS);
  const [now, setNow] = useState(() => Date.now());

  // Re-check every few seconds whether the stream has gone quiet (market closed, connection lost).
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  // Load data, and keep the 1D chart live while the page is open.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const body = await getHistory(ticker, range);
        if (!cancelled) {
          setData(body);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    };
    void load();
    // The demo snapshot only changes when it's republished, so there's nothing to poll.
    const timer = range === "1d" && !DEMO ? setInterval(load, 60_000) : undefined;
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [ticker, range]);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const current = data && data.range === range && data.ticker === ticker ? data : null;
  const liveRegular = !!live && live.marketHours === MarketHours.Regular && Math.max(now, live.time) - live.time < STALE_MS;

  const points = useMemo(() => {
    const base = current?.points ?? [];
    if (current?.range !== "1d" || !base.length) return base;
    const lastBar = base[base.length - 1].t;
    const end = current.sessionEnd ?? Infinity;
    // Only ticks after the last loaded bar and inside the session the chart shows.
    const tail = liveTail.filter((p) => p.t > lastBar && p.t <= end);
    return tail.length ? [...base, ...tail] : base;
  }, [current, liveTail]);
  const extendedLive = current?.range === "1d" && points.length > (current?.points.length ?? 0);

  // 1D is plotted on a real clock (so the line stops mid-chart during the session);
  // longer ranges are plotted by index so nights and weekends don't leave gaps.
  const geom = useMemo(() => {
    if (!current || points.length < 2 || width === 0) return null;
    const timeBased = current.range === "1d";
    const x0 = timeBased ? Math.min(current.sessionStart ?? points[0].t, points[0].t) : 0;
    const x1 = timeBased
      ? Math.max(current.sessionEnd ?? points[points.length - 1].t, points[points.length - 1].t)
      : points.length - 1;
    const xOf = (i: number) => ((timeBased ? points[i].t : i) - x0) / (x1 - x0 || 1) * width;
    const values = points.map((p) => p.close);
    if (timeBased) values.push(current.baseline);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pad = (hi - lo) * 0.08 || hi * 0.01;
    const yOf = (v: number) => PAD_Y + (1 - (v - (lo - pad)) / (hi - lo + 2 * pad)) * (HEIGHT - 2 * PAD_Y);
    const path = points.map((p, i) => `${i ? "L" : "M"}${xOf(i).toFixed(1)},${yOf(p.close).toFixed(1)}`).join("");
    const indexAt = (px: number) => {
      const frac = Math.max(0, Math.min(1, px / width));
      if (!timeBased) return Math.round(frac * (points.length - 1));
      return nearestIndex(points, x0 + frac * (x1 - x0));
    };
    return { xOf, yOf, path, indexAt, timeBased };
  }, [current, points, width]);

  const last = points[points.length - 1];
  const baseline = current?.baseline;
  const up = last && baseline !== undefined ? last.close >= baseline : true;
  const tone = up ? "var(--up)" : "var(--down)";
  const rangeInfo = CHART_RANGES.find((r) => r.key === range)!;

  // The headline number: the scrubbed point, else the live price while the market's
  // open, else the last close in the chart.
  let headPrice: number | null = null;
  let diff: number | null = null;
  if (hover !== null && points[hover]) {
    headPrice = points[hover].close;
    diff = baseline !== undefined ? headPrice - baseline : null;
  } else if (liveRegular && live) {
    headPrice = live.price;
    // If the loaded 1D chart is from an earlier session, use the stream's own change for today.
    diff = range === "1d" && !extendedLive && live.change !== null ? live.change : baseline !== undefined ? headPrice - baseline : null;
  } else if (last) {
    headPrice = last.close;
    diff = baseline !== undefined ? headPrice - baseline : null;
  }
  const diffPct = diff !== null && headPrice !== null && headPrice - diff !== 0 ? (diff / (headPrice - diff)) * 100 : null;
  const shownTime = hover !== null && points[hover] ? points[hover].t : null;

  // Outside regular hours, Robinhood shows the extended-hours price under the headline.
  const extendedLabel = live && !liveRegular && now - live.time < 30 * 60_000 ? sessionLabel(live.marketHours) : null;

  const onPointer = useCallback(
    (e: React.PointerEvent) => {
      if (!geom) return;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setHover(geom.indexAt(e.clientX - rect.left));
    },
    [geom],
  );

  const onKey = (e: React.KeyboardEvent) => {
    if (!points.length) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const step = e.key === "ArrowLeft" ? -1 : 1;
      setHover((h) => Math.max(0, Math.min(points.length - 1, (h ?? points.length - 1) + step)));
    } else if (e.key === "Escape") {
      setHover(null);
    }
  };

  const hx = hover !== null && geom ? geom.xOf(hover) : null;
  const hy = hover !== null && geom ? geom.yOf(points[hover].close) : null;

  return (
    <div>
      {/* Price header that tracks the cursor */}
      <div className="mb-4">
        <div className="text-4xl font-semibold tracking-tight">
          {headPrice !== null ? <RollingNumber value={money(headPrice, currency)} /> : "…"}
        </div>
        <div className="num mt-1 flex flex-wrap items-baseline gap-x-2 text-sm">
          {diff !== null && diffPct !== null ? (
            <span style={{ color: diff >= 0 ? "var(--up)" : "var(--down)" }} className="inline-flex items-baseline gap-1 font-medium">
              {diff >= 0 ? "▲" : "▼"}
              <RollingNumber value={`${money(Math.abs(diff), currency)} (${diffPct >= 0 ? "+" : ""}${diffPct.toFixed(2)}%)`} />
            </span>
          ) : (
            <span className="text-muted">—</span>
          )}
          <span className="text-text-2">{shownTime !== null ? formatPointTime(shownTime, range) : rangeInfo.period}</span>
          {liveRegular && shownTime === null && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-up" title="Streaming live prices">
              <span className="live-dot" aria-hidden /> Live
            </span>
          )}
        </div>
        {extendedLabel && live && shownTime === null && (
          <div className="num mt-1 flex flex-wrap items-baseline gap-x-2 text-sm text-text-2">
            <RollingNumber value={money(live.price, currency)} className="font-medium text-text" />
            {live.change !== null && live.changePercent !== null && (
              <span style={{ color: live.change >= 0 ? "var(--up)" : "var(--down)" }}>
                {live.change >= 0 ? "▲" : "▼"} {money(Math.abs(live.change), currency)} ({live.changePercent >= 0 ? "+" : ""}
                {live.changePercent.toFixed(2)}%)
              </span>
            )}
            <span>{extendedLabel}</span>
          </div>
        )}
      </div>

      {/* Chart */}
      <div
        ref={boxRef}
        className="relative w-full cursor-crosshair select-none outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-md"
        style={{ height: HEIGHT, touchAction: "pan-y" }}
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
        tabIndex={0}
        role="img"
        aria-label={
          last && diffPct !== null
            ? `${ticker} ${rangeInfo.period.toLowerCase()}: ${money(last.close, currency)}, ${diffPct >= 0 ? "up" : "down"} ${Math.abs(diffPct).toFixed(2)}%. Use arrow keys to scrub.`
            : `${ticker} price chart`
        }
      >
        {error ? (
          <div className="grid h-full place-items-center text-sm text-muted">{error}</div>
        ) : !geom ? (
          <div className="h-full animate-pulse rounded-lg bg-surface-2" />
        ) : (
          <>
            <svg width={width} height={HEIGHT} className="block overflow-visible">
              <defs>
                <clipPath id={`past-${ticker}`}>
                  <rect x={0} y={0} width={hx ?? width} height={HEIGHT} />
                </clipPath>
              </defs>
              {range === "1d" && baseline !== undefined && (
                <line
                  x1={0}
                  x2={width}
                  y1={geom.yOf(baseline)}
                  y2={geom.yOf(baseline)}
                  stroke="var(--muted)"
                  strokeWidth={1.5}
                  strokeDasharray="1 5"
                  strokeLinecap="round"
                />
              )}
              {/* Faded full line, then the solid part up to the cursor */}
              <path d={geom.path} fill="none" stroke={tone} strokeWidth={2} strokeLinejoin="round" opacity={hx !== null ? 0.3 : 1} />
              {hx !== null && (
                <path d={geom.path} fill="none" stroke={tone} strokeWidth={2} strokeLinejoin="round" clipPath={`url(#past-${ticker})`} />
              )}
              {hx !== null && hy !== null ? (
                <>
                  <line x1={hx} x2={hx} y1={0} y2={HEIGHT} stroke="var(--muted)" strokeWidth={1} />
                  <circle cx={hx} cy={hy} r={5} fill={tone} stroke="var(--surface)" strokeWidth={2} />
                </>
              ) : (
                range === "1d" &&
                last && (
                  <circle cx={geom.xOf(points.length - 1)} cy={geom.yOf(last.close)} r={4} fill={tone} stroke="var(--surface)" strokeWidth={2}>
                    <animate attributeName="r" values="4;6;4" dur="2s" repeatCount="indefinite" />
                  </circle>
                )
              )}
            </svg>
            {range === "1d" && baseline !== undefined && hx === null && (
              <span
                className="pointer-events-none absolute right-0 -translate-y-full pb-0.5 text-[11px] text-muted"
                style={{ top: geom.yOf(baseline) }}
              >
                Prev close {money(baseline, currency)}
              </span>
            )}
          </>
        )}
      </div>

      {/* Range tabs */}
      <div className="mt-4 flex gap-1 border-b border-border" role="tablist" aria-label="Chart range">
        {CHART_RANGES.map((r) => {
          const active = r.key === range;
          return (
            <button
              key={r.key}
              role="tab"
              aria-selected={active}
              onClick={() => {
                setRange(r.key);
                setHover(null);
              }}
              className={`-mb-px border-b-2 px-3 py-2 text-xs font-semibold ${active ? "" : "border-transparent text-text-2 hover:text-text"}`}
              style={active ? { color: tone, borderColor: tone } : undefined}
            >
              {r.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
