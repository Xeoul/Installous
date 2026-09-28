import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getHistory, getNews, getQuotes, HISTORY_RANGES, searchTickers } from "./market";
import { scoreMany, scoreTicker } from "./picks";
import { addToWatchlist, readStore, type InvestorProfile } from "./store";
import { DEFAULT_UNIVERSE } from "./universe";

export const ADVISOR_MODEL = process.env.INSTALLOUS_MODEL ?? "claude-opus-5";

export type AdvisorEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; label: string }
  | { type: "error"; message: string }
  | { type: "done" };

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

const SYSTEM_PROMPT = `You are Installous, a personal AI investment analyst working for one individual investor. You help them research stocks, understand their portfolio, and decide what to buy, hold, or sell.

How you work:
- Ground every claim about a company in data from your tools. Fetch fresh data rather than relying on memory for prices, valuations, or recent events. Use web search for recent news, earnings, and macro context your market-data tools don't cover.
- The app has a quantitative scoring model (0-100) built from five factors: value, quality, growth, momentum, and analyst sentiment. Use it as one input, and explain where your judgment differs from it and why.
- When recommending stocks, be decisive: give a clear view (e.g. buy / accumulate / hold / trim / avoid), the key reasons, the main risks, and what would change your mind. Tailor recommendations to the investor's profile below, including position sizing and diversification relative to what they already own.
- Be honest about uncertainty. Never promise returns. Mention concentration risk, valuation risk, and volatility when they matter.
- Keep answers skimmable: short paragraphs, bullet points, and small markdown tables for comparisons. Cite the numbers you used.
- You're a research tool, not a licensed financial adviser; the investor makes the final decision. You don't need to repeat that disclaimer in every message.`;

function profileBlock(profile: InvestorProfile): string {
  return `Investor profile:
- Risk tolerance: ${profile.risk}
- Time horizon: ${profile.horizon}
- Goals: ${profile.goals}

Today's date: ${new Date().toISOString().slice(0, 10)}`;
}

const tickerInput = z.object({ ticker: z.string().min(1).max(12) });

const toolInputs = {
  get_stock_analysis: tickerInput,
  get_price_history: z.object({
    ticker: z.string().min(1).max(12),
    range: z.enum(HISTORY_RANGES as [string, ...string[]]).default("1y"),
  }),
  search_ticker: z.object({ query: z.string().min(1).max(80) }),
  get_portfolio: z.object({}),
  get_top_picks: z.object({ limit: z.number().int().min(1).max(40).default(10) }),
  get_news: tickerInput,
  add_to_watchlist: tickerInput,
} as const;

type ToolName = keyof typeof toolInputs;

const TOOLS: Anthropic.Beta.BetaToolUnion[] = [
  {
    name: "get_stock_analysis",
    description:
      "Get a full snapshot for one stock: live price, valuation multiples, profitability, growth, balance sheet, analyst consensus and price target, company profile, and the app's 0-100 factor scores (value, quality, growth, momentum, sentiment) with an overall rating.",
    input_schema: {
      type: "object",
      properties: { ticker: { type: "string", description: "Ticker symbol, e.g. AAPL or BRK-B" } },
      required: ["ticker"],
    },
  },
  {
    name: "get_price_history",
    description:
      "Summarize a stock's price history over a range: total return, annualized volatility, max drawdown, high/low, and a sampled series of closing prices.",
    input_schema: {
      type: "object",
      properties: {
        ticker: { type: "string" },
        range: { type: "string", enum: HISTORY_RANGES, description: "Lookback window. Defaults to 1y." },
      },
      required: ["ticker"],
    },
  },
  {
    name: "search_ticker",
    description: "Look up ticker symbols by company name or keyword.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "get_portfolio",
    description:
      "Get the investor's current holdings (shares, cost basis, live value, gain/loss, weight) and their watchlist.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_top_picks",
    description:
      "Rank a universe of ~40 large-cap US stocks plus the investor's watchlist by the app's overall factor score, highest first. Use this to find candidate ideas, then dig into the best ones with get_stock_analysis.",
    input_schema: {
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: 40, description: "How many to return. Defaults to 10." } },
    },
  },
  {
    name: "get_news",
    description: "Get recent news headlines for a stock.",
    input_schema: {
      type: "object",
      properties: { ticker: { type: "string" } },
      required: ["ticker"],
    },
  },
  {
    name: "add_to_watchlist",
    description: "Add a stock to the investor's watchlist. Only do this when the investor asks you to.",
    input_schema: {
      type: "object",
      properties: { ticker: { type: "string" } },
      required: ["ticker"],
    },
  },
  { type: "web_search_20260209", name: "web_search", max_uses: 5 },
];

const TOOL_LABELS: Record<ToolName, (input: Record<string, unknown>) => string> = {
  get_stock_analysis: (i) => `Analyzing ${String(i.ticker).toUpperCase()}`,
  get_price_history: (i) => `Reading ${String(i.ticker).toUpperCase()} price history`,
  search_ticker: (i) => `Searching for "${i.query}"`,
  get_portfolio: () => "Reviewing your portfolio",
  get_top_picks: () => "Screening top-ranked stocks",
  get_news: (i) => `Reading ${String(i.ticker).toUpperCase()} news`,
  add_to_watchlist: (i) => `Adding ${String(i.ticker).toUpperCase()} to watchlist`,
};

function round(x: number | null, digits = 2): number | null {
  return x === null ? null : Number(x.toFixed(digits));
}

async function runTool(name: ToolName, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "get_stock_analysis": {
      const { ticker } = toolInputs.get_stock_analysis.parse(input);
      const { fundamentals, score } = await scoreTicker(ticker);
      const { summary, ...rest } = fundamentals;
      return { ...rest, businessSummary: summary?.slice(0, 600), score };
    }
    case "get_price_history": {
      const { ticker, range } = toolInputs.get_price_history.parse(input);
      const history = await getHistory(ticker, range as (typeof HISTORY_RANGES)[number]);
      const points = history.points;
      if (points.length < 2) return { ticker, range, error: "Not enough price history" };
      const closes = points.map((p) => p.close);
      const returns = closes.slice(1).map((c, i) => c / closes[i] - 1);
      const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
      // Annualize by the observed sampling frequency.
      const spanYears = (points[points.length - 1].t - points[0].t) / (365.25 * 86_400_000);
      const periodsPerYear = spanYears > 0 ? returns.length / spanYears : 252;
      let peak = closes[0];
      let maxDrawdown = 0;
      for (const c of closes) {
        peak = Math.max(peak, c);
        maxDrawdown = Math.min(maxDrawdown, c / peak - 1);
      }
      const step = Math.max(1, Math.floor(points.length / 12));
      const fmt = (p: { t: number; close: number }) => ({
        time: new Date(p.t).toISOString().slice(0, history.intraday ? 16 : 10),
        close: round(p.close),
      });
      const last = closes[closes.length - 1];
      return {
        ticker,
        range,
        start: fmt(points[0]),
        end: fmt(points[points.length - 1]),
        changeFromBaselinePct: round((last / history.baseline - 1) * 100),
        baseline: round(history.baseline),
        baselineMeaning: range === "1d" ? "previous close" : "first price in range",
        annualizedVolatilityPct: history.intraday ? null : round(Math.sqrt(variance * periodsPerYear) * 100),
        maxDrawdownPct: round(maxDrawdown * 100),
        high: round(Math.max(...closes)),
        low: round(Math.min(...closes)),
        sampled: points.filter((_, i) => i % step === 0 || i === points.length - 1).map(fmt),
      };
    }
    case "search_ticker": {
      const { query } = toolInputs.search_ticker.parse(input);
      return await searchTickers(query);
    }
    case "get_portfolio":
      return await portfolioSnapshot();
    case "get_top_picks": {
      const { limit } = toolInputs.get_top_picks.parse(input);
      const store = await readStore();
      const ranked = await scoreMany([...DEFAULT_UNIVERSE, ...store.watchlist]);
      return ranked.slice(0, limit).map(({ fundamentals: f, score }) => ({
        ticker: f.ticker,
        name: f.name,
        sector: f.sector,
        price: f.price,
        overall: score.overall,
        rating: score.rating,
        factors: Object.fromEntries(score.factors.map((x) => [x.key, x.score])),
      }));
    }
    case "get_news": {
      const { ticker } = toolInputs.get_news.parse(input);
      return await getNews(ticker);
    }
    case "add_to_watchlist": {
      const { ticker } = toolInputs.add_to_watchlist.parse(input);
      const store = await addToWatchlist(ticker);
      return { ok: true, watchlist: store.watchlist };
    }
  }
}

export async function portfolioSnapshot() {
  const store = await readStore();
  const quotes = await getQuotes(store.holdings.map((h) => h.ticker));
  const rows = store.holdings.map((h) => {
    const price = quotes[h.ticker]?.price ?? null;
    const value = price === null ? null : price * h.shares;
    const cost = h.costBasis * h.shares;
    return {
      ticker: h.ticker,
      name: quotes[h.ticker]?.name ?? h.ticker,
      shares: h.shares,
      costBasis: h.costBasis,
      price,
      dayChangePercent: quotes[h.ticker]?.changePercent ?? null,
      value,
      gain: value === null ? null : value - cost,
      gainPercent: value === null || cost === 0 ? null : (value / cost - 1) * 100,
    };
  });
  const totalValue = rows.reduce((a, r) => a + (r.value ?? 0), 0);
  const totalCost = store.holdings.reduce((a, h) => a + h.costBasis * h.shares, 0);
  return {
    holdings: rows.map((r) => ({
      ...r,
      weightPercent: totalValue > 0 && r.value !== null ? (r.value / totalValue) * 100 : null,
    })),
    totalValue,
    totalCost,
    totalGain: totalValue - totalCost,
    totalGainPercent: totalCost > 0 ? (totalValue / totalCost - 1) * 100 : null,
    watchlist: store.watchlist,
  };
}

const MAX_ITERATIONS = 16;

/**
 * Run one advisor turn: stream Claude's reply, executing market-data tools
 * as it asks for them, and report text and tool activity through `emit`.
 */
export async function runAdvisor(
  history: ChatTurn[],
  emit: (e: AdvisorEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const client = new Anthropic();
  const store = await readStore();
  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((t) => ({
    role: t.role,
    content: t.content,
  }));

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const stream = client.beta.messages.stream(
      {
        model: ADVISOR_MODEL,
        max_tokens: 64000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        cache_control: { type: "ephemeral" },
        system: [
          { type: "text", text: SYSTEM_PROMPT },
          { type: "text", text: profileBlock(store.profile) },
        ],
        tools: TOOLS,
        messages,
      },
      { signal },
    );

    stream.on("text", (delta) => emit({ type: "text", text: delta }));
    stream.on("streamEvent", (event) => {
      if (
        event.type === "content_block_start" &&
        event.content_block.type === "server_tool_use" &&
        event.content_block.name === "web_search"
      ) {
        emit({ type: "tool", name: "web_search", label: "Searching the web" });
      }
    });

    const message = await stream.finalMessage();

    if (message.stop_reason === "refusal") {
      emit({ type: "error", message: "The model declined to answer this request." });
      return;
    }
    if (message.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: message.content });
      continue;
    }

    const toolUses = message.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
    );
    if (toolUses.length === 0) return;
    if (message.stop_reason === "max_tokens") {
      emit({ type: "error", message: "The response was cut off before finishing." });
      return;
    }

    messages.push({ role: "assistant", content: message.content });

    // Run all requested tools in parallel and return every result in one user message.
    const results = await Promise.all(
      toolUses.map(async (tool): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        const input = (tool.input ?? {}) as Record<string, unknown>;
        if (!(tool.name in toolInputs)) {
          return { type: "tool_result", tool_use_id: tool.id, is_error: true, content: `Unknown tool ${tool.name}` };
        }
        const name = tool.name as ToolName;
        emit({ type: "tool", name, label: TOOL_LABELS[name](input) });
        try {
          const output = await runTool(name, input);
          return { type: "tool_result", tool_use_id: tool.id, content: JSON.stringify(output) };
        } catch (err) {
          const detail = err instanceof z.ZodError ? `Invalid input: ${err.message}` : (err as Error).message;
          return { type: "tool_result", tool_use_id: tool.id, is_error: true, content: detail };
        }
      }),
    );
    messages.push({ role: "user", content: results });
  }
  emit({ type: "error", message: "Stopped after too many research steps." });
}
