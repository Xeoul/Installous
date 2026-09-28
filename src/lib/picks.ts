import "server-only";
import { getFundamentals, type Fundamentals } from "./market";
import { scoreStock, type StockScore } from "./scoring";

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
