// Shared types and helpers for price charts (safe to import from client components).

export type ChartRange = "1d" | "1w" | "1mo" | "3mo" | "ytd" | "1y" | "5y";

export const CHART_RANGES: { key: ChartRange; label: string; period: string }[] = [
  { key: "1d", label: "1D", period: "Today" },
  { key: "1w", label: "1W", period: "Past week" },
  { key: "1mo", label: "1M", period: "Past month" },
  { key: "3mo", label: "3M", period: "Past 3 months" },
  { key: "ytd", label: "YTD", period: "Year to date" },
  { key: "1y", label: "1Y", period: "Past year" },
  { key: "5y", label: "5Y", period: "Past 5 years" },
];

export interface ChartData {
  ticker: string;
  range: ChartRange;
  intraday: boolean;
  points: { t: number; close: number }[];
  baseline: number;
  sessionStart?: number;
  sessionEnd?: number;
}

/** Nearest point index to time t in points sorted by time. */
export function nearestIndex(points: { t: number }[], t: number): number {
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t <= t) lo = mid;
    else hi = mid;
  }
  return Math.abs(points[hi].t - t) < Math.abs(points[lo].t - t) ? hi : lo;
}

export function formatPointTime(t: number, range: ChartRange): string {
  const d = new Date(t);
  const tz = "America/New_York";
  if (range === "1d") return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }) + " ET";
  if (range === "1w" || range === "1mo")
    return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: tz });
}
