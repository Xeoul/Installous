# Installous: a personal AI investor

A private web app for researching stocks and picking investments. It combines live market data, a five-factor stock
scoring model, and a Claude-powered AI analyst that knows your portfolio and investor profile.

## Features

- **Dashboard**: portfolio value, today's change, total gain/loss, your watchlist with 1D sparklines, and the day's top-ranked stocks.
- **Top Picks**: ranks ~40 large-cap US stocks plus your watchlist by the Installous score. Sort by any factor and filter by sector.
- **Stock pages**: a Robinhood-style chart with a live 1D intraday view (dotted previous-close line, green or red for up or down, and a price that follows your cursor as you scrub) plus 1W, 1M, 3M, YTD, 1Y and 5Y, factor score breakdown, key metrics, news, and a one-click AI investment thesis.
- **AI Advisor**: chat with an analyst that calls live tools (quotes, fundamentals, price history, news, your portfolio, the screener, and web search) and gives clear buy / hold / avoid views tailored to your profile.
- **Portfolio**: track positions with average cost, live value, gain/loss, and weight.
- **Profile**: set your risk tolerance, time horizon, and goals. The advisor uses them in every answer.

## The Installous score

Each stock gets 0–100 on five factors, blended into an overall score:

| Factor | Weight | Inputs |
|---|---|---|
| Value | 20% | Forward/trailing P/E, PEG, EV/EBITDA, P/S |
| Quality | 25% | ROE, operating and net margin, debt/equity, free cash flow |
| Growth | 20% | Revenue and earnings growth, implied forward EPS growth |
| Momentum | 20% | Price vs 50/200-day averages, 52-week return and range position |
| Analyst sentiment | 15% | Consensus rating, upside to mean price target |

Ratings: ≥72 Strong Buy · ≥60 Buy · ≥45 Hold · ≥33 Weak · below that Avoid. Weights and thresholds live in
`src/lib/scoring.ts` if you want to tune them.

## Getting started

Requires Node.js 20.9+.

```bash
npm install
cp .env.example .env.local   # then add your ANTHROPIC_API_KEY
npm run dev
```

Open http://localhost:3000.

Market data comes from Yahoo Finance and needs no API key. Everything except the AI advisor works without
`ANTHROPIC_API_KEY`.

Your watchlist, holdings, and profile are saved to `data/store.json`. That folder is git-ignored so your positions
never get committed.

## Project layout

```
src/lib/market.ts     Yahoo Finance data access with caching
src/lib/scoring.ts    Five-factor scoring model
src/lib/advisor.ts    Claude advisor: system prompt, tools, streaming tool-use loop
src/lib/store.ts      JSON-file persistence (watchlist, holdings, profile)
src/app/api/*         Route handlers used by the UI
src/app/*             Pages: dashboard, picks, stock/[ticker], advisor, portfolio, settings
```

## Disclaimer

Installous is a personal research tool, not a licensed financial adviser. Scores and AI output can be wrong. Market data
may be delayed. You make your own investment decisions.
