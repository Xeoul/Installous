"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { searchTickers, stockHref } from "@/lib/client-data";
import type { SearchResult as Result } from "@/lib/market";

export function TickerSearch({ placeholder = "Search stocks…" }: { placeholder?: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  // Results remember the query they answer, so Enter never opens a match for
  // an earlier, shorter query that's still on screen while the next search runs.
  const [results, setResults] = useState<{ query: string; items: Result[] }>({ query: "", items: [] });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!q.trim()) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const found = await searchTickers(q, ctrl.signal);
        if (!ctrl.signal.aborted) {
          setResults({ query: q.trim(), items: found });
          setActive(0);
        }
      } catch {
        // aborted or offline; keep previous results
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function go(ticker: string) {
    setOpen(false);
    setQ("");
    setResults({ query: "", items: [] });
    router.push(stockHref(ticker));
  }

  const shown = q.trim() ? results.items : [];

  return (
    <div ref={boxRef} className="relative">
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, shown.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            const typed = q.trim().toUpperCase();
            const fresh = results.query === q.trim();
            const pick = fresh
              ? (shown[active]?.ticker ?? typed)
              : (shown.find((r) => r.ticker === typed)?.ticker ?? typed);
            if (pick) go(pick);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        aria-label="Search stocks"
        className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-accent"
      />
      {open && shown.length > 0 && (
        <ul className="absolute right-0 z-30 mt-1 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
          {shown.map((r, i) => (
            <li key={r.ticker}>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => go(r.ticker)}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm ${i === active ? "bg-surface-2" : ""}`}
              >
                <span className="font-semibold">{r.ticker}</span>
                <span className="truncate text-text-2">{r.name}</span>
                {r.exchange && <span className="ml-auto shrink-0 text-xs text-muted">{r.exchange}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
