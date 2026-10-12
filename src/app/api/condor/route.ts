import { NextResponse } from "next/server";
import { errorResponse } from "../_util";

// Like the AI Fund, the condor bot trades on a schedule in GitHub Actions and
// is published with the live demo, so the local app shows that same bot.
const BOT_URL = process.env.INSTALLOUS_CONDOR_URL ?? "https://xeoul.github.io/Installous/demo-data/condor.json";

export async function GET() {
  try {
    const r = await fetch(BOT_URL, { next: { revalidate: 300 } });
    if (!r.ok) throw new Error(`Couldn't load the condor bot (${r.status})`);
    return NextResponse.json(await r.json());
  } catch (err) {
    return errorResponse(err, 502);
  }
}
