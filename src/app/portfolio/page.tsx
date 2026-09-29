"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Card, Stat } from "@/components/Card";
import { Change } from "@/components/Change";
import { addHolding, getPortfolio, removeHolding, stockHref } from "@/lib/client-data";
import { money } from "@/lib/format";
import type { PortfolioSnapshot as Portfolio } from "@/lib/portfolio";

export default function PortfolioPage() {
  return (
    <Suspense>
      <PortfolioView />
    </Suspense>
  );
}

function PortfolioView() {
  const params = useSearchParams();
  const [data, setData] = useState<Portfolio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ ticker: params.get("add") ?? "", shares: "", price: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getPortfolio()
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      setData(await addHolding(form.ticker, Number(form.shares), Number(form.price)));
      setForm({ ticker: "", shares: "", price: "" });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(ticker: string) {
    if (!confirm(`Remove ${ticker} from your portfolio?`)) return;
    try {
      setData(await removeHolding(ticker));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const has = data && data.holdings.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Portfolio</h1>
          <p className="text-text-2">Track your positions. Installous uses them when it gives you advice.</p>
        </div>
        {has && (
          <Link
            href={`/advisor?q=${encodeURIComponent("Review my portfolio in depth: diversification, risk, which positions to trim or add to, and what's missing.")}`}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white"
          >
            Get AI portfolio review →
          </Link>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Market value" value={data ? money(data.totalValue) : "…"} />
        <Stat label="Cost basis" value={data ? money(data.totalCost) : "…"} />
        <Stat label="Total gain / loss" value={data ? money(data.totalGain) : "…"} sub={has ? <Change value={data.totalGainPercent} /> : null} />
      </div>

      <Card title="Add a position">
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
          <Field label="Ticker">
            <input required value={form.ticker} onChange={(e) => setForm({ ...form, ticker: e.target.value.toUpperCase() })} placeholder="AAPL" className="input w-28" />
          </Field>
          <Field label="Shares">
            <input required type="number" step="any" min="0" value={form.shares} onChange={(e) => setForm({ ...form, shares: e.target.value })} placeholder="10" className="input w-28" />
          </Field>
          <Field label="Price paid / share">
            <input required type="number" step="any" min="0" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="150.00" className="input w-36" />
          </Field>
          <button disabled={saving} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {saving ? "Saving…" : "Add"}
          </button>
        </form>
        <p className="mt-2 text-xs text-muted">Adding shares of a stock you already own averages the cost basis.</p>
        {error && <p className="mt-2 text-sm text-down">⚠ {error}</p>}
      </Card>

      {has && (
        <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-text-2">
              <tr>
                <th className="px-4 py-3 font-medium">Stock</th>
                <th className="px-4 py-3 text-right font-medium">Shares</th>
                <th className="px-4 py-3 text-right font-medium">Avg cost</th>
                <th className="px-4 py-3 text-right font-medium">Price</th>
                <th className="px-4 py-3 text-right font-medium">Value</th>
                <th className="px-4 py-3 text-right font-medium">Gain / loss</th>
                <th className="px-4 py-3 text-right font-medium">Weight</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.holdings.map((h) => (
                <tr key={h.ticker}>
                  <td className="px-4 py-3">
                    <Link href={stockHref(h.ticker)} className="font-medium hover:text-accent">{h.ticker}</Link>
                    <div className="max-w-[180px] truncate text-xs text-text-2">{h.name}</div>
                  </td>
                  <td className="num px-4 py-3 text-right">{h.shares}</td>
                  <td className="num px-4 py-3 text-right">{money(h.costBasis)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="num">{money(h.price)}</div>
                    <Change value={h.dayChangePercent} className="text-xs" />
                  </td>
                  <td className="num px-4 py-3 text-right">{money(h.value)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="num">{money(h.gain)}</div>
                    <Change value={h.gainPercent} className="text-xs" />
                  </td>
                  <td className="num px-4 py-3 text-right text-text-2">{h.weightPercent === null ? "—" : `${h.weightPercent.toFixed(1)}%`}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => remove(h.ticker)} className="text-xs text-muted hover:text-down" aria-label={`Remove ${h.ticker}`}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-text-2">
      {label}
      {children}
    </label>
  );
}
