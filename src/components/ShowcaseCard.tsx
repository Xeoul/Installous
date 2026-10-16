"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Change } from "@/components/Change";
import { OrderTicket, PositionCard, TradeHistory, useNow } from "@/components/CondorLive";
import { LineChart } from "@/components/LineChart";
import { RollingNumber } from "@/components/RollingNumber";
import { getCondorBot, getFund, getSpxDay } from "@/lib/client-data";
import { botName, botQuoteTicker, type BotState, type BotTrade } from "@/lib/condor-bot";
import { fmtMonthDay } from "@/lib/dates";
import { money, signedPct, usd0 } from "@/lib/format";
import type { FundView } from "@/lib/fund";
import { MarketHours } from "@/lib/live/pricing";
import { useLivePrices, useLiveTail } from "@/lib/live/useLivePrice";
import { liveBot, liveFund, livePortfolio, type LivePrices } from "@/lib/live/valuations";
import type { PortfolioSnapshot } from "@/lib/portfolio";

type View = "fund" | "options" | "portfolio";
const STORAGE_KEY = "installous.showcase";

// The chosen view lives in localStorage; read it as an external store so the
// server render (AI Fund) and the browser's saved choice reconcile cleanly.
const viewListeners = new Set<() => void>();
const subscribeView = (cb: () => void) => {
  viewListeners.add(cb);
  return () => void viewListeners.delete(cb);
};
function savedView(): View | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "fund" || v === "options" || v === "portfolio" ? v : null;
  } catch {
    return null;
  }
}
function saveView(v: View) {
  try {
    localStorage.setItem(STORAGE_KEY, v);
  } catch {
    // storage unavailable: the choice lasts until the page reloads
  }
  viewListeners.forEach((cb) => cb());
}
// "$25k", "$24.8k", "$25.25k": as many decimals as the ticks need, so small
// moves on a large account don't all read "$25k".
const compactDollars = (v: number) => `$${Number((v / 1000).toFixed(2))}k`;

/**
 * The dashboard's headline card: switch between the AI Fund and the Options
 * Lab bot (and your own portfolio, once it has holdings) with an iOS-style
 * segmented control. Remembers the last choice on this device.
 */
export function ShowcaseCard({ portfolio }: { portfolio: PortfolioSnapshot | null }) {
  const saved = useSyncExternalStore(subscribeView, savedView, () => null);
  const [picked, setPicked] = useState<View | null>(null);
  const view: View = picked ?? saved ?? "fund";
  const [fund, setFund] = useState<FundView | null>(null);
  const [bot, setBot] = useState<BotState | null>(null);

  useEffect(() => {
    getFund().then(setFund).catch(() => {});
    getCondorBot().then(setBot).catch(() => {});
    // Load the S&P 500 chart alongside, so it's ready when the bot card draws.
    getSpxDay().catch(() => {});
  }, []);

  const hasPortfolio = !!portfolio && portfolio.holdings.length > 0;
  const shown: View = view === "portfolio" && !hasPortfolio ? "fund" : view;
  const choose = (v: View) => {
    setPicked(v);
    saveView(v);
  };

  // Stream prices for whatever the shown view holds, and re-price it live
  // (regular-session ticks only, like the watchlist).
  const tickers =
    shown === "fund"
      ? [...(fund?.holdings.map((h) => h.ticker) ?? []), "SPY"]
      : shown === "options"
        ? bot && (bot.open || bot.settling)
          ? [botQuoteTicker(bot.rules)]
          : []
        : (portfolio?.holdings.map((h) => h.ticker) ?? []);
  const ticks = useLivePrices(tickers);
  const prices: LivePrices = {};
  for (const [t, tick] of Object.entries(ticks)) if (tick.marketHours === MarketHours.Regular) prices[t] = tick.price;

  const tabs: { key: View; label: string }[] = [
    { key: "fund", label: "AI Fund" },
    { key: "options", label: "Options Lab" },
    ...(hasPortfolio ? [{ key: "portfolio" as const, label: "My portfolio" }] : []),
  ];

  return (
    <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
      <div role="tablist" aria-label="Showcase" className="flex rounded-[10px] bg-surface-2 p-0.5">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={shown === t.key}
            onClick={() => choose(t.key)}
            className={`flex-1 rounded-lg px-2 py-1.5 text-[13px] font-semibold transition-colors ${
              shown === t.key ? "bg-surface text-text shadow-sm" : "text-text-2"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {shown === "fund" ? (
          <FundPanel fund={fund} prices={prices} />
        ) : shown === "options" ? (
          <BotPanel bot={bot} prices={prices} onUpdate={setBot} />
        ) : (
          <PortfolioPanel p={portfolio!} prices={prices} />
        )}
      </div>
    </section>
  );
}

function Headline({ label, value, change, sub, live = false }: { label: string; value: number | null; change: ReactNode; sub?: ReactNode; live?: boolean }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
        {live && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-up" title="Updating with live prices">
            <span className="live-dot" aria-hidden /> Live
          </span>
        )}
      </div>
      <div className="mt-1 text-[34px] font-semibold leading-tight tracking-tight">
        {value === null ? <span className="text-muted">…</span> : <RollingNumber value={money(value)} />}
      </div>
      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-sm">
        {change}
        {sub && <span className="text-text-2">{sub}</span>}
      </div>
    </div>
  );
}

function Stats({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="mt-4 grid grid-cols-3 divide-x divide-border rounded-xl bg-surface-2 py-2.5 text-center">
      {items.map((s) => (
        <div key={s.label} className="min-w-0 px-2">
          <dt className="truncate text-[11px] text-muted">{s.label}</dt>
          <dd className="num mt-0.5 truncate text-sm font-semibold">{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function More({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="mt-3 flex items-center justify-end gap-1 text-sm font-medium text-accent">
      {children}
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden>
        <path d="m9 6 6 6-6 6" />
      </svg>
    </Link>
  );
}

function MiniChart({ history, series, caption }: { history: { date: string }[]; series: { key: string; label: string; color: string; dash?: string }[]; caption: string }) {
  if (history.length < 2) return null;
  return (
    <div className="mt-3">
      <LineChart data={history} series={series} formatX={fmtMonthDay} formatY={compactDollars} formatValue={(v) => money(v)} yAxisWidth={52} height={150} caption={caption} />
    </div>
  );
}

function FundPanel({ fund, prices }: { fund: FundView | null; prices: LivePrices }) {
  if (!fund) return <Headline label="AI Fund · paper money" value={null} change={null} />;
  const v = liveFund(fund, prices, prices.SPY);
  const ahead = v.returnPercent - v.benchmarkReturnPercent;
  return (
    <>
      <Headline
        label="AI Fund · paper money"
        value={v.equity}
        change={<Change value={v.returnPercent} />}
        live={v.live}
        sub={`since ${fmtMonthDay(fund.startDate)}`}
      />
      <MiniChart
        history={fund.history}
        series={[
          { key: "equity", label: "AI Fund", color: "var(--accent)" },
          { key: "benchmark", label: "S&P 500", color: "var(--muted)", dash: "5 4" },
        ]}
        caption="AI Fund value vs S&P 500 by day"
      />
      <Stats
        items={[
          { label: "S&P 500", value: signedPct(v.benchmarkReturnPercent) },
          { label: ahead >= 0 ? "Ahead by" : "Behind by", value: <span className={ahead >= 0 ? "text-up" : "text-down"}>{Math.abs(ahead).toFixed(2)} pts</span> },
          { label: "Holdings", value: fund.holdings.length },
        ]}
      />
      <More href="/fund">Holdings &amp; trades</More>
    </>
  );
}

function BotPanel({ bot, prices, onUpdate }: { bot: BotState | null; prices: LivePrices; onUpdate: (b: BotState) => void }) {
  // The same live view as the Options Lab: today's order, then each open condor marked live.
  const positions = [bot?.settling, bot?.open].filter((t): t is BotTrade => !!t);
  const quote = bot && positions.length ? botQuoteTicker(bot.rules) : null;
  const tail = useLiveTail(quote, 15_000);
  const [showHistory, setShowHistory] = useState(false);
  const now = useNow(5000, quote !== null && prices[quote] !== undefined);
  if (!bot) return <Headline label="Condor bot · paper money" value={null} change={null} />;
  const name = botName(bot.rules);
  const livePrice = quote ? prices[quote] : undefined;
  // With a condor open, mark it live (bought back now), like the position card below.
  const v = liveBot(bot, prices[botQuoteTicker(bot.rules)], now);
  const levels = bot.rules.levels ?? [1, 3, 6];
  const level = bot.open?.level ?? bot.level ?? 0;
  const wins = bot.trades.filter((t) => (t.pnl ?? 0) >= 0).length;
  const last = bot.trades[0];
  return (
    <>
      <Headline
        label={`${name} condor bot · paper money`}
        value={v.equity}
        change={<Change value={(v.equity / bot.rules.startCash - 1) * 100} />}
        sub={v.live ? `if closed now · open condor ${v.unsettled >= 0 ? "+" : "−"}${usd0(Math.abs(v.unsettled))}` : `since ${fmtMonthDay(bot.startDate)}`}
        live={v.live}
      />
      <div className="mt-4">
        <OrderTicket bot={bot} onUpdate={onUpdate} name={name} />
        {positions.map((t) => (
          <PositionCard key={t.date} trade={t} rules={bot.rules} spot={livePrice ?? t.spot} quoted={livePrice !== undefined} live={livePrice !== undefined} tail={tail} name={name} />
        ))}
      </div>
      {bot.history.length >= 2 ? (
        <MiniChart history={bot.history} series={[{ key: "equity", label: "Bot account", color: "var(--series-2)" }]} caption="Condor bot account value by day" />
      ) : (
        positions.length === 0 && (
          <p className="mt-3 rounded-xl bg-surface-2 px-3 py-2.5 text-sm text-text-2">
            The chart starts once the first condor settles. The bot trades right after each market day&apos;s close.
          </p>
        )
      )}
      <Stats
        items={[
          { label: "Level", value: bot.bust ? "Bust" : `${level + 1} of ${levels.length}` },
          { label: "Condors", value: bot.trades.length ? `${wins}/${bot.trades.length} won` : "0" },
          {
            label: bot.open ? "Open" : "Last",
            value: bot.open ? (
              `${bot.open.contracts}× · ${usd0(bot.open.credit * 100 * bot.open.contracts)}`
            ) : last?.pnl !== undefined ? (
              <span className={last.pnl >= 0 ? "text-up" : "text-down"}>{`${last.pnl >= 0 ? "+" : "−"}${usd0(Math.abs(last.pnl))}`}</span>
            ) : (
              "—"
            ),
          },
        ]}
      />
      <button
        type="button"
        onClick={() => setShowHistory((v) => !v)}
        aria-expanded={showHistory}
        aria-controls="home-condor-history"
        className="mt-3 flex w-full items-center justify-between rounded-xl bg-surface-2 px-3 py-2.5 text-sm font-medium transition hover:ring-1 hover:ring-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span>
          Trade history <span className="font-normal text-muted">· {bot.trades.length} settled</span>
        </span>
        <span className="flex items-center gap-1 text-accent">
          {showHistory ? "Hide" : "View"}
          <svg viewBox="0 0 16 16" className={`h-3.5 w-3.5 transition-transform ${showHistory ? "rotate-180" : ""}`} aria-hidden>
            <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      {showHistory && <TradeHistory id="home-condor-history" bot={bot} positions={positions} name={name} />}
      <More href="/options">Options Lab</More>
    </>
  );
}

function PortfolioPanel({ p, prices }: { p: PortfolioSnapshot; prices: LivePrices }) {
  const v = livePortfolio(p, prices);
  return (
    <>
      <Headline label="My portfolio" value={v.value} change={<Change value={v.dayPercent} />} sub="today" live={v.live} />
      <Stats
        items={[
          { label: "Today", value: money(v.day) },
          { label: "Total gain", value: <span className={v.gain >= 0 ? "text-up" : "text-down"}>{money(v.gain)}</span> },
          { label: "Positions", value: p.holdings.length },
        ]}
      />
      <More href="/portfolio">Portfolio</More>
    </>
  );
}
