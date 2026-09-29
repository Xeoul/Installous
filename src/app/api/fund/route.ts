import { NextResponse } from "next/server";
import { errorResponse } from "../_util";

// The AI Fund runs on a schedule in GitHub Actions and is published with the
// live demo, so the local app shows that same fund rather than a copy of its own.
const FUND_URL = process.env.INSTALLOUS_FUND_URL ?? "https://xeoul.github.io/Installous/demo-data/fund.json";

export async function GET() {
  try {
    const r = await fetch(FUND_URL, { next: { revalidate: 300 } });
    if (!r.ok) throw new Error(`Couldn't load the AI Fund (${r.status})`);
    return NextResponse.json(await r.json());
  } catch (err) {
    return errorResponse(err, 502);
  }
}
