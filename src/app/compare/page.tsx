"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/components/Card";
import { ScoreBadge } from "@/components/ScoreBadge";
import type { ChartData, ChartRange } from "@/lib/chart";
import { getHistory, getStock, searchTickers, stockHref, type StockData } from "@/lib/client-data";
import { compact, fixed, money, ratioPct, signedPct } from "@/lib/format";
import type { SearchResult } from "@/lib/market";

const MAX = 4;
const COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)"];
const RANGES: { key: ChartRange; label: string }[] = [
  { key: "3mo", label: "3M" },
  { key: "ytd", label: "YTD" },
  { key: "1y", label: "1Y" },
  { key: "5y", label: "5Y" },
];

export default function ComparePage() {
  return (
    <Suspense>
      <Compare />
    </Suspense>
  );
}

function Compare() {
  const router = useRouter();
  const params = useSearchParams();
  const symbols = useMemo(
    () =>
      [...new Set((params.get("symbols") ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, MAX),
    [params],
  );
  const [range, setRange] = useState<ChartRange>("1y");
  const [stocks, setStocks] = useState<Record<string, StockData | { error: string }>>({});
  const [histories, setHistories] = useState<Record<string, ChartData>>({});
  const requested = useRef(new Set<string>());

  const setSymbols = (next: string[]) => router.replace(`/compare?symbols=${next.map(encodeURIComponent).join(",")}`);

  useEffect(() => {
    for (const s of symbols) {
      if (requested.current.has(s)) continue;
      requested.current.add(s);
      getStock(s)
        .then((d) => setStocks((m) => ({ ...m, [s]: d })))
        .catch((e: Error) => setStocks((m) => ({ ...m, [s]: { error: e.message } })));
    }
  }, [symbols]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(symbols.map((s) => getHistory(s, range).then((h) => [s, h] as const).catch(() => null))).then((all) => {
      if (!cancelled) setHistories(Object.fromEntries(all.filter((x): x is readonly [string, ChartData] => x !== null)));
    });
    return () => {
      cancelled = true;
    };
  }, [symbols, range]);

  const loaded = symbols.filter((s) => stocks[s] && !("error" in stocks[s]));
  const failed = symbols.filter((s) => stocks[s] && "error" in stocks[s]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Compare stocks</h1>
        <p className="text-text-2">Put up to {MAX} stocks side by side: performance, scores and key numbers.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {symbols.map((s, i) => (
          <span key={s} className="flex items-center gap-2 rounded-full border border-border bg-surface py-1 pl-3 pr-1 text-sm">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS[i] }} aria-hidden />
            <Link href={stockHref(s)} className="font-medium hover:text-accent">
              {s}
            </Link>
            <button
              onClick={() => setSymbols(symbols.filter((x) => x !== s))}
              className="grid h-6 w-6 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-text"
              aria-label={`Remove ${s}`}
            >
              ×
            </button>
          </span>
        ))}
        {symbols.length < MAX && <AddStock onAdd={(t) => !symbols.includes(t) && setSymbols([...symbols, t])} />}
      </div>

      {failed.map((s) => (
        <p key={s} className="text-sm text-down">
          ⚠ {(stocks[s] as { error: string }).error}
        </p>
      ))}

      {symbols.length === 0 ? (
        <Card>
          <p className="text-sm text-text-2">
            Add stocks above, or try{" "}
            <Link href="/compare?symbols=NVDA,AMD,AVGO" className="text-accent underline">
              NVDA vs AMD vs AVGO
            </Link>{" "}
            or{" "}
            <Link href="/compare?symbols=KO,PEP" className="text-accent underline">
              KO vs PEP
            </Link>
            .
          </p>
        </Card>
      ) : (
        <>
          <Card
            title="Performance"
            action={
              <div className="flex gap-1" role="tablist" aria-label="Chart range">
                {RANGES.map((r) => (
                  <button
                    key={r.key}
                    role="tab"
                    aria-selected={r.key === range}
                    onClick={() => setRange(r.key)}
                    className={`rounded-md px-2.5 py-1 text-xs ${r.key === range ? "bg-surface-2 font-medium" : "text-text-2 hover:text-text"}`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            }
          >
            <PerformanceChart symbols={symbols} histories={histories} />
          </Card>

          {loaded.length > 0 && <MetricsTable symbols={loaded} stocks={stocks as Record<string, StockData>} colorOf={(s) => COLORS[symbols.indexOf(s)]} />}
        </>
      )}
    </div>
  );
}

function AddStock({ onAdd }: { onAdd: (ticker: string) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);

  useEffect(() => {
    if (!q.trim()) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      searchTickers(q, ctrl.signal)
        .then((r) => !ctrl.signal.aborted && setResults(r))
        .catch(() => {});
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const add = (t: string) => {
    onAdd(t.toUpperCase());
    setQ("");
    setResults([]);
  };

  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && q.trim()) add(results[0]?.ticker ?? q.trim());
        }}
        placeholder="+ Add a stock"
        aria-label="Add a stock to compare"
        className="input w-40"
      />
      {q.trim() && results.length > 0 && (
        <ul className="absolute z-20 mt-1 w-64 overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
          {results.slice(0, 6).map((r) => (
            <li key={r.ticker}>
              <button onClick={() => add(r.ticker)} className="flex w-full gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2">
                <span className="font-semibold">{r.ticker}</span>
                <span className="truncate text-text-2">{r.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Percent change from the first shared day, so stocks at very different prices share one axis. */
function PerformanceChart({ symbols, histories }: { symbols: string[]; histories: Record<string, ChartData> }) {
  const ready = symbols.filter((s) => histories[s]?.points.length);
  const data = useMemo(() => {
    const byDate = new Map<string, Record<string, number>>();
    for (const s of ready) {
      for (const p of histories[s].points) {
        const d = new Date(p.t).toISOString().slice(0, 10);
        byDate.set(d, { ...byDate.get(d), [s]: p.close });
      }
    }
    const rows = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const start = rows.find(([, v]) => ready.every((s) => v[s] !== undefined));
    if (!start) return [];
    return rows
      .filter(([d]) => d >= start[0])
      .map(([date, v]) => ({
        date,
        ...Object.fromEntries(ready.filter((s) => v[s] !== undefined).map((s) => [s, (v[s] / start[1][s] - 1) * 100])),
      })) as ({ date: string } & Record<string, number>)[];
  }, [ready, histories]);

  if (data.length < 2) return <div className="h-72 animate-pulse rounded-lg bg-surface-2" />;
  const last = data[data.length - 1];
  const color = (s: string) => COLORS[symbols.indexOf(s)];
  const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-sm" aria-hidden>
        {ready.map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-5 rounded" style={{ background: color(s) }} />
            <span className="font-medium">{s}</span>
            <span className={`num ${last[s] >= 0 ? "text-up" : "text-down"}`}>
              {last[s] >= 0 ? "▲" : "▼"} {signedPct(last[s])}
            </span>
          </span>
        ))}
      </div>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="date" tickFormatter={fmt} tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={40} />
            <YAxis
              // A stock can't lose more than 100%, so don't let the axis suggest it.
              domain={[(min: number) => Math.max(-100, Math.floor(min / 10) * 10), "auto"]}
              tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${v.toFixed(0)}%`} tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={false} width={52} />
            <Tooltip
              cursor={{ stroke: "var(--muted)", strokeDasharray: "3 3" }}
              contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", fontSize: 12 }}
              labelFormatter={(d) => new Date(`${String(d)}T12:00:00Z`).toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" })}
              formatter={(v, name) => [signedPct(Number(v)), String(name)]}
            />
            {ready.map((s) => (
              <Line key={s} type="monotone" dataKey={s} stroke={color(s)} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }} isAnimationActive={false} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

type Row = { label: string; value: (d: StockData) => number | null; format: (v: number | null) => string; better?: "high" | "low" };

const ROWS: { section: string; rows: Row[] }[] = [
  {
    section: "Price",
    rows: [
      { label: "Price", value: (d) => d.fundamentals.price, format: (v) => money(v) },
      { label: "Today", value: (d) => d.fundamentals.changePercent, format: (v) => (v === null ? "—" : signedPct(v)) },
      { label: "52-week return", value: (d) => d.fundamentals.fiftyTwoWeekChangePercent, format: (v) => (v === null ? "—" : signedPct(v)), better: "high" },
      { label: "Market cap", value: (d) => d.fundamentals.marketCap, format: compact },
    ],
  },
  {
    section: "Installous score",
    rows: [
      ...(["value", "quality", "growth", "momentum", "sentiment"] as const).map(
        (k): Row => ({
          label: k === "sentiment" ? "Analyst sentiment" : k[0].toUpperCase() + k.slice(1),
          value: (d) => d.score.factors.find((f) => f.key === k)?.score ?? null,
          format: (v) => (v === null ? "—" : String(v)),
          better: "high",
        }),
      ),
    ],
  },
  {
    section: "Valuation & fundamentals",
    rows: [
      { label: "Forward P/E", value: (d) => d.fundamentals.forwardPE, format: (v) => fixed(v, 1), better: "low" },
      { label: "PEG", value: (d) => d.fundamentals.pegRatio, format: (v) => fixed(v), better: "low" },
      { label: "Revenue growth", value: (d) => d.fundamentals.revenueGrowth, format: (v) => ratioPct(v), better: "high" },
      { label: "Operating margin", value: (d) => d.fundamentals.operatingMargins, format: (v) => ratioPct(v), better: "high" },
      { label: "ROE", value: (d) => d.fundamentals.returnOnEquity, format: (v) => ratioPct(v), better: "high" },
      { label: "Debt / equity", value: (d) => (d.fundamentals.debtToEquity === null ? null : d.fundamentals.debtToEquity / 100), format: (v) => (v === null ? "—" : `${v.toFixed(2)}x`), better: "low" },
      { label: "Dividend yield", value: (d) => d.fundamentals.dividendYield, format: (v) => ratioPct(v, 2) },
      {
        label: "Upside to analyst target",
        value: (d) => (d.fundamentals.targetMeanPrice && d.fundamentals.price ? (d.fundamentals.targetMeanPrice / d.fundamentals.price - 1) * 100 : null),
        format: (v) => (v === null ? "—" : signedPct(v, 1)),
        better: "high",
      },
    ],
  },
];

/** Metrics side by side; the best value in each comparable row is bold and starred. */
function MetricsTable({ symbols, stocks, colorOf }: { symbols: string[]; stocks: Record<string, StockData>; colorOf: (s: string) => string }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
      <table className="w-full min-w-[520px] text-sm">
        <thead className="border-b border-border">
          <tr>
            <th className="w-48 px-5 py-3" />
            {symbols.map((s) => (
              <th key={s} className="px-4 py-3 text-right">
                <Link href={stockHref(s)} className="inline-flex items-center gap-1.5 font-semibold hover:text-accent">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorOf(s) }} aria-hidden />
                  {s}
                </Link>
                <div className="truncate text-xs font-normal text-text-2">{stocks[s].fundamentals.name}</div>
              </th>
            ))}
          </tr>
          <tr className="border-t border-border">
            <th className="px-5 py-2 text-left text-xs font-medium text-text-2">Overall score</th>
            {symbols.map((s) => (
              <th key={s} className="px-4 py-2 text-right">
                <ScoreBadge score={stocks[s].score.overall} rating={stocks[s].score.rating} />
              </th>
            ))}
          </tr>
        </thead>
        {ROWS.map((group) => (
          <tbody key={group.section} className="divide-y divide-border border-t border-border">
            <tr>
              <th colSpan={symbols.length + 1} className="bg-surface-2 px-5 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-text-2">
                {group.section}
              </th>
            </tr>
            {group.rows.map((row) => {
              const values = symbols.map((s) => row.value(stocks[s]));
              const nums = values.filter((v): v is number => v !== null);
              const best = row.better && nums.length > 1 ? (row.better === "high" ? Math.max(...nums) : Math.min(...nums.filter((n) => n > 0))) : null;
              return (
                <tr key={row.label}>
                  <td className="px-5 py-2 text-text-2">{row.label}</td>
                  {values.map((v, i) => {
                    const isBest = best !== null && v === best;
                    return (
                      <td key={symbols[i]} className={`num px-4 py-2 text-right ${isBest ? "font-semibold" : ""}`}>
                        {isBest && <span className="mr-1 text-text-2" aria-label="best">★</span>}
                        {row.format(v)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
      <p className="border-t border-border px-5 py-2 text-xs text-muted">★ marks the best value in rows where higher or lower is clearly better.</p>
    </div>
  );
}
