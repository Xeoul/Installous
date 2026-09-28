import "server-only";
import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

// Small in-memory TTL cache so repeated page loads and AI tool calls
// don't hammer the data provider.
const cache = new Map<string, { expires: number; value: unknown }>();

async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const value = await load();
  cache.set(key, { expires: Date.now() + ttlMs, value });
  return value;
}

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
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v instanceof Date) return null;
  return null;
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
      };
    }
    return out;
  });
}

export type HistoryRange = "1mo" | "3mo" | "6mo" | "1y" | "2y" | "5y";

export const HISTORY_RANGES: HistoryRange[] = ["1mo", "3mo", "6mo", "1y", "2y", "5y"];

const RANGE_DAYS: Record<HistoryRange, number> = {
  "1mo": 31,
  "3mo": 92,
  "6mo": 183,
  "1y": 366,
  "2y": 731,
  "5y": 1827,
};

export interface PricePoint {
  date: string;
  close: number;
}

export async function getHistory(rawTicker: string, range: HistoryRange): Promise<PricePoint[]> {
  const ticker = normalizeTicker(rawTicker);
  return cached(`hist:${ticker}:${range}`, 15 * MINUTE, async () => {
    const period1 = new Date(Date.now() - RANGE_DAYS[range] * 86_400_000);
    const interval = range === "5y" ? "1wk" : "1d";
    const chart = await yf.chart(ticker, { period1, interval });
    return chart.quotes
      .filter((p) => typeof p.close === "number")
      .map((p) => ({ date: p.date.toISOString().slice(0, 10), close: p.close as number }));
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
    return res.news.map((n) => ({
      title: n.title,
      publisher: n.publisher,
      link: n.link,
      published: n.providerPublishTime.toISOString(),
    }));
  });
}
