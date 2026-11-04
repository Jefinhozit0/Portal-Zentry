import { describe, expect, it } from "vitest";
import { chargebackDate, inDateRange, periodRange, summarizeChargebacks } from "@shared/chargebacks";

describe("periodRange", () => {
  it("covers the whole calendar periods", () => {
    expect(periodRange("todos", "2026-11-04")).toEqual({ from: null, to: null });
    expect(periodRange("mes", "2026-11-04")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(periodRange("mes-passado", "2026-11-04")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(periodRange("3-meses", "2026-11-04")).toEqual({ from: "2026-09-01", to: "2026-11-30" });
    expect(periodRange("ano", "2026-11-04")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  it("crosses the turn of the year", () => {
    expect(periodRange("mes-passado", "2027-01-15")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(periodRange("3-meses", "2027-01-15")).toEqual({ from: "2026-11-01", to: "2027-01-31" });
    expect(periodRange("mes", "2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("takes custom dates, blank ends and dates the wrong way round", () => {
    expect(periodRange("personalizado", "2026-11-04", { from: "2026-08-10", to: "" })).toEqual({ from: "2026-08-10", to: null });
    expect(periodRange("personalizado", "2026-11-04", { from: "", to: "" })).toEqual({ from: null, to: null });
    expect(periodRange("personalizado", "2026-11-04", { from: "2026-09-30", to: "2026-09-01" })).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });
});

describe("chargebackDate", () => {
  it("prefers the contestation date", () => {
    expect(chargebackDate({ data_contestacao: "2026-10-15", created_at: "2026-11-01T12:00:00Z" })).toBe("2026-10-15");
  });

  it("falls back to the registration day in Brazil", () => {
    // 01:30 UTC on Nov 1st is still Oct 31st in São Paulo.
    expect(chargebackDate({ data_contestacao: null, created_at: "2026-11-01T01:30:00Z" })).toBe("2026-10-31");
    expect(chargebackDate({})).toBe("");
  });
});

describe("inDateRange", () => {
  const october = { from: "2026-10-01", to: "2026-10-31" };

  it("includes both ends of the range", () => {
    expect(inDateRange("2026-10-01", october)).toBe(true);
    expect(inDateRange("2026-10-31", october)).toBe(true);
    expect(inDateRange("2026-09-30", october)).toBe(false);
    expect(inDateRange("2026-11-01", october)).toBe(false);
  });

  it("leaves undated chargebacks out only when there is a limit", () => {
    expect(inDateRange("", october)).toBe(false);
    expect(inDateRange("", { from: null, to: null })).toBe(true);
  });
});

describe("summarizeChargebacks", () => {
  it("counts by the dashboard's rules, ignoring case and accents", () => {
    const summary = summarizeChargebacks([
      { status: "Revertido", amount: "R$ 1.000,50" },
      { status: "concluído", amount: "R$ 500,00" },
      { status: "Negado", amount: "R$ 9.999,00" },
      { status: "Em disputa", amount: "R$ 200,00" },
      { status: "Revertido", amount: "" },
    ]);
    expect(summary).toEqual({ recuperado: 1500.5, revertidos: 3, encerrados: 4, abertos: 1, taxaSucesso: 0.75 });
  });

  it("has no success rate with nothing closed", () => {
    expect(summarizeChargebacks([{ status: "Em disputa", amount: "R$ 200,00" }]).taxaSucesso).toBeNull();
  });
});
