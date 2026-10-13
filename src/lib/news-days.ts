// Market-moving US releases the condor bot won't hold a position through.
// Dates in New York time, YYYY-MM-DD.
//
// Sources (checked 2026-10-13):
//   FOMC decisions (2pm ET, second day of each meeting):
//     https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
//     (2027 dates are tentative until confirmed at the meeting before.)
//   CPI (8:30am ET): https://www.bls.gov/schedule/news_release/cpi.htm
//   Jobs report / Employment Situation (8:30am ET):
//     https://www.bls.gov/schedule/news_release/empSit.htm
//
// Add the next year's dates when the Fed and BLS publish them (usually in the
// fall); the bot shows a note when the calendar has run out.

export type NewsKind = "FOMC" | "CPI" | "Jobs report";

const FOMC = [
  "2026-10-28", "2026-12-09",
  "2027-01-27", "2027-03-17", "2027-04-28", "2027-06-09", "2027-07-28", "2027-09-15", "2027-10-27", "2027-12-08",
];
const CPI = [
  "2026-11-10", "2026-12-10",
  "2027-01-13", "2027-02-11", "2027-03-10", "2027-04-13", "2027-05-12", "2027-06-10", "2027-07-14", "2027-08-11",
  "2027-09-14", "2027-10-14", "2027-11-10", "2027-12-10",
];
const JOBS = [
  "2026-11-06", "2026-12-04",
  "2027-01-08", "2027-02-05", "2027-03-05", "2027-04-02", "2027-05-07", "2027-06-04", "2027-07-02", "2027-08-06",
  "2027-09-03", "2027-10-08", "2027-11-05", "2027-12-03",
];

const BY_DATE = new Map<string, NewsKind[]>();
for (const [kind, dates] of [["FOMC", FOMC], ["CPI", CPI], ["Jobs report", JOBS]] as const) {
  for (const d of dates) BY_DATE.set(d, [...(BY_DATE.get(d) ?? []), kind]);
}

/** The last date the calendar covers. */
export const NEWS_CALENDAR_ENDS = [...BY_DATE.keys()].sort().at(-1)!;

/** Releases scheduled on a date (empty when none). */
export function newsOn(date: string): NewsKind[] {
  return BY_DATE.get(date) ?? [];
}

/** The next few scheduled releases on or after a date. */
export function upcomingNews(from: string, count = 3): { date: string; kinds: NewsKind[] }[] {
  return [...BY_DATE.entries()]
    .filter(([d]) => d >= from)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, count)
    .map(([date, kinds]) => ({ date, kinds }));
}
