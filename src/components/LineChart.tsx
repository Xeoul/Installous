"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { fmtDate } from "@/lib/dates";

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  /** SVG dash pattern for reference lines, e.g. "5 4". */
  dash?: string;
}

type Row = { date: string } & Record<string, number | string | undefined>;

const PAD = { top: 8, right: 8, bottom: 22 };

/** Round a raw step up to 1, 2, 2.5 or 5 times a power of ten, for tidy axis ticks. */
function niceStep(raw: number): number {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow;
}

/**
 * A small multi-series line chart: grid, axes, a crosshair with values that
 * follows the cursor or finger (and the arrow keys), and a screen-reader
 * table. Plain SVG, no chart library.
 */
export function LineChart({
  data,
  series,
  formatY,
  formatX,
  formatValue = formatY,
  yAxisWidth = 48,
  yFloor,
  height = 256,
  caption,
}: {
  data: Row[];
  series: LineSeries[];
  formatY: (v: number) => string;
  formatX: (date: string) => string;
  formatValue?: (v: number) => string;
  yAxisWidth?: number;
  /** Don't let the axis go below this (e.g. -100 for percent returns). */
  yFloor?: number;
  height?: number;
  caption: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geom = useMemo(() => {
    if (width === 0 || data.length < 2) return null;
    let lo = Infinity;
    let hi = -Infinity;
    for (const row of data) {
      for (const s of series) {
        const v = row[s.key];
        if (typeof v === "number") {
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
      }
    }
    if (!Number.isFinite(lo)) return null;
    if (yFloor !== undefined) lo = Math.max(yFloor, lo);
    if (hi === lo) {
      const pad = Math.abs(hi) * 0.01 || 1;
      lo -= pad;
      hi += pad;
    }
    const step = niceStep((hi - lo) / 4);
    const y0 = Math.floor(lo / step) * step;
    const y1 = Math.ceil(hi / step) * step;
    const ticks: number[] = [];
    for (let v = y0; v <= y1 + step / 2; v += step) ticks.push(Math.round(v / step) * step);

    const left = yAxisWidth;
    const plotW = Math.max(1, width - left - PAD.right);
    const plotH = height - PAD.top - PAD.bottom;
    const xOf = (i: number) => left + (i / (data.length - 1)) * plotW;
    const yOf = (v: number) => PAD.top + (1 - (v - y0) / (y1 - y0)) * plotH;

    const paths = series.map((s) => {
      let d = "";
      data.forEach((row, i) => {
        const v = row[s.key];
        if (typeof v === "number") d += `${d ? "L" : "M"}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`;
      });
      return d;
    });

    // Evenly spaced date labels, about one per 90px, without repeats.
    const count = Math.max(2, Math.floor(plotW / 90));
    const xTicks: { i: number; label: string }[] = [];
    for (let k = 0; k < count; k++) {
      const i = Math.round((k / (count - 1)) * (data.length - 1));
      const label = formatX(data[i].date);
      if (!xTicks.some((t) => t.label === label)) xTicks.push({ i, label });
    }
    return { left, plotW, plotH, xOf, yOf, ticks, paths, xTicks };
  }, [data, series, width, height, yAxisWidth, yFloor, formatX]);

  const indexAt = (clientX: number) => {
    if (!geom || !boxRef.current) return null;
    const x = clientX - boxRef.current.getBoundingClientRect().left - geom.left;
    return Math.max(0, Math.min(data.length - 1, Math.round((x / geom.plotW) * (data.length - 1))));
  };

  const row = hover !== null ? data[hover] : null;
  const hx = geom && hover !== null ? geom.xOf(hover) : null;

  return (
    <div>
      <div
        ref={boxRef}
        className="relative w-full touch-pan-y select-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent"
        style={{ height }}
        tabIndex={0}
        role="img"
        aria-label={caption}
        onPointerMove={(e) => setHover(indexAt(e.clientX))}
        onPointerDown={(e) => setHover(indexAt(e.clientX))}
        onPointerLeave={() => setHover(null)}
        onPointerUp={(e) => e.pointerType !== "mouse" && setHover(null)}
        onBlur={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            const step = e.key === "ArrowLeft" ? -1 : 1;
            setHover((h) => Math.max(0, Math.min(data.length - 1, (h ?? data.length - 1) + step)));
          } else if (e.key === "Escape") setHover(null);
        }}
      >
        {geom && (
          <svg width={width} height={height} className="block" aria-hidden>
            {geom.ticks.map((v) => (
              <g key={v}>
                <line x1={geom.left} x2={width - PAD.right} y1={geom.yOf(v)} y2={geom.yOf(v)} stroke="var(--grid)" />
                <text x={geom.left - 6} y={geom.yOf(v)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted)">
                  {formatY(v)}
                </text>
              </g>
            ))}
            <line x1={geom.left} x2={width - PAD.right} y1={height - PAD.bottom} y2={height - PAD.bottom} stroke="var(--border)" />
            {geom.xTicks.map((t, k) => (
              <text
                key={t.i}
                x={geom.xOf(t.i)}
                y={height - 6}
                fontSize={11}
                fill="var(--muted)"
                textAnchor={k === 0 ? "start" : k === geom.xTicks.length - 1 ? "end" : "middle"}
              >
                {t.label}
              </text>
            ))}
            {/* Reference lines first so the main series draws on top. */}
            {series
              .map((s, k) => ({ s, d: geom.paths[k] }))
              .reverse()
              .map(({ s, d }) => (
                <path key={s.key} d={d} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dash} strokeLinejoin="round" />
              ))}
            {hx !== null && row && (
              <>
                <line x1={hx} x2={hx} y1={PAD.top} y2={height - PAD.bottom} stroke="var(--muted)" strokeDasharray="3 3" />
                {series.map((s) =>
                  typeof row[s.key] === "number" ? (
                    <circle key={s.key} cx={hx} cy={geom.yOf(row[s.key] as number)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
                  ) : null,
                )}
              </>
            )}
          </svg>
        )}
        {geom && hx !== null && row && (
          <div
            className="pointer-events-none absolute top-1 z-10 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs shadow-sm"
            style={hx > width / 2 ? { right: width - hx + 10 } : { left: hx + 10 }}
          >
            <div className="mb-0.5 text-text-2">{fmtDate(row.date)}</div>
            {series.map((s) =>
              typeof row[s.key] === "number" ? (
                <div key={s.key} className="num flex items-center gap-1.5 whitespace-nowrap">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
                  {s.label} <span className="font-medium">{formatValue(row[s.key] as number)}</span>
                </div>
              ) : null,
            )}
          </div>
        )}
      </div>
      {/* Tables ignore sr-only's 1px width, so the wrapper does the hiding. */}
      <div className="sr-only">
        <table>
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th>Date</th>
              {series.map((s) => (
                <th key={s.key}>{s.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.date}>
                <td>{r.date}</td>
                {series.map((s) => (
                  <td key={s.key}>{typeof r[s.key] === "number" ? formatValue(r[s.key] as number) : "—"}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
