"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/Card";
import { getEvents } from "@/lib/client-data";
import { compact, money } from "@/lib/format";
import type { StockEvents } from "@/lib/market";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });

const quarterLabel = (iso: string) => {
  const d = new Date(iso);
  return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
};

function daysUntil(iso: string) {
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
}

/** Next earnings, the last four quarters' beats and misses, and dividend history. */
export function EventsCard({ ticker, currency = "USD" }: { ticker: string; currency?: string }) {
  const [events, setEvents] = useState<StockEvents | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getEvents(ticker)
      .then(setEvents)
      .catch(() => setFailed(true));
  }, [ticker]);

  if (failed) return null;
  if (!events) return <div className="h-48 animate-pulse rounded-2xl bg-surface-2" />;

  const next = events.nextEarnings;
  const div = events.dividends;
  const maxYear = Math.max(...div.byYear.map((y) => y.total), 0);
  const thisYear = new Date().getFullYear();

  return (
    <Card title="Earnings & dividends">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section>
          <h3 className="text-xs font-medium text-muted">Next earnings</h3>
          {next ? (
            <>
              <p className="mt-1 text-lg font-semibold">
                {fmtDate(next.date)} <span className="text-sm font-normal text-text-2">{daysUntil(next.date)}</span>
              </p>
              <p className="text-xs text-muted">{next.confirmed ? "Confirmed date" : "Estimated date"}</p>
              <dl className="mt-3 space-y-1 text-sm">
                {next.epsAverage !== null && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-text-2">EPS estimate</dt>
                    <dd className="num">
                      {money(next.epsAverage, currency)}
                      {next.epsLow !== null && next.epsHigh !== null && (
                        <span className="text-xs text-muted"> ({next.epsLow.toFixed(2)}–{next.epsHigh.toFixed(2)})</span>
                      )}
                    </dd>
                  </div>
                )}
                {next.revenueAverage !== null && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-text-2">Revenue estimate</dt>
                    <dd className="num">{compact(next.revenueAverage)}</dd>
                  </div>
                )}
              </dl>
            </>
          ) : (
            <p className="mt-1 text-sm text-text-2">No upcoming date announced.</p>
          )}
        </section>

        <section>
          <h3 className="text-xs font-medium text-muted">Last 4 quarters: EPS vs estimate</h3>
          {events.earningsHistory.length ? (
            <table className="mt-2 w-full text-sm">
              <tbody className="divide-y divide-border">
                {events.earningsHistory.map((q) => {
                  const beat = q.surprisePercent !== null && q.surprisePercent >= 0;
                  return (
                    <tr key={q.quarter}>
                      <td className="py-1.5 text-text-2">{quarterLabel(q.quarter)}</td>
                      <td className="num py-1.5 text-right">
                        {q.epsActual === null ? "—" : q.epsActual.toFixed(2)}
                        <span className="text-xs text-muted"> vs {q.epsEstimate === null ? "—" : q.epsEstimate.toFixed(2)}</span>
                      </td>
                      <td className={`num py-1.5 pl-3 text-right text-xs ${q.surprisePercent === null ? "text-muted" : beat ? "text-up" : "text-down"}`}>
                        {q.surprisePercent === null ? "—" : `${beat ? "▲ Beat" : "▼ Miss"} ${Math.abs(q.surprisePercent).toFixed(1)}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="mt-1 text-sm text-text-2">No recent results.</p>
          )}
        </section>

        <section>
          <h3 className="text-xs font-medium text-muted">Dividends</h3>
          {div.annualRate ? (
            <>
              <p className="mt-1 text-lg font-semibold">
                {money(div.annualRate, currency)}
                <span className="text-sm font-normal text-text-2">
                  /yr{div.yieldPercent !== null && ` · ${div.yieldPercent.toFixed(2)}% yield`}
                </span>
              </p>
              <p className="text-xs text-muted">
                {[
                  div.exDividendDate && `Last ex-dividend ${fmtDate(div.exDividendDate)}`,
                  div.payoutRatioPercent !== null && `pays out ${div.payoutRatioPercent.toFixed(0)}% of earnings`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {div.byYear.length > 0 && (
                <ul className="mt-3 space-y-1.5" aria-label="Dividends paid per year">
                  {div.byYear.map((y) => (
                    <li key={y.year} className="flex items-center gap-2 text-xs">
                      <span className="num w-10 text-text-2">{y.year}</span>
                      <span className="h-2 flex-1 rounded-full bg-surface-2">
                        <span className="block h-2 rounded-full bg-accent" style={{ width: `${(y.total / maxYear) * 100}%` }} />
                      </span>
                      <span className="num w-24 text-right">
                        {money(y.total, currency)}
                        {y.year === thisYear && <span className="text-muted"> so far</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="mt-1 text-sm text-text-2">Doesn&apos;t pay a dividend.</p>
          )}
        </section>
      </div>
    </Card>
  );
}
