// How the chat UI talks to the advisor: over the /api/chat stream in the full
// app, or directly from the browser with the visitor's own API key in the demo.
import type { AdvisorEvent, ChatTurn } from "./advisor-core";
import { demoAdvisorData, getProfile } from "./client-data";

const KEY_STORAGE = "installous.anthropicKey";

export function loadApiKey(): string | null {
  try {
    return localStorage.getItem(KEY_STORAGE);
  } catch {
    return null;
  }
}

export function saveApiKey(key: string) {
  try {
    localStorage.setItem(KEY_STORAGE, key);
  } catch {
    // Storage unavailable; the key only lasts for this page view.
  }
}

export function forgetApiKey() {
  try {
    localStorage.removeItem(KEY_STORAGE);
  } catch {
    // nothing stored
  }
}

export async function streamFromServer(
  history: ChatTurn[],
  onEvent: (e: AdvisorEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: history }),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      if (frame.startsWith("data: ")) onEvent(JSON.parse(frame.slice(6)) as AdvisorEvent);
    }
  }
}

const DEMO_NOTE =
  "You are running inside the public Installous demo. Market data comes from a snapshot of about 50 large-cap US stocks that is refreshed every 30 minutes during market hours, so prices may lag by that much; mention that when timing matters. If a ticker isn't in the snapshot, say so and suggest one that is, or use web search for context.";

export async function streamInBrowser(
  history: ChatTurn[],
  apiKey: string,
  onEvent: (e: AdvisorEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  // Loaded on demand so the SDK only ships to visitors who use the advisor.
  const [{ default: Anthropic }, { runAdvisorLoop }] = await Promise.all([
    import("@anthropic-ai/sdk"),
    import("./advisor-core"),
  ]);
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  try {
    await runAdvisorLoop({
      client,
      history,
      profile: await getProfile(),
      data: demoAdvisorData,
      emit: onEvent,
      signal,
      note: DEMO_NOTE,
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      throw new Error("Anthropic rejected that API key. Check it and try again, or remove it and paste a new one.");
    }
    if (err instanceof Anthropic.PermissionDeniedError) {
      throw new Error("That API key isn't allowed to use this model. Check your Anthropic Console settings.");
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new Error("Your Anthropic account hit a rate or spending limit. Try again in a moment.");
    }
    if (err instanceof Anthropic.APIUserAbortError) {
      const abort = new Error("Stopped");
      abort.name = "AbortError";
      throw abort;
    }
    throw err;
  }
}
