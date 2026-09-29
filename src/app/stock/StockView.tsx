"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card } from "@/components/Card";
import { Chat } from "@/components/Chat";
import { FactorBars } from "@/components/FactorBars";
import { StockChart } from "@/components/StockChart";
import { ScoreBadge } from "@/components/ScoreBadge";
import {
  addToWatchlist,
  getNews,
  getStock,
  getWatchlist,
  removeFromWatchlist,
  type StockData,
} from "@/lib/client-data";
import { compact, fixed, money, ratioPct } from "@/lib/format";
import type { NewsItem } from "@/lib/market";

export function StockView({ ticker }: { ticker: string }) {
  const [data, setData] = useState<StockData | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [watching, setWatching] = useState<boolean | null>(null);
  const [analyze, setAnalyze] = useState(false);

  useEffect(() => {
    getStock(ticker)
      .then(setData)
      .catch((e: Error) => setError(e.message));
    getNews(ticker)
      .then(setNews)
      .catch(() => {});
    getWatchlist()
      .then((w) => setWatching(w.some((x) => x.ticker === ticker)))
      .catch(() => {});
  }, [ticker]);

  async function toggleWatch() {
    try {
      const list = watching ? await removeFromWatchlist(ticker) : await addToWatchlist(ticker);
      setWatching(list.includes(ticker));
    } catch {
      // leave the button as it was
    }
  }

  if (error) {
    return (
      <div className="py-16 text-center">
        <h1 className="text-xl font-semibold">Couldn&apos;t load {ticker}</h1>
        <p className="mt-2 text-text-2">{error}</p>
        <Link href="/" className="mt-4 inline-block text-accent">← Back to dashboard</Link>
      </div>
    );
  }

  const f = data?.fundamentals;
  const s = data?.score;

  const metrics: [string, string][] = f
    ? [
        ["Market cap", compact(f.marketCap)],
        ["P/E (TTM)", fixed(f.trailingPE, 1)],
        ["Forward P/E", fixed(f.forwardPE, 1)],
        ["PEG", fixed(f.pegRatio)],
        ["P/B", fixed(f.priceToBook)],
        ["EV/EBITDA", fixed(f.enterpriseToEbitda, 1)],
        ["Revenue growth", ratioPct(f.revenueGrowth)],
        ["Earnings growth", ratioPct(f.earningsGrowth)],
        ["Operating margin", ratioPct(f.operatingMargins)],
        ["ROE", ratioPct(f.returnOnEquity)],
        ["Debt / equity", f.debtToEquity === null ? "—" : `${(f.debtToEquity / 100).toFixed(2)}x`],
        ["Dividend yield", ratioPct(f.dividendYield, 2)],
        ["Beta", fixed(f.beta)],
        ["52-wk range", f.fiftyTwoWeekLow && f.fiftyTwoWeekHigh ? `${f.fiftyTwoWeekLow.toFixed(2)} – ${f.fiftyTwoWeekHigh.toFixed(2)}` : "—"],
        ["Analyst target", money(f.targetMeanPrice, f.currency)],
        ["Consensus", f.analystRating ? `${f.analystRating.replaceAll("_", " ")} (${f.analystCount ?? 0})` : "—"],
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <div className="mb-1 flex flex-wrap items-baseline gap-x-3">
            <h1 className="text-2xl font-semibold">{f?.name ?? ticker}</h1>
            <span className="text-sm font-medium text-text-2">{ticker}</span>
          </div>
          <div className="mb-4 text-xs text-muted">{[f?.exchange, f?.sector, f?.industry].filter(Boolean).join(" · ")}</div>
          <StockChart ticker={ticker} currency={f?.currency} />
        </section>

        <aside className="space-y-4">
          <div className="flex gap-2">
            <button
              onClick={toggleWatch}
              disabled={watching === null}
              className="flex-1 rounded-full border border-border px-3 py-2 text-sm font-medium hover:border-accent"
            >
              {watching ? "★ Watching" : "☆ Add to watchlist"}
            </button>
            <Link
              href={`/portfolio?add=${ticker}`}
              className="flex-1 rounded-full bg-accent px-3 py-2 text-center text-sm font-medium text-white"
            >
              + Add position
            </Link>
          </div>
          <Card title="Installous Score" action={s && <ScoreBadge score={s.overall} rating={s.rating} />}>
            {s ? <FactorBars factors={s.factors} /> : <div className="h-64 animate-pulse rounded-lg bg-surface-2" />}
          </Card>
        </aside>
      </div>

      <Card
        title="AI analysis"
        action={
          !analyze && (
            <button onClick={() => setAnalyze(true)} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white">
              Analyze {ticker} with AI
            </button>
          )
        }
      >
        {analyze ? (
          <div className="h-[520px]">
            <Chat
              compact
              initialPrompt={`Give me a full investment analysis of ${ticker}: business quality, valuation, growth, momentum, recent news, key risks, and a clear verdict (buy / accumulate / hold / avoid) with a fair-value range and how it fits my portfolio.`}
            />
          </div>
        ) : (
          <p className="text-sm text-text-2">
            Get a written investment thesis with a clear verdict. Installous checks fundamentals, price action, recent news,
            and how {ticker} fits your portfolio.
          </p>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Key metrics" className="lg:col-span-2">
          {f ? (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              {metrics.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-muted">{k}</dt>
                  <dd className="num text-sm font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <div className="h-40 animate-pulse rounded-lg bg-surface-2" />
          )}
          {f?.summary && <p className="mt-5 line-clamp-5 text-sm text-text-2">{f.summary}</p>}
        </Card>
        <Card title="News">
          {news.length === 0 ? (
            <p className="text-sm text-muted">No recent headlines.</p>
          ) : (
            <ul className="space-y-3">
              {news.slice(0, 6).map((n) => (
                <li key={n.link}>
                  <a href={n.link} target="_blank" rel="noreferrer" className="text-sm font-medium hover:text-accent">
                    {n.title}
                  </a>
                  <div className="text-xs text-muted">
                    {n.publisher} · {new Date(n.published).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
