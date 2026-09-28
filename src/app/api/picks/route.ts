import { NextResponse } from "next/server";
import { scoreMany } from "@/lib/picks";
import { readStore } from "@/lib/store";
import { DEFAULT_UNIVERSE } from "@/lib/universe";
import { errorResponse } from "../_util";

export async function GET() {
  try {
    const { watchlist } = await readStore();
    const ranked = await scoreMany([...DEFAULT_UNIVERSE, ...watchlist]);
    return NextResponse.json(
      ranked.map(({ fundamentals: f, score }) => ({
        ticker: f.ticker,
        name: f.name,
        sector: f.sector ?? null,
        price: f.price,
        changePercent: f.changePercent,
        marketCap: f.marketCap,
        overall: score.overall,
        rating: score.rating,
        factors: Object.fromEntries(score.factors.map((x) => [x.key, x.score])),
        onWatchlist: watchlist.includes(f.ticker),
      })),
    );
  } catch (err) {
    return errorResponse(err);
  }
}
