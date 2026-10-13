"use client";

import { useEffect, useState } from "react";
import { Change } from "@/components/Change";
import { FundChart } from "@/components/FundChart";
import { getCondorBot } from "@/lib/client-data";
import { nyDate, type BotState, type BotTrade } from "@/lib/condor-bot";
import { money } from "@/lib/format";
import { useLivePrice } from "@/lib/live/useLivePrice";
import { upcomingNews } from "@/lib/news-days";
import { settlement } from "@/lib/options";

const fmtDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const usd0 = (x: number) => money(Math.round(x)).replace(".00", "");
const signed = (x: number) => `${x >= 0 ? "+" : "−"}${usd0(Math.abs(x))}`;
const strikes = (t: BotTrade) => `${t.putLong}/${t.putShort}p · ${t.callShort}/${t.callLong}c`;
const DEFAULT_LEVELS = [1, 2, 5, 10, 25];

/** The live paper bot: SPY iron condors held to the next day's close, sized by the level ladder. */
export function CondorBot() {
  const [bot, setBot] = useState<BotState | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    getCondorBot()
      .then(setBot)
      .catch(() => setError(true));
  }, []);

  const r = bot?.rules;
  // Older published states predate the level ladder.
  const levels = r?.levels ?? DEFAULT_LEVELS;
  const level = bot?.level ?? 0;
  // Size after the open condor settles: back to level 1 on a win, up a level on a loss (past the top, start over).
  const openLevel = bot?.open?.level ?? level;
  const afterLoss = openLevel + 1 >= levels.length ? levels[0] : levels[openLevel + 1];
  const wins = bot?.trades.filter((t) => (t.pnl ?? 0) >= 0).length ?? 0;
  // While a condor is open, show what it would pay if SPY settled at the live price,
  // the way you'd check it in the last minutes before the close.
  const watching = bot?.settling ?? bot?.open ?? null;
  const live = useLivePrice(watching && !bot?.bust ? (r?.ticker ?? "SPY") : null);
  const now = watching && live && r ? projected(watching, live.price, r.feePerLeg) : null;
  const skips = upcomingNews(nyDate(new Date()), 3);

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-text-2">
          {watching && !bot?.bust && <span className="live-dot" aria-hidden />}
          Live SPY martingale bot
        </h2>
        {bot && (
          <span className="text-xs text-muted">
            Started {fmtDate(bot.startDate)} · updated {new Date(bot.updatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
          </span>
        )}
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
              label={bot.open ? "Open condor" : "Last condor"}
              value={
                bot.open
                  ? `${bot.open.contracts}× for ${usd0(bot.open.credit * 100 * bot.open.contracts)}`
                  : bot.trades[0]
                    ? signed(bot.trades[0].pnl!)
                    : "None yet"
              }
              sub={
                bot.open ? (
                  <span className="text-text-2">
                    {strikes(bot.open)} · settles {fmtDate(bot.open.expiry)} at 4:00pm ET
                  </span>
                ) : bot.trades[0] ? (
                  <span className="text-text-2">
                    {fmtDate(bot.trades[0].expiry ?? bot.trades[0].date)} · SPY closed {bot.trades[0].close?.toFixed(2)}
                  </span>
                ) : (
                  <span className="text-text-2">Opens in the last half hour of a market day</span>
                )
              }
            />
            <Tile
              label="Level"
              value={bot.bust ? "Bust" : `${(bot.open ? openLevel : level) + 1} of ${levels.length}`}
              sub={
                bot.bust ? (
                  <span className="text-down">Stopped {fmtDate(bot.bust)}</span>
                ) : (
                  <span className="text-text-2">
                    {bot.open
                      ? `Next: ${levels[0]}× after a win, ${afterLoss}× after a loss`
                      : `Next condor: ${levels[level]}×`}{" "}
                    · ladder {levels.join("·")}
                  </span>
                )
              }
            />
            <Tile
              label="Condors"
              value={String(bot.trades.length)}
              sub={<span className="text-text-2">{bot.trades.length ? `${Math.round((wins / bot.trades.length) * 100)}% won` : "None settled yet"}</span>}
            />
          </div>

          {now && live && watching && (
            <p className="num mt-3 flex flex-wrap items-baseline gap-x-2 text-sm text-text-2" aria-live="polite">
              <span className="live-dot" aria-hidden />
              {bot.settling ? `Condor expiring ${fmtDate(watching.expiry)}, if` : "If"} SPY settled now at {live.price.toFixed(2)}:
              <span className={`font-semibold ${now.pnl >= 0 ? "text-up" : "text-down"}`}>{signed(now.pnl)}</span>
              <span>· {now.label}</span>
            </p>
          )}

          {bot.settling?.rolled && (
            <p className="mt-2 text-xs text-text-2">
              The condor expiring {fmtDate(bot.settling.expiry)} looked like {signed(bot.settling.rolled.pnl)} with SPY at{" "}
              {bot.settling.rolled.spot.toFixed(2)} near the close, so the next one opened at level {(bot.open?.level ?? level) + 1}. It
              settles at the official close.
            </p>
          )}

          {bot.note && !bot.open && <p className="mt-3 text-sm text-text-2">{bot.note}</p>}

          {r.skipNews !== false && skips.length > 0 && (
            <p className="mt-2 text-xs text-muted">
              Won&apos;t hold a condor through:{" "}
              {skips.map((s) => `${fmtDate(s.date)} (${s.kinds.join(", ")})`).join(" · ")}
            </p>
          )}

          {bot.history.length >= 2 && (
            <div className="mt-5">
              <FundChart
                history={bot.history}
                series={[{ key: "equity", label: "Bot account", color: "var(--series-2)" }]}
                caption="Bot account value by day"
                fineAxis
              />
            </div>
          )}

          {bot.trades.length > 0 && (
            <ul className="mt-4 divide-y divide-border text-sm">
              {bot.trades.slice(0, 10).map((t) => (
                <li key={`${t.date}-${t.expiry}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2">
                  <span className="flex-1 text-xs text-muted sm:w-24 sm:flex-none">{fmtDate(t.expiry ?? t.date)}</span>
                  <span className="num order-last w-full text-xs text-text-2 sm:order-none sm:w-auto sm:min-w-0 sm:flex-1">
                    {strikes(t)} · SPY {t.spot.toFixed(2)} → {t.close?.toFixed(2)}
                  </span>
                  <span className={`num w-24 text-right text-xs ${(t.level ?? 0) > 0 ? "font-semibold text-warn" : "text-text-2"}`}>
                    L{(t.level ?? 0) + 1} · {t.contracts}×
                  </span>
                  <span className={`num w-20 text-right ${t.pnl! >= 0 ? "text-up" : "text-down"}`}>{signed(t.pnl!)}</span>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-4 text-xs text-muted">
            In the last half hour of each market day it checks whether the condor expiring today is a win or a loss, sets the next
            size from the ladder ({levels.join(", ")} contracts: a loss moves up a level, any win goes back to level 1, and a loss on
            level {levels.length} starts over), then sells a SPY iron condor expiring the next trading day with ${r.width} wings
            {r.evenMoney ? `, short strikes placed so it collects about $${(r.width * 50).toFixed(0)}` : ""}. It skips a day if the
            condor pays under ${((r.minCredit ?? 0) * 100).toFixed(0)}, or if a Fed decision, CPI or jobs report lands while it would be
            open. Fills use the quoted mid less ${r.slippage.toFixed(2)} per spread (Yahoo Finance quotes, which can be delayed), and
            each condor settles at the 4:00pm close. Starts with {usd0(r.startCash)}. Paper money only.
          </p>
        </>
      )}
    </section>
  );
}

/** What an open condor would pay if it settled at `price`, and whether that's a full win, full loss or partial. */
function projected(t: BotTrade, price: number, feePerLeg: number) {
  const owed = settlement(t, price);
  const pnl = (t.credit - owed) * 100 * t.contracts - 4 * feePerLeg * t.contracts;
  const maxOwed = Math.max(t.putShort - t.putLong, t.callLong - t.callShort);
  const label = owed === 0 ? "full win" : owed >= maxOwed ? "full loss" : pnl >= 0 ? "partial win" : "partial loss";
  return { pnl, label };
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
