import type { FactorScore } from "@/lib/scoring";

/** One horizontal 0-100 meter per factor, single hue; the number is always shown as text. */
export function FactorBars({ factors }: { factors: FactorScore[] }) {
  return (
    <div className="space-y-4">
      {factors.map((f) => (
        <div key={f.key}>
          <div className="mb-1 flex items-baseline justify-between text-sm">
            <span className="font-medium">{f.label}</span>
            <span className="num text-text-2">{f.score ?? "n/a"}</span>
          </div>
          <div
            className="h-2 w-full rounded-full bg-surface-2"
            role="meter"
            aria-label={`${f.label} score`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={f.score ?? undefined}
          >
            {f.score !== null && (
              <div className="h-2 rounded-full bg-accent" style={{ width: `${Math.max(f.score, 2)}%` }} />
            )}
          </div>
          {f.notes.length > 0 && <p className="mt-1 text-xs text-muted">{f.notes.join(" · ")}</p>}
        </div>
      ))}
    </div>
  );
}
