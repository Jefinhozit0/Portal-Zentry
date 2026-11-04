import { describe, expect, it } from "vitest";
import { chargebacksInRow, mergeRepeated, monthOfTab, planSync, sheetDate, statusFromReversal, type PortalChargeback, type SheetChargeback } from "./chargebacksPlanilha";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const noGreen = () => false;
const row = (...cells: unknown[]) => [undefined, ...cells];

const sheet = (fields: Partial<SheetChargeback>): SheetChargeback => ({
  aba: "Outubro 26", mes: "2026-10", client: "ANA SOUZA", data_venda: "2026-09-10", data_contestacao: "2026-10-05", valor: 1000,
  comercial: null, juridico: null, reversao: null, observacoes: null, ...fields,
});
const portal = (id: number, fields: Partial<PortalChargeback>, aba = "Outubro 26"): PortalChargeback => ({
  id, client: "ANA SOUZA", cliente_id: null, valor: 1000, data_venda: "2026-09-10", data_contestacao: "2026-10-05",
  comercial: null, juridico: null, reversao: null, observacoes: null, status: "Em disputa",
  historico: [{ at: "2026-10-14T00:00:00Z", autor: "sistema", acao: `Importado da planilha de chargebacks (${aba})` }], ...fields,
});

describe("chargebacks spreadsheet", () => {
  it("reads the month of each tab", () => {
    expect(monthOfTab("Outubro 26")).toBe("2026-10");
    expect(monthOfTab("setembro 26")).toBe("2026-09");
    expect(monthOfTab("Março 2026")).toBe("2026-03");
    expect(monthOfTab("cancelados outubro")).toBeNull();
  });

  it("reads dates and leaves typos out", () => {
    expect(sheetDate(d("2026-10-01"))).toBe("2026-10-01");
    expect(sheetDate("5/10/2026")).toBe("2026-10-05");
    expect(sheetDate("")).toBeNull();
    expect(sheetDate("26/101026")).toBeUndefined();
    expect(sheetDate("30/04/0206")).toBeUndefined();
  });

  it("finds the main table and the reversed list on the same row, but not the totals", () => {
    const cells = row(
      d("2026-09-16"), d("2026-10-01"), "ELAINE ", 2160, null, "JOÃO", null, "CLIENTE FOI COBRADA",
      null, null, null, d("2026-08-31"), d("2026-10-05"), "PAULO", 13000, null, "RAFAEL/TIAGO", "REVERTIDO DIA (05/10/2026)",
    );
    const found = chargebacksInRow(cells, noGreen, "Outubro 26", "2026-10");
    expect(found.map((c) => [c.client, c.valor, c.reversao, c.observacoes])).toEqual([
      ["ELAINE", 2160, null, "CLIENTE FOI COBRADA"],
      ["PAULO", 13000, "REVERTIDO DIA (05/10/2026)", null],
    ]);
    expect(chargebacksInRow(row(null, null, null, null, null, null, null, null, null, null, "TOTAL", 41266.66), noGreen, "Outubro 26", "2026-10")).toEqual([]);
    expect(chargebacksInRow(row(null, "Data Da Contestação", "Nome Do Cliente", "Valor Contestado"), noGreen, "Outubro 26", "2026-10")).toEqual([]);
  });

  it("uses the notes of column H for a row that only has the reversed list, and green means reversed", () => {
    const cells = row(null, null, null, null, null, null, null, "FALTA DE RETORNO", null, null, null, d("2026-08-21"), d("2026-10-08"), "BEATRIZ", 1245, "SARA");
    const [found] = chargebacksInRow(cells, (column) => column === 14, "Outubro 26", "2026-10");
    expect(found).toMatchObject({ client: "BEATRIZ", observacoes: "FALTA DE RETORNO", reversao: "REVERTIDO (linha verde na planilha)" });
  });

  it("keeps a main table row without dates and reads money typed as text", () => {
    const [found] = chargebacksInRow(row(null, null, "DANIELA", "R$ 4.150,00", null, "RAFAEL"), noGreen, "setembro 26", "2026-09");
    expect(found).toMatchObject({ client: "DANIELA", valor: 4150, data_venda: null, data_contestacao: null });
  });

  it("treats a contestation far from the tab's month as a typo", () => {
    const [typo] = chargebacksInRow(row(d("2026-04-06"), d("2026-04-17"), "ULISSES", 5593), noGreen, "Julho 26", "2026-07");
    expect(typo.data_contestacao).toBeUndefined();
    const [late] = chargebacksInRow(row(d("2026-09-11"), d("2026-09-22"), "PIETRA", 2900), noGreen, "Outubro 26", "2026-10");
    expect(late.data_contestacao).toBe("2026-09-22");
  });

  it("joins the same chargeback written in two tabs, keeping the first tab and the latest values", () => {
    const merged = mergeRepeated([
      sheet({ aba: "Agosto 26", juridico: "Rafael/Hugo" }),
      sheet({ aba: "setembro 26", juridico: "RAFAEL", reversao: "REVERTIDA" }),
    ]);
    expect(merged).toEqual([sheet({ aba: "Agosto 26", juridico: "RAFAEL", reversao: "REVERTIDA" })]);
  });

  it("maps the reversal column to a status only when it says so", () => {
    expect(statusFromReversal("REVERTIDO DIA (05/10/2026)")).toBe("Revertido");
    expect(statusFromReversal("RESTITUIDO PELA N1")).toBe("Cancelado");
    expect(statusFromReversal("charge dividido por 3 pessoas")).toBeNull();
    expect(statusFromReversal(null)).toBeNull();
  });

  it("inserts new rows, updates changed ones and removes rows deleted from a tab that was read", () => {
    const plan = planSync(
      [sheet({ comercial: "BIA" }), sheet({ client: "NOVO CLIENTE", valor: 500 })],
      [portal(1, {}), portal(2, { client: "APAGADO", valor: 700 }), portal(3, { client: "OUTRO MÊS", valor: 900 }, "Julho 26")],
      ["Outubro 26"],
    );
    expect(plan.insert.map((c) => c.client)).toEqual(["NOVO CLIENTE"]);
    expect(plan.update.map((u) => [u.current.id, u.changed])).toEqual([[1, ["Comercial: vazio → BIA"]]]);
    expect(plan.remove.map((c) => c.id)).toEqual([2]);
  });

  it("matches a fixed spelling or a reversed chargeback entered with value 0 instead of duplicating", () => {
    const plan = planSync(
      [sheet({ client: "MARTA PEIXOTO", valor: 3250 }), sheet({ client: "PAULO TEIXEIRA", valor: 21114, data_venda: undefined })],
      [portal(5, { client: "MARTE PEIXOTO", valor: 3250 }, "charge outubro"), portal(6, { client: "PAULO TEIXEIRA", valor: 0, data_venda: "2026-09-10" }, "charge outubro")],
      ["Outubro 26"],
    );
    expect(plan.insert).toEqual([]);
    expect(plan.update.map((u) => u.current.id).sort()).toEqual([5, 6]);
    expect(plan.remove).toEqual([]);
  });

  it("keeps the portal's date when the spreadsheet has a typo there", () => {
    const plan = planSync([sheet({ data_contestacao: undefined })], [portal(1, {})], ["Outubro 26"]);
    expect(plan.update).toEqual([]);
    expect(plan.insert).toEqual([]);
  });
});
