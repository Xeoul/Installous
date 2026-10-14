// Phone notifications for the condor bot: what to say, as
// pure functions of their saved states (scripts/notify.ts sends them).
import { botName, type BotState, type BotTrade } from "./condor-bot";
import { fmtWeekday } from "./dates";
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
const strikes = (t: BotTrade) => `${t.putLong}/${t.putShort}p · ${t.callShort}/${t.callLong}c`;

/** What changed in the condor bot between two saved states, as notifications. */
export function condorNotifications(prev: BotState | null, state: BotState): Notification[] {
  const out: Notification[] = [];
  const known = new Set((prev?.trades ?? []).map((t) => t.expiry));
  const levels = state.rules.levels;
  const start = state.rules.startCash;
  const name = botName(state.rules);

  // Settled condors, oldest first.
  for (const t of state.trades.filter((t) => !known.has(t.expiry)).reverse()) {
    const pnl = t.pnl ?? 0;
    const after = t.equityAfter ?? state.equity;
    const before = after - pnl;
    out.push({
      title: `Iron condor ${pnl >= 0 ? "won" : "lost"} ${signedUsd(pnl)} (${signedPct((pnl / before) * 100)})`,
      short: `Condor ${pnl >= 0 ? "won" : "lost"} ${signedUsd0(pnl)}`,
      message:
        `${name} closed ${t.close} on ${fmtWeekday(t.expiry)} · ${t.contracts}× ${strikes(t)}.\n` +
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
      short: `Level ${open.level + 1} - ${open.contracts} contract${open.contracts === 1 ? "" : "s"}`,
      message:
        `${name} ${strikes(open)} for ${usd(credit)} credit (${name} ${open.spot.toFixed(2)}).\n` +
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
