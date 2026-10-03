// Client-side data access. In the full app this calls the /api routes; in the
// static demo (NEXT_PUBLIC_DEMO=1) it reads the JSON snapshot published with
// the site and keeps the visitor's watchlist, holdings and profile in this
// browser's localStorage.
import type { AdvisorData } from "./advisor-core";
import type { ChartData, ChartRange } from "./chart";
import { DEFAULT_PROFILE, DEFAULT_WATCHLIST } from "./defaults";
import type { BacktestView } from "./backtest";
import type { FundView } from "./fund";
import type { Fundamentals, NewsItem, Quote, SearchResult } from "./market";
import { computePortfolio, mergeHolding, type Pick, type PortfolioSnapshot } from "./portfolio";
import type { StockScore } from "./scoring";
import type { Holding, InvestorProfile } from "./store";

export const DEMO = process.env.NEXT_PUBLIC_DEMO === "1";
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export interface StockData {
  fundamentals: Fundamentals;
  score: StockScore;
}

export interface DemoMeta {
  generatedAt: string;
  tickers: number;
}

export function stockHref(ticker: string) {
  return `/stock?symbol=${encodeURIComponent(ticker)}`;
}

function normalize(ticker: string) {
  return ticker.trim().toUpperCase();
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `Request failed (${r.status})`);
  return body as T;
}

const send = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

// ---------------------------------------------------------------------------
// Demo snapshot + browser storage

const snapshotCache = new Map<string, Promise<unknown>>();

function snapshot<T>(path: string, notFound?: string): Promise<T> {
  let p = snapshotCache.get(path) as Promise<T> | undefined;
  if (!p) {
    p = fetch(`${BASE_PATH}/demo-data/${path}`).then(async (r) => {
      if (r.status === 404 && notFound) throw new Error(notFound);
      if (!r.ok) throw new Error(`Couldn't load demo data (${r.status})`);
      return r.json() as Promise<T>;
    });
    p.catch(() => snapshotCache.delete(path));
    snapshotCache.set(path, p);
  }
  return p;
}

const notInDemo = (t: string) =>
  `${t} isn't in the demo's data set. The live demo covers about 50 large-cap US stocks; run Installous locally to research any ticker.`;

interface LocalStore {
  watchlist: string[];
  holdings: Holding[];
  profile: InvestorProfile;
}

const STORE_KEY = "installous.demo.store.v1";

function readLocal(): LocalStore {
  const fallback: LocalStore = { watchlist: [...DEFAULT_WATCHLIST], holdings: [], profile: { ...DEFAULT_PROFILE } };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<LocalStore>) } : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(mutate: (s: LocalStore) => void): LocalStore {
  const s = readLocal();
  mutate(s);
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    // Storage unavailable (private mode etc.); changes last for this page view only.
  }
  return s;
}

const demoQuotes = () => snapshot<Record<string, Quote>>("quotes.json");

async function demoSupports(ticker: string): Promise<boolean> {
  return ticker in (await demoQuotes());
}

// ---------------------------------------------------------------------------
// Public API used by the pages

export function getDemoMeta(): Promise<DemoMeta> {
  return snapshot<DemoMeta>("meta.json");
}

/** The AI Fund's latest published state. */
export function getFund(): Promise<FundView> {
  if (DEMO) return snapshot("fund.json");
  return json("/api/fund");
}

/** The AI Fund rules replayed over the last 5 years. */
export function getBacktest(): Promise<BacktestView> {
  if (DEMO) return snapshot("backtest.json");
  return json("/api/backtest");
}

export function getStock(ticker: string): Promise<StockData> {
  const t = normalize(ticker);
  if (DEMO) return snapshot(`stock/${t}.json`, notInDemo(t));
  return json(`/api/stock/${encodeURIComponent(t)}`);
}

export function getHistory(ticker: string, range: ChartRange): Promise<ChartData> {
  const t = normalize(ticker);
  if (DEMO) return snapshot(`history/${t}/${range}.json`, notInDemo(t));
  return json(`/api/history/${encodeURIComponent(t)}?range=${range}`);
}

export function getNews(ticker: string): Promise<NewsItem[]> {
  const t = normalize(ticker);
  if (DEMO) return snapshot<NewsItem[]>(`news/${t}.json`).catch(() => []);
  return json(`/api/news/${encodeURIComponent(t)}`);
}

export async function getPicks(): Promise<Pick[]> {
  if (!DEMO) return json("/api/picks");
  const { watchlist } = readLocal();
  const picks = await snapshot<Pick[]>("picks.json");
  return picks.map((p) => ({ ...p, onWatchlist: watchlist.includes(p.ticker) }));
}

export async function searchTickers(q: string, signal?: AbortSignal): Promise<SearchResult[]> {
  if (!DEMO) return json(`/api/search?q=${encodeURIComponent(q)}`, { signal });
  const all = await snapshot<SearchResult[]>("search.json");
  const needle = q.trim().toLowerCase();
  const starts = all.filter((r) => r.ticker.toLowerCase().startsWith(needle));
  const rest = all.filter((r) => !starts.includes(r) && r.name.toLowerCase().includes(needle));
  return [...starts, ...rest].slice(0, 8);
}

export async function getSparklines(tickers: string[]): Promise<Record<string, ChartData>> {
  if (tickers.length === 0) return {};
  if (!DEMO) return json(`/api/sparklines?tickers=${tickers.map(encodeURIComponent).join(",")}`);
  const all = await snapshot<Record<string, ChartData>>("sparklines.json");
  return Object.fromEntries(tickers.filter((t) => all[t]).map((t) => [t, all[t]]));
}

export async function getWatchlist(): Promise<Quote[]> {
  if (!DEMO) return json("/api/watchlist");
  const quotes = await demoQuotes();
  return readLocal().watchlist.map(
    (t) => quotes[t] ?? { ticker: t, name: t, price: null, change: null, changePercent: null },
  );
}

export async function addToWatchlist(ticker: string): Promise<string[]> {
  const t = normalize(ticker);
  if (!DEMO) return json("/api/watchlist", send("POST", { ticker: t }));
  if (!(await demoSupports(t))) throw new Error(notInDemo(t));
  return writeLocal((s) => {
    if (!s.watchlist.includes(t)) s.watchlist.push(t);
  }).watchlist;
}

export async function removeFromWatchlist(ticker: string): Promise<string[]> {
  const t = normalize(ticker);
  if (!DEMO) return json("/api/watchlist", send("DELETE", { ticker: t }));
  return writeLocal((s) => {
    s.watchlist = s.watchlist.filter((w) => w !== t);
  }).watchlist;
}

export async function getPortfolio(): Promise<PortfolioSnapshot> {
  if (!DEMO) return json("/api/portfolio");
  const s = readLocal();
  return computePortfolio(s.holdings, await demoQuotes(), s.watchlist);
}

export async function addHolding(ticker: string, shares: number, price: number): Promise<PortfolioSnapshot> {
  const t = normalize(ticker);
  if (!DEMO) return json("/api/portfolio", send("POST", { ticker: t, shares, price }));
  if (!(await demoSupports(t))) throw new Error(notInDemo(t));
  writeLocal((s) => {
    s.holdings = mergeHolding(s.holdings, t, shares, price);
  });
  return getPortfolio();
}

export async function removeHolding(ticker: string): Promise<PortfolioSnapshot> {
  const t = normalize(ticker);
  if (!DEMO) return json("/api/portfolio", send("DELETE", { ticker: t }));
  writeLocal((s) => {
    s.holdings = s.holdings.filter((h) => h.ticker !== t);
  });
  return getPortfolio();
}

export async function getProfile(): Promise<InvestorProfile> {
  if (!DEMO) return json("/api/profile");
  return readLocal().profile;
}

export async function saveProfile(profile: InvestorProfile): Promise<InvestorProfile> {
  if (!DEMO) return json("/api/profile", send("PUT", profile));
  return writeLocal((s) => {
    s.profile = profile;
  }).profile;
}

/** Advisor tools backed by the demo snapshot, for the in-browser advisor. */
export const demoAdvisorData: AdvisorData = {
  stock: getStock,
  history: getHistory,
  search: (q) => searchTickers(q),
  portfolio: getPortfolio,
  topPicks: getPicks,
  news: getNews,
  addToWatchlist,
};
