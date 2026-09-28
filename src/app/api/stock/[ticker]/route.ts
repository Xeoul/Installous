import { NextResponse, type NextRequest } from "next/server";
import { scoreTicker } from "@/lib/picks";
import { errorResponse } from "../../_util";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/stock/[ticker]">) {
  const { ticker } = await ctx.params;
  try {
    return NextResponse.json(await scoreTicker(ticker));
  } catch (err) {
    return errorResponse(err, 404);
  }
}
