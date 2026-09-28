import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { portfolioSnapshot } from "@/lib/advisor";
import { getFundamentals } from "@/lib/market";
import { addHolding, removeHolding } from "@/lib/store";
import { errorResponse } from "../_util";

const addBody = z.object({
  ticker: z.string().min(1).max(12),
  shares: z.number().positive(),
  price: z.number().positive(),
});
const removeBody = z.object({ ticker: z.string().min(1).max(12) });

export async function GET() {
  try {
    return NextResponse.json(await portfolioSnapshot());
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  const parsed = addBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse(new Error("ticker, shares and price are required"), 400);
  try {
    // Validate the ticker exists before recording a position in it.
    await getFundamentals(parsed.data.ticker);
  } catch {
    return errorResponse(new Error(`Unknown ticker: ${parsed.data.ticker}`), 400);
  }
  await addHolding(parsed.data.ticker, parsed.data.shares, parsed.data.price);
  return NextResponse.json(await portfolioSnapshot());
}

export async function DELETE(req: NextRequest) {
  const parsed = removeBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse(new Error("ticker is required"), 400);
  await removeHolding(parsed.data.ticker);
  return NextResponse.json(await portfolioSnapshot());
}
