"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, Stat } from "@/components/Card";
import { Change } from "@/components/Change";
import { FundChart } from "@/components/FundChart";
import { Backtest, TrackRecord } from "@/components/FundSections";
import { ScoreBadge } from "@/components/ScoreBadge";
import type { BacktestView } from "@/lib/backtest";
import { getBacktest, getFund, stockHref } from "@/lib/client-data";
import { money, signedPct } from "@/lib/format";
import type { FundView } from "@/lib/fund";

const fmtDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export default function FundPage() {
  const [fund, setFund] = useState<FundView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [backtest, setBacktest] = useState<BacktestView | null>(null);

  useEffect(() => {
    // The backtest is optional: the section just doesn't show if it can't load.
    getBacktest().then(setBacktest).catch(() => {});
    getFund()
      .then(setFund)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="py-16 text-center">
        <h1 className="text-xl font-semibold">The AI Fund isn&apos;t available</h1>
        <p className="mt-2 text-text-2">{error}</p>
      </div>
    );
  }

  const r = fund?.rules;
  const vsBenchmark = fund ? fund.returnPercent - fund.benchmarkReturnPercent : null;
  const trades = fund ? (showAll ? fund.trades : fund.trades.slice(0, 15)) : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">AI Fund</h1>
            <span className="rounded-md border border-border bg-surface-2 px-2 py-0.5 text-xs font-medium text-text-2">
              Paper money
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-text-2">
            A {r ? money(r.startCash).replace(".00", "") : "$100,000"} simulated portfolio that picks stocks by rules
            alone, using the Installous score. No human picks. It&apos;s measured against simply buying the S&amp;P 500.
          </p>
        </div>
        {fund && (
          <div className="text-right text-xs text-muted">
            Started {fmtDate(fund.startDate)}
            <br />
            Values as of {fmtDate(fund.asOf)}
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Fund value" value={fund ? money(fund.equity) : "…"} sub={fund ? <Change value={fund.returnPercent} /> : null} />
        <Stat
          label="S&P 500 (same start)"
          value={fund ? money(fund.benchmarkValue) : "…"}
          sub={fund ? <Change value={fund.benchmarkReturnPercent} /> : null}
        />
        <Stat
          label="Fund vs S&P 500"
          value={vsBenchmark === null ? "…" : signedPct(vsBenchmark)}
          sub={
            vsBenchmark === null ? null : (
              <span className="text-text-2">{vsBenchmark >= 0 ? "Ahead of" : "Behind"} the index</span>
            )
          }
        />
        <Stat
          label="Next rebalance"
          value={fund?.nextRebalance ? fmtDate(fund.nextRebalance) : "…"}
          sub={fund ? <span className="text-text-2">{money(fund.cash)} in cash</span> : null}
        />
      </div>

      <Card title="Performance">
        {fund ? <FundChart history={fund.history} /> : <div className="h-64 animate-pulse rounded-lg bg-surface-2" />}
      </Card>

      {fund?.stats && <TrackRecord {...fund.stats} />}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card title={`Holdings${fund ? ` (${fund.holdings.length})` : ""}`} className="lg:col-span-2">
          {!fund ? (
            <div className="h-64 animate-pulse rounded-lg bg-surface-2" />
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-xs text-text-2">
                  <tr>
                    <th className="px-5 py-2 font-medium">Stock</th>
                    <th className="px-3 py-2 text-right font-medium">Weight</th>
                    <th className="px-3 py-2 text-right font-medium">Value</th>
                    <th className="px-3 py-2 text-right font-medium">Return</th>
                    <th className="px-5 py-2 text-right font-medium">Score now</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {fund.holdings.map((h) => (
                    <tr key={h.ticker}>
                      <td className="px-5 py-2.5">
                        <Link href={stockHref(h.ticker)} className="font-medium hover:text-accent">
                          {h.ticker}
                        </Link>
                        <div className="max-w-[200px] truncate text-xs text-text-2">
                          {h.name} · since {fmtDate(h.openedAt)}
                        </div>
                      </td>
                      <td className="num px-3 py-2.5 text-right">{h.weight.toFixed(1)}%</td>
                      <td className="num px-3 py-2.5 text-right">{money(h.value)}</td>
                      <td className="px-3 py-2.5 text-right">
                        <Change value={h.gainPercent} className="text-xs" />
                      </td>
                      <td className="px-5 py-2.5 text-right">
                        {h.rating ? <ScoreBadge score={h.score} rating={h.rating} /> : <span className="text-muted">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="The rules">
          {r ? (
            <ol className="list-decimal space-y-2 pl-5 text-sm text-text-2">
              <li>
                Start with <strong className="text-text">{money(r.startCash).replace(".00", "")}</strong> of paper money.
              </li>
              <li>
                Every <strong className="text-text">{r.rebalanceDays} days</strong>, hold the{" "}
                <strong className="text-text">top {r.holdings}</strong> stocks by Installous score, each at an equal{" "}
                {100 / r.holdings}% weight.
              </li>
              <li>
                Keep a stock while it stays in the top {r.keepRank} and scores at least {r.minScore} (Hold). Otherwise sell
                it and buy the next best.
              </li>
              <li>
                Only trim or top up a position once it drifts more than {r.driftBand * 100} points from its target.
              </li>
              <li>
                Every fill pays a {r.slippage * 100}% simulated trading cost. Returns exclude dividends for both the fund
                and the S&amp;P 500.
              </li>
            </ol>
          ) : (
            <div className="h-40 animate-pulse rounded-lg bg-surface-2" />
          )}
        </Card>
      </div>

      <Card title="Trade log">
        {!fund ? (
          <div className="h-40 animate-pulse rounded-lg bg-surface-2" />
        ) : (
          <>
            <ul className="divide-y divide-border">
              {trades.map((t, i) => (
                <li key={`${t.date}-${t.ticker}-${i}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5 text-sm">
                  <span className="num w-24 shrink-0 text-xs text-muted">{fmtDate(t.date)}</span>
                  <span
                    className={`w-11 shrink-0 rounded px-1.5 py-0.5 text-center text-[11px] font-semibold ${
                      t.side === "buy" ? "bg-up/10 text-up" : "bg-down/10 text-down"
                    }`}
                  >
                    {t.side.toUpperCase()}
                  </span>
                  <Link href={stockHref(t.ticker)} className="w-14 shrink-0 font-medium hover:text-accent">
                    {t.ticker}
                  </Link>
                  <span className="num w-40 shrink-0 text-text-2">
                    {t.shares.toFixed(2)} @ {money(t.price)}
                  </span>
                  <span className="min-w-0 flex-1 text-text-2">{t.reason}</span>
                </li>
              ))}
            </ul>
            {fund.trades.length > 15 && (
              <button onClick={() => setShowAll(!showAll)} className="mt-3 text-sm text-accent">
                {showAll ? "Show fewer" : `Show all ${fund.trades.length} trades`}
              </button>
            )}
          </>
        )}
      </Card>

      {backtest && <Backtest bt={backtest} />}

      <p className="text-xs text-muted">
        Simulated with paper money for research and entertainment. Past results, simulated or real, don&apos;t predict
        future returns. This isn&apos;t investment advice.
      </p>
    </div>
  );
}
