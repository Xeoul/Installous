"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { forgetApiKey, loadApiKey, saveApiKey, streamFromServer, streamInBrowser } from "@/lib/advisor-client";
import type { AdvisorEvent } from "@/lib/advisor-core";
import { DEMO } from "@/lib/client-data";

interface Msg {
  role: "user" | "assistant";
  content: string;
  steps?: string[];
  error?: string;
}

const STORAGE_KEY = "installous.chat.v1";

const SUGGESTIONS = [
  "What are the 3 best stocks to buy right now for my profile?",
  "Review my portfolio: what should I trim, hold, or add to?",
  "Compare NVDA, AMD, and AVGO. Which is the best buy today?",
  "Find me undervalued, high-quality dividend stocks.",
];

function loadHistory(): Msg[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Msg[]) : [];
  } catch {
    return [];
  }
}

export function Chat({ initialPrompt, compact = false }: { initialPrompt?: string; compact?: boolean }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const sentInitial = useRef(false);
  const loaded = useRef(false);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [keyChecked, setKeyChecked] = useState(!DEMO);

  // Restore the saved conversation (full-page advisor only) and, in the demo,
  // the visitor's API key.
  useEffect(() => {
    if (!compact) {
      setMessages(loadHistory());
    }
    if (DEMO) {
      setApiKey(loadApiKey());
      setKeyChecked(true);
    }
    loaded.current = true;
  }, [compact]);

  useEffect(() => {
    if (compact || !loaded.current || busy) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-40)));
    } catch {
      // storage unavailable; conversation just won't persist
    }
  }, [messages, busy, compact]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const send = useCallback(
    async (text: string, prior: Msg[]) => {
      const content = text.trim();
      if (!content) return;
      const history: Msg[] = [...prior, { role: "user", content }];
      setMessages([...history, { role: "assistant", content: "", steps: [] }]);
      setInput("");
      setBusy(true);

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const update = (fn: (m: Msg) => Msg) =>
        setMessages((ms) => [...ms.slice(0, -1), fn(ms[ms.length - 1])]);

      let afterTool = false;
      const onEvent = (event: AdvisorEvent) => {
        if (event.type === "text") {
          const sep = afterTool ? "\n\n" : "";
          afterTool = false;
          update((m) => ({ ...m, content: m.content + (m.content && sep ? sep : "") + event.text }));
        } else if (event.type === "tool") {
          afterTool = true;
          update((m) => ({ ...m, steps: [...(m.steps ?? []), event.label] }));
        } else if (event.type === "error") {
          update((m) => ({ ...m, error: event.message }));
        }
      };
      // Only send turns that have text; failed/empty replies are dropped.
      const turns = history.filter((m) => m.content.trim()).map(({ role, content }) => ({ role, content }));

      try {
        if (DEMO) {
          if (!apiKey) throw new Error("Add your Anthropic API key to use the advisor.");
          await streamInBrowser(turns, apiKey, onEvent, ctrl.signal);
        } else {
          await streamFromServer(turns, onEvent, ctrl.signal);
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          update((m) => ({ ...m, error: (err as Error).message }));
        }
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [apiKey],
  );

  const ready = !DEMO || !!apiKey;

  useEffect(() => {
    if (initialPrompt && ready && !sentInitial.current && loaded.current) {
      sentInitial.current = true;
      void send(initialPrompt, compact ? [] : loadHistory());
    }
  }, [initialPrompt, send, compact, ready]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pb-4">
        {DEMO && keyChecked && !apiKey && (
          <ApiKeyPanel
            onSave={(k) => {
              saveApiKey(k);
              setApiKey(k);
            }}
          />
        )}
        {messages.length === 0 && !compact && ready && (
          <div className="py-8">
            <h1 className="text-2xl font-semibold">Ask Installous</h1>
            <p className="mt-1 text-text-2">
              Your AI analyst pulls live prices, fundamentals, factor scores, news, and your portfolio to help you pick
              stocks.
            </p>
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s, messages)}
                  className="rounded-xl border border-border bg-surface p-3 text-left text-sm hover:border-accent"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-accent px-4 py-2 text-sm text-white">{m.content}</div>
            </div>
          ) : (
            <div key={i} className="space-y-2">
              {m.steps && m.steps.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {m.steps.map((s, j) => (
                    <span key={j} className="rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-xs text-text-2">
                      {s}
                    </span>
                  ))}
                </div>
              )}
              {m.content ? (
                <div className="prose-installous text-sm">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                </div>
              ) : (
                busy && i === messages.length - 1 && !m.error && <div className="text-sm text-muted animate-pulse">Researching…</div>
              )}
              {m.error && (
                <div className="rounded-lg border border-down/40 bg-down/10 px-3 py-2 text-sm text-down">⚠ {m.error}</div>
              )}
            </div>
          ),
        )}
        <div ref={bottomRef} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) void send(input, messages);
        }}
        className="flex gap-2 border-t border-border pt-3"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!busy) void send(input, messages);
            }
          }}
          rows={1}
          placeholder="Ask about any stock, your portfolio, or what to buy…"
          className="min-h-10 flex-1 resize-none rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
        {busy ? (
          <button type="button" onClick={() => abortRef.current?.abort()} className="rounded-xl border border-border px-4 text-sm">
            Stop
          </button>
        ) : (
          <button type="submit" disabled={!input.trim() || !ready} className="rounded-xl bg-accent px-4 text-sm font-medium text-white disabled:opacity-40">
            Send
          </button>
        )}
        {!compact && messages.length > 0 && !busy && (
          <button type="button" onClick={() => setMessages([])} className="rounded-xl px-2 text-sm text-muted hover:text-text" title="Start a new conversation">
            Clear
          </button>
        )}
      </form>
      {DEMO && apiKey && !compact && (
        <p className="pt-2 text-xs text-muted">
          Using your Anthropic API key, stored only in this browser.{" "}
          <button
            type="button"
            onClick={() => {
              forgetApiKey();
              setApiKey(null);
            }}
            className="underline hover:text-text"
          >
            Remove key
          </button>
        </p>
      )}
    </div>
  );
}

function ApiKeyPanel({ onSave }: { onSave: (key: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSave(value.trim());
      }}
      className="rounded-2xl border border-border bg-surface p-5"
    >
      <h2 className="font-semibold">Try the AI advisor with your own API key</h2>
      <p className="mt-1 text-sm text-text-2">
        This is the public demo, so the advisor runs in your browser on your own Anthropic account. Your key is saved
        only in this browser and sent only to <code>api.anthropic.com</code>. A typical answer costs roughly 10–50 cents in API usage.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="sk-ant-…"
          autoComplete="off"
          aria-label="Anthropic API key"
          className="input min-w-0 flex-1"
        />
        <button disabled={!value.trim()} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
          Save key
        </button>
      </div>
      <p className="mt-2 text-xs text-muted">
        Don&apos;t have one?{" "}
        <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="underline">
          Create a key in the Anthropic Console
        </a>
        . You can remove it any time.
      </p>
    </form>
  );
}
