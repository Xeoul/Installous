"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { FundPoint } from "@/lib/fund";
import { money } from "@/lib/format";

const fmtDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** Fund value vs the same starting cash in SPY. One dollar axis; the benchmark is a dashed, muted line. */
export function FundChart({ history }: { history: FundPoint[] }) {
  if (history.length < 2) {
    return (
      <div className="grid h-64 place-items-center rounded-lg bg-surface-2 px-6 text-center text-sm text-text-2">
        The performance chart starts after the fund&apos;s second trading day. Check back tomorrow.
      </div>
    );
  }
  const last = history[history.length - 1];
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-text-2" aria-hidden>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-5 rounded bg-accent" /> AI Fund {money(last.equity)}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-5 border-t-2 border-dashed border-muted" /> S&amp;P 500 (SPY) {money(last.benchmark)}
        </span>
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
              labelFormatter={(d) => fmtDate(String(d))}
              formatter={(v, name) => [money(Number(v)), name === "equity" ? "AI Fund" : "S&P 500 (SPY)"]}
            />
            <Line type="monotone" dataKey="benchmark" stroke="var(--muted)" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="equity" stroke="var(--accent)" strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>AI Fund value vs S&amp;P 500 by day</caption>
        <thead>
          <tr>
            <th>Date</th>
            <th>AI Fund</th>
            <th>S&amp;P 500</th>
          </tr>
        </thead>
        <tbody>
          {history.map((p) => (
            <tr key={p.date}>
              <td>{p.date}</td>
              <td>{money(p.equity)}</td>
              <td>{money(p.benchmark)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
