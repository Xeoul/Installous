"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/Card";
import { CondorBot } from "@/components/CondorBot";
import { Change } from "@/components/Change";
import { FundChart, type ChartSeries } from "@/components/FundChart";
import { getIndexBars } from "@/lib/client-data";
import { money, signedPct } from "@/lib/format";
import {
  DEFAULT_RULES,
  doublingLadder,
  nextCondor,
  simulateCondors,
  type CondorResult,
  type CondorRules,
  type CondorTrade,
  type IndexBar,
} from "@/lib/options";

const SERIES: ChartSeries[] = [
  { key: "fixed", label: "Same size every trade", color: "var(--accent)" },
  { key: "martingale", label: "Martingale (double after a loss)", color: "var(--series-2)" },
];

const PERIODS = [
  { key: "2006", label: "Since 2006 (incl. 2008 & 2020)", from: "2006-01-01" },
  { key: "2016", label: "Last 10 years", years: 10 },
  { key: "2021", label: "Last 5 years", years: 5 },
  { key: "1y", label: "Last year", years: 1 },
] as const;

const fmtDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const usd0 = (x: number) => money(Math.round(x)).replace(".00", "");

type Settings = Omit<CondorRules, "sizing"> & { period: (typeof PERIODS)[number]["key"] };

export default function OptionsLab() {
  const [bars, setBars] = useState<IndexBar[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [s, setS] = useState<Settings>({ ...DEFAULT_RULES, period: "2006" });
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    getIndexBars()
      .then(setBars)
      .catch((e: Error) => setError(e.message));
  }, []);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((cur) => ({ ...cur, [k]: v }));

  const sim = useMemo(() => {
    if (!bars?.length) return null;
    const p = PERIODS.find((x) => x.key === s.period)!;
    const from =
      "from" in p ? p.from : new Date(Date.parse(`${bars.at(-1)!.date}T12:00:00Z`) - p.years * 365.25 * 86_400_000).toISOString().slice(0, 10);
    const slice = bars.filter((b) => b.date >= from);
    const rules: CondorRules = { ...s, sizing: "fixed" };
    const fixed = simulateCondors(slice, { ...rules, sizing: "fixed" });
    const martingale = simulateCondors(slice, { ...rules, sizing: "martingale" });
    return { fixed, martingale, next: nextCondor(slice, { ...rules, sizing: "fixed" }), from: slice[0]?.date };
  }, [bars, s]);

  const history = useMemo(() => (sim ? mergeCurves(sim.fixed, sim.martingale) : []), [sim]);

  if (error) {
    return (
      <div className="py-16 text-center">
        <h1 className="text-xl font-semibold">The Options Lab isn&apos;t available</h1>
        <p className="mt-2 text-text-2">{error}</p>
      </div>
    );
  }

  const m = sim?.martingale.stats;
  const f = sim?.fixed.stats;
  const next = sim?.next;
  const ladder = next && f ? doublingLadder(next.condor, s, f.winRatePercent, f.trades) : [];
  const maxLoss = next ? (next.condor.putShort - next.condor.putLong - next.condor.credit) * 100 : null;
  const trades = sim ? [...sim.martingale.trades].reverse() : [];
  const shownTrades = showAll ? trades.slice(0, 500) : trades.slice(0, 20);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">Options Lab</h1>
          <span className="rounded-md border border-border bg-surface-2 px-2 py-0.5 text-xs font-medium text-text-2">Paper money</span>
        </div>
        <p className="mt-1 max-w-3xl text-text-2">
          Sell SPY iron condors with the martingale system: double the size after every loss, go back to the base size
          after a win. The live bot trades one every market day; the simulator below replays the same idea over 20 years.
        </p>
      </div>

      <CondorBot />

      <h2 className="pt-2 text-lg font-semibold">Simulator</h2>

      <Card title="Strategy">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Expiration" hint={s.dte === 0 ? "Open at 9:30, settle at 4:00 the same day" : undefined}>
            <select className="input w-full" value={s.dte} onChange={(e) => set("dte", Number(e.target.value))}>
              <option value={0}>Same day (0DTE)</option>
              <option value={1}>Next day</option>
              <option value={7}>1 week</option>
              <option value={30}>30 days</option>
              <option value={45}>45 days</option>
            </select>
          </Field>
          <Field label="Short strikes" hint="Roughly the chance each short strike ends in the money. Lower = further away, less credit">
            <select className="input w-full" value={s.shortDelta} onChange={(e) => set("shortDelta", Number(e.target.value))}>
              {[0.05, 0.1, 0.16, 0.2, 0.3].map((d) => (
                <option key={d} value={d}>
                  {Math.round(d * 100)} delta (~{Math.round(d * 100)}% chance per side)
                </option>
              ))}
            </select>
          </Field>
          <Field label="Wing width" hint="Distance to the protective long options">
            <select className="input w-full" value={s.width} onChange={(e) => set("width", Number(e.target.value))}>
              {[1, 2, 3, 5, 10].map((w) => (
                <option key={w} value={w}>
                  ${w} (up to ${(w * 100).toLocaleString()} per contract)
                </option>
              ))}
            </select>
          </Field>
          <Field label="Period">
            <select className="input w-full" value={s.period} onChange={(e) => set("period", e.target.value as Settings["period"])}>
              {PERIODS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Take profit" hint={s.dte === 0 ? "Same-day trades are held to the close" : undefined}>
            <select
              className="input w-full"
              disabled={s.dte === 0}
              value={s.dte === 0 ? "" : String(s.takeProfit)}
              onChange={(e) => set("takeProfit", e.target.value === "null" ? null : Number(e.target.value))}
            >
              {s.dte === 0 && <option value="">Hold to close</option>}
              <option value="null">Hold to expiration</option>
              <option value="0.25">At 25% of the credit</option>
              <option value="0.5">At 50% of the credit</option>
              <option value="0.75">At 75% of the credit</option>
            </select>
          </Field>
          <Field label="Stop loss">
            <select
              className="input w-full"
              disabled={s.dte === 0}
              value={s.dte === 0 ? "" : String(s.stopLoss)}
              onChange={(e) => set("stopLoss", e.target.value === "null" ? null : Number(e.target.value))}
            >
              {s.dte === 0 && <option value="">None</option>}
              <option value="null">None</option>
              <option value="1">Loss of 1× the credit</option>
              <option value="2">Loss of 2× the credit</option>
              <option value="3">Loss of 3× the credit</option>
            </select>
          </Field>
          <Field label="Starting cash">
            <select className="input w-full" value={s.startCash} onChange={(e) => set("startCash", Number(e.target.value))}>
              {[10_000, 25_000, 50_000, 100_000, 250_000].map((c) => (
                <option key={c} value={c}>
                  {usd0(c)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Base size" hint="Contracts after a win; the martingale doubles from here">
            <select className="input w-full" value={s.contracts} onChange={(e) => set("contracts", Number(e.target.value))}>
              {[1, 2, 5, 10, 20, 50].map((n) => (
                <option key={n} value={n}>
                  {n} contract{n === 1 ? "" : "s"}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Martingale limit" hint="Give up and reset after this many doublings">
            <select
              className="input w-full"
              value={String(s.maxDoublings)}
              onChange={(e) => set("maxDoublings", e.target.value === "null" ? null : Number(e.target.value))}
            >
              <option value="null">No limit (classic)</option>
              {[2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n} doublings (max {2 ** n}×)
                </option>
              ))}
            </select>
          </Field>
        </div>
        <p className="mt-4 text-xs text-muted">
          Each trade pays ${s.feePerLeg.toFixed(2)} per contract per leg in fees and gives up ${s.slippage.toFixed(2)} per spread
          in slippage. SPY has had same-day expirations every weekday only since late 2022; earlier years assume it did.
        </p>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ResultCard title="Same size every trade" color="var(--accent)" stats={f} start={s.startCash} />
        <ResultCard title="Martingale" color="var(--series-2)" stats={m} start={s.startCash} />
      </div>

      {sim && m?.bust && <BustNote result={sim.martingale} />}

      <Card title={sim?.from ? `Account value since ${fmtDate(sim.from)}` : "Account value"}>
        {sim ? (
          <FundChart history={history} series={SERIES} longRange caption="Account value by day, same size vs martingale" />
        ) : (
          <div className="h-64 animate-pulse rounded-lg bg-surface-2" />
        )}
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card title="Why doubling down breaks here" className="lg:col-span-3">
          {next && maxLoss !== null && f ? (
            <>
              <p className="text-sm text-text-2">
                Martingale assumes each win pays as much as each loss costs, like red or black at roulette. An iron condor
                wins small and loses big: this one collects about <strong className="text-text">{usd0(next.condor.credit * 100)}</strong>{" "}
                but can lose up to <strong className="text-text">{usd0(maxLoss)}</strong>. After one full loss, a doubled
                win only brings back {usd0(next.condor.credit * 200)}. You&apos;d need about{" "}
                <strong className="text-text">{Math.ceil(maxLoss / Math.max(next.condor.credit * 100, 1))}×</strong> the size to
                win it back in one trade.
              </p>
              <div className="-mx-5 mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border text-left text-xs text-text-2">
                    <tr>
                      <th className="px-5 py-2 font-medium">Losses in a row</th>
                      <th className="px-3 py-2 text-right font-medium">Next size</th>
                      <th className="px-3 py-2 text-right font-medium">At risk</th>
                      <th className="px-3 py-2 text-right font-medium">Lost so far (worst case)</th>
                      <th className="px-5 py-2 text-right font-medium">Times seen</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {ladder.map((r) => (
                      <tr key={r.losses} className={r.affordable ? "" : "text-down"}>
                        <td className="num px-5 py-2">{r.losses}</td>
                        <td className="num px-3 py-2 text-right">{r.contracts}×</td>
                        <td className="num px-3 py-2 text-right">{usd0(r.atRisk)}</td>
                        <td className="num px-3 py-2 text-right">{usd0(r.lostSoFar)}</td>
                        <td className="num px-5 py-2 text-right">{r.losses === 0 ? "—" : timesSeen(sim!.fixed.trades, r.losses)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-muted">
                Red rows need more than your {usd0(s.startCash)} starting cash. &ldquo;Times seen&rdquo; counts streaks of
                at least that many losses in the backtest, using the same-size strategy.
              </p>
            </>
          ) : (
            <div className="h-48 animate-pulse rounded-lg bg-surface-2" />
          )}
        </Card>

        <Card title="Next trade (estimate)" className="lg:col-span-2">
          {next && maxLoss !== null ? (
            <div className="space-y-3 text-sm">
              <p className="text-text-2">
                From the {fmtDate(next.date)} close: SPY {money(next.spot)}, VIX{" "}
                {next.vix.toFixed(1)}.
              </p>
              <dl className="num grid grid-cols-2 gap-x-4 gap-y-1.5">
                <dt className="text-text-2">Buy put</dt>
                <dd className="text-right">{next.condor.putLong}</dd>
                <dt className="text-text-2">Sell put</dt>
                <dd className="text-right">{next.condor.putShort}</dd>
                <dt className="text-text-2">Sell call</dt>
                <dd className="text-right">{next.condor.callShort}</dd>
                <dt className="text-text-2">Buy call</dt>
                <dd className="text-right">{next.condor.callLong}</dd>
                <dt className="border-t border-border pt-1.5 text-text-2">Credit</dt>
                <dd className="border-t border-border pt-1.5 text-right text-up">{usd0(next.condor.credit * 100)}</dd>
                <dt className="text-text-2">Max loss</dt>
                <dd className="text-right text-down">{usd0(maxLoss)}</dd>
                <dt className="text-text-2">Breakevens</dt>
                <dd className="text-right">
                  {(next.condor.putShort - next.condor.credit).toFixed(2)}–{(next.condor.callShort + next.condor.credit).toFixed(2)}
                </dd>
              </dl>
              <p className="text-xs text-muted">
                Modeled prices for one contract, not live quotes. Check your broker&apos;s option chain before trading.
              </p>
            </div>
          ) : (
            <div className="h-48 animate-pulse rounded-lg bg-surface-2" />
          )}
        </Card>
      </div>

      <Card title={`Martingale trade log${sim ? ` (${sim.martingale.trades.length})` : ""}`}>
        {!sim ? (
          <div className="h-40 animate-pulse rounded-lg bg-surface-2" />
        ) : (
          <>
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-xs text-text-2">
                  <tr>
                    <th className="px-5 py-2 font-medium">Opened</th>
                    <th className="px-3 py-2 font-medium">Strikes</th>
                    <th className="px-3 py-2 text-right font-medium">Size</th>
                    <th className="px-3 py-2 text-right font-medium">Result</th>
                    <th className="px-5 py-2 text-right font-medium">Account</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {shownTrades.map((t) => (
                    <TradeRow key={`${t.opened}-${t.closed}`} t={t} />
                  ))}
                </tbody>
              </table>
            </div>
            {trades.length > 20 && (
              <button onClick={() => setShowAll(!showAll)} className="mt-3 text-sm text-accent">
                {showAll ? "Show fewer" : `Show the last ${Math.min(500, trades.length)} trades`}
              </button>
            )}
          </>
        )}
      </Card>

      <Card title="How this works">
        <ul className="list-disc space-y-2 pl-5 text-sm text-text-2">
          <li>
            An <strong className="text-text">iron condor</strong> sells a put below the market and a call above it, and
            buys cheaper options further out so the loss is capped. You keep the credit if SPY finishes between
            the short strikes.
          </li>
          <li>
            Historical option prices aren&apos;t free, so each option is priced with the Black-Scholes model using that
            day&apos;s VIX. That ignores skew (crash protection usually costs extra) and intraday swings, so treat results
            as estimates. Real fills will differ.
          </li>
          <li>
            Same-day trades open at the open with yesterday&apos;s VIX and settle at the close. Longer trades open at the
            close and are checked once a day, so a stop can fill worse than shown. A new trade opens when the last one ends.
          </li>
          <li>
            The martingale sizes up after each loss until it hits your limit or can&apos;t afford the next trade. When it
            can&apos;t afford one contract, the account is counted as bust and stops trading.
          </li>
          <li>Paper money only. This is a learning tool, not investment advice.</li>
        </ul>
      </Card>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

function ResultCard({ title, color, stats, start }: { title: string; color: string; stats?: CondorResult["stats"]; start: number }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-text-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} aria-hidden />
        {title}
      </h2>
      {!stats ? (
        <div className="mt-4 h-32 animate-pulse rounded-lg bg-surface-2" />
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-3">
            <span className="num text-3xl font-semibold">{usd0(stats.finalEquity)}</span>
            <Change value={(stats.finalEquity / start - 1) * 100} />
            {stats.bust && <span className="rounded bg-down/10 px-1.5 py-0.5 text-xs font-semibold text-down">BUST {fmtDate(stats.bust)}</span>}
          </div>
          <dl className="num mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <Row label="Per year" value={stats.cagrPercent === null ? "—" : signedPct(stats.cagrPercent)} />
            <Row label="Worst drop" value={signedPct(stats.maxDrawdownPercent)} />
            <Row label="Trades" value={stats.trades.toLocaleString()} />
            <Row label="Win rate" value={stats.winRatePercent === null ? "—" : `${stats.winRatePercent}%`} />
            <Row label="Avg win / loss" value={`${usd0(stats.avgWin ?? 0)} / ${usd0(stats.avgLoss ?? 0)}`} />
            <Row label="Worst trade" value={stats.worstTrade === null ? "—" : usd0(stats.worstTrade)} />
            <Row label="Longest losing run" value={String(stats.longestLosingStreak)} />
            <Row label="Biggest size" value={`${stats.largestPosition} contract${stats.largestPosition === 1 ? "" : "s"}`} />
          </dl>
        </>
      )}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-text-2">{label}</dt>
      <dd className="text-right">{value}</dd>
    </>
  );
}

function BustNote({ result }: { result: CondorResult }) {
  const t = result.trades.at(-1);
  if (!t || !result.stats.bust) return null;
  return (
    <div className="rounded-2xl border border-down/40 bg-down/10 p-4 text-sm">
      <strong className="text-down">The martingale account went bust on {fmtDate(result.stats.bust)}.</strong>{" "}
      <span className="text-text-2">
        Its last trade was {t.contracts} contract{t.contracts === 1 ? "" : "s"} after {t.streak} loss{t.streak === 1 ? "" : "es"} in a
        row and lost {usd0(-t.pnl)}, leaving {usd0(t.equityAfter)}, not enough to cover even one more condor.
      </span>
    </div>
  );
}

function TradeRow({ t }: { t: CondorTrade }) {
  return (
    <tr>
      <td className="num px-5 py-2 text-xs text-text-2">
        {fmtDate(t.opened)}
        {t.closed !== t.opened && <span className="block text-muted">→ {fmtDate(t.closed)}</span>}
      </td>
      <td className="num px-3 py-2 text-xs">
        {t.putLong}/{t.putShort} · {t.callShort}/{t.callLong}
        <span className="block text-muted">SPY {t.spot.toFixed(2)} · credit {usd0(t.credit * 100)}</span>
      </td>
      <td className="num px-3 py-2 text-right">
        <span className={t.streak > 0 ? "font-semibold text-warn" : ""}>{t.contracts}×</span>
        {t.capped && <span className="block text-xs text-down">all-in</span>}
      </td>
      <td className={`num px-3 py-2 text-right ${t.pnl >= 0 ? "text-up" : "text-down"}`}>
        {t.pnl >= 0 ? "+" : "−"}
        {usd0(Math.abs(t.pnl))}
        {t.exit !== "expired" && <span className="block text-xs text-muted">{t.exit === "profit" ? "took profit" : "stopped"}</span>}
      </td>
      <td className="num px-5 py-2 text-right">{usd0(t.equityAfter)}</td>
    </tr>
  );
}

/** Number of losing streaks at least `k` long. */
function timesSeen(trades: CondorTrade[], k: number): string {
  let run = 0;
  let count = 0;
  for (const t of trades) {
    run = t.pnl < 0 ? run + 1 : 0;
    if (run === k) count++;
  }
  return count.toLocaleString();
}

/** One row per day with both accounts (a bust account stays flat), downsampled so long ranges stay quick to draw. */
function mergeCurves(fixed: CondorResult, martingale: CondorResult) {
  const a = new Map(fixed.curve.map((p) => [p.date, p.equity]));
  const b = new Map(martingale.curve.map((p) => [p.date, p.equity]));
  const dates = (fixed.curve.length >= martingale.curve.length ? fixed : martingale).curve.map((p) => p.date);
  let lastA = fixed.rules.startCash;
  let lastB = martingale.rules.startCash;
  const rows = dates.map((date) => {
    lastA = a.get(date) ?? lastA;
    lastB = b.get(date) ?? lastB;
    return { date, fixed: Math.round(lastA), martingale: Math.round(lastB) };
  });
  const step = Math.max(1, Math.ceil(rows.length / 600));
  return rows.filter((_, i) => i % step === 0 || i === rows.length - 1);
}
