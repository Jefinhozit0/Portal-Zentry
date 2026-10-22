/**
 * Sales HUB numbers, all computed from the registered sales. Pure functions, so they are tested
 * on their own (salesHubData.test.ts) and the screen only draws what comes out of here.
 */

export type Sector = "comercial" | "juridico";
export type HubSale = {
  id: number;
  date: string; // dd/mm/aaaa
  client: string;
  phone: string;
  consultants: string[];
  product: string;
  status: "Pendente" | "OK";
  cbk: boolean;
  gross: number;
  net: number;
  note: string;
  setor?: Sector;
  createdAt?: string | null;
};
export type HubRankingItem = { name: string; count: number; gross: number; net: number };

export const SECTOR_LABEL: Record<Sector, string> = { comercial: "Comercial", juridico: "Jurídico" };
export const hubMoney = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Zentry's card fee (%) by number of installments: index 0 = 1x ... index 9 = 10x. */
export const CARD_FEES = [4.87, 6.3, 7.33, 8.37, 9.41, 13.14, 14.59, 16.04, 17.51, 18.94];

/** What Zentry receives from a card payment of `gross` in `installments`x (1 to 10), rounded to cents. */
export function netAfterCardFee(gross: number, installments: number): number {
  const fee = CARD_FEES[installments - 1];
  if (fee === undefined) throw new RangeError(`Sem taxa para ${installments}x.`);
  return Math.round(gross * (100 - fee)) / 100;
}
export const hubPercent = (value: number | null) => (value === null ? "—" : `${(value * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MONTHS_LONG = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** "28/09/2026" -> "2026-09"; null when the date is not in that format. */
export function saleMonth(sale: Pick<HubSale, "date">) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(sale.date);
  return match ? `${match[3]}-${match[2]}` : null;
}

/** "2026-09" -> "setembro de 2026" */
export function monthLabel(month: string) {
  const [year, number] = month.split("-").map(Number);
  return year && number ? `${MONTHS_LONG[number - 1]} de ${year}` : "todo o período";
}

/** "setembro de 2026" -> "Setembro de 2026" */
export const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function currentMonth(now = new Date()) {
  return now.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 7);
}

export function shiftMonth(month: string, delta: number) {
  const [year, number] = month.split("-").map(Number);
  const date = new Date(year, number - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export const sectorOf = (sale: HubSale): Sector => sale.setor ?? "comercial";

export type SalesFilter = { month: string; sector: Sector | "todos"; consultant: string; query: string };

export function filterSales(sales: HubSale[], filter: SalesFilter) {
  const query = filter.query.trim().toLowerCase();
  return sales.filter((sale) => {
    if (filter.month && saleMonth(sale) !== filter.month) return false;
    if (filter.sector !== "todos" && sectorOf(sale) !== filter.sector) return false;
    if (filter.consultant !== "Todos" && !sale.consultants.includes(filter.consultant)) return false;
    if (!query) return true;
    return `${sale.client} ${sale.phone} ${sale.product} ${sale.consultants.join(" ")} ${sale.note}`.toLowerCase().includes(query);
  });
}

/** "13/10/2026" → "20261013", so dates sort as text. */
export const dateKey = (date: string) => date.split("/").reverse().join("");

export type SaleSortKey = "date" | "client" | "gross" | "net";

/** Newest first by default; ties keep the most recently registered on top. */
export function sortSales(sales: HubSale[], key: SaleSortKey, direction: "asc" | "desc") {
  const sign = direction === "asc" ? 1 : -1;
  const compare = (a: HubSale, b: HubSale) => {
    if (key === "client") return a.client.localeCompare(b.client, "pt-BR");
    if (key === "gross" || key === "net") return a[key] - b[key];
    return dateKey(a.date).localeCompare(dateKey(b.date));
  };
  return [...sales].sort((a, b) => compare(a, b) * sign || b.id - a.id);
}

export type Totals = { count: number; gross: number; net: number; cbkCount: number; cbkNet: number; netShare: number | null; ticket: number | null; resultado: number };

/** Chargeback loss = the net value of the sales marked with a chargeback. */
export function totals(sales: HubSale[]): Totals {
  const gross = sales.reduce((sum, sale) => sum + sale.gross, 0);
  const net = sales.reduce((sum, sale) => sum + sale.net, 0);
  const cbk = sales.filter((sale) => sale.cbk);
  const cbkNet = cbk.reduce((sum, sale) => sum + sale.net, 0);
  return {
    count: sales.length,
    gross,
    net,
    cbkCount: cbk.length,
    cbkNet,
    netShare: gross > 0 ? net / gross : null,
    ticket: sales.length > 0 ? gross / sales.length : null,
    resultado: net - cbkNet,
  };
}

export function ranking(sales: HubSale[]): HubRankingItem[] {
  const byName = new Map<string, HubRankingItem>();
  for (const sale of sales) {
    for (const name of sale.consultants) {
      const item = byName.get(name) ?? { name, count: 0, gross: 0, net: 0 };
      item.count += 1;
      item.gross += sale.gross;
      item.net += sale.net;
      byName.set(name, item);
    }
  }
  return Array.from(byName.values()).sort((a, b) => b.net - a.net || b.count - a.count || a.name.localeCompare(b.name));
}

export type MonthPoint = { month: string; label: string; gross: number; net: number; count: number };

/** The `size` months ending at `endMonth`, oldest first, months without sales at zero. */
export function monthlyEvolution(sales: HubSale[], endMonth: string, size = 12): MonthPoint[] {
  const points: MonthPoint[] = [];
  for (let offset = size - 1; offset >= 0; offset--) {
    const month = shiftMonth(endMonth, -offset);
    const inMonth = sales.filter((sale) => saleMonth(sale) === month);
    const [year, number] = month.split("-");
    points.push({
      month,
      // The year only shows on January, so the labels fit; the tooltip and the table have the full month.
      label: `${MONTHS[Number(number) - 1]}${number === "01" ? `/${year.slice(2)}` : ""}`,
      gross: inMonth.reduce((sum, sale) => sum + sale.gross, 0),
      net: inMonth.reduce((sum, sale) => sum + sale.net, 0),
      count: inMonth.length,
    });
  }
  return points;
}

export const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
export const DAY_PERIODS = ["Madrugada", "Manhã", "Tarde", "Noite"];

/**
 * Sales by weekday × time of day, in Brazil's time, from when each sale was registered.
 * Returns the counts and the busiest cell (null with no sales).
 */
export function heatmap(sales: HubSale[]) {
  const grid = WEEKDAYS.map(() => DAY_PERIODS.map(() => 0));
  for (const sale of sales) {
    if (!sale.createdAt) continue;
    const parts = new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", hour12: false, timeZone: "America/Sao_Paulo" }).formatToParts(new Date(sale.createdAt));
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.find((part) => part.type === "weekday")?.value ?? "");
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? NaN) % 24;
    if (weekday < 0 || Number.isNaN(hour)) continue;
    grid[weekday][Math.floor(hour / 6)] += 1;
  }
  let peak: { weekday: number; period: number; count: number } | null = null;
  grid.forEach((row, weekday) => row.forEach((count, period) => {
    if (count > 0 && (!peak || count > peak.count)) peak = { weekday, period, count };
  }));
  const max = Math.max(0, ...grid.flat());
  return { grid, peak: peak as { weekday: number; period: number; count: number } | null, max };
}

/** Heat level 0–4 for a cell, relative to the busiest cell. */
export const heatLevel = (count: number, max: number) => (count === 0 || max === 0 ? 0 : Math.max(1, Math.ceil((count / max) * 4)));

const csvCell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
export const buildSalesHubCsv = (sales: HubSale[], rankingItems: HubRankingItem[]) => [
  "RELATÓRIO SALES HUB",
  `Vendas filtradas: ${sales.length}`,
  "",
  ["Data", "Setor", "Cliente", "Telefone", "Consultor(es)", "Produto", "Status", "CBK", "Bruto", "Líquido", "Observação"].map(csvCell).join(";"),
  ...sales.map((sale) => [sale.date, SECTOR_LABEL[sectorOf(sale)], sale.client, sale.phone, sale.consultants.join(", "), sale.product, sale.status, sale.cbk ? "sim" : "não", sale.gross, sale.net, sale.note].map(csvCell).join(";")),
  "",
  "RANKING DE CONSULTORES",
  ["Posição", "Consultor", "Vendas", "Bruto", "Líquido"].map(csvCell).join(";"),
  ...rankingItems.map((item, index) => [index + 1, item.name, item.count, item.gross, item.net].map(csvCell).join(";")),
].join("\n");

export const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
