// SPX lists two kinds of contract on a monthly-expiration Friday: SPXW, settled
// at the 4:00pm close (what the condor bot trades), and the monthly SPX,
// settled at that morning's open. Yahoo returns one contract per strike, a mix
// of the two, so on those days the chain is rebuilt from the PM-settled
// quotes alone: strikes Yahoo only gave as AM-settled are priced from the
// implied volatility of the neighboring PM-settled strikes.
import { bsPrice } from "./options";

export interface RawLeg {
  contractSymbol: string;
  strike: number;
  bid?: number;
  ask?: number;
}

const isPm = (l: RawLeg) => !/^SPX\d/.test(l.contractSymbol); // SPXW..., or any non-SPX root

/** The volatility at which Black-Scholes gives `price` (bisection), or null if it can't. */
function impliedVolOf(kind: "put" | "call", spot: number, strike: number, t: number, price: number): number | null {
  const intrinsic = Math.max(0, kind === "call" ? spot - strike : strike - spot);
  if (!(price > intrinsic) || t <= 0) return null;
  let lo = 0.005;
  let hi = 4;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (bsPrice(kind, spot, strike, t, mid) > price) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Legs for one side of the chain, settled at the close: PM-settled quotes as
 * they are, AM-settled strikes repriced at the volatility interpolated (by
 * strike) between the nearest PM-settled strikes on either side. Strikes with
 * no PM-settled neighbor on both sides are dropped.
 */
export function pmLegs(kind: "put" | "call", legs: RawLeg[], spot: number, t: number): { strike: number; bid: number; ask: number }[] {
  const out = (l: RawLeg) => ({ strike: l.strike, bid: l.bid ?? 0, ask: l.ask ?? 0 });
  if (legs.every(isPm)) return legs.map(out);
  const smile = legs
    .filter((l) => isPm(l) && (l.bid ?? 0) > 0 && (l.ask ?? 0) >= (l.bid ?? 0))
    .map((l) => ({ strike: l.strike, vol: impliedVolOf(kind, spot, l.strike, t, ((l.bid ?? 0) + (l.ask ?? 0)) / 2), spread: (l.ask ?? 0) - (l.bid ?? 0) }))
    .filter((p): p is { strike: number; vol: number; spread: number } => p.vol !== null)
    .sort((a, b) => a.strike - b.strike);
  const result: { strike: number; bid: number; ask: number }[] = [];
  for (const l of [...legs].sort((a, b) => a.strike - b.strike)) {
    if (isPm(l)) {
      result.push(out(l));
      continue;
    }
    const below = smile.findLast((p) => p.strike < l.strike);
    const above = smile.find((p) => p.strike > l.strike);
    if (!below || !above) continue;
    const w = (l.strike - below.strike) / (above.strike - below.strike);
    const vol = below.vol + w * (above.vol - below.vol);
    const price = bsPrice(kind, spot, l.strike, t, vol);
    const half = Math.max(below.spread, above.spread) / 2;
    result.push({ strike: l.strike, bid: Math.max(0, Math.round((price - half) * 100) / 100), ask: Math.round((price + half) * 100) / 100 });
  }
  return result;
}
