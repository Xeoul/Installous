import { NextResponse, type NextRequest } from "next/server";
import { getNews } from "@/lib/market";
import { errorResponse, tickerParam } from "../../_util";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/news/[ticker]">) {
  const ticker = tickerParam((await ctx.params).ticker);
  if (typeof ticker !== "string") return ticker;
  try {
    return NextResponse.json(await getNews(ticker));
  } catch (err) {
    return errorResponse(err);
  }
}
