import { chargebackOutcome } from "./dashboard";

/**
 * Status the team can choose for a chargeback, with the color shown next to it.
 * "Revertido" and "Negado"/"Cancelado" must stay in DASHBOARD_RULES so they count as won and lost.
 */
export const CHARGEBACK_STATUSES = [
  { label: "Em conferência", tone: "blue" },
  { label: "Documentação enviada", tone: "blue" },
  { label: "Aguardando banco", tone: "yellow" },
  { label: "Em disputa", tone: "yellow" },
  { label: "Revertido", tone: "green" },
  { label: "Negado", tone: "red" },
  { label: "Cancelado", tone: "red" },
] as const;

export type ChargebackStatus = (typeof CHARGEBACK_STATUSES)[number]["label"];
export const CHARGEBACK_STATUS_LABELS = CHARGEBACK_STATUSES.map((status) => status.label) as [ChargebackStatus, ...ChargebackStatus[]];

export function chargebackTone(status: string): string {
  return CHARGEBACK_STATUSES.find((option) => option.label === status)?.tone ?? "blue";
}

/** 1234.5 → "R$ 1.234,50", the format the amount column has always used. */
export function formatBrl(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/ /g, " ");
}

/** What the team types: "1.234,56", "1234,56", "R$ 1.234,56" or "1234.56". NaN when it is not a number. */
export function parseBrlInput(value: string): number {
  const cleaned = value.trim().replace(/[^\d.,]/g, "");
  if (!cleaned) return NaN;
  return Number(cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned);
}

/** "2026-10-15" → "15/10/2026", the deadline format the dashboard reads. */
export const isoToBrDate = (iso: string) => iso.split("-").reverse().join("/");

/** "15/10/2026" → "2026-10-15" for a date input; anything else (like "03 out 2026") → "". */
export function brToIsoDate(value: string | null | undefined): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value ?? "").trim());
  return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
}

export const CHARGEBACK_PERIODS = [
  { id: "todos", label: "Todo o período" },
  { id: "mes", label: "Este mês" },
  { id: "mes-passado", label: "Mês passado" },
  { id: "3-meses", label: "Últimos 3 meses" },
  { id: "ano", label: "Este ano" },
  { id: "personalizado", label: "Personalizado" },
] as const;

export type ChargebackPeriod = (typeof CHARGEBACK_PERIODS)[number]["id"];
export type DateRange = { from: string | null; to: string | null };

/** A moment → its date in Brazil, as AAAA-MM-DD. */
export const saoPauloDate = (date: Date) => date.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

/** The date a chargeback belongs to: its contestation or, when the spreadsheet has none, the day it was registered. */
export function chargebackDate(row: { data_contestacao?: unknown; created_at?: unknown }): string {
  if (typeof row.data_contestacao === "string" && row.data_contestacao) return row.data_contestacao.slice(0, 10);
  const created = typeof row.created_at === "string" ? new Date(row.created_at) : null;
  return created && !Number.isNaN(created.getTime()) ? saoPauloDate(created) : "";
}

/** The first and last day of a period, given today (AAAA-MM-DD). Dates typed the wrong way round are swapped. */
export function periodRange(period: ChargebackPeriod, today: string, custom: DateRange = { from: null, to: null }): DateRange {
  const [year, month] = today.split("-").map(Number);
  const day = (y: number, monthIndex: number, d: number) => new Date(Date.UTC(y, monthIndex, d)).toISOString().slice(0, 10);
  switch (period) {
    case "todos": return { from: null, to: null };
    case "mes": return { from: day(year, month - 1, 1), to: day(year, month, 0) };
    case "mes-passado": return { from: day(year, month - 2, 1), to: day(year, month - 1, 0) };
    case "3-meses": return { from: day(year, month - 3, 1), to: day(year, month, 0) };
    case "ano": return { from: `${year}-01-01`, to: `${year}-12-31` };
    case "personalizado": {
      const from = custom.from || null;
      const to = custom.to || null;
      return from && to && from > to ? { from: to, to: from } : { from, to };
    }
  }
}

/** With no limits everything fits; with a limit, a chargeback with no date stays out. */
export function inDateRange(date: string, { from, to }: DateRange): boolean {
  if (!from && !to) return true;
  return !!date && (!from || date >= from) && (!to || date <= to);
}

/** The summary cards' numbers for a set of chargebacks, by the same rules as the dashboard. */
export function summarizeChargebacks(items: { status: string; amount: string }[]) {
  let recuperado = 0;
  let revertidos = 0;
  let negados = 0;
  for (const item of items) {
    const outcome = chargebackOutcome(item.status);
    if (outcome === "won") {
      revertidos++;
      const amount = parseBrlInput(item.amount);
      if (Number.isFinite(amount)) recuperado += amount;
    } else if (outcome === "lost") negados++;
  }
  const encerrados = revertidos + negados;
  return { recuperado, revertidos, encerrados, abertos: items.length - encerrados, taxaSucesso: encerrados ? revertidos / encerrados : null };
}

/** What the Sales HUB passes on when a sale is marked with chargeback. */
export type ChargebackDraft = { client: string; amount?: number; vendaId?: number; note?: string };

export type ChargebackHistoryEntry = { at: string; autor: string; acao: string };
