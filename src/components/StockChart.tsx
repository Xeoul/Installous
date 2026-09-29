"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CHART_RANGES, formatPointTime, nearestIndex, type ChartData, type ChartRange } from "@/lib/chart";
import { DEMO, getHistory } from "@/lib/client-data";
import { money } from "@/lib/format";

const HEIGHT = 280;
const PAD_Y = 16;

/**
 * Robinhood-style price chart: the big price above the chart follows your cursor
 * (or finger) as you scrub, and the line is green or red depending on whether the
 * stock is up or down over the selected range.
 */
export function StockChart({ ticker, currency = "USD" }: { ticker: string; currency?: string }) {
  const [range, setRange] = useState<ChartRange>("1d");
  const [data, setData] = useState<ChartData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

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
  const points = useMemo(() => current?.points ?? [], [current]);

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
  const shown = hover !== null ? points[hover] : last;
  const baseline = current?.baseline;
  const up = last && baseline !== undefined ? last.close >= baseline : true;
  const tone = up ? "var(--up)" : "var(--down)";
  const diff = shown && baseline !== undefined ? shown.close - baseline : null;
  const diffPct = diff !== null && baseline ? (diff / baseline) * 100 : null;
  const rangeInfo = CHART_RANGES.find((r) => r.key === range)!;

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
        <div className="num text-4xl font-semibold tracking-tight">{shown ? money(shown.close, currency) : "…"}</div>
        <div className="num mt-1 flex flex-wrap items-baseline gap-x-2 text-sm">
          {diff !== null && diffPct !== null ? (
            <span style={{ color: diff >= 0 ? "var(--up)" : "var(--down)" }} className="font-medium">
              {diff >= 0 ? "▲" : "▼"} {money(Math.abs(diff), currency)} ({diffPct >= 0 ? "+" : ""}
              {diffPct.toFixed(2)}%)
            </span>
          ) : (
            <span className="text-muted">—</span>
          )}
          <span className="text-text-2">
            {hover !== null && shown ? formatPointTime(shown.t, range) : rangeInfo.period}
          </span>
        </div>
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
