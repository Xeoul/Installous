import type { NextRequest } from "next/server";
import { z } from "zod";
import { runAdvisor, type AdvisorEvent } from "@/lib/advisor";
import { errorResponse } from "../_util";

const body = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1) }))
    .min(1),
});

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return errorResponse(new Error("Set ANTHROPIC_API_KEY in .env.local to enable the AI advisor."), 503);
  }
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success || parsed.data.messages.at(-1)?.role !== "user") {
    return errorResponse(new Error("Expected a conversation ending with a user message"), 400);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: AdvisorEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        await runAdvisor(parsed.data.messages, emit, req.signal);
      } catch (err) {
        if (!req.signal.aborted) emit({ type: "error", message: (err as Error).message });
      }
      if (!req.signal.aborted) {
        emit({ type: "done" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
