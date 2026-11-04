import { readFile, stat } from "node:fs/promises";
import ExcelJS from "exceljs";
import { chargebackTone, formatBrl, parseBrlInput, type ChargebackHistoryEntry, type ChargebackStatus } from "@shared/chargebacks";
import { supabase } from "./supabase";
import { registrarAcao } from "./auditoria";

/**
 * Keeps the chargebacks in step with the team's spreadsheet ("CHARGE BACK", one tab per month, e.g. "Outubro 26").
 * The .xlsx lives in Google Drive; Google Drive for desktop keeps a copy on this notebook (CHARGEBACKS_PLANILHA).
 *
 * The spreadsheet rules over its own columns (dates, client, value, consultants, reversal, notes):
 * - a row that is new in the spreadsheet becomes a chargeback ("Em disputa", or "Revertido" when the reversal says so);
 * - when those columns change, the chargeback is updated and the change goes to its history;
 * - a row removed from a tab removes the chargeback that came from that tab.
 * What exists only in the portal (status chosen by the team, history, link to the client) is kept.
 *
 * Each tab has the main table (A..H) and, to its right, a list of reversed chargebacks with the same columns,
 * so every row is scanned for "sale date, contestation date, client, value, commercial, legal, reversal, notes".
 */

export type SheetChargeback = {
  aba: string;
  /** The tab's month as AAAA-MM, used when the contestation date is blank. */
  mes: string;
  client: string;
  /** undefined: the cell has something that is not a date (a typo), so the portal keeps what it has. */
  data_venda: string | null | undefined;
  data_contestacao: string | null | undefined;
  valor: number;
  comercial: string | null;
  juridico: string | null;
  reversao: string | null;
  observacoes: string | null;
};

const MONTHS = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const GREEN = "FF00FF00";

export const plain = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const tidy = (value: string) => value.replace(/\s+/g, " ").trim();

/** "Outubro 26" → "2026-10"; anything else (e.g. "cancelados outubro") → null. */
export function monthOfTab(name: string): string | null {
  const match = /^([a-z]+)\s+(\d{2}|\d{4})$/.exec(plain(name));
  const month = match ? MONTHS.indexOf(match[1]) : -1;
  if (!match || month < 0) return null;
  const year = match[2].length === 2 ? `20${match[2]}` : match[2];
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function cellValue(value: ExcelJS.CellValue): unknown {
  if (value && typeof value === "object" && !(value instanceof Date)) {
    if ("result" in value) return value.result;
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
    if ("text" in value) return value.text;
    return null;
  }
  return value;
}

function text(value: unknown): string | null {
  if (value === null || value === undefined || value instanceof Date || typeof value === "number") return null;
  const result = tidy(String(value));
  return result || null;
}

/** A Date cell or "15/10/2026" → "2026-10-15". Blank → null. Something else ("26/101026") → undefined. */
export function sheetDate(value: unknown): string | null | undefined {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const valid = (iso: string) => (/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(iso) ? iso : undefined);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : valid(value.toISOString().slice(0, 10));
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(value).trim());
  return match ? valid(`${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`) : undefined;
}

export function sheetMoney(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  if (typeof value !== "string" || !/\d/.test(value)) return null;
  const number = parseBrlInput(value);
  return Number.isFinite(number) ? number : null;
}

const monthsBetween = (from: string, to: string) =>
  (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7));

/**
 * The contestation date, read against the tab's month: a date from the month before is a late entry and is kept;
 * one further away ("17/04" in July) is a typo and counts as unreadable (undefined).
 */
function contestation(value: unknown, mes: string) {
  const iso = sheetDate(value);
  if (!iso) return iso;
  const distance = monthsBetween(iso.slice(0, 7), mes);
  return distance === 0 || distance === 1 ? iso : undefined;
}

/** The chargebacks in a row of cells (index 1 = column A), as found by the column pattern above. */
export function chargebacksInRow(cells: unknown[], greenAt: (column: number) => boolean, aba: string, mes: string): SheetChargeback[] {
  const found: { column: number; item: SheetChargeback }[] = [];
  for (let c = 1; c + 3 < cells.length; c++) {
    const client = text(cells[c + 2]);
    const valor = sheetMoney(cells[c + 3]);
    // The main table (column A) may have rows without dates; elsewhere the dates tell a chargeback from a total.
    const hasDate = c === 1 || sheetDate(cells[c]) || sheetDate(cells[c + 1]) || /\d/.test(String(cells[c + 1] ?? ""));
    if (!client || valor === null || !hasDate || sheetMoney(client) !== null) continue;
    const reversal = text(cells[c + 6]) ?? (greenAt(c + 2) ? "REVERTIDO (linha verde na planilha)" : null);
    found.push({
      column: c,
      item: {
        aba, mes, client, valor,
        data_venda: sheetDate(cells[c]),
        data_contestacao: contestation(cells[c + 1], mes),
        comercial: text(cells[c + 4]),
        juridico: text(cells[c + 5]),
        reversao: reversal,
        observacoes: text(cells[c + 7]),
      },
    });
    c += 7;
  }
  // The reversed list has no notes column of its own: a row with only that list uses the main table's notes (H).
  if (found.length === 1 && found[0].column !== 1 && !found[0].item.observacoes) found[0].item.observacoes = text(cells[8]);
  return found.map((entry) => entry.item);
}

/**
 * Every chargeback in the month tabs from `desde` (AAAA-MM) on, and the names of the tabs read.
 * Rows contested before `desde` (last month's leftovers at the bottom of the first tab) belong to tabs not synced.
 */
export async function readSpreadsheet(file: Buffer | ArrayBuffer, desde: string) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file as ArrayBuffer);
  const items: SheetChargeback[] = [];
  const abas: string[] = [];
  const tabs = workbook.worksheets.map((sheet) => ({ sheet, mes: monthOfTab(sheet.name) }))
    .filter((tab): tab is { sheet: ExcelJS.Worksheet; mes: string } => !!tab.mes && tab.mes >= desde)
    .sort((a, b) => a.mes.localeCompare(b.mes));
  for (const { sheet, mes } of tabs) {
    abas.push(sheet.name);
    sheet.eachRow((row) => {
      const cells: unknown[] = [];
      for (let c = 1; c <= Math.max(row.cellCount, 8); c++) cells[c] = cellValue(row.getCell(c).value);
      const greenAt = (c: number) => (row.getCell(c).fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb === GREEN;
      items.push(...chargebacksInRow(cells, greenAt, sheet.name, mes).filter((item) => !item.data_contestacao || item.data_contestacao.slice(0, 7) >= desde));
    });
  }
  return { items: mergeRepeated(items), abas };
}

/**
 * The same chargeback written twice (in the main table and in the reversed list, or again in the next month's tab)
 * is one chargeback: it keeps the first tab and the latest non-empty value of each column.
 */
export function mergeRepeated(items: SheetChargeback[]): SheetChargeback[] {
  const byKey = new Map<string, SheetChargeback>();
  for (const item of items) {
    const key = exactKey(item);
    const first = byKey.get(key);
    if (!first) {
      byKey.set(key, { ...item });
      continue;
    }
    for (const field of ["comercial", "juridico", "reversao", "observacoes"] as const) first[field] = item[field] ?? first[field];
  }
  return Array.from(byKey.values());
}

/**
 * The spreadsheet's REVERSÃO column -> the portal's statuses:
 * "RESTITUIDO PELA N1" (company gave the money back) -> Cancelado; "REVERTIDO", "PAGOU...", "sim" -> Revertido;
 * blank or anything else -> null (the status stays whatever the team chose).
 */
export function statusFromReversal(reversal: string | null): ChargebackStatus | null {
  const value = plain(reversal ?? "");
  if (/restitu/.test(value)) return "Cancelado";
  if (/revert|pagou|pago|^sim$/.test(value)) return "Revertido";
  return null;
}

const br = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "sem data");

/** The note shown on the chargeback, made from the spreadsheet's columns. */
export function observation(c: Pick<SheetChargeback, "comercial" | "juridico" | "reversao" | "observacoes"> & { data_venda: string | null; data_contestacao: string | null }) {
  const lines = [
    `Venda: ${br(c.data_venda)} · Contestação: ${br(c.data_contestacao)}`,
    `Comercial: ${c.comercial ?? "—"} · Jurídico: ${c.juridico ?? "—"}`,
    c.reversao ? `Reversão: ${c.reversao}` : "",
    c.observacoes ?? "",
  ].filter(Boolean);
  const value = lines.join("\n");
  return value.length > 2000 ? `${value.slice(0, 1999)}…` : value; // the edit form accepts up to 2000
}

export type PortalChargeback = {
  id: number;
  client: string;
  cliente_id: number | null;
  valor: number | string | null;
  data_venda: string | null;
  data_contestacao: string | null;
  comercial: string | null;
  juridico: string | null;
  reversao: string | null;
  observacoes: string | null;
  status: string;
  historico: ChargebackHistoryEntry[] | null;
};

const ORIGIN = /planilha de chargebacks \(([^)]+)\)/i;

/** The tab a chargeback came from, read from its history ("Importado da planilha de chargebacks (Outubro 26)"). */
export function originOf(c: Pick<PortalChargeback, "historico">): string | null {
  const entries = Array.isArray(c.historico) ? c.historico : [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const match = ORIGIN.exec(entries[i].acao);
    if (match) return match[1];
  }
  return null;
}

const money = (value: number | string | null) => Number(value ?? 0);
const firstName = (name: string) => plain(name).replace(/[^a-z ]/g, "").trim().split(" ")[0] ?? "";
const exactKey = (c: { client: string; valor: number | string | null; data_venda?: string | null; data_contestacao?: string | null }) =>
  [plain(c.client), money(c.valor).toFixed(2), c.data_venda ?? "", c.data_contestacao ?? ""].join("|");

/** The values the spreadsheet decides, with the portal's kept where the spreadsheet has a typo in a date. */
function sheetFields(item: SheetChargeback, current?: PortalChargeback) {
  return {
    client: item.client,
    valor: item.valor,
    data_venda: item.data_venda === undefined ? current?.data_venda ?? null : item.data_venda,
    data_contestacao: item.data_contestacao === undefined ? current?.data_contestacao ?? null : item.data_contestacao,
    comercial: item.comercial,
    juridico: item.juridico,
    reversao: item.reversao,
    observacoes: item.observacoes,
  };
}

const LABELS: Record<keyof ReturnType<typeof sheetFields>, string> = {
  client: "Cliente", valor: "Valor", data_venda: "Data da venda", data_contestacao: "Data da contestação",
  comercial: "Comercial", juridico: "Jurídico", reversao: "Reversão", observacoes: "Observações",
};

/** "Comercial: Ana → Bia" for the history; the old notes are kept whole there, so an edit never loses them. */
function describe(key: keyof typeof LABELS, before: unknown, after: unknown) {
  const show = (value: unknown) => {
    if (value === null || value === undefined || value === "") return "vazio";
    if (key === "valor") return formatBrl(money(value as number));
    if (key.startsWith("data_")) return br(String(value));
    return String(value);
  };
  if (key === "observacoes") return before ? `Observações (antes: «${before}»)` : "Observações";
  return `${LABELS[key]}: ${show(before)} → ${show(after)}`;
}

export type SyncPlan = {
  insert: SheetChargeback[];
  update: { current: PortalChargeback; item: SheetChargeback; changed: string[] }[];
  /** Linked to the tab without changes: chargebacks that came from somewhere else and were found in the spreadsheet. */
  adopt: { current: PortalChargeback; item: SheetChargeback }[];
  remove: PortalChargeback[];
};

/**
 * Pairs the spreadsheet's rows with the portal's chargebacks: first the exact match (client, value and dates),
 * then the same first name and value (a fixed date or spelling), then the same client and contestation in the
 * same tab (a fixed value). Chargebacks from a tab that was read and have no row left are removed.
 */
export function planSync(items: SheetChargeback[], portal: PortalChargeback[], abas: string[]): SyncPlan {
  const tabs = new Set(abas.map(plain));
  const free = new Set(portal);
  const pairs: { item: SheetChargeback; current: PortalChargeback }[] = [];
  const pending: SheetChargeback[] = [];
  const take = (item: SheetChargeback, test: (c: PortalChargeback) => boolean) => {
    const candidates = Array.from(free).filter(test);
    const match = candidates.find((c) => plain(originOf(c) ?? "") === plain(item.aba)) ?? candidates[0];
    if (!match) return false;
    free.delete(match);
    pairs.push({ item, current: match });
    return true;
  };

  for (const item of items) if (!take(item, (c) => exactKey(c) === exactKey(sheetFields(item, c)))) pending.push(item);
  const rest = pending.filter((item) => !take(item, (c) =>
    firstName(c.client) === firstName(item.client) && Math.abs(money(c.valor) - item.valor) < 1
    && (!item.data_contestacao || !c.data_contestacao || item.data_contestacao === c.data_contestacao || item.data_venda === c.data_venda)));
  const sameDay = rest.filter((item) => !take(item, (c) =>
    plain(originOf(c) ?? "") === plain(item.aba) && plain(c.client) === plain(item.client) && !!item.data_contestacao && c.data_contestacao === item.data_contestacao));
  // Same day and a name spelled differently ("Marta"/"Marte"), or a reversed one entered elsewhere with value 0.
  const insert = sameDay.filter((item) => !take(item, (c) =>
    !!item.data_contestacao && c.data_contestacao === item.data_contestacao && firstName(c.client).slice(0, 3) === firstName(item.client).slice(0, 3)
    && (Math.abs(money(c.valor) - item.valor) < 1 || money(c.valor) === 0)));

  const plan: SyncPlan = { insert, update: [], adopt: [], remove: [] };
  for (const { item, current } of pairs) {
    const next = sheetFields(item, current);
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter((key) =>
      key === "valor" ? Math.abs(money(current.valor) - next.valor) >= 0.005 : (current[key] ?? null) !== (next[key] ?? null));
    if (changed.length) plan.update.push({ current, item, changed: changed.map((key) => describe(key, current[key], next[key])) });
    else if (plain(originOf(current) ?? "") !== plain(item.aba)) plan.adopt.push({ current, item });
  }
  plan.remove = Array.from(free).filter((c) => tabs.has(plain(originOf(c) ?? "")));
  return plan;
}

/** More removals than this in one go (or over a fifth of what came from the spreadsheet) look like a bad read, not edits. */
const MAX_REMOVALS = 5;

export async function syncChargebacks(file: string, desde: string, options: { write: boolean }) {
  const { items, abas } = await readSpreadsheet(await readFile(file), desde);
  if (!abas.length) throw new Error(`Nenhuma aba de mês a partir de ${desde} na planilha.`);

  const { data, error } = await supabase.from("chargebacks")
    .select("id, client, cliente_id, valor, data_venda, data_contestacao, comercial, juridico, reversao, observacoes, status, historico");
  if (error) throw new Error(error.message);
  const portal = (data ?? []) as PortalChargeback[];
  const plan = planSync(items, portal, abas);
  const fromSheet = portal.filter((c) => originOf(c)).length;
  const removalsBlocked = plan.remove.length > Math.max(MAX_REMOVALS, fromSheet / 5);

  const summary = `${plan.insert.length} novo(s), ${plan.update.length} atualizado(s), ${removalsBlocked ? 0 : plan.remove.length} removido(s)`
    + (removalsBlocked ? ` · ${plan.remove.length} sumiram da planilha, nada foi apagado (confira a planilha)` : "");
  if (!options.write) return { plan, summary, removalsBlocked };

  const { data: clientes, error: clientesError } = await supabase.from("clientes").select("id, name");
  if (clientesError) throw new Error(clientesError.message);
  const idsByName = new Map<string, number[]>();
  for (const c of clientes ?? []) idsByName.set(plain(c.name), [...(idsByName.get(plain(c.name)) ?? []), c.id]);
  // Linked to the client's record only when exactly one client has that name.
  const clienteIdOf = (name: string) => {
    const ids = idsByName.get(plain(name));
    return ids?.length === 1 ? ids[0] : null;
  };
  const now = new Date().toISOString();
  const entry = (acao: string): ChargebackHistoryEntry => ({ at: now, autor: "sistema", acao });
  const history = (c: PortalChargeback) => (Array.isArray(c.historico) ? c.historico : []);

  if (plan.insert.length) {
    const rows = plan.insert.map((item) => {
      const fields = sheetFields(item);
      const status = statusFromReversal(item.reversao) ?? "Em disputa";
      const createdAt = `${fields.data_contestacao ?? `${item.mes}-01`}T12:00:00-03:00`;
      return {
        ...fields, cliente_id: clienteIdOf(item.client), bank: null, amount: formatBrl(item.valor), deadline: null,
        status, tone: chargebackTone(status), observacao: observation(fields), created_at: createdAt, atualizado_em: createdAt,
        historico: [entry(`Importado da planilha de chargebacks (${item.aba})`)],
      };
    });
    const { error: insertError } = await supabase.from("chargebacks").insert(rows);
    if (insertError) throw new Error(`Inserindo: ${insertError.message}`);
  }
  for (const { current, item, changed } of plan.update) {
    const fields = sheetFields(item, current);
    const status = (current.reversao ?? null) !== item.reversao ? statusFromReversal(item.reversao) : null;
    const origin = plain(originOf(current) ?? "") === plain(item.aba) ? "" : ` (${item.aba})`;
    const { error: updateError } = await supabase.from("chargebacks").update({
      ...fields,
      amount: formatBrl(item.valor),
      observacao: observation(fields),
      cliente_id: current.cliente_id ?? clienteIdOf(item.client),
      ...(status && status !== current.status ? { status, tone: chargebackTone(status) } : {}),
      atualizado_em: now,
      historico: [...history(current), entry(`Atualizado pela planilha de chargebacks${origin}: ${changed.join("; ")}`)],
    }).eq("id", current.id);
    if (updateError) throw new Error(`Atualizando #${current.id}: ${updateError.message}`);
  }
  for (const { current, item } of plan.adopt) {
    const { error: adoptError } = await supabase.from("chargebacks")
      .update({ historico: [...history(current), entry(`Ligado à planilha de chargebacks (${item.aba})`)] }).eq("id", current.id);
    if (adoptError) throw new Error(`Ligando #${current.id}: ${adoptError.message}`);
  }
  if (!removalsBlocked && plan.remove.length) {
    const { error: deleteError } = await supabase.from("chargebacks").delete().in("id", plan.remove.map((c) => c.id));
    if (deleteError) throw new Error(`Removendo: ${deleteError.message}`);
  }
  if (plan.insert.length || plan.update.length || (!removalsBlocked && plan.remove.length)) {
    const removed = removalsBlocked ? [] : plan.remove.map((c) => `${c.client} (${formatBrl(money(c.valor))})`);
    await registrarAcao(undefined, "Sincronizou chargebacks com a planilha", summary + (removed.length ? `. Removidos: ${removed.join("; ")}` : ""));
  }
  return { plan, summary, removalsBlocked };
}

/** When the file last changed; a Google Drive that is not mounted yet can hang, so it gives up after 30 s. */
export async function modifiedAt(file: string): Promise<number> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("A pasta do Google Drive não respondeu.")), 30_000);
  });
  try {
    return (await Promise.race([stat(file), timeout])).mtimeMs;
  } finally {
    clearTimeout(timer);
  }
}
