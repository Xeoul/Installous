import { describe, expect, it } from "vitest";
import { BOT_RULES, newBotState, type BotState, type BotTrade } from "@/lib/condor-bot";
import { condorNotifications } from "@/lib/notifications";

const condor = (o: Partial<BotTrade> = {}): BotTrade => ({
  date: "2026-10-13",
  expiry: "2026-10-14",
  openedAt: "2026-10-13T19:27:00Z",
  spot: 778.01,
  putLong: 773,
  putShort: 777,
  callShort: 780,
  callLong: 784,
  credit: 1.92,
  contracts: 1,
  level: 0,
  streak: 0,
  capped: false,
  ...o,
});
const base = (): BotState => newBotState(new Date("2026-10-13T13:00:00Z"));

describe("condor notifications", () => {
  it("announces a new condor once, with its level, size, credit and risk", () => {
    const prev = base();
    const state = { ...prev, open: condor({ level: 1, contracts: 2 }) };
    const [n, ...rest] = condorNotifications(prev, state);
    expect(rest).toEqual([]);
    expect(n.title).toBe("Iron condor opened · level 2 of 3, 2×");
    expect(n.message).toContain("773/777p · 780/784c for $384.00 credit");
    expect(n.message).toContain("lose up to $416.00");
    expect(n.short).toBe("Level 2 - 2 contracts");
    // A later step with the same condor says nothing new.
    expect(condorNotifications(state, structuredClone(state))).toEqual([]);
  });

  it("reports a settlement's P/L in dollars and percent, and the account's total", () => {
    const prev = { ...base(), open: condor() };
    const settled = { ...condor(), close: 778.5, pnl: 191.84, equityAfter: 25191.84 };
    const state = { ...prev, open: null, equity: 25191.84, trades: [settled] };
    const [n] = condorNotifications(prev, state);
    expect(n.title).toBe("Iron condor won +$191.84 (+0.77%)");
    expect(n.message).toContain("Account $25,191.84 · +$191.84 (+0.77%) total.");
    expect(n.short).toBe("Condor won +$192");

    const lost = { ...condor({ date: "2026-10-14", expiry: "2026-10-15" }), close: 760, pnl: -208.16, equityAfter: 24983.68 };
    const [l] = condorNotifications({ ...state }, { ...state, equity: 24983.68, trades: [lost, settled] });
    expect(l.title).toBe("Iron condor lost −$208.16 (−0.83%)");
    expect(l.short).toBe("Condor lost −$208");
    expect(l.message).toContain("−$16.32 (−0.07%) total");
  });

  it("says once when it skips a day or goes bust", () => {
    const skip = { ...base(), note: "Skipped: FOMC on Wed, Oct 28, while the condor would be open." };
    expect(condorNotifications(base(), skip).map((n) => n.title)).toEqual(["No iron condor today"]);
    expect(condorNotifications(base(), skip)[0].short).toBe("No condor today: FOMC on Wed, Oct 28");
    expect(condorNotifications(skip, { ...skip })).toEqual([]);
    expect(condorNotifications(base(), { ...base(), bust: "2026-10-13" })[0].title).toBe("Condor bot is bust");
  });

  it("keeps the rules' ladder in the title", () => {
    const state = { ...base(), rules: { ...BOT_RULES, levels: [1, 3, 9] }, open: condor({ level: 2, contracts: 9 }) };
    expect(condorNotifications(base(), state)[0].title).toBe("Iron condor opened · level 3 of 3, 9×");
  });
});
