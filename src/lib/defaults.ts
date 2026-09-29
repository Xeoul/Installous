import type { InvestorProfile } from "./store";

export const DEFAULT_WATCHLIST = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN"];

export const DEFAULT_PROFILE: InvestorProfile = {
  risk: "moderate",
  horizon: "5+ years",
  goals: "Long-term growth with a diversified portfolio.",
};
