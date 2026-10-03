import type { Fundamentals } from "./market";

export type FactorKey = "value" | "quality" | "growth" | "momentum" | "sentiment";

export interface FactorScore {
  key: FactorKey;
  label: string;
  score: number | null; // 0-100, null when there isn't enough data
  notes: string[];
}

export interface StockScore {
  ticker: string;
  overall: number | null;
  rating: Rating;
  factors: FactorScore[];
}

export type Rating = "Strong Buy" | "Buy" | "Hold" | "Weak" | "Avoid" | "N/A";

export const FACTOR_WEIGHTS: Record<FactorKey, number> = {
  value: 0.2,
  quality: 0.25,
  growth: 0.2,
  momentum: 0.2,
  sentiment: 0.15,
};

const FACTOR_LABELS: Record<FactorKey, string> = {
  value: "Value",
  quality: "Quality",
  growth: "Growth",
  momentum: "Momentum",
  sentiment: "Analyst Sentiment",
};

/** Linearly map x from [bad, good] onto [0, 100], clamped. Works when bad > good too. */
function scale(x: number, bad: number, good: number): number {
  const t = (x - bad) / (good - bad);
  return Math.round(Math.max(0, Math.min(1, t)) * 100);
}

function average(parts: (number | null)[]): number | null {
  const present = parts.filter((p): p is number => p !== null);
  if (present.length === 0) return null;
  return Math.round(present.reduce((a, b) => a + b, 0) / present.length);
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function valueScore(f: Fundamentals): FactorScore {
  const notes: string[] = [];
  const parts: (number | null)[] = [];
  const pe = f.forwardPE ?? f.trailingPE;
  if (pe !== null) {
    // Negative P/E means losses: score it as poor value.
    parts.push(pe <= 0 ? 0 : scale(pe, 45, 10));
    notes.push(`${f.forwardPE !== null ? "Forward" : "Trailing"} P/E ${pe.toFixed(1)}`);
  }
  if (f.pegRatio !== null && f.pegRatio > 0) {
    parts.push(scale(f.pegRatio, 3, 0.8));
    notes.push(`PEG ${f.pegRatio.toFixed(2)}`);
  }
  if (f.enterpriseToEbitda !== null && f.enterpriseToEbitda > 0) {
    parts.push(scale(f.enterpriseToEbitda, 30, 6));
    notes.push(`EV/EBITDA ${f.enterpriseToEbitda.toFixed(1)}`);
  }
  if (f.priceToSales !== null && f.priceToSales > 0) {
    parts.push(scale(f.priceToSales, 15, 1));
    notes.push(`P/S ${f.priceToSales.toFixed(1)}`);
  }
  return { key: "value", label: FACTOR_LABELS.value, score: average(parts), notes };
}

function qualityScore(f: Fundamentals): FactorScore {
  const notes: string[] = [];
  const parts: (number | null)[] = [];
  if (f.returnOnEquity !== null) {
    parts.push(scale(f.returnOnEquity, 0, 0.3));
    notes.push(`ROE ${pct(f.returnOnEquity)}`);
  }
  if (f.operatingMargins !== null) {
    parts.push(scale(f.operatingMargins, 0, 0.3));
    notes.push(`Operating margin ${pct(f.operatingMargins)}`);
  }
  if (f.profitMargins !== null) {
    parts.push(scale(f.profitMargins, -0.05, 0.25));
    notes.push(`Net margin ${pct(f.profitMargins)}`);
  }
  if (f.debtToEquity !== null) {
    // Yahoo reports D/E as a percentage (e.g. 150 = 1.5x).
    parts.push(scale(f.debtToEquity, 250, 20));
    notes.push(`Debt/Equity ${(f.debtToEquity / 100).toFixed(2)}x`);
  }
  if (f.freeCashflow !== null) {
    parts.push(f.freeCashflow > 0 ? 80 : 15);
    notes.push(f.freeCashflow > 0 ? "Positive free cash flow" : "Negative free cash flow");
  }
  return { key: "quality", label: FACTOR_LABELS.quality, score: average(parts), notes };
}

function growthScore(f: Fundamentals): FactorScore {
  const notes: string[] = [];
  const parts: (number | null)[] = [];
  if (f.revenueGrowth !== null) {
    parts.push(scale(f.revenueGrowth, -0.05, 0.3));
    notes.push(`Revenue growth ${pct(f.revenueGrowth)} YoY`);
  }
  if (f.earningsGrowth !== null) {
    parts.push(scale(f.earningsGrowth, -0.1, 0.4));
    notes.push(`Earnings growth ${pct(f.earningsGrowth)} YoY`);
  }
  if (f.trailingPE !== null && f.forwardPE !== null && f.trailingPE > 0 && f.forwardPE > 0) {
    // Forward P/E below trailing implies analysts expect earnings to rise.
    const implied = f.trailingPE / f.forwardPE - 1;
    parts.push(scale(implied, -0.1, 0.3));
    notes.push(`Implied forward EPS growth ${pct(implied)}`);
  }
  return { key: "growth", label: FACTOR_LABELS.growth, score: average(parts), notes };
}

export type MomentumInputs = Pick<
  Fundamentals,
  "price" | "fiftyDayAverage" | "twoHundredDayAverage" | "fiftyTwoWeekChangePercent" | "fiftyTwoWeekHigh" | "fiftyTwoWeekLow"
>;

/** The price-only factor; exported so the backtest can rebuild it from historical prices. */
export function momentumScore(f: MomentumInputs): FactorScore {
  const notes: string[] = [];
  const parts: (number | null)[] = [];
  const p = f.price;
  if (p !== null && f.fiftyDayAverage) {
    const d = p / f.fiftyDayAverage - 1;
    parts.push(scale(d, -0.1, 0.1));
    notes.push(`${pct(d)} vs 50-day average`);
  }
  if (p !== null && f.twoHundredDayAverage) {
    const d = p / f.twoHundredDayAverage - 1;
    parts.push(scale(d, -0.15, 0.2));
    notes.push(`${pct(d)} vs 200-day average`);
  }
  if (f.fiftyTwoWeekChangePercent !== null) {
    // Yahoo returns this one already in percent units.
    const d = f.fiftyTwoWeekChangePercent / 100;
    parts.push(scale(d, -0.2, 0.4));
    notes.push(`52-week return ${pct(d)}`);
  }
  if (p !== null && f.fiftyTwoWeekHigh && f.fiftyTwoWeekLow && f.fiftyTwoWeekHigh > f.fiftyTwoWeekLow) {
    const pos = (p - f.fiftyTwoWeekLow) / (f.fiftyTwoWeekHigh - f.fiftyTwoWeekLow);
    parts.push(scale(pos, 0, 1));
    notes.push(`At ${Math.round(pos * 100)}% of 52-week range`);
  }
  return { key: "momentum", label: FACTOR_LABELS.momentum, score: average(parts), notes };
}

function sentimentScore(f: Fundamentals): FactorScore {
  const notes: string[] = [];
  const parts: (number | null)[] = [];
  if (f.analystRatingMean !== null && (f.analystCount ?? 0) > 0) {
    // 1 = strong buy, 5 = strong sell
    parts.push(scale(f.analystRatingMean, 3.5, 1.5));
    notes.push(`Consensus ${f.analystRating?.replaceAll("_", " ") ?? ""} (${f.analystRatingMean.toFixed(2)}, ${f.analystCount} analysts)`);
  }
  if (f.targetMeanPrice !== null && f.price) {
    const upside = f.targetMeanPrice / f.price - 1;
    parts.push(scale(upside, -0.1, 0.3));
    notes.push(`Mean target ${f.targetMeanPrice.toFixed(2)} (${upside >= 0 ? "+" : ""}${pct(upside)})`);
  }
  return { key: "sentiment", label: FACTOR_LABELS.sentiment, score: average(parts), notes };
}

export function ratingFor(score: number | null): Rating {
  if (score === null) return "N/A";
  if (score >= 72) return "Strong Buy";
  if (score >= 60) return "Buy";
  if (score >= 45) return "Hold";
  if (score >= 33) return "Weak";
  return "Avoid";
}

export function scoreStock(f: Fundamentals): StockScore {
  const factors = [valueScore(f), qualityScore(f), growthScore(f), momentumScore(f), sentimentScore(f)];
  let weighted = 0;
  let totalWeight = 0;
  for (const factor of factors) {
    if (factor.score === null) continue;
    weighted += factor.score * FACTOR_WEIGHTS[factor.key];
    totalWeight += FACTOR_WEIGHTS[factor.key];
  }
  // Require at least roughly half the model to have data before giving an overall score.
  const overall = totalWeight >= 0.45 ? Math.round(weighted / totalWeight) : null;
  return { ticker: f.ticker, overall, rating: ratingFor(overall), factors };
}
