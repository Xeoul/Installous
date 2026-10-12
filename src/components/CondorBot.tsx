"use client";

import { useEffect, useState } from "react";
import { Change } from "@/components/Change";
import { FundChart } from "@/components/FundChart";
import { getCondorBot } from "@/lib/client-data";
import type { BotState, BotTrade } from "@/lib/condor-bot";
import { money } from "@/lib/format";
import { sizeFor } from "@/lib/options";

const fmtDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const usd0 = (x: number) => money(Math.round(x)).replace(".00", "");
const strikes = (t: BotTrade) => `${t.putLong}/${t.putShort}p · ${t.callShort}/${t.callLong}c`;

/** The live paper bot: one martingale-sized SPY iron condor every market day. */
export function CondorBot() {
  const [bot, setBot] = useState<BotState | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    getCondorBot()
      .then(setBot)
      .catch(() => setError(true));
  }, []);

  const r = bot?.rules;
  const size = (streak: number) => (r ? sizeFor({ ...r, sizing: "martingale" }, streak).contracts : 0);
  const wins = bot?.trades.filter((t) => (t.pnl ?? 0) >= 0).length ?? 0;

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-text-2">
          {bot?.open && !bot.bust && <span className="live-dot" aria-hidden />}
          Live SPY martingale bot
        </h2>
        {bot && <span className="text-xs text-muted">Started {fmtDate(bot.startDate)} · updated {new Date(bot.updatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</span>}
      </div>

      {error ? (
        <p className="text-sm text-text-2">The bot&apos;s first update hasn&apos;t been published yet. It starts trading on the next market day.</p>
      ) : !bot || !r ? (
        <div className="h-40 animate-pulse rounded-lg bg-surface-2" />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Account" value={usd0(bot.equity)} sub={<Change value={(bot.equity / r.startCash - 1) * 100} />} />
            <Tile
              label={bot.open ? "Today's trade" : "Last trade"}
              value={
                bot.open
                  ? `${bot.open.contracts}× for ${usd0(bot.open.credit * 100 * bot.open.contracts)}`
                  : bot.trades[0]
                    ? `${bot.trades[0].pnl! >= 0 ? "+" : "−"}${usd0(Math.abs(bot.trades[0].pnl!))}`
                    : "None yet"
              }
              sub={
                bot.open ? (
                  <span className="text-text-2">
                    {strikes(bot.open)} · settles at 4:00pm ET
                  </span>
                ) : bot.trades[0] ? (
                  <span className="text-text-2">
                    {fmtDate(bot.trades[0].date)} · SPY closed {bot.trades[0].close?.toFixed(2)}
                  </span>
                ) : (
                  <span className="text-text-2">Opens after 9:45am ET on market days</span>
                )
              }
            />
            <Tile
              label="Losses in a row"
              value={bot.bust ? "Bust" : String(bot.streak)}
              sub={
                bot.bust ? (
                  <span className="text-down">Stopped {fmtDate(bot.bust)}</span>
                ) : (
                  <span className="text-text-2">
                    {bot.open
                      ? `Next: ${r.contracts}× after a win, ${size(bot.open.streak + 1)}× after a loss`
                      : `Next trade: ${size(bot.streak)}×`}
                  </span>
                )
              }
            />
            <Tile
              label="Trades"
              value={String(bot.trades.length)}
              sub={<span className="text-text-2">{bot.trades.length ? `${Math.round((wins / bot.trades.length) * 100)}% won` : "No settled trades yet"}</span>}
            />
          </div>

          {bot.note && !bot.open && <p className="mt-3 text-sm text-text-2">{bot.note}</p>}

          {bot.history.length >= 2 && (
            <div className="mt-5">
              <FundChart history={bot.history} series={[{ key: "equity", label: "Bot account", color: "var(--series-2)" }]} caption="Bot account value by day" fineAxis />
            </div>
          )}

          {bot.trades.length > 0 && (
            <ul className="mt-4 divide-y divide-border text-sm">
              {bot.trades.slice(0, 10).map((t) => (
                <li key={t.date} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2">
                  <span className="flex-1 text-xs text-muted sm:w-24 sm:flex-none">{fmtDate(t.date)}</span>
                  <span className="num order-last w-full text-xs text-text-2 sm:order-none sm:w-auto sm:min-w-0 sm:flex-1">
                    {strikes(t)} · SPY {t.spot.toFixed(2)} → {t.close?.toFixed(2)}
                  </span>
                  <span className={`num w-10 text-right ${t.streak ? "font-semibold text-warn" : ""}`}>{t.contracts}×</span>
                  <span className={`num w-20 text-right ${t.pnl! >= 0 ? "text-up" : "text-down"}`}>
                    {t.pnl! >= 0 ? "+" : "−"}
                    {usd0(Math.abs(t.pnl!))}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-4 text-xs text-muted">
            Every market day after 9:45am ET it sells one same-day SPY iron condor: the strikes nearest {Math.round(r.shortDelta * 100)} delta
            with ${r.width} wings, filled at the quoted mid less ${r.slippage.toFixed(2)} per spread (Yahoo Finance quotes, which can be
            delayed), and settled at the 4:00pm close. It starts with {usd0(r.startCash)}, trades {r.contracts} contract after a win and
            doubles after every loss{r.maxDoublings === null ? " with no limit" : `, up to ${r.maxDoublings} times`}. Paper money only.
          </p>
        </>
      )}
    </section>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-surface-2 p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="num mt-1 text-xl font-semibold">{value}</div>
      <div className="mt-0.5 text-xs">{sub}</div>
    </div>
  );
}
