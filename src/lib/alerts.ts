// Decides when the scheduled workflow should alert you (by opening a GitHub
// issue assigned to the repo owner, which GitHub emails) and writes the
// message: one when the AI Fund trades, plus a weekly digest after Friday's
// close. Pure logic; scripts/alerts.ts does the I/O.
import type { FundTrade, FundView } from "./fund";
import type { Pick } from "./portfolio";
import type { Rating } from "./scoring";

export interface AlertState {
  /** Trades already reported, so each trade is announced once. */
  tradesReported: number;
  /** The Friday (YYYY-MM-DD) of the last week a digest went out. */
  lastDigestWeek: string | null;
  /** Snapshot at the last digest, to measure the week against. */
  snapshot: {
    equity: number;
    benchmark: number;
    prices: Record<string, number>;
    ratings: Record<string, Rating>;
  };
}

export interface Alert {
  title: string;
  body: string;
}

export interface AlertInput {
  fund: FundView;
  picks: Pick[];
  now: Date;
  fundUrl: string;
}

const ny = (d: Date, opts: Intl.DateTimeFormatOptions) => d.toLocaleString("en-US", { timeZone: "America/New_York", ...opts });
const nyDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const pct = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(2)}%`;
const usd = (x: number) => x.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** The Friday that ends the week containing `d` (New York time). */
export function weekKey(d: Date): string {
  const date = new Date(`${nyDate(d)}T12:00:00Z`);
  const toFriday = (5 - date.getUTCDay() + 7) % 7;
  return new Date(date.getTime() + toFriday * 86_400_000).toISOString().slice(0, 10);
}

const isWeekend = (d: Date) => ["Sat", "Sun"].includes(ny(d, { weekday: "short" }));

/** The week a digest sent now would cover: over the weekend, the one that just ended. */
function digestWeek(now: Date): string {
  return weekKey(isWeekend(now) ? new Date(now.getTime() - 2 * 86_400_000) : now);
}

/** After Friday's 4pm close, or any time over the weekend, in New York. */
export function digestDue(now: Date, lastDigestWeek: string | null): boolean {
  const minutes = Number(ny(now, { hour: "numeric", hour12: false })) * 60 + Number(ny(now, { minute: "numeric" }));
  const afterClose = isWeekend(now) || (ny(now, { weekday: "short" }) === "Fri" && minutes >= 16 * 60 + 15);
  return afterClose && digestWeek(now) !== lastDigestWeek;
}

function snapshotOf(input: AlertInput): AlertState["snapshot"] {
  const prices: Record<string, number> = {};
  const ratings: Record<string, Rating> = {};
  for (const p of input.picks) {
    if (p.price !== null) prices[p.ticker] = p.price;
    ratings[p.ticker] = p.rating;
  }
  return { equity: input.fund.equity, benchmark: input.fund.benchmarkValue, prices, ratings };
}

function tradesSection(trades: FundTrade[], fundUrl: string): string {
  const rows = trades.map(
    (t) => `| ${t.side === "buy" ? "🟢 Buy" : "🔴 Sell"} | **${t.ticker}** | ${t.shares.toFixed(2)} @ ${usd(t.price)} | ${usd(t.value)} | ${t.reason} |`,
  );
  return [
    `## AI Fund trades`,
    "",
    "| | Stock | Shares | Value | Why |",
    "|---|---|---|---|---|",
    ...rows,
    "",
    `[See the fund](${fundUrl})`,
  ].join("\n");
}

function digestSection(prev: AlertState["snapshot"], input: AlertInput): string {
  const { fund, picks } = input;
  const weekFund = (fund.equity / prev.equity - 1) * 100;
  const weekSpy = (fund.benchmarkValue / prev.benchmark - 1) * 100;

  const moves = picks
    .filter((p) => p.price !== null && prev.prices[p.ticker])
    .map((p) => ({ ticker: p.ticker, name: p.name, change: ((p.price as number) / prev.prices[p.ticker] - 1) * 100 }))
    .sort((a, b) => b.change - a.change);
  const movers = [...moves.slice(0, 3), ...moves.slice(-3).reverse()]
    .filter((m, i, all) => all.findIndex((x) => x.ticker === m.ticker) === i)
    .map((m) => `- **${m.ticker}** ${pct(m.change)} (${m.name})`);

  const changes = picks
    .filter((p) => prev.ratings[p.ticker] && prev.ratings[p.ticker] !== p.rating)
    .map((p) => `- **${p.ticker}**: ${prev.ratings[p.ticker]} → ${p.rating} (score ${p.overall ?? "n/a"})`);

  const holdings = fund.holdings.map((h) => `${h.ticker} ${h.weight.toFixed(0)}%`).join(" · ");

  return [
    `## Week in review`,
    "",
    `| | This week | Since ${fund.startDate} |`,
    "|---|---|---|",
    `| AI Fund | ${pct(weekFund)} | ${pct(fund.returnPercent)} (${usd(fund.equity)}) |`,
    `| S&P 500 | ${pct(weekSpy)} | ${pct(fund.benchmarkReturnPercent)} |`,
    "",
    `**Holdings:** ${holdings}`,
    "",
    `### Biggest movers this week`,
    ...(movers.length ? movers : ["- No price history yet"]),
    "",
    `### Rating changes`,
    ...(changes.length ? changes : ["- None this week"]),
    "",
    `[Open the AI Fund](${input.fundUrl})`,
  ].join("\n");
}

const FOOTER =
  "\n\n---\n_Sent by the Installous demo workflow. Older alerts close automatically when a new one opens. Paper money only; not investment advice._";

/** Work out whether anything is worth an alert, and the state to save afterwards. */
export function buildAlert(prev: AlertState | null, input: AlertInput): { state: AlertState; alert: Alert | null } {
  const tradesOldestFirst = [...input.fund.trades].reverse();

  if (!prev) {
    return {
      // The welcome stands in for this week's digest, so the first real one compares a full week.
      state: {
        tradesReported: tradesOldestFirst.length,
        lastDigestWeek: digestDue(input.now, null) ? digestWeek(input.now) : null,
        snapshot: snapshotOf(input),
      },
      alert: {
        title: "Installous alerts are on",
        body:
          `You'll get an issue like this one when the [AI Fund](${input.fundUrl}) trades, and a weekly digest after Friday's close ` +
          `with the fund against the S&P 500, the biggest movers and any rating changes among the tracked stocks.` +
          FOOTER,
      },
    };
  }

  const newTrades = tradesOldestFirst.slice(prev.tradesReported);
  const due = digestDue(input.now, prev.lastDigestWeek);
  if (newTrades.length === 0 && !due) return { state: prev, alert: null };

  const sections: string[] = [];
  if (newTrades.length) sections.push(tradesSection(newTrades, input.fundUrl));
  if (due) sections.push(digestSection(prev.snapshot, input));

  const parts = [
    newTrades.length ? `${newTrades.length} AI Fund trade${newTrades.length === 1 ? "" : "s"}` : null,
    due ? "weekly digest" : null,
  ].filter(Boolean);
  const title = `Installous: ${parts.join(" + ")} (${nyDate(input.now)})`;

  return {
    state: {
      tradesReported: tradesOldestFirst.length,
      lastDigestWeek: due ? digestWeek(input.now) : prev.lastDigestWeek,
      snapshot: due ? snapshotOf(input) : prev.snapshot,
    },
    alert: { title, body: sections.join("\n\n") + FOOTER },
  };
}
