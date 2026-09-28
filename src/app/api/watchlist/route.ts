import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getQuotes } from "@/lib/market";
import { addToWatchlist, readStore, removeFromWatchlist } from "@/lib/store";
import { errorResponse } from "../_util";

const body = z.object({ ticker: z.string().min(1).max(12) });

export async function GET() {
  try {
    const { watchlist } = await readStore();
    const quotes = await getQuotes(watchlist);
    return NextResponse.json(watchlist.map((t) => quotes[t] ?? { ticker: t, name: t, price: null, change: null, changePercent: null }));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse(new Error("ticker is required"), 400);
  const store = await addToWatchlist(parsed.data.ticker);
  return NextResponse.json(store.watchlist);
}

export async function DELETE(req: NextRequest) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse(new Error("ticker is required"), 400);
  const store = await removeFromWatchlist(parsed.data.ticker);
  return NextResponse.json(store.watchlist);
}
