import type { ChartData } from "@/lib/chart";

/** Tiny 1D chart for list rows: green/red line with a dotted previous-close baseline. */
export function Sparkline({ data, width = 72, height = 28 }: { data?: ChartData; width?: number; height?: number }) {
  if (!data || data.points.length < 2) return <div style={{ width, height }} />;
  const pts = data.points;
  const x0 = Math.min(data.sessionStart ?? pts[0].t, pts[0].t);
  const x1 = Math.max(data.sessionEnd ?? pts[pts.length - 1].t, pts[pts.length - 1].t);
  const values = [...pts.map((p) => p.close), data.baseline];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const x = (t: number) => ((t - x0) / (x1 - x0 || 1)) * width;
  const y = (v: number) => 2 + (1 - (v - lo) / (hi - lo || 1)) * (height - 4);
  const up = pts[pts.length - 1].close >= data.baseline;
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.close).toFixed(1)}`).join("");
  return (
    <svg width={width} height={height} aria-hidden className="shrink-0">
      <line x1={0} x2={width} y1={y(data.baseline)} y2={y(data.baseline)} stroke="var(--muted)" strokeWidth={1} strokeDasharray="1 3" />
      <path d={d} fill="none" stroke={up ? "var(--up)" : "var(--down)"} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}
