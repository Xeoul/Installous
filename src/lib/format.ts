export function money(x: number | null | undefined, currency = "USD"): string {
  if (x === null || x === undefined) return "—";
  return x.toLocaleString("en-US", { style: "currency", currency, maximumFractionDigits: 2 });
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
