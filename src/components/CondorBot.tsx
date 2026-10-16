"use client";

import { useEffect, useState } from "react";
import { OrderTicket, PositionCard, TradeHistory, useNow } from "@/components/CondorLive";
import { Change } from "@/components/Change";
import { FundChart } from "@/components/FundChart";
import { RollingNumber } from "@/components/RollingNumber";
import { getCondorBot, getSpxDay } from "@/lib/client-data";
import { botName, botQuoteTicker, type BotState, type BotTrade } from "@/lib/condor-bot";
import { fmtWeekday as fmtDate, nyDate } from "@/lib/dates";
import { signedUsd0 as signed, usd0 } from "@/lib/format";
import { MarketHours } from "@/lib/live/pricing";
import { liveBot } from "@/lib/live/valuations";
import { useLivePrice, useLiveTail } from "@/lib/live/useLivePrice";
import { upcomingNews } from "@/lib/news-days";

const strikes = (t: BotTrade) => `${t.putLong}/${t.putShort}p · ${t.callShort}/${t.callLong}c`;
const DEFAULT_LEVELS = [1, 3, 6];

/** The live paper bot: SPX iron condors held to the next day's close, sized by the level ladder. */
export function CondorBot() {
  const [bot, setBot] = useState<BotState | null>(null);
  const [error, setError] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    getCondorBot()
      .then(setBot)
      .catch(() => setError(true));
    // Load the S&P 500 chart alongside, so it's ready when the position card draws.
    getSpxDay().catch(() => {});
  }, []);

  const r = bot?.rules;
  // Older published states predate the level ladder.
  const levels = r?.levels ?? DEFAULT_LEVELS;
  const level = bot?.level ?? 0;
  // Size after the open condor settles: back to level 1 on a win, up a level on a loss (past the top, start over).
  const openLevel = bot?.open?.level ?? level;
  const afterLoss = openLevel + 1 >= levels.length ? levels[0] : levels[openLevel + 1];
  const wins = bot?.trades.filter((t) => (t.pnl ?? 0) >= 0).length ?? 0;
  // Open condors are marked live from the index's streamed price, like positions in a brokerage app.
  const positions = [bot?.settling, bot?.open].filter((t): t is BotTrade => !!t);
  const ticker = positions.length && r ? botQuoteTicker(r) : null;
  const name = r ? botName(r) : "SPX";
  const live = useLivePrice(ticker);
  const tail = useLiveTail(ticker, 15_000);
  const spot = live?.price ?? positions.at(-1)?.spot;
  // The account with the open condors marked live (bought back now), like the position card.
  const now = useNow(5000, live?.marketHours === MarketHours.Regular);
  const v = bot ? liveBot(bot, live?.price, now) : null;
  const skips = upcomingNews(nyDate(new Date()), 3);

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-text-2">
          {positions.length > 0 && !bot?.bust && <span className="live-dot" aria-hidden />}
          Live {name} martingale bot
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
          <OrderTicket bot={bot} onUpdate={setBot} name={name} />
          {spot !== undefined &&
            positions.map((t) => (
              <PositionCard key={t.date} trade={t} rules={r} name={name} spot={spot} quoted={!!live} live={live?.marketHours === MarketHours.Regular} tail={tail} />
            ))}
          <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
            <Tile
              label={v?.live ? "Account · live" : "Account"}
              value={usd0(v?.equity ?? bot.equity)}
              sub={
                <span className="flex flex-wrap items-center gap-x-1.5">
                  <Change value={((v?.equity ?? bot.equity) / r.startCash - 1) * 100} />
                  {v?.live && <span className="text-text-2">if closed now</span>}
                </span>
              }
            />
            <Tile
              label={bot.open ? (v?.live ? "Open condor · now" : "Open condor") : "Last condor"}
              value={
                bot.open
                  ? v?.live
                    ? signed(v.unsettled)
                    : `${bot.open.contracts}× for ${usd0(bot.open.credit * 100 * bot.open.contracts)}`
                  : bot.trades[0]
                    ? signed(bot.trades[0].pnl!)
                    : "None yet"
              }
              sub={
                bot.open ? (
                  <span className="text-text-2">
                    {v?.live && `${bot.open.contracts}× for ${usd0(bot.open.credit * 100 * bot.open.contracts)} · `}
                    {strikes(bot.open)} · settles {fmtDate(bot.open.expiry)} at 1:00pm PT
                  </span>
                ) : bot.trades[0] ? (
                  <span className="text-text-2">
                    {fmtDate(bot.trades[0].expiry ?? bot.trades[0].date)} · {name} closed {bot.trades[0].close?.toFixed(2)}
                  </span>
                ) : (
                  <span className="text-text-2">Opens right after a market day&apos;s close</span>
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
              label="Condors settled"
              value={String(bot.trades.length)}
              sub={
                <span className="text-text-2">
                  {bot.trades.length ? `${Math.round((wins / bot.trades.length) * 100)}% won` : "None settled yet"} ·{" "}
                  <span className="font-medium text-accent">{showHistory ? "Hide history" : "View history"}</span>
                </span>
              }
              onClick={() => setShowHistory((v) => !v)}
              expanded={showHistory}
              controls="condor-history"
            />
          </div>

          {showHistory && <TradeHistory id="condor-history" bot={bot} positions={positions} name={name} />}

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

          <details className="mt-4 text-xs text-muted">
            <summary className="cursor-pointer font-medium text-text-2">How the bot trades</summary>
            <p className="mt-2">
              Right after each market day&apos;s close (1:00pm PT) it settles the condor expiring today as a win or a loss, sets the next
              size from the ladder ({levels.join(", ")} contracts: a loss moves up a level, any win goes back to level 1, and a loss on
              level {levels.length} starts over), then sells a {name} iron condor expiring the next trading day with ${r.width} wings
              {r.evenMoney ? `, short strikes placed so it collects about $${(r.width * 50).toFixed(0)}` : ""}. It skips a day if the
              condor pays under ${((r.minCredit ?? 0) * 100).toFixed(0)}, or if a Fed decision, CPI or jobs report lands while it would be
              open. Fills use the quoted mid less ${r.slippage.toFixed(2)} per spread (Yahoo Finance quotes, which can be delayed), and
              each condor settles at the 1:00pm PT close. Starts with {usd0(r.startCash)}. Paper money only.
            </p>
          </details>
        </>
      )}
    </section>
  );
}

interface TileProps {
  label: string;
  value: string;
  sub: React.ReactNode;
  /** Makes the tile a button that toggles the panel `controls` names. */
  onClick?: () => void;
  expanded?: boolean;
  controls?: string;
}

function Tile({ label, value, sub, onClick, expanded, controls }: TileProps) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-1 text-xs text-muted">
        {label}
        {onClick && (
          <svg viewBox="0 0 16 16" className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden>
            <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      <div className="num mt-1 truncate text-lg font-semibold sm:text-xl">
        <RollingNumber value={value} />
      </div>
      <div className="mt-0.5 text-xs">{sub}</div>
    </>
  );
  if (!onClick) return <div className="min-w-0 rounded-xl bg-surface-2 p-3">{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      aria-controls={controls}
      className={`min-w-0 rounded-xl bg-surface-2 p-3 text-left ring-accent transition hover:ring-1 focus-visible:outline-none focus-visible:ring-2 ${expanded ? "ring-1" : ""}`}
    >
      {body}
    </button>
  );
}
