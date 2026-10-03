import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { runAdvisorLoop, type AdvisorData, type AdvisorEvent, type ChatTurn } from "./advisor-core";
import { getEvents, getHistory, getNews, getQuotes, searchTickers } from "./market";
import { buildPicks, scoreTicker } from "./picks";
import { computePortfolio } from "./portfolio";
import { addToWatchlist, readStore } from "./store";

export async function portfolioSnapshot() {
  const store = await readStore();
  const quotes = await getQuotes(store.holdings.map((h) => h.ticker));
  return computePortfolio(store.holdings, quotes, store.watchlist);
}

const serverData: AdvisorData = {
  stock: scoreTicker,
  history: getHistory,
  search: searchTickers,
  portfolio: portfolioSnapshot,
  topPicks: async () => buildPicks((await readStore()).watchlist),
  news: getNews,
  events: getEvents,
  addToWatchlist: async (ticker) => (await addToWatchlist(ticker)).watchlist,
};

export async function runAdvisor(history: ChatTurn[], emit: (e: AdvisorEvent) => void, signal?: AbortSignal) {
  const { profile } = await readStore();
  await runAdvisorLoop({
    client: new Anthropic(),
    model: process.env.INSTALLOUS_MODEL,
    history,
    profile,
    data: serverData,
    emit,
    signal,
  });
}
