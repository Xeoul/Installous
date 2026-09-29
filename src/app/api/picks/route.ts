import { NextResponse } from "next/server";
import { buildPicks } from "@/lib/picks";
import { readStore } from "@/lib/store";
import { errorResponse } from "../_util";

export async function GET() {
  try {
    return NextResponse.json(await buildPicks((await readStore()).watchlist));
  } catch (err) {
    return errorResponse(err);
  }
}
