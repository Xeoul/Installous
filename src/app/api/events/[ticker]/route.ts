import { NextResponse, type NextRequest } from "next/server";
import { getEvents } from "@/lib/market";
import { errorResponse } from "../../_util";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/events/[ticker]">) {
  const { ticker } = await ctx.params;
  try {
    return NextResponse.json(await getEvents(ticker));
  } catch (err) {
    return errorResponse(err);
  }
}
