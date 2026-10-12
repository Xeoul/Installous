import { NextResponse, type NextRequest } from "next/server";
import { getEvents } from "@/lib/market";
import { errorResponse, tickerParam } from "../../_util";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/events/[ticker]">) {
  const ticker = tickerParam((await ctx.params).ticker);
  if (typeof ticker !== "string") return ticker;
  try {
    return NextResponse.json(await getEvents(ticker));
  } catch (err) {
    return errorResponse(err);
  }
}
