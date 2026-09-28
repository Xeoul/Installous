import type { Rating } from "@/lib/scoring";

const TONE: Record<Rating, string> = {
  "Strong Buy": "bg-up/15 text-up border-up/40",
  Buy: "bg-up/10 text-up border-up/30",
  Hold: "bg-surface-2 text-text-2 border-border",
  Weak: "bg-warn/10 text-warn border-warn/30",
  Avoid: "bg-down/10 text-down border-down/30",
  "N/A": "bg-surface-2 text-muted border-border",
};

export function ScoreBadge({
  score,
  rating,
  size = "sm",
}: {
  score: number | null;
  rating: Rating;
  size?: "sm" | "lg";
}) {
  if (size === "lg") {
    return (
      <div className={`inline-flex items-baseline gap-2 rounded-xl border px-4 py-2 ${TONE[rating]}`}>
        <span className="num text-3xl font-semibold">{score ?? "—"}</span>
        <span className="text-sm font-medium">{rating}</span>
      </div>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${TONE[rating]}`}>
      <span className="num">{score ?? "—"}</span>
      <span>{rating}</span>
    </span>
  );
}
