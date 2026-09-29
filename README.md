# Installous: a personal AI investor

A private web app for researching stocks and picking investments. It combines live market data, a five-factor stock
scoring model, and a Claude-powered AI analyst that knows your portfolio and investor profile.

## Features

- **Dashboard**: portfolio value, today's change, total gain/loss, your watchlist with 1D sparklines, and the day's top-ranked stocks.
- **Top Picks**: ranks ~40 large-cap US stocks plus your watchlist by the Installous score. Sort by any factor and filter by sector.
- **Stock pages**: a Robinhood-style chart with a live 1D intraday view (dotted previous-close line, green or red for up or down, and a price that follows your cursor as you scrub) plus 1W, 1M, 3M, YTD, 1Y and 5Y, factor score breakdown, key metrics, news, and a one-click AI investment thesis.
- **AI Advisor**: chat with an analyst that calls live tools (quotes, fundamentals, price history, news, your portfolio, the screener, and web search) and gives clear buy / hold / avoid views tailored to your profile.
- **AI Fund**: a rules-only $100,000 paper portfolio that picks stocks from the Installous score by itself and is
  measured against the S&P 500, with every trade and its reason logged.
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

## The AI Fund

A paper-money portfolio that runs on rules alone, with no human picks:

1. Start with $100,000.
2. Every 7 days, hold the top 10 stocks by Installous score at equal 10% weights.
3. Keep a holding while it stays in the top 15 and scores at least 45 (Hold); otherwise sell it and buy the next best.
4. Only trim or top up a position once it drifts more than 2 points from its target weight.
5. Every fill pays a 0.05% simulated trading cost. Returns exclude dividends for both the fund and the S&P 500 (SPY).

It runs in the demo's GitHub Actions workflow (`npm run fund`, logic in `src/lib/fund.ts`). Its state (cash, positions,
trade log and daily value history) is saved to the `fund-data` branch. The Fund page reads the published copy, so the
local app shows the same fund as the live demo. To restart the fund from $100,000, delete `fund.json` on that branch.

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

## Live demo

A static build of the app is published to GitHub Pages at **https://xeoul.github.io/Installous/**.

- **Market data:** `.github/workflows/demo.yml` snapshots it for about 50 large-cap stocks every 30 minutes while US
  markets are open, then rebuilds and redeploys the site.
- **Portfolio, watchlist and profile:** saved in each visitor's browser.
- **AI advisor:** runs in the browser with the visitor's own Anthropic API key, which never leaves their browser except
  to go to `api.anthropic.com`.

To build the demo locally:

```bash
npm run demo:data    # writes public/demo-data/
npm run build:demo   # static export to out/, served under /Installous
```

One-time setup: in the repo's **Settings → Pages**, set **Source** to **GitHub Actions**.

## Project layout

```
src/lib/market.ts        Yahoo Finance data access with caching
src/lib/scoring.ts       Five-factor scoring model
src/lib/advisor-core.ts  Claude advisor: system prompt, tools, streaming tool-use loop (server or browser)
src/lib/client-data.ts   Data access for the UI: /api routes, or the static snapshot in the demo
src/lib/store.ts         JSON-file persistence (watchlist, holdings, profile)
src/app/api/*            Route handlers used by the full app
src/app/*                Pages: dashboard, picks, stock, advisor, portfolio, settings
scripts/                 Demo data snapshot and static build
```

## Disclaimer

Installous is a personal research tool, not a licensed financial adviser. Scores and AI output can be wrong. Market data
may be delayed. You make your own investment decisions.
