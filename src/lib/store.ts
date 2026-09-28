import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { normalizeTicker } from "./market";

// Single-user app: everything persists to one JSON file on disk.
const DATA_DIR = process.env.INSTALLOUS_DATA_DIR ?? path.join(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");

export interface Holding {
  ticker: string;
  shares: number;
  costBasis: number; // average cost per share
}

export type RiskTolerance = "conservative" | "moderate" | "aggressive";

export interface InvestorProfile {
  risk: RiskTolerance;
  horizon: string;
  goals: string;
}

export interface Store {
  watchlist: string[];
  holdings: Holding[];
  profile: InvestorProfile;
}

const DEFAULT_STORE: Store = {
  watchlist: ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN"],
  holdings: [],
  profile: {
    risk: "moderate",
    horizon: "5+ years",
    goals: "Long-term growth with a diversified portfolio.",
  },
};

let writeChain: Promise<unknown> = Promise.resolve();

export async function readStore(): Promise<Store> {
  try {
    const raw = await fs.readFile(STORE_FILE, "utf8");
    return { ...DEFAULT_STORE, ...(JSON.parse(raw) as Partial<Store>) };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(DEFAULT_STORE);
    throw err;
  }
}

/** Serialize read-modify-write cycles so concurrent requests don't clobber each other. */
export function updateStore(mutate: (s: Store) => void): Promise<Store> {
  const next = writeChain.then(async () => {
    const store = await readStore();
    mutate(store);
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmp = `${STORE_FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(store, null, 2));
    await fs.rename(tmp, STORE_FILE);
    return store;
  });
  writeChain = next.catch(() => undefined);
  return next;
}

export function addToWatchlist(ticker: string) {
  const t = normalizeTicker(ticker);
  return updateStore((s) => {
    if (t && !s.watchlist.includes(t)) s.watchlist.push(t);
  });
}

export function removeFromWatchlist(ticker: string) {
  const t = normalizeTicker(ticker);
  return updateStore((s) => {
    s.watchlist = s.watchlist.filter((w) => w !== t);
  });
}

/** Buying more of an existing holding re-averages the cost basis. */
export function addHolding(ticker: string, shares: number, price: number) {
  const t = normalizeTicker(ticker);
  return updateStore((s) => {
    const existing = s.holdings.find((h) => h.ticker === t);
    if (existing) {
      const totalShares = existing.shares + shares;
      existing.costBasis = (existing.costBasis * existing.shares + price * shares) / totalShares;
      existing.shares = totalShares;
    } else {
      s.holdings.push({ ticker: t, shares, costBasis: price });
    }
  });
}

export function removeHolding(ticker: string) {
  const t = normalizeTicker(ticker);
  return updateStore((s) => {
    s.holdings = s.holdings.filter((h) => h.ticker !== t);
  });
}

export function setProfile(profile: InvestorProfile) {
  return updateStore((s) => {
    s.profile = profile;
  });
}
