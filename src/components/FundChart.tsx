"use client";

import { fmtMonthDay, fmtMonthYear } from "@/lib/dates";
import { money } from "@/lib/format";
import { LineChart, type LineSeries } from "./LineChart";

export type ChartSeries = LineSeries;

/** The fund vs the S&P 500 (dashed and muted, since it's the reference line). */
export const FUND_SERIES: ChartSeries[] = [
  { key: "equity", label: "AI Fund", color: "var(--accent)" },
  { key: "benchmark", label: "S&P 500 (SPY)", color: "var(--muted)", dash: "5 4" },
];

const thousands = (v: number) => `$${(v / 1000).toFixed(v !== 0 && Math.abs(v) < 10_000 ? 1 : 0)}k`;
const dollars = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;

/** Value-over-time chart on one dollar axis, with a legend, scrubbable values and a screen-reader table. */
export function FundChart({
  history,
  series = FUND_SERIES,
  longRange = false,
  caption = "AI Fund value vs S&P 500 by day",
  fineAxis = false,
}: {
  history: { date: string }[];
  series?: ChartSeries[];
  longRange?: boolean;
  caption?: string;
  /** Label the value axis in whole dollars, for values that move by less than $1k. */
  fineAxis?: boolean;
}) {
  if (history.length < 2) {
    return (
      <div className="grid h-64 place-items-center rounded-lg bg-surface-2 px-6 text-center text-sm text-text-2">
        The performance chart starts after the fund&apos;s second trading day. Check back tomorrow.
      </div>
    );
  }
  const last = history[history.length - 1] as Record<string, unknown>;
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
      <LineChart
        data={history}
        series={series}
        formatX={longRange ? fmtMonthYear : fmtMonthDay}
        formatY={fineAxis ? dollars : thousands}
        formatValue={(v) => money(v)}
        yAxisWidth={fineAxis ? 64 : 48}
        caption={caption}
      />
    </div>
  );
}
