import { NextResponse } from "next/server";

export function errorResponse(err: unknown, status = 500) {
  const message = err instanceof Error ? err.message : "Unexpected error";
  return NextResponse.json({ error: message }, { status });
}
