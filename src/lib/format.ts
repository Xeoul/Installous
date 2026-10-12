// Yahoo quotes some markets in minor units (London in pence as "GBp", Johannesburg
// in cents as "ZAc", Tel Aviv in agorot as "ILA"). Intl reads "GBp" as pounds,
// which would show prices 100x too high, so convert to the main unit first.
const MINOR_UNITS: Record<string, string> = { GBp: "GBP", GBX: "GBP", ZAc: "ZAR", ILA: "ILS" };

export function money(x: number | null | undefined, currency = "USD"): string {
  if (x === null || x === undefined) return "—";
  const major = MINOR_UNITS[currency];
  const [value, code] = major ? [x / 100, major] : [x, currency];
  try {
    return value.toLocaleString("en-US", { style: "currency", currency: code, maximumFractionDigits: 2 });
  } catch {
    // Not a currency code Intl knows; show the number with the code instead of crashing.
    return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${code}`;
  }
}

export function compact(x: number | null | undefined): string {
  if (x === null || x === undefined) return "—";
  return x.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 });
}

/** Format a value that's already in percent units (e.g. 1.5 => "+1.50%"). */
export function signedPct(x: number | null | undefined, digits = 2): string {
  if (x === null || x === undefined) return "—";
  return `${x > 0 ? "+" : ""}${x.toFixed(digits)}%`;
}

/** Format a ratio (e.g. 0.153 => "15.3%"). */
export function ratioPct(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined) return "—";
  return `${(x * 100).toFixed(digits)}%`;
}

export function fixed(x: number | null | undefined, digits = 2): string {
  if (x === null || x === undefined) return "—";
  return x.toFixed(digits);
}
