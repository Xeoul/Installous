import { signedPct } from "@/lib/format";

/** Signed percent change with an arrow, so direction never relies on color alone. */
export function Change({ value, className = "" }: { value: number | null | undefined; className?: string }) {
  if (value === null || value === undefined) return <span className={`text-muted ${className}`}>—</span>;
  const up = value >= 0;
  return (
    <span className={`num ${up ? "text-up" : "text-down"} ${className}`}>
      {up ? "▲" : "▼"} {signedPct(value)}
    </span>
  );
}
