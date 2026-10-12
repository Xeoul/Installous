import { describe, expect, it } from "vitest";
import { money } from "@/lib/format";

describe("money", () => {
  it("formats dollars", () => {
    expect(money(1234.5)).toBe("$1,234.50");
    expect(money(null)).toBe("—");
  });

  it("converts minor-unit quotes to their main currency", () => {
    // London prices come in pence: 7,050p is £70.50, not £7,050.
    expect(money(7050, "GBp")).toBe("£70.50");
    expect(money(1000, "ZAc").replace(/\s/g, " ")).toBe("ZAR 10.00"); // Intl uses a non-breaking space
  });

  it("doesn't throw on a code Intl doesn't know", () => {
    expect(money(5, "NOT-A-CODE")).toBe("5 NOT-A-CODE");
  });
});
