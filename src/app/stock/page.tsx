"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { StockView } from "./StockView";

// The ticker is a query parameter (/stock?symbol=AAPL) rather than a path
// segment so the page can also be exported as static HTML for the demo.
export default function StockPage() {
  return (
    <Suspense>
      <StockFromQuery />
    </Suspense>
  );
}

function StockFromQuery() {
  const symbol = useSearchParams().get("symbol")?.trim().toUpperCase();
  if (!symbol) {
    return (
      <div className="py-16 text-center">
        <h1 className="text-xl font-semibold">No stock selected</h1>
        <p className="mt-2 text-text-2">Search for a stock using the box at the top of the page.</p>
        <Link href="/" className="mt-4 inline-block text-accent">← Back to dashboard</Link>
      </div>
    );
  }
  return <StockView key={symbol} ticker={symbol} />;
}
