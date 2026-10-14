"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { RollingNumber } from "@/components/RollingNumber";
import { refreshCondorBot } from "@/lib/client-data";
import type { BotRules, BotState, BotTrade } from "@/lib/condor-bot";
import { condorValue, impliedVol, markCondor, nyClose, orderPhase, payoff, yearsLeft } from "@/lib/condor-live";
import { fmtWeekday } from "@/lib/dates";
import { usd0 } from "@/lib/format";
import type { TailPoint } from "@/lib/live/useLivePrice";

const signed2 = (v: number) => `${v >= 0 ? "+" : "−"}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const nyTime = (d: Date) => d.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });

/** The current time, ticking every `ms` while `on`. */
function useNow(ms: number, on = true): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [ms, on]);
  return now;
}

function countdown(ms: number): string {
  if (ms <= 0) return "now";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(sec).padStart(2, "0")}s`;
}

/**
 * Today's order, like a brokerage order ticket: a countdown to 3:27pm, a
 * working order while the bot places it (polling for the fill), then filled.
 */
export function OrderTicket({ bot, onUpdate, name }: { bot: BotState; onUpdate: (b: BotState) => void; name: string }) {
  const now = useNow(1000);
  const status = orderPhase(bot, now);
  const levels = bot.rules.levels ?? [1];
  const size = levels[bot.level] ?? levels[0];

  // While the order is working, check for the fill every 20 seconds.
  const working = status.phase === "working";
  useEffect(() => {
    if (!working) return;
    const id = setInterval(() => refreshCondorBot().then(onUpdate).catch(() => {}), 20_000);
    return () => clearInterval(id);
  }, [working, onUpdate]);

  // Flash the ticket when a fill arrives while you're watching.
  const wasWorking = useRef(false);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (status.phase === "working") wasWorking.current = true;
    else if (status.phase === "filled" && wasWorking.current) {
      wasWorking.current = false;
      setFlash(true);
      const id = setTimeout(() => setFlash(false), 2400);
      return () => clearTimeout(id);
    }
  }, [status.phase]);

  if (status.phase === "closed") return null;
  const steps = ["Check today's condor", "Pick strikes", "Send order", "Filled"];
  const done = status.phase === "filled" ? 4 : status.phase === "working" ? Math.min(3, 1 + Math.floor((now.getSeconds() % 30) / 10)) : 0;

  return (
    <div className={`mb-4 rounded-xl border p-3 transition-colors ${flash ? "fill-flash border-up" : "border-border"} ${status.phase === "working" ? "bg-accent-soft/30" : "bg-surface-2"}`} aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {status.phase === "working" && <span className="live-dot" aria-hidden />}
          {status.phase === "waiting" && "Next order"}
          {status.phase === "working" && "Placing today's order"}
          {status.phase === "filled" && "Today's order · Filled"}
          {status.phase === "skipped" && "No order today"}
        </div>
        <span className="num text-xs text-text-2">
          {status.phase === "waiting" && `${nyTime(status.at)} ET · in ${countdown(status.at.getTime() - now.getTime())}`}
          {status.phase === "working" && "Waiting for the fill…"}
          {status.phase === "filled" && `${nyTime(new Date(status.trade.openedAt))} ET`}
        </span>
      </div>

      {status.phase === "skipped" ? (
        <p className="mt-1 text-sm text-text-2">{status.note}</p>
      ) : (
        <>
          <p className="num mt-1 text-sm text-text-2">
            {status.phase === "filled" ? (
              <>
                Sold {status.trade.contracts}× {name} iron condor · level {status.trade.level + 1} · credit{" "}
                <span className="font-semibold text-up">{usd0(status.trade.credit * 100 * status.trade.contracts)}</span> · expires{" "}
                {fmtWeekday(status.trade.expiry)}
              </>
            ) : (
              <>
                Sell {size}× {name} iron condor · level {bot.level + 1} of {levels.length} · expires next trading day
              </>
            )}
          </p>
          {status.phase !== "waiting" && (
            <ol className="mt-2 grid grid-cols-4 gap-1 text-[11px]">
              {steps.map((s, i) => (
                <li key={s} className={`rounded-md px-1.5 py-1 text-center ${i < done ? "bg-up/15 text-up" : i === done ? "animate-pulse bg-surface text-text" : "bg-surface text-muted"}`}>
                  {i < done ? "✓ " : ""}
                  {s}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}

/** An open condor, marked live like a brokerage position. */
export function PositionCard({ trade, rules, spot, live, tail, name }: { trade: BotTrade; rules: BotRules; spot: number; live: boolean; tail: TailPoint[]; name: string }) {
  const now = useNow(5000, live);
  const vol = useMemo(() => impliedVol(trade, rules.slippage), [trade, rules.slippage]);
  const mark = markCondor(trade, spot, now, vol, rules.feePerLeg);
  const credit = trade.credit * 100 * trade.contracts;
  const maxLoss = (Math.max(trade.putShort - trade.putLong, trade.callLong - trade.callShort) - trade.credit) * 100 * trade.contracts;
  const close = nyClose(trade.expiry);
  const expiresToday = close.getTime() - now.getTime() < 24 * 3_600_000;
  const up = mark.pnl >= 0;

  return (
    <div className="mb-4 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">
          {name} Iron Condor · {trade.contracts}× · L{trade.level + 1}
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${expiresToday ? "bg-warn/15 text-warn" : "bg-up/15 text-up"}`}>
          {close.getTime() <= now.getTime() ? "Settling" : expiresToday ? `Expires today · ${countdown(close.getTime() - now.getTime())}` : `Expires ${fmtWeekday(trade.expiry)}`}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-muted">
            {live && <span className="live-dot" aria-hidden />}
            Profit / loss if closed now
          </div>
          <div className={`text-3xl font-semibold tracking-tight ${up ? "text-up" : "text-down"}`}>
            <RollingNumber value={signed2(mark.pnl)} />
          </div>
          <div className={`num text-sm ${up ? "text-up" : "text-down"}`}>
            {mark.pctOfMax >= 0 ? "+" : "−"}
            {Math.abs(mark.pctOfMax).toFixed(1)}% of max profit
          </div>
        </div>
        <PnlSpark trade={trade} rules={rules} vol={vol} tail={tail} />
      </div>

      <dl className="num mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <Stat label={name} value={<RollingNumber value={spot.toFixed(2)} />} />
        <Stat label="If it expired here" value={<span className={mark.atExpiry >= 0 ? "text-up" : "text-down"}>{signed2(mark.atExpiry)}</span>} />
        <Stat label="Credit (max profit)" value={usd0(credit)} />
        <Stat label="Max loss" value={usd0(maxLoss)} />
      </dl>

      <PayoffChart trade={trade} rules={rules} spot={spot} vol={vol} now={now} />

      <table className="num mt-3 w-full text-xs">
        <thead>
          <tr className="text-left text-muted">
            <th className="font-normal">Leg</th>
            <th className="text-right font-normal">Strike</th>
            <th className="text-right font-normal">Est. price</th>
          </tr>
        </thead>
        <tbody>
          {mark.legs.map((l) => (
            <tr key={`${l.kind}${l.strike}`} className="border-t border-border">
              <td className="py-1">
                <span className={l.action === "Sell" ? "text-down" : "text-up"}>{l.action}</span> {trade.contracts} {l.kind}
              </td>
              <td className="py-1 text-right">{l.strike}</td>
              <td className="py-1 text-right">
                <RollingNumber value={l.price.toFixed(2)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-muted">
        Leg prices are estimates from {name}&apos;s live price at the volatility the bot&apos;s fill implied ({(vol * 100).toFixed(0)}%); the
        condor settles at the 4:00pm close on {fmtWeekday(trade.expiry)}.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-surface-2 px-2 py-1.5">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="mt-0.5 font-semibold">{value}</dd>
    </div>
  );
}

/** Profit or loss through today's session, from SPY's streamed ticks. */
function PnlSpark({ trade, rules, vol, tail }: { trade: BotTrade; rules: BotRules; vol: number; tail: TailPoint[] }) {
  const pts = tail.map((p) => markCondor(trade, p.close, new Date(p.t), vol, rules.feePerLeg).pnl);
  if (pts.length < 2) return <div className="w-40 text-[11px] text-muted sm:text-right">Live P/L chart starts with the next tick</div>;
  const lo = Math.min(0, ...pts);
  const hi = Math.max(0, ...pts);
  const y = (v: number) => 46 - ((v - lo) / (hi - lo || 1)) * 44;
  const line = pts.map((v, i) => `${(i / (pts.length - 1)) * 160},${y(v).toFixed(1)}`).join(" ");
  const color = pts.at(-1)! >= 0 ? "var(--up)" : "var(--down)";
  return (
    <svg viewBox="0 0 160 48" className="h-12 w-40" role="img" aria-label="Profit or loss since this page opened">
      <line x1="0" x2="160" y1={y(0)} y2={y(0)} stroke="var(--border)" strokeDasharray="3 3" />
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

/** Profit or loss across SPY prices: at expiry (solid) and if closed now (dashed), with SPY marked. */
function PayoffChart({ trade, rules, spot, vol, now }: { trade: BotTrade; rules: BotRules; spot: number; vol: number; now: Date }) {
  const id = useId();
  const W = 320;
  const H = 110;
  const exp = payoff(trade, rules.feePerLeg, 61);
  const lo = exp[0].spot;
  const hi = exp.at(-1)!.spot;
  const years = yearsLeft(trade, now);
  const today = exp.map((p) => ({ spot: p.spot, pnl: (trade.credit - condorValue(trade, p.spot, years, vol)) * 100 * trade.contracts - 4 * rules.feePerLeg * trade.contracts }));
  const minP = Math.min(...exp.map((p) => p.pnl));
  const maxP = Math.max(...exp.map((p) => p.pnl));
  const x = (s: number) => ((Math.min(Math.max(s, lo), hi) - lo) / (hi - lo)) * W;
  const y = (v: number) => 8 + ((maxP - v) / (maxP - minP || 1)) * (H - 26);
  const path = (pts: { spot: number; pnl: number }[]) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.spot).toFixed(1)},${y(p.pnl).toFixed(1)}`).join("");
  const zero = y(0);
  const area = `${path(exp)}L${W},${zero}L0,${zero}Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto mt-3 block w-full max-w-md" role="img" aria-label={`Payoff: profit between ${trade.putShort} and ${trade.callShort}, SPY at ${spot.toFixed(2)}`}>
      <defs>
        <clipPath id={`${id}a`}>
          <rect x="0" y="0" width={W} height={zero} />
        </clipPath>
        <clipPath id={`${id}b`}>
          <rect x="0" y={zero} width={W} height={H - zero} />
        </clipPath>
      </defs>
      <path d={area} fill="var(--up)" opacity="0.15" clipPath={`url(#${id}a)`} />
      <path d={area} fill="var(--down)" opacity="0.15" clipPath={`url(#${id}b)`} />
      <line x1="0" x2={W} y1={zero} y2={zero} stroke="var(--border)" />
      <path d={path(exp)} fill="none" stroke="var(--text-2)" strokeWidth="1.5" />
      {years > 0 && <path d={path(today)} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="4 3" />}
      <line x1={x(spot)} x2={x(spot)} y1="4" y2={H - 16} stroke="var(--accent)" strokeWidth="1.5" />
      <circle cx={x(spot)} cy={y(markCondor(trade, spot, now, vol, rules.feePerLeg).pnl)} r="3.5" fill="var(--accent)" />
      {[trade.putLong, trade.putShort, trade.callShort, trade.callLong].map((k) => (
        <text key={k} x={x(k)} y={H - 3} textAnchor="middle" fontSize="9" fill="var(--muted)">
          {k}
        </text>
      ))}
    </svg>
  );
}
