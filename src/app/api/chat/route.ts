import type { NextRequest } from "next/server";
import { z } from "zod";
import { runAdvisor } from "@/lib/advisor";
import type { AdvisorEvent } from "@/lib/advisor-core";
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
      let open = true;
      // The browser can disconnect mid-answer; writing after that would throw.
      const emit = (e: AdvisorEvent) => {
        if (!open || req.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          open = false;
        }
      };
      try {
        await runAdvisor(parsed.data.messages, emit, req.signal);
      } catch (err) {
        emit({ type: "error", message: (err as Error).message });
      }
      emit({ type: "done" });
      if (open) {
        open = false;
        try {
          controller.close();
        } catch {
          // already closed by the client going away
        }
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
