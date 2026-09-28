import { NextResponse, type NextRequest } from "next/server";
import { getHistory, HISTORY_RANGES, type HistoryRange } from "@/lib/market";
import { errorResponse } from "../../_util";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/history/[ticker]">) {
  const { ticker } = await ctx.params;
  const requested = req.nextUrl.searchParams.get("range") ?? "1d";
  const range = (HISTORY_RANGES as string[]).includes(requested) ? (requested as HistoryRange) : "1d";
  try {
    return NextResponse.json(await getHistory(ticker, range));
  } catch (err) {
    return errorResponse(err);
  }
}
