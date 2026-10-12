import { NextResponse } from "next/server";
import { getIndexBars } from "@/lib/market";
import { errorResponse } from "../_util";

export async function GET() {
  try {
    return NextResponse.json(await getIndexBars());
  } catch (err) {
    return errorResponse(err, 502);
  }
}
