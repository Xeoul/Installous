// Client-side data access. In the full app this calls the /api routes; in the
// static demo (NEXT_PUBLIC_DEMO=1) it reads the JSON snapshot published with
// the site and keeps the visitor's watchlist, holdings and profile in this
// browser's localStorage.
import type { AdvisorData } from "./advisor-core";
import type { ChartData, ChartRange } from "./chart";
import type { BotState } from "./condor-bot";
import { DEFAULT_PROFILE, DEFAULT_WATCHLIST } from "./defaults";
import type { BacktestView } from "./backtest";
import type { FundView } from "./fund";
import type { Fundamentals, NewsItem, Quote, SearchResult, StockEvents } from "./market";
import { computePortfolio, mergeHolding, type Pick, type PortfolioSnapshot } from "./portfolio";
import type { StockScore } from "./scoring";
import type { Holding, InvestorProfile } from "./store";

export const DEMO = process.env.NEXT_PUBLIC_DEMO === "1";
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export interface StockData {
  fundamentals: Fundamentals;
  score: StockScore;
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

// Full app: keep recent API reads in memory, so coming back to a page (or two
// components asking for the same data) is instant instead of another request.
// Writes clear the entries they change.
const apiCache = new Map<string, { at: number; value: Promise<unknown> }>();

function cachedJson<T>(url: string, ttlMs: number): Promise<T> {
  const hit = apiCache.get(url);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = json<T>(url);
  apiCache.set(url, { at: Date.now(), value });
  value.catch(() => apiCache.delete(url));
  return value;
}

function invalidate(...prefixes: string[]) {
  for (const key of apiCache.keys()) if (prefixes.some((p) => key.startsWith(p))) apiCache.delete(key);
}

const MARKET_TTL = 60_000;
const USER_TTL = 30_000;
/** Things that change when the watchlist, holdings or profile do. */
const USER_DATA = ["/api/watchlist", "/api/portfolio", "/api/picks", "/api/profile"];

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

/** The AI Fund's latest published state. */
export function getFund(): Promise<FundView> {
  if (DEMO) return snapshot("fund.json");
  return cachedJson("/api/fund", MARKET_TTL);
}

/** The AI Fund rules replayed over the last 5 years. */
export function getBacktest(): Promise<BacktestView> {
  if (DEMO) return snapshot("backtest.json");
  return cachedJson("/api/backtest", 10 * MARKET_TTL);
}

/** The live SPY condor bot's latest published state. */
export function getCondorBot(): Promise<BotState> {
  if (DEMO) return snapshot("condor.json");
  return cachedJson("/api/condor", MARKET_TTL);
}

/** The bot's latest published state, skipping every cache (to catch an order as it fills). */
export async function refreshCondorBot(): Promise<BotState> {
  const url = DEMO ? `${BASE_PATH}/demo-data/condor.json` : "/api/condor";
  const bot = await json<BotState>(`${url}?t=${Date.now()}`, { cache: "no-store" });
  const fresh = Promise.resolve(bot);
  if (DEMO) snapshotCache.set("condor.json", fresh);
  else apiCache.set("/api/condor", { at: Date.now(), value: fresh });
  return bot;
}


export function getStock(ticker: string): Promise<StockData> {
  const t = normalize(ticker);
  if (DEMO) return snapshot(`stock/${t}.json`, notInDemo(t));
  return cachedJson(`/api/stock/${encodeURIComponent(t)}`, MARKET_TTL);
}

export function getHistory(ticker: string, range: ChartRange): Promise<ChartData> {
  const t = normalize(ticker);
  if (DEMO) return snapshot(`history/${t}/${range}.json`, notInDemo(t));
  // Shorter than the 1D chart's one-minute refresh, so each refresh gets new data.
  return cachedJson(`/api/history/${encodeURIComponent(t)}?range=${range}`, 30_000);
}

/** The S&P 500's latest session (5-minute bars), always fresh: the demo republishes it every half hour. */
export async function getSpxDay(): Promise<ChartData> {
  if (!DEMO) return getHistory("^GSPC", "1d");
  const r = await fetch(`${BASE_PATH}/demo-data/spx-1d.json?t=${Math.floor(Date.now() / 60_000)}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`Couldn't load the S&P 500 chart (${r.status})`);
  return r.json() as Promise<ChartData>;
}

export function getEvents(ticker: string): Promise<StockEvents> {
  const t = normalize(ticker);
  if (DEMO) return snapshot(`events/${t}.json`, notInDemo(t));
  return cachedJson(`/api/events/${encodeURIComponent(t)}`, 10 * MARKET_TTL);
}

export function getNews(ticker: string): Promise<NewsItem[]> {
  const t = normalize(ticker);
  if (DEMO) return snapshot<NewsItem[]>(`news/${t}.json`).catch(() => []);
  return cachedJson(`/api/news/${encodeURIComponent(t)}`, 5 * MARKET_TTL);
}

export async function getPicks(): Promise<Pick[]> {
  if (!DEMO) return cachedJson("/api/picks", USER_TTL);
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
  if (!DEMO) return cachedJson(`/api/sparklines?tickers=${tickers.map(encodeURIComponent).join(",")}`, MARKET_TTL);
  const all = await snapshot<Record<string, ChartData>>("sparklines.json");
  return Object.fromEntries(tickers.filter((t) => all[t]).map((t) => [t, all[t]]));
}

export async function getWatchlist(): Promise<Quote[]> {
  if (!DEMO) return cachedJson("/api/watchlist", USER_TTL);
  const quotes = await demoQuotes();
  return readLocal().watchlist.map(
    (t) => quotes[t] ?? { ticker: t, name: t, price: null, change: null, changePercent: null },
  );
}

export async function addToWatchlist(ticker: string): Promise<string[]> {
  const t = normalize(ticker);
  if (!DEMO) return json<string[]>("/api/watchlist", send("POST", { ticker: t })).finally(() => invalidate(...USER_DATA));
  if (!(await demoSupports(t))) throw new Error(notInDemo(t));
  return writeLocal((s) => {
    if (!s.watchlist.includes(t)) s.watchlist.push(t);
  }).watchlist;
}

export async function removeFromWatchlist(ticker: string): Promise<string[]> {
  const t = normalize(ticker);
  if (!DEMO) return json<string[]>("/api/watchlist", send("DELETE", { ticker: t })).finally(() => invalidate(...USER_DATA));
  return writeLocal((s) => {
    s.watchlist = s.watchlist.filter((w) => w !== t);
  }).watchlist;
}

export async function getPortfolio(): Promise<PortfolioSnapshot> {
  if (!DEMO) return cachedJson("/api/portfolio", USER_TTL);
  const s = readLocal();
  return computePortfolio(s.holdings, await demoQuotes(), s.watchlist);
}

export async function addHolding(ticker: string, shares: number, price: number): Promise<PortfolioSnapshot> {
  const t = normalize(ticker);
  if (!DEMO) return json<PortfolioSnapshot>("/api/portfolio", send("POST", { ticker: t, shares, price })).finally(() => invalidate(...USER_DATA));
  if (!(await demoSupports(t))) throw new Error(notInDemo(t));
  writeLocal((s) => {
    s.holdings = mergeHolding(s.holdings, t, shares, price);
  });
  return getPortfolio();
}

export async function removeHolding(ticker: string): Promise<PortfolioSnapshot> {
  const t = normalize(ticker);
  if (!DEMO) return json<PortfolioSnapshot>("/api/portfolio", send("DELETE", { ticker: t })).finally(() => invalidate(...USER_DATA));
  writeLocal((s) => {
    s.holdings = s.holdings.filter((h) => h.ticker !== t);
  });
  return getPortfolio();
}

export async function getProfile(): Promise<InvestorProfile> {
  if (!DEMO) return cachedJson("/api/profile", USER_TTL);
  return readLocal().profile;
}

export async function saveProfile(profile: InvestorProfile): Promise<InvestorProfile> {
  if (!DEMO) return json<InvestorProfile>("/api/profile", send("PUT", profile)).finally(() => invalidate(...USER_DATA));
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
  events: getEvents,
  addToWatchlist,
};
