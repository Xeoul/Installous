import "server-only";
import YahooFinance from "yahoo-finance2";
import { createCache } from "./cache";
import type { Chain } from "./condor-bot";
import type { IndexBar } from "./options";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

// Shared so repeated page loads and the advisor's tool calls don't hammer the
// data provider; see cache.ts.
const { cached } = createCache();

const MINUTE = 60_000;

export interface Fundamentals {
  ticker: string;
  name: string;
  exchange?: string;
  currency?: string;
  sector?: string;
  industry?: string;
  summary?: string;
  website?: string;

  price: number | null;
  change: number | null;
  changePercent: number | null;
  marketCap: number | null;
  volume: number | null;

  fiftyDayAverage: number | null;
  twoHundredDayAverage: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  fiftyTwoWeekChangePercent: number | null;

  trailingPE: number | null;
  forwardPE: number | null;
  pegRatio: number | null;
  priceToBook: number | null;
  priceToSales: number | null;
  enterpriseToEbitda: number | null;
  dividendYield: number | null;
  beta: number | null;

  revenueGrowth: number | null;
  earningsGrowth: number | null;
  grossMargins: number | null;
  operatingMargins: number | null;
  profitMargins: number | null;
  returnOnEquity: number | null;
  returnOnAssets: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  freeCashflow: number | null;

  analystRating: string | null;
  analystRatingMean: number | null;
  analystCount: number | null;
  targetMeanPrice: number | null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function normalizeTicker(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9.\-^=]/g, "");
}

export async function getFundamentals(rawTicker: string): Promise<Fundamentals> {
  const ticker = normalizeTicker(rawTicker);
  return cached(`fund:${ticker}`, 10 * MINUTE, async () => {
    const [q, s] = await Promise.all([
      yf.quote(ticker),
      yf
        .quoteSummary(ticker, {
          modules: ["financialData", "defaultKeyStatistics", "summaryDetail", "assetProfile"],
        })
        .catch(() => null),
    ]);
    if (!q) throw new Error(`Unknown ticker: ${ticker}`);
    const fd = s?.financialData;
    const ks = s?.defaultKeyStatistics;
    const sd = s?.summaryDetail;
    const ap = s?.assetProfile;

    return {
      ticker,
      name: q.longName ?? q.shortName ?? ticker,
      exchange: q.fullExchangeName,
      currency: q.currency,
      sector: ap?.sector,
      industry: ap?.industry,
      summary: ap?.longBusinessSummary,
      website: ap?.website,

      price: num(q.regularMarketPrice),
      change: num(q.regularMarketChange),
      changePercent: num(q.regularMarketChangePercent),
      marketCap: num(q.marketCap),
      volume: num(q.regularMarketVolume),

      fiftyDayAverage: num(q.fiftyDayAverage),
      twoHundredDayAverage: num(q.twoHundredDayAverage),
      fiftyTwoWeekHigh: num(q.fiftyTwoWeekHigh),
      fiftyTwoWeekLow: num(q.fiftyTwoWeekLow),
      fiftyTwoWeekChangePercent: num(q.fiftyTwoWeekChangePercent),

      trailingPE: num(q.trailingPE) ?? num(sd?.trailingPE),
      forwardPE: num(q.forwardPE) ?? num(ks?.forwardPE),
      pegRatio: num(ks?.pegRatio),
      priceToBook: num(q.priceToBook) ?? num(ks?.priceToBook),
      priceToSales: num(sd?.priceToSalesTrailing12Months),
      enterpriseToEbitda: num(ks?.enterpriseToEbitda),
      dividendYield: num(sd?.dividendYield),
      beta: num(sd?.beta) ?? num(ks?.beta),

      revenueGrowth: num(fd?.revenueGrowth),
      earningsGrowth: num(fd?.earningsGrowth),
      grossMargins: num(fd?.grossMargins),
      operatingMargins: num(fd?.operatingMargins),
      profitMargins: num(fd?.profitMargins),
      returnOnEquity: num(fd?.returnOnEquity),
      returnOnAssets: num(fd?.returnOnAssets),
      debtToEquity: num(fd?.debtToEquity),
      currentRatio: num(fd?.currentRatio),
      freeCashflow: num(fd?.freeCashflow),

      analystRating: fd?.recommendationKey ?? null,
      analystRatingMean: num(fd?.recommendationMean),
      analystCount: num(fd?.numberOfAnalystOpinions),
      targetMeanPrice: num(fd?.targetMeanPrice),
    };
  });
}

export interface Quote {
  ticker: string;
  name: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  /** When the price was last updated (ISO), for knowing which market day it belongs to. */
  marketTime?: string;
}

export async function getQuotes(rawTickers: string[]): Promise<Record<string, Quote>> {
  const tickers = [...new Set(rawTickers.map(normalizeTicker))].filter(Boolean);
  if (tickers.length === 0) return {};
  const key = `quotes:${tickers.slice().sort().join(",")}`;
  return cached(key, 1 * MINUTE, async () => {
    const results = await yf.quote(tickers, { return: "array" });
    const out: Record<string, Quote> = {};
    for (const q of results) {
      out[q.symbol] = {
        ticker: q.symbol,
        name: q.longName ?? q.shortName ?? q.symbol,
        price: num(q.regularMarketPrice),
        change: num(q.regularMarketChange),
        changePercent: num(q.regularMarketChangePercent),
        marketTime: q.regularMarketTime instanceof Date ? q.regularMarketTime.toISOString() : undefined,
      };
    }
    return out;
  });
}

export type HistoryRange = "1d" | "1w" | "1mo" | "3mo" | "ytd" | "1y" | "5y";

export const HISTORY_RANGES: HistoryRange[] = ["1d", "1w", "1mo", "3mo", "ytd", "1y", "5y"];

type Interval = "5m" | "15m" | "1h" | "1d" | "1wk";

const RANGE_CONFIG: Record<Exclude<HistoryRange, "1d" | "ytd">, { days: number; interval: Interval }> = {
  "1w": { days: 7, interval: "15m" },
  "1mo": { days: 31, interval: "1h" },
  "3mo": { days: 92, interval: "1d" },
  "1y": { days: 366, interval: "1d" },
  "5y": { days: 1827, interval: "1wk" },
};

export interface PricePoint {
  t: number; // epoch ms
  close: number;
}

export interface PriceHistory {
  ticker: string;
  range: HistoryRange;
  intraday: boolean;
  points: PricePoint[];
  /** Reference price for the change calculation: previous close for 1D, first point otherwise. */
  baseline: number;
  /** 1D only: regular-session open/close, so the chart can leave room for the rest of the day. */
  sessionStart?: number;
  sessionEnd?: number;
}

function toPoints(quotes: { date: Date; close?: number | null }[]): PricePoint[] {
  return quotes
    .filter((q) => typeof q.close === "number")
    .map((q) => ({ t: q.date.getTime(), close: q.close as number }));
}

async function getIntraday(ticker: string): Promise<PriceHistory> {
  // Fetch several days so we always have the latest session plus the close before it,
  // even on Mondays and after holidays.
  const chart = await yf.chart(ticker, {
    period1: new Date(Date.now() - 7 * 86_400_000),
    interval: "5m",
    includePrePost: false,
  });
  const offsetMs = (chart.meta.gmtoffset ?? 0) * 1000;
  const exchangeDay = (t: number) => Math.floor((t + offsetMs) / 86_400_000);
  const all = toPoints(chart.quotes);
  if (all.length === 0) throw new Error(`No intraday data for ${ticker}`);

  const lastDay = exchangeDay(all[all.length - 1].t);
  const points = all.filter((p) => exchangeDay(p.t) === lastDay);
  const before = all.filter((p) => exchangeDay(p.t) < lastDay);
  // Prefer the exchange's official previous close; the last 5-minute bar can differ slightly.
  const baseline =
    chart.meta.previousClose ?? (before.length ? before[before.length - 1].close : points[0].close);

  // US regular session 9:30-16:00 in exchange-local time.
  const dayStart = lastDay * 86_400_000 - offsetMs;
  return {
    ticker,
    range: "1d",
    intraday: true,
    points,
    baseline,
    sessionStart: dayStart + 9.5 * 3_600_000,
    sessionEnd: dayStart + 16 * 3_600_000,
  };
}

export async function getHistory(rawTicker: string, range: HistoryRange): Promise<PriceHistory> {
  const ticker = normalizeTicker(rawTicker);
  const ttl = range === "1d" || range === "1w" ? 1 * MINUTE : 15 * MINUTE;
  return cached(`hist:${ticker}:${range}`, ttl, async () => {
    if (range === "1d") return getIntraday(ticker);
    const { days, interval } =
      range === "ytd"
        ? { days: 0, interval: "1d" as Interval }
        : RANGE_CONFIG[range];
    const period1 =
      range === "ytd"
        ? new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1))
        : new Date(Date.now() - days * 86_400_000);
    const chart = await yf.chart(ticker, { period1, interval, includePrePost: false });
    const points = toPoints(chart.quotes);
    if (points.length === 0) throw new Error(`No price history for ${ticker}`);
    return {
      ticker,
      range,
      intraday: interval !== "1d" && interval !== "1wk",
      points,
      baseline: points[0].close,
    };
  });
}

export interface SearchResult {
  ticker: string;
  name: string;
  exchange?: string;
  type?: string;
}

export async function searchTickers(query: string): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  return cached(`search:${q.toLowerCase()}`, 60 * MINUTE, async () => {
    const res = await yf.search(q, { newsCount: 0, quotesCount: 8 });
    const out: SearchResult[] = [];
    for (const item of res.quotes) {
      if (!("symbol" in item) || !item.isYahooFinance) continue;
      if (item.quoteType !== "EQUITY" && item.quoteType !== "ETF") continue;
      out.push({
        ticker: item.symbol,
        name: item.longname ?? item.shortname ?? item.symbol,
        exchange: item.exchDisp,
        type: item.quoteType,
      });
    }
    return out;
  });
}

export interface NewsItem {
  title: string;
  publisher: string;
  link: string;
  published: string;
}

export async function getNews(rawTicker: string): Promise<NewsItem[]> {
  const ticker = normalizeTicker(rawTicker);
  return cached(`news:${ticker}`, 30 * MINUTE, async () => {
    const res = await yf.search(ticker, { newsCount: 8, quotesCount: 0 });
    // Skip malformed items instead of failing the whole list over one of them.
    return res.news
      .filter((n) => n.title && n.link && n.providerPublishTime instanceof Date && !Number.isNaN(n.providerPublishTime.getTime()))
      .map((n) => ({
        title: n.title,
        publisher: n.publisher ?? "",
        link: n.link,
        published: n.providerPublishTime.toISOString(),
      }));
  });
}

/** The nearest-expiring option chain for a ticker (on a trading day, today's), for the condor bot. */
export async function getNearestChain(rawTicker: string): Promise<Chain> {
  const ticker = normalizeTicker(rawTicker);
  const r = await yf.options(ticker);
  const o = r.options[0];
  const spot = num(r.quote?.regularMarketPrice);
  if (!o || spot === null) throw new Error(`No option chain for ${ticker}`);
  const leg = (c: { strike: number; bid?: number; ask?: number }) => ({ strike: c.strike, bid: c.bid ?? 0, ask: c.ask ?? 0 });
  return { expiry: o.expirationDate.toISOString().slice(0, 10), spot, puts: o.puts.map(leg), calls: o.calls.map(leg) };
}

/** Daily SPY bars since 2006 joined with the VIX close, for the Options Lab. */
export async function getIndexBars(): Promise<IndexBar[]> {
  return cached("index-bars", 60 * MINUTE, async () => {
    const period1 = new Date("2006-01-01");
    const [spx, vix] = await Promise.all([
      yf.chart("SPY", { period1, interval: "1d" }),
      yf.chart("^VIX", { period1, interval: "1d" }),
    ]);
    const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const vixByDay = new Map(vix.quotes.filter((q) => typeof q.close === "number").map((q) => [day(q.date), q.close as number]));
    const round = (x: number) => Math.round(x * 100) / 100;
    return spx.quotes.flatMap((q) => {
      const date = day(q.date);
      const v = vixByDay.get(date);
      return typeof q.open === "number" && typeof q.close === "number" && q.open > 0 && v
        ? [{ date, open: round(q.open), close: round(q.close), vix: round(v) }]
        : [];
    });
  });
}

/** Daily closes for the last `years` years, dated in exchange (New York) time. */
export async function getDailyCloses(rawTicker: string, years: number): Promise<{ date: string; close: number }[]> {
  const ticker = normalizeTicker(rawTicker);
  return cached(`daily:${ticker}:${years}`, 60 * MINUTE, async () => {
    const chart = await yf.chart(ticker, {
      period1: new Date(Date.now() - years * 365.25 * 86_400_000),
      interval: "1d",
      includePrePost: false,
    });
    return chart.quotes
      .filter((q) => typeof q.close === "number")
      .map((q) => ({
        date: q.date.toLocaleDateString("en-CA", { timeZone: "America/New_York" }),
        close: q.close as number,
      }));
  });
}

export interface StockEvents {
  ticker: string;
  nextEarnings: {
    date: string; // ISO
    confirmed: boolean;
    epsAverage: number | null;
    epsLow: number | null;
    epsHigh: number | null;
    revenueAverage: number | null;
  } | null;
  /** Up to the last four reported quarters, oldest first. */
  earningsHistory: { quarter: string; epsActual: number | null; epsEstimate: number | null; surprisePercent: number | null }[];
  dividends: {
    annualRate: number | null;
    yieldPercent: number | null;
    exDividendDate: string | null;
    payoutRatioPercent: number | null;
    /** Total paid per calendar year, last 5 years (oldest first). */
    byYear: { year: number; total: number; payments: number }[];
  };
}

const isoOrNull = (d: unknown) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString() : null);

/** Earnings dates, estimates and recent results, plus dividend history. */
export async function getEvents(rawTicker: string): Promise<StockEvents> {
  const ticker = normalizeTicker(rawTicker);
  return cached(`events:${ticker}`, 6 * 60 * MINUTE, async () => {
    const [s, chart] = await Promise.all([
      yf.quoteSummary(ticker, { modules: ["calendarEvents", "earningsHistory", "summaryDetail"] }).catch(() => null),
      yf
        .chart(ticker, { period1: new Date(Date.now() - 5.5 * 365.25 * 86_400_000), interval: "1mo", events: "div" })
        .catch(() => null),
    ]);
    const cal = s?.calendarEvents?.earnings;
    const nextDate = cal?.earningsDate?.find((d) => d instanceof Date && d.getTime() > Date.now() - 86_400_000);
    const sd = s?.summaryDetail;

    const byYear = new Map<number, { total: number; payments: number }>();
    for (const d of chart?.events?.dividends ?? []) {
      const year = new Date(d.date).getUTCFullYear();
      const y = byYear.get(year) ?? { total: 0, payments: 0 };
      y.total += d.amount;
      y.payments += 1;
      byYear.set(year, y);
    }
    const thisYear = new Date().getUTCFullYear();

    return {
      ticker,
      nextEarnings: nextDate
        ? {
            date: nextDate.toISOString(),
            confirmed: cal?.isEarningsDateEstimate === false,
            epsAverage: num(cal?.earningsAverage),
            epsLow: num(cal?.earningsLow),
            epsHigh: num(cal?.earningsHigh),
            revenueAverage: num(cal?.revenueAverage),
          }
        : null,
      earningsHistory: (s?.earningsHistory?.history ?? [])
        .map((h) => ({
          quarter: isoOrNull(h.quarter) ?? "",
          epsActual: num(h.epsActual),
          epsEstimate: num(h.epsEstimate),
          surprisePercent: num(h.surprisePercent) === null ? null : Math.round((num(h.surprisePercent) as number) * 10_000) / 100,
        }))
        .filter((h) => h.quarter)
        .sort((a, b) => a.quarter.localeCompare(b.quarter))
        .slice(-4),
      dividends: {
        annualRate: num(sd?.dividendRate),
        yieldPercent: num(sd?.dividendYield) === null ? null : (num(sd?.dividendYield) as number) * 100,
        exDividendDate: isoOrNull(sd?.exDividendDate),
        payoutRatioPercent: num(sd?.payoutRatio) === null ? null : (num(sd?.payoutRatio) as number) * 100,
        byYear: [...byYear.entries()]
          .filter(([y]) => y > thisYear - 5)
          .sort((a, b) => a[0] - b[0])
          .map(([year, v]) => ({ year, total: Math.round(v.total * 10_000) / 10_000, payments: v.payments })),
      },
    };
  });
}
