"use client";

import Link from "next/link";
import { Card } from "@/components/Card";
import { FUND_SERIES, FundChart, type ChartSeries } from "@/components/FundChart";
import type { BacktestView } from "@/lib/backtest";
import { stockHref } from "@/lib/client-data";
import { signedPct } from "@/lib/format";
import type { PerfStats, PositionResult, TradeStats } from "@/lib/fund-stats";

const pct = (x: number | null) => (x === null ? "—" : signedPct(x));

function PerfTable({ columns }: { columns: { label: string; stats: PerfStats }[] }) {
  const rows: { label: string; hint?: string; value: (s: PerfStats) => string }[] = [
    { label: "Total return", value: (s) => pct(s.totalReturnPercent) },
    { label: "Yearly return (CAGR)", hint: "Shown once there's a year of history", value: (s) => pct(s.cagrPercent) },
    { label: "Worst drop from a peak", value: (s) => pct(s.maxDrawdownPercent) },
    { label: "Volatility (annualized)", value: (s) => (s.volatilityPercent === null ? "—" : `${s.volatilityPercent.toFixed(1)}%`) },
  ];
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-border text-left text-xs text-text-2">
          <tr>
            <th className="px-5 py-2 font-medium" />
            {columns.map((c) => (
              <th key={c.label} className="px-5 py-2 text-right font-medium">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="px-5 py-2 text-text-2" title={r.hint}>
                {r.label}
              </td>
              {columns.map((c) => (
                <td key={c.label} className="num px-5 py-2 text-right">
                  {r.value(c.stats)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Position({ label, p }: { label: string; p: PositionResult | null }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm font-medium">
        {p ? (
          <>
            <Link href={stockHref(p.ticker)} className="hover:text-accent">
              {p.ticker}
            </Link>{" "}
            <span className={`num ${p.returnPercent >= 0 ? "text-up" : "text-down"}`}>
              {p.returnPercent >= 0 ? "▲" : "▼"} {signedPct(p.returnPercent)}
            </span>
            <span className="text-xs font-normal text-muted"> · {p.open ? "still held" : `held ${p.days} days`}</span>
          </>
        ) : (
          "—"
        )}
      </dd>
    </div>
  );
}

function TradingStats({ s }: { s: TradeStats }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
      <div>
        <dt className="text-xs text-muted">Trades</dt>
        <dd className="num text-sm font-medium">{s.trades}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted">Positions closed</dt>
        <dd className="num text-sm font-medium">{s.closedPositions}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted">Win rate (closed)</dt>
        <dd className="num text-sm font-medium">{s.winRatePercent === null ? "—" : `${s.winRatePercent}%`}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted">Average hold</dt>
        <dd className="num text-sm font-medium">{s.avgHoldingDays === null ? "—" : `${s.avgHoldingDays} days`}</dd>
      </div>
      <Position label="Best position" p={s.best} />
      <Position label="Worst position" p={s.worst} />
    </dl>
  );
}

export function TrackRecord({ fund, benchmark, trading }: { fund: PerfStats; benchmark: PerfStats; trading: TradeStats }) {
  return (
    <Card title="Track record">
      <PerfTable columns={[{ label: "AI Fund", stats: fund }, { label: "S&P 500", stats: benchmark }]} />
      <div className="mt-5 border-t border-border pt-4">
        <TradingStats s={trading} />
      </div>
    </Card>
  );
}

const BACKTEST_SERIES: ChartSeries[] = [
  ...FUND_SERIES.slice(0, 1).map((s) => ({ ...s, label: "Backtest (momentum rules)" })),
  { key: "universe", label: "Same 50 stocks, held", color: "var(--series-2)", dash: "2 3" },
  FUND_SERIES[1],
];

export function Backtest({ bt }: { bt: BacktestView }) {
  const years = (d: string) => new Date(`${d}T12:00:00Z`).getUTCFullYear();
  return (
    <Card title={`Backtest: the same rules over ${years(bt.endDate) - years(bt.startDate)} years`}>
      <p className="mb-4 max-w-3xl text-sm text-text-2">
        The fund&apos;s rules replayed day by day since{" "}
        {new Date(`${bt.startDate}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}.
        Free data only has today&apos;s company fundamentals, so this version ranks stocks by the{" "}
        <strong className="text-text">momentum factor alone</strong>, the part of the score that can be rebuilt from past
        prices. Each day&apos;s decisions use only prices up to the day before.
      </p>
      <FundChart history={bt.history} series={BACKTEST_SERIES} longRange caption="Backtest value by week" />

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PerfTable
          columns={[
            { label: "Backtest", stats: bt.stats.fund },
            { label: "Same stocks", stats: bt.stats.universe },
            { label: "S&P 500", stats: bt.stats.benchmark },
          ]}
        />
        <div className="-mx-5 overflow-x-auto lg:mx-0">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-text-2">
              <tr>
                <th className="px-5 py-2 font-medium lg:px-3">Year</th>
                <th className="px-3 py-2 text-right font-medium">Backtest</th>
                <th className="px-3 py-2 text-right font-medium">Same stocks</th>
                <th className="px-5 py-2 text-right font-medium lg:px-3">S&amp;P 500</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {bt.years.map((y) => (
                <tr key={y.year}>
                  <td className="num px-5 py-2 text-text-2 lg:px-3">
                    {y.year}
                    {y.partial && <span className="text-muted"> (part)</span>}
                  </td>
                  <td className="num px-3 py-2 text-right">{signedPct(y.fundPercent)}</td>
                  <td className="num px-3 py-2 text-right">{signedPct(y.universePercent)}</td>
                  <td className="num px-5 py-2 text-right lg:px-3">{signedPct(y.benchmarkPercent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-5 border-t border-border pt-4">
        <TradingStats s={bt.stats.trading} />
      </div>

      <div className="mt-5 rounded-xl bg-surface-2 p-4 text-sm text-text-2">
        <p className="font-medium text-text">Read this before trusting the numbers</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <strong className="text-text">Hindsight in the stock list.</strong> The {bt.universeSize} stocks are today&apos;s
            large caps, so they&apos;re companies that already did well. Any strategy limited to them looks good: the
            orange line (buying all of them and holding) shows how much of the result comes from the list alone.
          </li>
          <li>
            <strong className="text-text">Momentum only.</strong> The live fund also uses value, quality, growth and analyst
            sentiment, which this can&apos;t test. It shows how the rules behave, not how the live fund will do.
          </li>
          <li>Simulated fills at daily closing prices with a 0.05% trading cost, no taxes, and no dividends on any line.</li>
        </ul>
      </div>
    </Card>
  );
}
