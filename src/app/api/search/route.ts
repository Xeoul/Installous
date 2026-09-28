import { NextResponse, type NextRequest } from "next/server";
import { searchTickers } from "@/lib/market";
import { errorResponse } from "../_util";

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json(await searchTickers(req.nextUrl.searchParams.get("q") ?? ""));
  } catch (err) {
    return errorResponse(err);
  }
}
