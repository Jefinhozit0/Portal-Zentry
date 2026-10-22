/**
 * Brings chargebacks from the team's spreadsheet ("CHARGE BACK", one tab per month) into the portal.
 * Nobody is notified. Needs these migrations run in the Supabase SQL Editor:
 *   supabase/migrations/20261013_chargebacks_cadastro.sql  (cliente, observação, histórico)
 *   supabase/migrations/20261014_chargebacks_planilha.sql  (datas, valor, consultores, reversão)
 *
 *   npx tsx scripts/importar-chargebacks.ts <chargebacks.json>            -> only shows what would happen
 *   npx tsx scripts/importar-chargebacks.ts <chargebacks.json> --gravar   -> writes to the database
 *
 * Each item: { client, data_venda, data_contestacao, valor, comercial, juridico, reversao, observacoes, mes, origem }
 * (dates as AAAA-MM-DD; mes = the tab as AAAA-MM, used when the contestation date is blank).
 * A chargeback already imported (same client, value, sale and contestation dates) is updated instead of
 * duplicated, so this can run again.
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { chargebackTone, formatBrl, type ChargebackStatus } from "../shared/chargebacks";

type SheetChargeback = {
  client: string;
  data_venda: string | null;
  data_contestacao: string | null;
  valor: number;
  comercial: string | null;
  juridico: string | null;
  reversao: string | null;
  observacoes: string | null;
  mes: string;
  origem?: string;
};

const BATCH = 100;
const plain = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const br = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "sem data");
const keyOf = (c: { client: string; valor: number | string | null; data_venda: string | null; data_contestacao: string | null }) =>
  [plain(c.client), Number(c.valor ?? 0).toFixed(2), c.data_venda ?? "", c.data_contestacao ?? ""].join("|");

/**
 * The spreadsheet's REVERSÃO column -> the portal's statuses:
 * "RESTITUIDO PELA Zentry" (company gave the money back) -> Cancelado; "REVERTIDO", "PAGOU...", "sim" -> Revertido;
 * blank or anything else -> Em disputa.
 */
function statusFromReversal(reversal: string | null): ChargebackStatus {
  const text = plain(reversal ?? "");
  if (/restitu/.test(text)) return "Cancelado";
  if (/revert|pagou|pago|^sim$/.test(text)) return "Revertido";
  return "Em disputa";
}

function observation(c: SheetChargeback) {
  const lines = [
    `Venda: ${br(c.data_venda)} · Contestação: ${br(c.data_contestacao)}`,
    `Comercial: ${c.comercial ?? "—"} · Jurídico: ${c.juridico ?? "—"}`,
    c.reversao ? `Reversão: ${c.reversao}` : "",
    c.observacoes ?? "",
  ].filter(Boolean);
  const text = lines.join("\n");
  return text.length > 2000 ? `${text.slice(0, 1999)}…` : text; // the edit form accepts up to 2000
}

async function main() {
  const [file, flag] = process.argv.slice(2);
  if (!file) {
    console.log("Uso: npx tsx scripts/importar-chargebacks.ts <chargebacks.json> [--gravar]");
    process.exit(1);
  }
  const write = flag === "--gravar";
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });

  const { data: existing, error: listError } = await supabase.from("chargebacks").select("id, client, valor, data_venda, data_contestacao, historico");
  if (listError) {
    const hint = /column/i.test(listError.message)
      ? " Rode supabase/migrations/20261013_chargebacks_cadastro.sql e 20261014_chargebacks_planilha.sql no SQL Editor do Supabase."
      : "";
    throw new Error(listError.message + hint);
  }
  const byKey = new Map((existing ?? []).filter((c) => c.valor !== null).map((c) => [keyOf(c), c]));

  // Link to the client's record only when exactly one client has that name.
  const { data: clientes, error: clientesError } = await supabase.from("clientes").select("id, name");
  if (clientesError) throw clientesError;
  const idsByName = new Map<string, number[]>();
  for (const c of clientes ?? []) idsByName.set(plain(c.name), [...(idsByName.get(plain(c.name)) ?? []), c.id]);
  const clienteIdOf = (name: string) => {
    const ids = idsByName.get(plain(name));
    return ids?.length === 1 ? ids[0] : null;
  };

  const now = new Date().toISOString();
  const items = JSON.parse(await readFile(file, "utf8")) as SheetChargeback[];
  const toInsert: Record<string, unknown>[] = [];
  const toUpdate: { id: number; row: Record<string, unknown> }[] = [];
  for (const c of items) {
    const status = statusFromReversal(c.reversao);
    const createdAt = `${c.data_contestacao ?? `${c.mes}-01`}T12:00:00-03:00`;
    const row = {
      client: c.client,
      cliente_id: clienteIdOf(c.client),
      bank: null,
      amount: formatBrl(c.valor),
      deadline: null,
      status,
      tone: chargebackTone(status),
      observacao: observation(c),
      data_venda: c.data_venda,
      data_contestacao: c.data_contestacao,
      valor: c.valor,
      comercial: c.comercial,
      juridico: c.juridico,
      reversao: c.reversao,
      observacoes: c.observacoes,
      created_at: createdAt,
      atualizado_em: createdAt,
    };
    const found = byKey.get(keyOf(c));
    const history = [{ at: now, autor: "sistema", acao: `Importado da planilha de chargebacks${c.origem ? ` (${c.origem.replace(/:\d+$/, "")})` : ""}` }];
    if (found) {
      const previous = Array.isArray(found.historico) ? found.historico : [];
      toUpdate.push({ id: found.id, row: { ...row, historico: previous.length ? previous : history } });
    } else {
      toInsert.push({ ...row, historico: history });
    }
  }

  const all = [...toInsert, ...toUpdate.map((u) => u.row)];
  const count = (status: string) => all.filter((r) => r.status === status);
  const sum = (rows: Record<string, unknown>[]) => formatBrl(rows.reduce((s, r) => s + Number(r.valor), 0));
  console.log(`No arquivo: ${items.length}. Novos: ${toInsert.length}. Já importados (serão atualizados): ${toUpdate.length}.`);
  for (const status of ["Em disputa", "Revertido", "Cancelado"]) console.log(`  ${status}: ${count(status).length} (${sum(count(status))})`);
  console.log(`  Ligados ao cadastro do cliente: ${all.filter((r) => r.cliente_id).length}`);
  if (!write) {
    console.log("\nNada foi gravado. Rode de novo com --gravar para importar.");
    return;
  }

  for (let i = 0; i < toInsert.length; i += BATCH) {
    const { error } = await supabase.from("chargebacks").insert(toInsert.slice(i, i + BATCH));
    if (error) throw new Error(`Inserindo lote ${i / BATCH + 1}: ${error.message}`);
  }
  for (const { id, row } of toUpdate) {
    const { error } = await supabase.from("chargebacks").update(row).eq("id", id);
    if (error) throw new Error(`Atualizando #${id}: ${error.message}`);
  }
  await supabase.from("auditoria").insert({
    autor: "sistema",
    acao: "Importou chargebacks da planilha",
    detalhes: `${toInsert.length} novos, ${toUpdate.length} atualizados`,
  });
  console.log(`\nPronto: ${toInsert.length} novos e ${toUpdate.length} atualizados.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
