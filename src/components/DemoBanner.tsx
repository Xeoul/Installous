"use client";

import { useEffect, useState } from "react";
import { DEMO, getDemoMeta } from "@/lib/client-data";

/** Shown only in the static demo: says where the data comes from and how fresh it is. */
export function DemoBanner() {
  const [asOf, setAsOf] = useState<string | null>(null);

  useEffect(() => {
    if (!DEMO) return;
    getDemoMeta()
      .then((m) =>
        setAsOf(
          new Date(m.generatedAt).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            timeZone: "America/New_York",
            timeZoneName: "short",
          }),
        ),
      )
      .catch(() => {});
  }, []);

  if (!DEMO) return null;
  return (
    <div className="border-b border-border bg-surface-2 px-4 py-2 text-center text-xs text-text-2">
      <strong className="font-semibold text-text">Live demo</strong>
      {" · "}Market data {asOf ? `as of ${asOf}` : "snapshot"}, refreshed every 30 min during market hours
      {" · "}Your portfolio and watchlist stay in this browser
      {" · "}
      <a href="https://github.com/Xeoul/Installous" target="_blank" rel="noreferrer" className="underline hover:text-text">
        Source
      </a>
    </div>
  );
}
