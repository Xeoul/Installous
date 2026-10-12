import { NextResponse } from "next/server";
import { normalizeTicker } from "@/lib/market";

// How Yahoo Finance (and our own lookups) say a symbol doesn't exist.
const NOT_FOUND = /not found|no data found|unknown ticker|delisted|invalid symbol/i;

export function errorResponse(err: unknown, status = 500) {
  const message = err instanceof Error ? err.message : "Unexpected error";
  return NextResponse.json({ error: message }, { status: status >= 500 && NOT_FOUND.test(message) ? 404 : status });
}

/** The normalized ticker from a route parameter, or a 400 response when there isn't one. */
export function tickerParam(raw: string): string | NextResponse {
  const ticker = normalizeTicker(raw);
  return ticker ? ticker : NextResponse.json({ error: "Missing or invalid ticker" }, { status: 400 });
}
