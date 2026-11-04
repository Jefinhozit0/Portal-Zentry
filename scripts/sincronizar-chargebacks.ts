/**
 * Syncs the chargebacks with the team's spreadsheet now, without waiting for the server's check.
 *
 *   npx tsx scripts/sincronizar-chargebacks.ts             -> only shows what would change
 *   npx tsx scripts/sincronizar-chargebacks.ts --gravar    -> writes to the database
 *
 * Reads CHARGEBACKS_PLANILHA (the .xlsx in the Google Drive folder) and the tabs from CHARGEBACKS_DESDE (AAAA-MM) on.
 * The rules are in server/_core/chargebacksPlanilha.ts.
 */
import "dotenv/config";
import { formatBrl } from "../shared/chargebacks";
import { originOf, syncChargebacks } from "../server/_core/chargebacksPlanilha";
import { ENV } from "../server/_core/env";

async function main() {
  if (!ENV.chargebacksPlanilha) throw new Error("Defina CHARGEBACKS_PLANILHA no .env com o caminho da planilha.");
  const write = process.argv.includes("--gravar");
  const { plan, summary } = await syncChargebacks(ENV.chargebacksPlanilha, ENV.chargebacksDesde, { write });
  const brl = (value: number | string | null) => formatBrl(Number(value ?? 0));
  for (const item of plan.insert) console.log(`+ ${item.aba} · ${item.data_contestacao ?? "sem data"} · ${item.client} · ${brl(item.valor)}${item.reversao ? ` · ${item.reversao}` : ""}`);
  for (const { current, changed } of plan.update) console.log(`~ #${current.id} ${current.client}: ${changed.join("; ").slice(0, 160)}`);
  for (const { current, item } of plan.adopt) console.log(`= #${current.id} ${current.client} (${originOf(current)}) → ${item.aba}`);
  for (const c of plan.remove) console.log(`- #${c.id} ${originOf(c)} · ${c.data_contestacao ?? "sem data"} · ${c.client} · ${brl(c.valor)}`);
  console.log(`\n${summary}.`);
  if (!write) console.log("Nada foi gravado. Rode de novo com --gravar para gravar.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
