import { NextResponse, type NextRequest } from "next/server";
import { scoreTicker } from "@/lib/picks";
import { errorResponse, tickerParam } from "../../_util";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/stock/[ticker]">) {
  const ticker = tickerParam((await ctx.params).ticker);
  if (typeof ticker !== "string") return ticker;
  try {
    return NextResponse.json(await scoreTicker(ticker));
  } catch (err) {
    return errorResponse(err, 404);
  }
}
