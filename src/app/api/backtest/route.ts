import { NextResponse } from "next/server";
import { errorResponse } from "../_util";

// Like the AI Fund itself, the backtest is computed by the scheduled demo
// workflow, so the local app shows the published result.
const BACKTEST_URL = process.env.INSTALLOUS_BACKTEST_URL ?? "https://xeoul.github.io/Installous/demo-data/backtest.json";

export async function GET() {
  try {
    const r = await fetch(BACKTEST_URL, { next: { revalidate: 3600 } });
    if (!r.ok) throw new Error(`Couldn't load the backtest (${r.status})`);
    return NextResponse.json(await r.json());
  } catch (err) {
    return errorResponse(err, 502);
  }
}
