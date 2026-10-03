"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { money } from "@/lib/format";

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
  dash?: string;
}

/** The fund vs the S&P 500 (dashed and muted, since it's the reference line). */
export const FUND_SERIES: ChartSeries[] = [
  { key: "equity", label: "AI Fund", color: "var(--accent)" },
  { key: "benchmark", label: "S&P 500 (SPY)", color: "var(--muted)", dash: "5 4" },
];

/** Value-over-time chart on one dollar axis, with a legend, hover values and a screen-reader table. */
export function FundChart({
  history,
  series = FUND_SERIES,
  longRange = false,
  caption = "AI Fund value vs S&P 500 by day",
}: {
  history: { date: string }[];
  series?: ChartSeries[];
  longRange?: boolean;
  caption?: string;
}) {
  const fmtDate = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString(
      "en-US",
      longRange ? { month: "short", year: "numeric", timeZone: "UTC" } : { month: "short", day: "numeric", timeZone: "UTC" },
    );

  if (history.length < 2) {
    return (
      <div className="grid h-64 place-items-center rounded-lg bg-surface-2 px-6 text-center text-sm text-text-2">
        The performance chart starts after the fund&apos;s second trading day. Check back tomorrow.
      </div>
    );
  }
  const last = history[history.length - 1] as unknown as Record<string, number>;
  const labelOf = new Map(series.map((s) => [s.key, s.label]));
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-2" aria-hidden>
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <svg width="20" height="4" className="shrink-0">
              <line x1="0" x2="20" y1="2" y2="2" stroke={s.color} strokeWidth="2" strokeDasharray={s.dash} />
            </svg>
            {s.label} {money(Number(last[s.key]))}
          </span>
        ))}
      </div>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={history} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={fmtDate}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              minTickGap={40}
            />
            <YAxis
              domain={["auto", "auto"]}
              tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={48}
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
              labelFormatter={(d) =>
                new Date(`${String(d)}T12:00:00Z`).toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" })
              }
              formatter={(v, name) => [money(Number(v)), labelOf.get(String(name)) ?? String(name)]}
            />
            {/* Reference lines first so the fund draws on top. */}
            {[...series].reverse().map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={2}
                strokeDasharray={s.dash}
                dot={false}
                activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
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
          {history.map((p) => (
            <tr key={p.date}>
              <td>{p.date}</td>
              {series.map((s) => (
                <td key={s.key}>{money(Number((p as unknown as Record<string, number>)[s.key]))}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
