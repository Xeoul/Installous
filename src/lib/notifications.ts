// Phone notifications for the condor bot and the AI Fund: what to say, as
// pure functions of their saved states (scripts/notify.ts sends them).
import type { BotState, BotTrade } from "./condor-bot";
import { fmtMonthDay, fmtWeekday } from "./dates";
import { maxLossPerShare } from "./options";

export interface Notification {
  title: string;
  /** One short line that fits a phone notification on its own. */
  short: string;
  message: string;
  /** ntfy tags: emoji shortcodes shown beside the title. */
  tags: string[];
  /** Site path to open when tapped. */
  path: string;
}

const usd = (v: number) => `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signedUsd = (v: number) => `${v >= 0 ? "+" : "−"}${usd(Math.abs(v))}`;
const signedPct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}%`;
// Whole dollars and one-decimal percents for the one-line versions.
const usd0 = (v: number) => `${v < 0 ? "−" : ""}$${Math.round(Math.abs(v)).toLocaleString("en-US")}`;
const signedUsd0 = (v: number) => `${v >= 0 ? "+" : "−"}${usd0(Math.abs(v))}`;
const signedPct1 = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;
const strikes = (t: BotTrade) => `${t.putLong}/${t.putShort}p · ${t.callShort}/${t.callLong}c`;

/** What changed in the condor bot between two saved states, as notifications. */
export function condorNotifications(prev: BotState | null, state: BotState): Notification[] {
  const out: Notification[] = [];
  const known = new Set((prev?.trades ?? []).map((t) => t.expiry));
  const levels = state.rules.levels;
  const start = state.rules.startCash;

  // Settled condors, oldest first.
  for (const t of state.trades.filter((t) => !known.has(t.expiry)).reverse()) {
    const pnl = t.pnl ?? 0;
    const after = t.equityAfter ?? state.equity;
    const before = after - pnl;
    out.push({
      title: `Iron condor ${pnl >= 0 ? "won" : "lost"} ${signedUsd(pnl)} (${signedPct((pnl / before) * 100)})`,
      short: `Condor ${pnl >= 0 ? "won" : "lost"} ${signedUsd0(pnl)} (${signedPct1((pnl / before) * 100)}), account ${usd0(after)}`,
      message:
        `SPY closed ${t.close} on ${fmtWeekday(t.expiry)} · ${t.contracts}× ${strikes(t)}.\n` +
        `Account ${usd(after)} · ${signedUsd(after - start)} (${signedPct((after / start - 1) * 100)}) total.`,
      tags: [pnl >= 0 ? "white_check_mark" : "x"],
      path: "/options/",
    });
  }

  // Today's new condor.
  const open = state.open;
  if (open && open.date !== prev?.open?.date) {
    const credit = open.credit * 100 * open.contracts;
    const maxLoss = maxLossPerShare(open) * 100 * open.contracts;
    out.push({
      title: `Iron condor opened · level ${open.level + 1} of ${levels.length}, ${open.contracts}×`,
      short: `Condor opened: level ${open.level + 1}, ${open.contracts}× ${open.putShort}/${open.callShort}, ${usd0(credit)} credit, risk ${usd0(maxLoss)}`,
      message:
        `SPY ${strikes(open)} for ${usd(credit)} credit (SPY ${open.spot.toFixed(2)}).\n` +
        `Expires ${fmtWeekday(open.expiry)} at the close · win up to ${usd(credit)}, lose up to ${usd(maxLoss)}.` +
        (open.capped ? `\nCapped at ${open.contracts}× by the cash on hand (level ${open.level + 1} wants ${levels[open.level]}×).` : ""),
      tags: ["chart_with_upwards_trend"],
      path: "/options/",
    });
  }

  // A skipped day or a bust, once.
  if (state.bust && !prev?.bust) {
    out.push({ title: "Condor bot is bust", short: "Condor bot is bust: can't cover another condor", message: state.note ?? "The account can't cover another condor.", tags: ["rotating_light"], path: "/options/" });
  } else if (state.note?.startsWith("Skipped") && state.note !== prev?.note) {
    out.push({ title: "No iron condor today", short: `No condor today: ${state.note.replace(/^Skipped: /, "").replace(/, while the condor would be open\.$/, "").replace(/\.$/, "")}`, message: state.note, tags: ["pause_button"], path: "/options/" });
  }
  return out;
}

export interface FundDay {
  date: string;
  startDate: string;
  startCash: number;
  equity: number;
  /** The fund's value at the previous close. */
  prevEquity: number;
  /** SPY at today's and the previous close, and on the start date. */
  spy: number;
  prevSpy: number;
  spyStart: number;
  trades: { side: "buy" | "sell"; ticker: string; value: number }[];
}

/** The AI Fund's end-of-day summary. */
export function fundNotification(d: FundDay): Notification {
  const day = d.equity - d.prevEquity;
  const total = d.equity - d.startCash;
  const lines = [
    `Value ${usd(d.equity)} · ${signedUsd(total)} (${signedPct((total / d.startCash) * 100)}) since ${fmtMonthDay(d.startDate)}.`,
    `S&P 500 ${signedPct((d.spy / d.prevSpy - 1) * 100)} today, ${signedPct((d.spy / d.spyStart - 1) * 100)} total.`,
  ];
  const bought = d.trades.filter((t) => t.side === "buy").map((t) => t.ticker);
  const sold = d.trades.filter((t) => t.side === "sell").map((t) => t.ticker);
  if (bought.length || sold.length) lines.push([sold.length ? `Sold ${sold.join(", ")}` : "", bought.length ? `Bought ${bought.join(", ")}` : ""].filter(Boolean).join(" · ") + ".");
  return {
    title: `AI Fund ${signedUsd(day)} (${signedPct((day / d.prevEquity) * 100)}) today`,
    short: `AI Fund ${signedUsd0(day)} (${signedPct((day / d.prevEquity) * 100)}) today, ${signedPct((total / d.startCash) * 100)} total vs S&P ${signedPct((d.spy / d.spyStart - 1) * 100)}`,
    message: lines.join("\n"),
    tags: [day >= 0 ? "moneybag" : "small_red_triangle_down"],
    path: "/fund/",
  };
}
