import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { readStore, setProfile } from "@/lib/store";
import { errorResponse } from "../_util";

const body = z.object({
  risk: z.enum(["conservative", "moderate", "aggressive"]),
  horizon: z.string().min(1).max(100),
  goals: z.string().min(1).max(1000),
});

export async function GET() {
  const { profile } = await readStore();
  return NextResponse.json(profile);
}

export async function PUT(req: NextRequest) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse(new Error("Invalid profile"), 400);
  const store = await setProfile(parsed.data);
  return NextResponse.json(store.profile);
}
