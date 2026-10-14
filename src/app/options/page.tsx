import { CondorBot } from "@/components/CondorBot";

export default function OptionsLab() {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">Options Lab</h1>
          <span className="rounded-md border border-border bg-surface-2 px-2 py-0.5 text-xs font-medium text-text-2">Paper money</span>
        </div>
        <p className="mt-1 max-w-3xl text-text-2">
          A bot that sells a SPY iron condor every market day with martingale sizing: a loss moves up a level (1, 3, 6
          contracts), any win goes back to level 1. It rolls into a next-day condor in the last half hour of each market day
          at real quotes, and you can watch the order and the open position live here.
        </p>
      </div>

      <CondorBot />
    </div>
  );
}
