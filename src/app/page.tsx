"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, Stat } from "@/components/Card";
import { Change } from "@/components/Change";
import { ScoreBadge } from "@/components/ScoreBadge";
import { Sparkline } from "@/components/Sparkline";
import type { ChartData } from "@/lib/chart";
import { money } from "@/lib/format";
import type { Rating } from "@/lib/scoring";

interface Quote {
  ticker: string;
  name: string;
  price: number | null;
  changePercent: number | null;
}
interface Portfolio {
  holdings: { ticker: string; value: number | null; dayChangePercent: number | null; shares: number }[];
  totalValue: number;
  totalGain: number;
  totalGainPercent: number | null;
}
interface Pick {
  ticker: string;
  name: string;
  sector: string | null;
  price: number | null;
  changePercent: number | null;
  overall: number | null;
  rating: Rating;
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  const body = await r.json();
  if (!r.ok) throw new Error(body.error ?? "Request failed");
  return body as T;
}

export default function Dashboard() {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [watchlist, setWatchlist] = useState<Quote[] | null>(null);
  const [picks, setPicks] = useState<Pick[] | null>(null);
  const [sparks, setSparks] = useState<Record<string, ChartData>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getJson<Portfolio>("/api/portfolio").then(setPortfolio).catch((e) => setError(e.message));
    getJson<Quote[]>("/api/watchlist")
      .then((w) => {
        setWatchlist(w);
        if (w.length === 0) return;
        return getJson<Record<string, ChartData>>(`/api/sparklines?tickers=${w.map((q) => q.ticker).join(",")}`).then(setSparks);
      })
      .catch((e) => setError(e.message));
    getJson<Pick[]>("/api/picks").then(setPicks).catch((e) => setError(e.message));
  }, []);

  // Today's portfolio change, weighted by position value.
  const dayChange = portfolio?.holdings.reduce((acc, h) => {
    if (h.value === null || h.dayChangePercent === null) return acc;
    return acc + h.value - h.value / (1 + h.dayChangePercent / 100);
  }, 0);
  const dayChangePct =
    portfolio && dayChange !== undefined && portfolio.totalValue > 0
      ? (dayChange / (portfolio.totalValue - dayChange)) * 100
      : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Good {greeting()}</h1>
          <p className="text-text-2">Here&apos;s your portfolio and today&apos;s highest-ranked ideas.</p>
        </div>
        <Link href="/advisor" className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white">
          Ask your AI advisor →
        </Link>
      </div>

      {error && <div className="rounded-lg border border-down/40 bg-down/10 px-3 py-2 text-sm text-down">⚠ {error}</div>}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Portfolio value" value={portfolio ? money(portfolio.totalValue) : "…"} />
        <Stat
          label="Today"
          value={portfolio ? money(dayChange ?? 0) : "…"}
          sub={portfolio && portfolio.holdings.length > 0 ? <Change value={dayChangePct} /> : null}
        />
        <Stat
          label="Total gain / loss"
          value={portfolio ? money(portfolio.totalGain) : "…"}
          sub={portfolio && portfolio.holdings.length > 0 ? <Change value={portfolio.totalGainPercent} /> : null}
        />
      </div>
      {portfolio && portfolio.holdings.length === 0 && (
        <p className="text-sm text-text-2">
          No holdings yet. <Link href="/portfolio" className="text-accent underline">Add your positions</Link> so Installous can
          tailor its advice.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <Card
          title="Top picks"
          action={<Link href="/picks" className="text-sm text-accent">See all →</Link>}
          className="lg:col-span-3"
        >
          {!picks ? (
            <Skeleton rows={6} />
          ) : (
            <ul className="divide-y divide-border">
              {picks.slice(0, 8).map((p, i) => (
                <li key={p.ticker}>
                  <Link href={`/stock/${p.ticker}`} className="flex items-center gap-3 py-2.5 hover:bg-surface-2/50">
                    <span className="num w-5 text-sm text-muted">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{p.ticker}</div>
                      <div className="truncate text-xs text-text-2">{p.name}</div>
                    </div>
                    <div className="hidden text-right sm:block">
                      <div className="num text-sm">{money(p.price)}</div>
                      <Change value={p.changePercent} className="text-xs" />
                    </div>
                    <ScoreBadge score={p.overall} rating={p.rating} />
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
              {watchlist.map((q) => (
                <li key={q.ticker}>
                  <Link href={`/stock/${q.ticker}`} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{q.ticker}</div>
                      <div className="truncate text-xs text-text-2">{q.name}</div>
                    </div>
                    <Sparkline data={sparks[q.ticker]} />
                    <div className="w-20 text-right">
                      <div className="num text-sm">{money(q.price)}</div>
                      <Change value={q.changePercent} className="text-xs" />
                    </div>
                  </Link>
                </li>
              ))}
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
