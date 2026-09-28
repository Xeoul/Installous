"use client";

import { useEffect, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Change } from "./Change";
import { money } from "@/lib/format";

const RANGES = ["1mo", "3mo", "6mo", "1y", "2y", "5y"] as const;
type Range = (typeof RANGES)[number];

interface Point {
  date: string;
  close: number;
}

export function PriceChart({ ticker, currency = "USD" }: { ticker: string; currency?: string }) {
  const [range, setRange] = useState<Range>("1y");
  const [data, setData] = useState<{ key: string; points: Point[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = `${ticker}:${range}`;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/history/${encodeURIComponent(ticker)}?range=${range}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "Failed to load prices");
        if (!cancelled) {
          setData({ key: `${ticker}:${range}`, points: body });
          setError(null);
        }
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [ticker, range]);

  const points = data?.key === key ? data.points : null;
  const first = points?.[0]?.close;
  const last = points?.[points.length - 1]?.close;
  const rangeReturn = first && last ? (last / first - 1) * 100 : null;
  const longRange = range === "2y" || range === "5y";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-text-2">
          {range} return <Change value={rangeReturn} className="ml-1 font-medium" />
        </div>
        <div className="flex gap-1" role="tablist" aria-label="Chart range">
          {RANGES.map((r) => (
            <button
              key={r}
              role="tab"
              aria-selected={r === range}
              onClick={() => setRange(r)}
              className={`rounded-md px-2.5 py-1 text-xs ${r === range ? "bg-surface-2 font-medium" : "text-text-2 hover:text-text"}`}
            >
              {r.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div className="h-72 w-full">
        {error ? (
          <div className="grid h-full place-items-center text-sm text-muted">{error}</div>
        ) : !points ? (
          <div className="h-full animate-pulse rounded-lg bg-surface-2" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: "var(--muted)", fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: "var(--border)" }}
                minTickGap={40}
                tickFormatter={(d: string) =>
                  new Date(d).toLocaleDateString("en-US", longRange ? { month: "short", year: "2-digit" } : { month: "short", day: "numeric" })
                }
              />
              <YAxis
                domain={["auto", "auto"]}
                tick={{ fill: "var(--muted)", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={56}
                tickFormatter={(v: number) => v.toFixed(0)}
              />
              <Tooltip
                cursor={{ stroke: "var(--muted)", strokeDasharray: "3 3" }}
                contentStyle={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  color: "var(--text)",
                  fontSize: 12,
                }}
                labelFormatter={(d) => new Date(String(d)).toLocaleDateString("en-US", { dateStyle: "medium" })}
                formatter={(v) => [money(Number(v), currency), "Close"]}
              />
              <Area
                type="monotone"
                dataKey="close"
                stroke="var(--accent)"
                strokeWidth={2}
                fill="url(#priceFill)"
                activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
