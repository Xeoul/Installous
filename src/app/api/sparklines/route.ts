import { NextResponse, type NextRequest } from "next/server";
import { getHistory, normalizeTicker, type PriceHistory } from "@/lib/market";
import { errorResponse } from "../_util";

/** 1D intraday series for several tickers at once, downsampled for sparklines. */
export async function GET(req: NextRequest) {
  const tickers = (req.nextUrl.searchParams.get("tickers") ?? "")
    .split(",")
    .map(normalizeTicker)
    .filter(Boolean)
    .slice(0, 30);
  try {
    const entries = await Promise.all(
      tickers.map(async (t): Promise<[string, PriceHistory | null]> => {
        try {
          const h = await getHistory(t, "1d");
          const step = Math.max(1, Math.ceil(h.points.length / 60));
          const points = h.points.filter((_, i) => i % step === 0 || i === h.points.length - 1);
          return [t, { ...h, points }];
        } catch {
          return [t, null];
        }
      }),
    );
    return NextResponse.json(Object.fromEntries(entries.filter(([, v]) => v !== null)));
  } catch (err) {
    return errorResponse(err);
  }
}
