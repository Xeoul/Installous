// Date labels for YYYY-MM-DD strings, shared across pages and charts. Each
// style reuses one Intl formatter and caches its labels: building a formatter
// is far slower than using one, and charts format hundreds of dates per render.

function dateFormatter(opts: Intl.DateTimeFormatOptions) {
  const f = new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" });
  const cache = new Map<string, string>();
  return (d: string) => {
    let label = cache.get(d);
    if (label === undefined) {
      label = f.format(new Date(`${d}T12:00:00Z`));
      cache.set(d, label);
    }
    return label;
  };
}

/** "Oct 13" */
export const fmtMonthDay = dateFormatter({ month: "short", day: "numeric" });
/** "Oct 2026" */
export const fmtMonthYear = dateFormatter({ month: "short", year: "numeric" });
/** "Oct '26" */
export const fmtMonthShortYear = dateFormatter({ month: "short", year: "2-digit" });
/** "Oct 13, 2026" */
export const fmtDate = dateFormatter({ month: "short", day: "numeric", year: "numeric" });
/** "Tue, Oct 13" */
export const fmtWeekday = dateFormatter({ weekday: "short", month: "short", day: "numeric" });
/** "October 2026" */
export const fmtLongMonthYear = dateFormatter({ month: "long", year: "numeric" });

/** The New York (market) calendar date of a moment, as YYYY-MM-DD. */
export function nyDate(t: Date): string {
  return t.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}
