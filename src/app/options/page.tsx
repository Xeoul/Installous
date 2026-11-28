import { CondorBot } from "@/components/CondorBot";

export default function OptionsLab() {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">Options Lab</h1>
          <span className="rounded-md border border-border bg-surface-2 px-2 py-0.5 text-xs font-medium text-text-2">Paper money</span>
        </div>
        <p className="mt-1 max-w-5xl text-text-2">
          A bot that sells a far-out SPX (S&P 500 index) iron condor most market days, sized so a full loss costs 20% of the account
          (10% while it&apos;s 25% or more below its high), so wins compound. Right after each close it settles the day&apos;s condor and opens
          the next one at real quotes, and you can watch the order and the open position live here.
        </p>
      </div>

      <CondorBot />
    </div>
  );
}
