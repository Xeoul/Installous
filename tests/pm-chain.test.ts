import { describe, expect, it } from "vitest";
import { bsPrice } from "@/lib/options";
import { pmLegs } from "@/lib/pm-chain";

const t = 1 / 365;
const spot = 7720;
// A put quoted fairly at a 15% vol, a cent either side.
const quote = (root: string, strike: number, vol = 0.15) => {
  const fair = bsPrice("put", spot, strike, t, vol);
  return { contractSymbol: `${root}261016P0${strike}000`, strike, bid: fair - 0.01, ask: fair + 0.01 };
};

describe("pmLegs", () => {
  it("passes an all-SPXW chain through untouched", () => {
    const legs = [quote("SPXW", 7680), quote("SPXW", 7685)];
    expect(pmLegs("put", legs, spot, t)).toEqual(legs.map(({ strike, bid, ask }) => ({ strike, bid, ask })));
  });

  it("reprices an AM-settled strike from its PM-settled neighbours", () => {
    // The monthly 7680 put is quoted far too cheap for a close-settled option (it settles at the open).
    const am = { ...quote("SPX", 7680), bid: 5.9, ask: 6.2 };
    const legs = pmLegs("put", [quote("SPXW", 7675), am, quote("SPXW", 7685)], spot, t);
    const fair = bsPrice("put", spot, 7680, t, 0.15);
    const k = legs.find((l) => l.strike === 7680)!;
    expect((k.bid + k.ask) / 2).toBeCloseTo(fair, 1);
    expect(k.bid).toBeGreaterThan(6.2);
    expect(legs.map((l) => l.strike)).toEqual([7675, 7680, 7685]);
  });

  it("drops an AM-settled strike with no PM-settled strike on one side", () => {
    const legs = pmLegs("put", [quote("SPX", 7670), quote("SPXW", 7675), quote("SPXW", 7685)], spot, t);
    expect(legs.map((l) => l.strike)).toEqual([7675, 7685]);
  });
});
