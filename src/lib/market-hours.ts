// US stock market hours on the New York clock: open 9:30am–4:00pm on
// weekdays, closed on exchange holidays, and closing at 1:00pm on a few
// half days. Holidays are listed through 2027 (like news-days.ts).

const HOLIDAYS = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);
const HALF_DAYS = new Set(["2026-11-27", "2026-12-24", "2027-11-26"]);

const OPEN = 9 * 60 + 30;
const CLOSE = 16 * 60;
const HALF_CLOSE = 13 * 60;

export interface MarketStatus {
  open: boolean;
  /** When the market next opens (if closed) or closes (if open). */
  next: Date;
}

/** New York calendar date and minutes past midnight for a moment. */
function nyParts(d: Date): { date: string; minutes: number; weekday: number } {
  const date = d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const [h, m] = d.toLocaleTimeString("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).split(":");
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return { date, minutes: Number(h) * 60 + Number(m), weekday };
}

const isTradingDay = (date: string) => {
  const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
  return wd !== 0 && wd !== 6 && !HOLIDAYS.has(date);
};

/** The moment it's `minutes` past midnight in New York on `date`. */
function nyMoment(date: string, minutes: number): Date {
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  for (const off of ["-04:00", "-05:00"]) {
    const d = new Date(`${date}T${hh}:${mm}:00${off}`);
    if (nyParts(d).minutes === minutes && nyParts(d).date === date) return d;
  }
  return new Date(`${date}T${hh}:${mm}:00-05:00`);
}

const nextDate = (date: string) => new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** Whether the market is open at `now`, and when that changes. */
export function marketStatus(now: Date): MarketStatus {
  const { date, minutes } = nyParts(now);
  if (isTradingDay(date)) {
    const close = HALF_DAYS.has(date) ? HALF_CLOSE : CLOSE;
    if (minutes >= OPEN && minutes < close) return { open: true, next: nyMoment(date, close) };
    if (minutes < OPEN) return { open: false, next: nyMoment(date, OPEN) };
  }
  let d = nextDate(date);
  while (!isTradingDay(d)) d = nextDate(d);
  return { open: false, next: nyMoment(d, OPEN) };
}

/**
 * Whether SPX index options are trading at `now`: market days from the open
 * to 15 minutes after the close (4:15pm, or 1:15pm on half days).
 */
export function optionsSessionOpen(now: Date): boolean {
  const { date, minutes } = nyParts(now);
  if (!isTradingDay(date)) return false;
  const close = HALF_DAYS.has(date) ? HALF_CLOSE : CLOSE;
  return minutes >= OPEN && minutes < close + 15;
}

/** "2h 14m", "45m", "under a minute". */
export function untilLabel(ms: number): string {
  const mins = Math.ceil(ms / 60_000);
  if (mins <= 1) return "1m";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

/** The calendar date of a moment in a time zone. */
const zoneDate = (d: Date, timeZone: string) => d.toLocaleDateString("en-CA", { timeZone });

/**
 * When the market opens next, in words, on the clock of `timeZone` (Pacific by
 * default): "6:30 AM", "tomorrow 6:30 AM" or "Mon 6:30 AM".
 */
export function opensLabel(next: Date, now: Date, timeZone = "America/Los_Angeles"): string {
  const time = next.toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" });
  const date = zoneDate(now, timeZone);
  const target = zoneDate(next, timeZone);
  if (target === date) return time;
  if (target === nextDate(date)) return `tomorrow ${time}`;
  return `${next.toLocaleDateString("en-US", { timeZone, weekday: "short" })} ${time}`;
}
