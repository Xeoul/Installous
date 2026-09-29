// Snapshot market data for the static demo into public/demo-data/.
// Run with `npm run demo:data` (the GitHub Pages workflow does this on a
// schedule). Uses the same data and scoring code as the full app, so the
// JSON matches what the /api routes return.
import { mkdir, rm, writeFile } from "fs/promises";
import path from "path";
import { DEFAULT_WATCHLIST } from "../src/lib/defaults";
import { getHistory, getNews, getQuotes, HISTORY_RANGES, type PriceHistory, type SearchResult } from "../src/lib/market";
import { scoreTicker, type ScoredStock } from "../src/lib/picks";
import { toPick } from "../src/lib/portfolio";
import { DEFAULT_UNIVERSE } from "../src/lib/universe";

const OUT = path.join(process.cwd(), "public", "demo-data");
const TICKERS = [...new Set([...DEFAULT_UNIVERSE, ...DEFAULT_WATCHLIST])];
const CONCURRENCY = 4;

async function write(rel: string, data: unknown) {
  const file = path.join(OUT, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data));
}

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts) throw err;
      console.warn(`  retry ${i} for ${label}: ${(err as Error).message}`);
      await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
}

async function snapshotTicker(t: string): Promise<{ scored: ScoredStock; spark: PriceHistory | null }> {
  const scored = await withRetry(`${t} fundamentals`, () => scoreTicker(t));
  await write(`stock/${t}.json`, scored);

  let spark: PriceHistory | null = null;
  for (const range of HISTORY_RANGES) {
    try {
      const h = await withRetry(`${t} ${range}`, () => getHistory(t, range));
      await write(`history/${t}/${range}.json`, h);
      if (range === "1d") {
        const step = Math.max(1, Math.ceil(h.points.length / 60));
        spark = { ...h, points: h.points.filter((_, i) => i % step === 0 || i === h.points.length - 1) };
      }
    } catch (err) {
      console.warn(`  skipped ${t} ${range}: ${(err as Error).message}`);
    }
  }

  try {
    await write(`news/${t}.json`, await withRetry(`${t} news`, () => getNews(t)));
  } catch {
    await write(`news/${t}.json`, []);
  }
  return { scored, spark };
}

async function main() {
  const started = Date.now();
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const queue = [...TICKERS];
  const done: { scored: ScoredStock; spark: PriceHistory | null }[] = [];
  const failed: string[] = [];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length) {
        const t = queue.shift()!;
        try {
          done.push(await snapshotTicker(t));
          console.log(`✓ ${t}`);
        } catch (err) {
          failed.push(t);
          console.warn(`✗ ${t}: ${(err as Error).message}`);
        }
      }
    }),
  );

  // Don't publish a mostly-empty demo: failing here keeps the previous deployment live.
  if (done.length < TICKERS.length * 0.8) {
    throw new Error(`Only ${done.length}/${TICKERS.length} tickers loaded (failed: ${failed.join(", ")})`);
  }

  const ok = done.map((d) => d.scored.fundamentals.ticker);
  const quotes = await withRetry("quotes", () => getQuotes(ok));
  await write("quotes.json", quotes);

  const ranked = done
    .map((d) => d.scored)
    .sort((a, b) => (b.score.overall ?? -1) - (a.score.overall ?? -1));
  await write("picks.json", ranked.map(({ fundamentals, score }) => toPick(fundamentals, score, [])));

  const search: SearchResult[] = ranked
    .map(({ fundamentals: f }) => ({ ticker: f.ticker, name: f.name, exchange: f.exchange, type: "EQUITY" }))
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
  await write("search.json", search);

  await write(
    "sparklines.json",
    Object.fromEntries(done.filter((d) => d.spark).map((d) => [d.scored.fundamentals.ticker, d.spark])),
  );

  await write("meta.json", { generatedAt: new Date().toISOString(), tickers: ok.length });
  console.log(`Snapshot of ${ok.length} tickers written to public/demo-data in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  if (failed.length) console.warn(`Failed: ${failed.join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
