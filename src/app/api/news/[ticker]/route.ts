import { NextResponse, type NextRequest } from "next/server";
import { getNews } from "@/lib/market";
import { errorResponse } from "../../_util";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/news/[ticker]">) {
  const { ticker } = await ctx.params;
  try {
    return NextResponse.json(await getNews(ticker));
  } catch (err) {
    return errorResponse(err);
  }
}
