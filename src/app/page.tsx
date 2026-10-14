"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card } from "@/components/Card";
import { Change } from "@/components/Change";
import { RollingNumber } from "@/components/RollingNumber";
import { ScoreBadge } from "@/components/ScoreBadge";
import { ShowcaseCard } from "@/components/ShowcaseCard";
import { Sparkline } from "@/components/Sparkline";
import type { ChartData } from "@/lib/chart";
import { getPicks, getPortfolio, getSparklines, getWatchlist, stockHref } from "@/lib/client-data";
import { money } from "@/lib/format";
import { MarketHours } from "@/lib/live/pricing";
import { useLivePrices } from "@/lib/live/useLivePrice";
import type { Quote } from "@/lib/market";
import type { Pick, PortfolioSnapshot } from "@/lib/portfolio";

export default function Dashboard() {
  const [portfolio, setPortfolio] = useState<PortfolioSnapshot | null>(null);
  const [watchlist, setWatchlist] = useState<Quote[] | null>(null);
  const [picks, setPicks] = useState<Pick[] | null>(null);
  const [sparks, setSparks] = useState<Record<string, ChartData>>({});
  // Streamed prices for the watchlist and the top picks shown here.
  const live = useLivePrices([...(watchlist?.map((q) => q.ticker) ?? []), ...(picks?.slice(0, 5).map((p) => p.ticker) ?? [])]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPortfolio().then(setPortfolio).catch((e) => setError(e.message));
    getWatchlist()
      .then((w) => {
        setWatchlist(w);
        return getSparklines(w.map((q) => q.ticker)).then(setSparks);
      })
      .catch((e) => setError(e.message));
    getPicks().then(setPicks).catch((e) => setError(e.message));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Good {greeting()}</h1>
          <p className="text-text-2">The AI Fund, the options bot and today&apos;s highest-ranked ideas.</p>
        </div>
        <Link href="/advisor" className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white">
          Ask your AI advisor →
        </Link>
      </div>

      {error && <div className="rounded-lg border border-down/40 bg-down/10 px-3 py-2 text-sm text-down">⚠ {error}</div>}

      <ShowcaseCard portfolio={portfolio} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card
          title="Top picks"
          action={<Link href="/picks" className="text-sm text-accent">See all →</Link>}
          className="lg:col-span-3"
        >
          {!picks ? (
            <Skeleton rows={6} />
          ) : (
            <ul className="divide-y divide-border">
              {picks.slice(0, 5).map((p, i) => (
                <li key={p.ticker}>
                  <Link href={stockHref(p.ticker)} className="flex items-center gap-3 py-2.5 hover:bg-surface-2/50">
                    <span className="num w-5 text-sm text-muted">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{p.ticker}</div>
                      <div className="truncate text-xs text-text-2">{p.name}</div>
                    </div>
                    <div className="w-20 shrink-0 text-right sm:w-24">
                      {(() => {
                        const tick = live[p.ticker];
                        const on = tick?.marketHours === MarketHours.Regular;
                        const price = on ? tick.price : p.price;
                        return (
                          <>
                            <div className="num text-sm">{price !== null ? <RollingNumber value={money(price)} /> : money(price)}</div>
                            <Change value={on ? (tick.changePercent ?? p.changePercent) : p.changePercent} className="text-xs" />
                          </>
                        );
                      })()}
                    </div>
                    <div className="flex w-28 shrink-0 justify-end sm:w-32">
                      <ScoreBadge score={p.overall} rating={p.rating} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Watchlist" className="lg:col-span-2">
          {!watchlist ? (
            <Skeleton rows={5} />
          ) : watchlist.length === 0 ? (
            <p className="text-sm text-text-2">Your watchlist is empty. Search for a stock to add it.</p>
          ) : (
            <ul className="divide-y divide-border">
              {watchlist.map((quote) => {
                // While the market's open, streamed prices tick the row every second.
                const tick = live[quote.ticker];
                const q =
                  tick?.marketHours === MarketHours.Regular && tick.time > Date.parse(quote.marketTime ?? "0")
                    ? { ...quote, price: tick.price, changePercent: tick.changePercent ?? quote.changePercent }
                    : quote;
                return (
                  <li key={q.ticker}>
                    <Link href={stockHref(q.ticker)} className="flex items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{q.ticker}</div>
                        <div className="truncate text-xs text-text-2">{q.name}</div>
                      </div>
                      <Sparkline data={sparks[q.ticker]} />
                      <div className="w-24 shrink-0 text-right">
                        <div className="num text-sm">{q.price !== null ? <RollingNumber value={money(q.price)} /> : money(q.price)}</div>
                        <Change value={q.changePercent} className="text-xs" />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
}

function Skeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-9 animate-pulse rounded-lg bg-surface-2" />
      ))}
    </div>
  );
}
