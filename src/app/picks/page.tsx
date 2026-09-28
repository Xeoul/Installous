"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Change } from "@/components/Change";
import { ScoreBadge } from "@/components/ScoreBadge";
import { compact, money } from "@/lib/format";
import type { FactorKey, Rating } from "@/lib/scoring";

interface Pick {
  ticker: string;
  name: string;
  sector: string | null;
  price: number | null;
  changePercent: number | null;
  marketCap: number | null;
  overall: number | null;
  rating: Rating;
  factors: Record<FactorKey, number | null>;
  onWatchlist: boolean;
}

type SortKey = "overall" | FactorKey | "marketCap" | "changePercent";

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "overall", label: "Score" },
  { key: "value", label: "Value" },
  { key: "quality", label: "Quality" },
  { key: "growth", label: "Growth" },
  { key: "momentum", label: "Momentum" },
  { key: "sentiment", label: "Analysts" },
];

function sortValue(p: Pick, key: SortKey): number {
  if (key === "overall" || key === "marketCap" || key === "changePercent") return p[key] ?? -Infinity;
  return p.factors[key] ?? -Infinity;
}

export default function PicksPage() {
  const [picks, setPicks] = useState<Pick[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("overall");
  const [sector, setSector] = useState("All");

  useEffect(() => {
    fetch("/api/picks")
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "Failed to load");
        setPicks(body);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const sectors = useMemo(
    () => ["All", ...[...new Set((picks ?? []).map((p) => p.sector).filter((s): s is string => !!s))].sort()],
    [picks],
  );
  const rows = useMemo(
    () =>
      (picks ?? [])
        .filter((p) => sector === "All" || p.sector === sector)
        .sort((a, b) => sortValue(b, sort) - sortValue(a, sort)),
    [picks, sort, sector],
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Top Picks</h1>
        <p className="text-text-2">
          Large-cap US stocks plus your watchlist, ranked by Installous&apos;s five-factor score. Click a column to re-rank.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-text-2" htmlFor="sector">Sector</label>
        <select
          id="sector"
          value={sector}
          onChange={(e) => setSector(e.target.value)}
          className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
        >
          {sectors.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <Link
          href={`/advisor?q=${encodeURIComponent("Look at today's top-ranked stocks and tell me which 3 you'd actually buy for my profile, and why.")}`}
          className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white"
        >
          Ask AI to pick from these →
        </Link>
      </div>

      {error && <div className="rounded-lg border border-down/40 bg-down/10 px-3 py-2 text-sm text-down">⚠ {error}</div>}

      <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs text-text-2">
            <tr>
              <th className="px-4 py-3 font-medium">#</th>
              <th className="px-4 py-3 font-medium">Stock</th>
              <th className="px-4 py-3 text-right font-medium">Price</th>
              <th className="hidden px-4 py-3 text-right font-medium md:table-cell">Mkt cap</th>
              {COLUMNS.map((c) => (
                <th key={c.key} className="px-3 py-3 text-right font-medium">
                  <button
                    onClick={() => setSort(c.key)}
                    className={sort === c.key ? "font-semibold text-text" : "hover:text-text"}
                    aria-sort={sort === c.key ? "descending" : undefined}
                  >
                    {c.label}
                    {sort === c.key ? " ↓" : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {!picks &&
              Array.from({ length: 10 }, (_, i) => (
                <tr key={i}>
                  <td colSpan={10} className="px-4 py-3">
                    <div className="h-5 animate-pulse rounded bg-surface-2" />
                  </td>
                </tr>
              ))}
            {rows.map((p, i) => (
              <tr key={p.ticker} className="hover:bg-surface-2/50">
                <td className="num px-4 py-3 text-muted">{i + 1}</td>
                <td className="px-4 py-3">
                  <Link href={`/stock/${p.ticker}`} className="block">
                    <span className="font-medium">{p.ticker}</span>
                    {p.onWatchlist && <span className="ml-1 text-xs text-muted" title="On your watchlist">★</span>}
                    <div className="max-w-[180px] truncate text-xs text-text-2">{p.name}</div>
                  </Link>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="num">{money(p.price)}</div>
                  <Change value={p.changePercent} className="text-xs" />
                </td>
                <td className="num hidden px-4 py-3 text-right text-text-2 md:table-cell">{compact(p.marketCap)}</td>
                <td className="px-3 py-3 text-right">
                  <ScoreBadge score={p.overall} rating={p.rating} />
                </td>
                {COLUMNS.slice(1).map((c) => (
                  <td key={c.key} className="num px-3 py-3 text-right text-text-2">
                    {p.factors[c.key as FactorKey] ?? "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
