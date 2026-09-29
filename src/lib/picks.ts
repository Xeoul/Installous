import "server-only";
import { getFundamentals, type Fundamentals } from "./market";
import { toPick, type Pick } from "./portfolio";
import { scoreStock, type StockScore } from "./scoring";
import { DEFAULT_UNIVERSE } from "./universe";

export interface ScoredStock {
  fundamentals: Fundamentals;
  score: StockScore;
}

export async function scoreTicker(ticker: string): Promise<ScoredStock> {
  const fundamentals = await getFundamentals(ticker);
  return { fundamentals, score: scoreStock(fundamentals) };
}

/** Score many tickers with bounded concurrency; tickers that fail to load are skipped. */
export async function scoreMany(tickers: string[], concurrency = 6): Promise<ScoredStock[]> {
  const queue = [...new Set(tickers)];
  const results: ScoredStock[] = [];
  async function worker() {
    while (queue.length) {
      const t = queue.shift()!;
      try {
        results.push(await scoreTicker(t));
      } catch {
        // Unknown or delisted ticker; leave it out of the ranking.
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results.sort((a, b) => (b.score.overall ?? -1) - (a.score.overall ?? -1));
}

/** The Top Picks list: the default universe plus the watchlist, ranked. */
export async function buildPicks(watchlist: string[]): Promise<Pick[]> {
  const ranked = await scoreMany([...DEFAULT_UNIVERSE, ...watchlist]);
  return ranked.map(({ fundamentals, score }) => toPick(fundamentals, score, watchlist));
}
