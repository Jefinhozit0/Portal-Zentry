import { FormEvent, useMemo, useState } from "react";
import { Briefcase, ChevronRight, FileText, LayoutDashboard, Plus, Scale, Search, Table2, Trash2, Trophy, Users, X } from "lucide-react";
import { toast } from "sonner";
import type { ChargebackDraft } from "@shared/chargebacks";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { StatusPill } from "./Home";
import { CountUp } from "@/components/CountUp";
import { SalesManager } from "./SalesManager";
import {
  DAY_PERIODS, SECTOR_LABEL, WEEKDAYS, CARD_FEES, buildSalesHubCsv, capitalize, currentMonth, escapeHtml, filterSales, heatLevel, heatmap, hubMoney, hubPercent,
  monthLabel, monthlyEvolution, netAfterCardFee, ranking as buildRanking, sectorOf, shiftMonth, sortSales, totals, type HubSale, type Sector,
} from "./salesHubData";

type Section = Sector | "control" | "vendas";
type SaleForm = { id?: number; date: string; client: string; phone: string; product: string; status: HubSale["status"]; cbk: boolean; gross: string; net: string; note: string; consultants: string[]; setor: Sector; payment: string };

const PRODUCTS = ["Revisão de Juros", "Revisão de contrato", "Portabilidade", "Laudo", "Busca e apreensão", "Outros"];
const todayInput = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
/** "2026-09-28" <-> "28/09/2026" */
const toBrDate = (iso: string) => iso.split("-").reverse().join("/");
const toIsoDate = (br: string) => br.split("/").reverse().join("-");
const emptyForm = (setor: Sector): SaleForm => ({ date: todayInput(), client: "", phone: "", product: PRODUCTS[0], status: "Pendente", cbk: false, gross: "", net: "", note: "", consultants: [], setor, payment: "" });
/** Accepts "1.234,56", "1234,56" and "1234.56". */
function parseMoney(value: string) {
  const cleaned = value.trim().replace(/[^\d.,]/g, "");
  if (!cleaned) return NaN;
  const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned;
  return Number(normalized);
}

/** "" = typed by hand, "pix" = PIX or boleto (no fee), "1".."10" = card installments. */
const paymentLabel = (payment: string) => (payment === "pix" ? "PIX/boleto" : payment ? `Cartão ${payment}x (taxa ${CARD_FEES[Number(payment) - 1].toLocaleString("pt-BR")}%)` : "");

/** The note saved with the sale starts with how it was paid, so the net value can be checked later. */
function noteWithPayment(form: SaleForm) {
  const note = form.note.trim();
  const label = paymentLabel(form.payment);
  return !label || note.includes(label) ? note : [label, note].filter(Boolean).join(" · ");
}

/** Applies a change to the form and, when a payment is chosen, fills the net value from the card fee table. */
function withPayment(form: SaleForm, changes: Partial<SaleForm>): SaleForm {
  const next = { ...form, ...changes };
  const gross = parseMoney(next.gross);
  if (!next.payment || !Number.isFinite(gross)) return next;
  const net = next.payment === "pix" ? gross : netAfterCardFee(gross, Number(next.payment));
  return { ...next, net: net.toFixed(2).replace(".", ",") };
}

/** How many of the latest sales the Comercial, Jurídico and Zentry Control tabs show; the Vendas tab has all of them. */
const RECENT_SALES = 10;

export default function SalesHubPage({ isAdmin, onChargeback }: { userName: string; isAdmin: boolean; onChargeback: (draft: ChargebackDraft) => void }) {
  const utils = trpc.useUtils();
  const [section, setSection] = useState<Section>("comercial");
  /** Sector the Vendas tab opens with when reached from "Ver todas" in a sector tab. */
  const [salesSector, setSalesSector] = useState<Sector | "todos">("todos");
  function openSection(next: Section) {
    if (next === "vendas") setSalesSector("todos");
    setSection(next);
  }
  function openAllSales() {
    setSalesSector(section === "comercial" || section === "juridico" ? section : "todos");
    setSection("vendas");
  }
  const [month, setMonth] = useState(currentMonth());
  const [consultant, setConsultant] = useState("Todos");
  const [query, setQuery] = useState("");
  const vendasQuery = trpc.portal.vendas.useQuery(undefined, { retry: false });
  const consultoresQuery = trpc.portal.consultores.useQuery(undefined, { retry: false });
  const sales = (vendasQuery.data ?? []) as HubSale[];

  const refresh = () => Promise.all([utils.portal.vendas.invalidate(), utils.portal.consultores.invalidate()]);
  const createVenda = trpc.portal.createVenda.useMutation();
  const updateVenda = trpc.portal.updateVenda.useMutation();
  const deleteVenda = trpc.portal.deleteVenda.useMutation({
    onSuccess: () => { toast.success("Venda apagada."); setSaleToDelete(null); refresh(); },
    onError: (error) => toast.error(error.message),
  });
  const addConsultant = trpc.portal.adicionarConsultor.useMutation({
    onSuccess: (_data, variables) => { toast.success(`${variables.nome} cadastrado.`); setNewConsultant(""); refresh(); },
    onError: (error) => toast.error(error.message),
  });
  const removeConsultant = trpc.portal.removerConsultor.useMutation({
    onSuccess: () => { toast.success("Consultor removido. As vendas dele continuam no histórico."); refresh(); },
    onError: (error) => toast.error(error.message),
  });

  const [saleForm, setSaleForm] = useState<SaleForm | null>(null);
  const [saleToDelete, setSaleToDelete] = useState<HubSale | null>(null);
  const [consultantsOpen, setConsultantsOpen] = useState(false);
  const [newConsultant, setNewConsultant] = useState("");
  const [showChartTable, setShowChartTable] = useState(false);
  const [hoveredMonth, setHoveredMonth] = useState<number | null>(null);

  // Before the migration that creates the consultants table, the names already on sales stand in for it.
  const activeConsultants = consultoresQuery.data && !consultoresQuery.data.ready
    ? Array.from(new Set(sales.flatMap((sale) => sale.consultants))).sort((a, b) => a.localeCompare(b)).map((nome, index) => ({ id: -1 - index, nome, ativo: true }))
    : (consultoresQuery.data?.consultores ?? []).filter((item) => item.ativo);
  // The filter also lists people who left but still have sales, so old months can be filtered by them.
  const consultantOptions = useMemo(() => {
    const names = new Set(activeConsultants.map((item) => item.nome));
    sales.forEach((sale) => sale.consultants.forEach((name) => names.add(name)));
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [activeConsultants, sales]);

  const sector: Sector | "todos" = section === "control" || section === "vendas" ? "todos" : section;
  const filtered = useMemo(() => filterSales(sales, { month, sector, consultant, query }), [sales, month, sector, consultant, query]);
  const current = useMemo(() => totals(filtered), [filtered]);
  const monthAll = useMemo(() => filterSales(sales, { month, sector: "todos", consultant: "Todos", query: "" }), [sales, month]);
  const bySector = useMemo(() => ({
    comercial: totals(monthAll.filter((sale) => sectorOf(sale) === "comercial")),
    juridico: totals(monthAll.filter((sale) => sectorOf(sale) === "juridico")),
    todos: totals(monthAll),
  }), [monthAll]);
  const rankingItems = useMemo(() => buildRanking(filtered), [filtered]);
  // The chart follows the sector and consultant, and ends on the chosen month (or this month).
  const evolution = useMemo(
    () => monthlyEvolution(filterSales(sales, { month: "", sector, consultant, query: "" }), month || currentMonth()),
    [sales, sector, consultant, month],
  );
  const evolutionMax = Math.max(0, ...evolution.map((point) => point.gross));
  const heat = useMemo(() => heatmap(filtered), [filtered]);
  const periodText = month ? monthLabel(month) : "todo o período";
  const loading = vendasQuery.isLoading;

  function selectRanking(name: string) {
    setConsultant((currentName) => (currentName === name ? "Todos" : name));
  }

  function openNewSale() {
    setSaleForm(emptyForm(section === "juridico" ? "juridico" : "comercial"));
  }

  function openEditSale(sale: HubSale) {
    setSaleForm({ id: sale.id, date: toIsoDate(sale.date), client: sale.client, phone: sale.phone, product: sale.product, status: sale.status, cbk: sale.cbk, gross: String(sale.gross).replace(".", ","), net: String(sale.net).replace(".", ","), note: sale.note, consultants: sale.consultants, setor: sectorOf(sale), payment: "" });
  }

  async function saveSale(event: FormEvent) {
    event.preventDefault();
    if (!saleForm) return;
    const gross = parseMoney(saleForm.gross);
    const net = saleForm.net.trim() ? parseMoney(saleForm.net) : gross;
    if (!saleForm.client.trim()) return toast.error("Informe o cliente.");
    if (!Number.isFinite(gross) || gross < 0) return toast.error("Informe o valor bruto, por exemplo 1.500,00.");
    if (!Number.isFinite(net) || net < 0) return toast.error("O valor líquido não é um número válido.");
    if (net > gross) return toast.error("O valor líquido não pode ser maior que o bruto.");
    const payload = {
      date: toBrDate(saleForm.date), client: saleForm.client.trim(), phone: saleForm.phone.trim(), consultants: saleForm.consultants, product: saleForm.product,
      status: saleForm.status, cbk: saleForm.cbk, gross, net, note: noteWithPayment(saleForm), setor: saleForm.setor,
    };
    const wasCbk = saleForm.id ? sales.find((sale) => sale.id === saleForm.id)?.cbk === true : false;
    try {
      const saved = saleForm.id ? await updateVenda.mutateAsync({ id: saleForm.id, ...payload }) : await createVenda.mutateAsync(payload);
      toast.success(saleForm.id ? "Venda atualizada." : "Venda cadastrada.");
      // Just marked with chargeback: offer to open the chargeback with the sale data filled in.
      if (payload.cbk && !wasCbk) {
        const vendaId = typeof saved?.id === "number" ? saved.id : saleForm.id;
        toast("Venda marcada com chargeback.", {
          description: "Quer registrar o chargeback para acompanhar a contestação?",
          duration: 12_000,
          action: { label: "Abrir chargeback", onClick: () => onChargeback({ client: payload.client, amount: payload.gross, vendaId, note: [payload.product, `venda de ${payload.date}`].filter(Boolean).join(" · ") }) },
        });
      }
      setSaleForm(null);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar a venda.");
    }
  }

  async function markPaid(sale: HubSale) {
    try {
      await updateVenda.mutateAsync({
        id: sale.id, date: sale.date, client: sale.client, phone: sale.phone, consultants: sale.consultants, product: sale.product,
        status: "OK", cbk: sale.cbk, gross: sale.gross, net: sale.net, note: sale.note, setor: sectorOf(sale),
      });
      toast.success(`Venda de ${sale.client} marcada como OK.`);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível atualizar a venda.");
    }
  }

  function toggleFormConsultant(name: string) {
    setSaleForm((form) => form && { ...form, consultants: form.consultants.includes(name) ? form.consultants.filter((item) => item !== name) : [...form.consultants, name] });
  }

  function downloadFile(content: BlobPart, type: string, filename: string) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([content], { type }));
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function exportCsv() {
    downloadFile(`﻿${buildSalesHubCsv(filtered, rankingItems)}`, "text/csv;charset=utf-8", `sales-hub-${month || "todo-periodo"}.csv`);
  }

  function exportPdf() {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return toast.error("O navegador bloqueou a janela do PDF. Permita pop-ups para exportar.");
    const cell = (value: string) => `<td>${escapeHtml(value)}</td>`;
    const rows = filtered.map((sale) => `<tr>${[sale.date, SECTOR_LABEL[sectorOf(sale)], sale.client, sale.consultants.join(", "), sale.product, sale.status, hubMoney(sale.gross), hubMoney(sale.net)].map(cell).join("")}</tr>`).join("");
    const rankingRows = rankingItems.map((item, index) => `<tr>${[String(index + 1), item.name, String(item.count), hubMoney(item.gross), hubMoney(item.net)].map(cell).join("")}</tr>`).join("");
    const title = section === "control" ? "Zentry Control" : section === "vendas" ? "Vendas" : SECTOR_LABEL[section];
    printWindow.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Sales HUB — ${escapeHtml(title)}</title><style>body{font:12px Arial;color:#202020;margin:34px}h1{color:#8a6016;margin-bottom:4px}h2{margin-top:28px;border-bottom:2px solid #d5a63d;padding-bottom:7px}p{color:#555}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #ddd;padding:7px;text-align:left}th{background:#f5e7c2}tr:nth-child(even){background:#fafafa}.meta{display:flex;gap:24px;margin:18px 0;font-weight:bold}@media print{body{margin:15mm}}</style></head><body><h1>Sales HUB · ${escapeHtml(title)}</h1><p>Relatório de vendas e ranking de consultores</p><div class="meta"><span>Período: ${escapeHtml(periodText)}</span><span>Vendas: ${current.count}</span><span>Bruto: ${hubMoney(current.gross)}</span><span>Líquido: ${hubMoney(current.net)}</span></div><h2>Vendas</h2><table><thead><tr><th>Data</th><th>Setor</th><th>Cliente</th><th>Consultor(es)</th><th>Produto</th><th>Status</th><th>Bruto</th><th>Líquido</th></tr></thead><tbody>${rows || '<tr><td colspan="8">Nenhuma venda encontrada.</td></tr>'}</tbody></table><h2>Ranking de consultores</h2><table><thead><tr><th>Posição</th><th>Consultor</th><th>Vendas</th><th>Bruto</th><th>Líquido</th></tr></thead><tbody>${rankingRows || '<tr><td colspan="5">Nenhuma venda com consultor.</td></tr>'}</tbody></table><script>window.onload=()=>{window.print();window.onafterprint=()=>window.close()}</script></body></html>`);
    printWindow.document.close();
  }

  const monthControl = (
    <div className="month-control">
      <button type="button" aria-label="Mês anterior" onClick={() => setMonth(shiftMonth(month || currentMonth(), -1))}>‹</button>
      <input id="hub-month" type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
      <button type="button" aria-label="Próximo mês" onClick={() => setMonth(shiftMonth(month || currentMonth(), 1))}>›</button>
      <button type="button" aria-label="Ver todo o período" title="Ver todo o período" onClick={() => setMonth("")}>×</button>
    </div>
  );

  const actions = (
    <div className="hub-actions">
      <button type="button" onClick={exportCsv}><FileText size={14} /> CSV</button>
      <button type="button" onClick={exportPdf}><FileText size={14} /> PDF</button>
      <button type="button" className="hub-icon-action" onClick={() => setConsultantsOpen(true)} aria-label="Consultores" title="Consultores"><Users size={15} /></button>
      <button type="button" className="hub-primary" onClick={openNewSale}><Plus size={15} /> Nova venda</button>
    </div>
  );

  /** Period, consultant and search, with the actions on the same bar. Zentry Control only uses the period. */
  const toolbar = (withFilters: boolean) => (
    <section className={`hub-toolbar ${withFilters ? "" : "hub-toolbar-compact"}`}>
      <div className="hub-toolbar-fields hub-filter-row">
        <div>
          <label htmlFor="hub-month" className="sr-only">Período</label>
          {monthControl}
        </div>
        {withFilters && (
          <>
            <div>
              <label htmlFor="hub-consultant" className="sr-only">Consultor</label>
              <select id="hub-consultant" value={consultant} onChange={(event) => setConsultant(event.target.value)}>
                <option value="Todos">Consultor: todos</option>
                {consultantOptions.map((name) => <option key={name}>{name}</option>)}
              </select>
            </div>
            <div className="hub-search">
              <label htmlFor="hub-search" className="sr-only">Buscar</label>
              <div><Search size={15} /><input id="hub-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar venda..." title="Cliente, telefone, produto ou observação" /></div>
            </div>
          </>
        )}
      </div>
      {actions}
    </section>
  );

  const tabs = (
    <div className="hub-tabs" role="tablist" aria-label="Setores">
      <button type="button" role="tab" aria-selected={section === "comercial"} className={section === "comercial" ? "active" : ""} onClick={() => openSection("comercial")}><Briefcase size={16} /> Comercial</button>
      <button type="button" role="tab" aria-selected={section === "juridico"} className={section === "juridico" ? "active" : ""} onClick={() => openSection("juridico")}><Scale size={16} /> Jurídico</button>
      <button type="button" role="tab" aria-selected={section === "vendas"} className={section === "vendas" ? "active" : ""} onClick={() => openSection("vendas")}><Table2 size={16} /> Vendas</button>
      <button type="button" role="tab" aria-selected={section === "control"} className={section === "control" ? "active" : ""} onClick={() => openSection("control")}><LayoutDashboard size={16} /> Zentry Control</button>
    </div>
  );

  const sectorShare = (value: number) => (bySector.todos.gross > 0 ? value / bySector.todos.gross : null);

  /** The latest sales of the tab, compact; the full list with paging and filters is in the Vendas tab. */
  const recent = useMemo(() => sortSales(filtered, "date", "desc").slice(0, RECENT_SALES), [filtered]);
  const salesTable = (
    <section className="hub-panel sales-table-panel">
      <div className="hub-panel-heading">
        <div><h3>Últimas vendas</h3><p>{loading ? "Carregando..." : filtered.length > recent.length ? `${recent.length} mais recentes de ${filtered.length} · ${periodText}` : `${filtered.length} venda(s) · ${periodText}`}</p></div>
        <div className="hub-heading-actions">
          {(query || consultant !== "Todos") && <button type="button" className="text-button" onClick={() => { setQuery(""); setConsultant("Todos"); }}>Limpar filtros <X size={14} /></button>}
          {filtered.length > 0 && <button type="button" className="secondary-button" onClick={openAllSales}>Ver todas na aba Vendas <ChevronRight size={15} /></button>}
        </div>
      </div>
      <div className="table-wrap">
        <table className="sales-fit">
          <thead><tr><th>{section === "control" ? "Data · setor" : "Data"}</th><th>Cliente</th><th>Consultor</th><th>Produto</th><th>Status</th><th className="num">Bruto</th><th className="num">Líquido</th><th><span className="sr-only">Ações</span></th></tr></thead>
          <tbody>
            {!loading && filtered.length === 0 && <tr><td colSpan={8} className="hub-empty-row">Nenhuma venda em {periodText}{consultant !== "Todos" ? ` para ${consultant}` : ""}. Use "Nova venda" para registrar.</td></tr>}
            {recent.map((sale) => (
              <tr key={sale.id} onClick={() => openEditSale(sale)} title="Clique para editar">
                <td className="nowrap">{sale.date}{section === "control" && <small className="hub-note">{SECTOR_LABEL[sectorOf(sale)]}</small>}</td>
                <td className="sales-client"><strong>{sale.client}</strong>{(sale.phone || sale.note) && <small className="hub-note" title={sale.note || undefined}>{[sale.phone, sale.note].filter(Boolean).join(" · ")}</small>}</td>
                <td>{sale.consultants.join(", ") || "—"}</td>
                <td>{sale.product || "—"}</td>
                <td className="nowrap"><StatusPill tone={sale.status === "OK" ? "green" : "yellow"}>{sale.status}</StatusPill>{sale.cbk && <span className="sales-cbk-tag">CBK</span>}</td>
                <td className="num">{hubMoney(sale.gross)}</td>
                <td className="num">{hubMoney(sale.net)}</td>
                <td className="hub-row-actions" onClick={(event) => event.stopPropagation()}>
                  {isAdmin && <button type="button" className="icon-button hub-delete" onClick={() => setSaleToDelete(sale)} aria-label={`Apagar venda de ${sale.client}`} title="Apagar venda"><Trash2 size={15} /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );

  const dialogs = (
    <>
      <Dialog open={saleForm !== null} onOpenChange={(open) => !open && !createVenda.isPending && !updateVenda.isPending && setSaleForm(null)}>
        <DialogContent className="hub-dialog">
          {saleForm && (
            <form onSubmit={saveSale}>
              <DialogHeader>
                <DialogTitle>{saleForm.id ? "Editar venda" : "Nova venda"}</DialogTitle>
                <DialogDescription>Os valores aparecem no painel e nos relatórios assim que você salvar.</DialogDescription>
              </DialogHeader>
              <div className="new-sale-grid">
                <label>Cliente<input required value={saleForm.client} onChange={(event) => setSaleForm({ ...saleForm, client: event.target.value })} placeholder="Nome do cliente" /></label>
                <label>Telefone<input value={saleForm.phone} onChange={(event) => setSaleForm({ ...saleForm, phone: event.target.value })} placeholder="(00) 00000-0000" /></label>
                <label>Data da venda<input required type="date" value={saleForm.date} onChange={(event) => setSaleForm({ ...saleForm, date: event.target.value })} /></label>
                <label>Setor<select value={saleForm.setor} onChange={(event) => setSaleForm({ ...saleForm, setor: event.target.value as Sector })}><option value="comercial">Comercial</option><option value="juridico">Jurídico</option></select></label>
                <label>Produto<select value={PRODUCTS.includes(saleForm.product) ? saleForm.product : "__outro"} onChange={(event) => setSaleForm({ ...saleForm, product: event.target.value === "__outro" ? "" : event.target.value })}>{PRODUCTS.map((product) => <option key={product}>{product}</option>)}{!PRODUCTS.includes(saleForm.product) && <option value="__outro">{saleForm.product || "Outro produto"}</option>}</select></label>
                <label>Status<select value={saleForm.status} onChange={(event) => setSaleForm({ ...saleForm, status: event.target.value as HubSale["status"] })}><option>Pendente</option><option>OK</option></select></label>
                <label className="full-field">Pagamento<select value={saleForm.payment} onChange={(event) => setSaleForm(withPayment(saleForm, { payment: event.target.value }))}>
                  <option value="">Informar o líquido manualmente</option>
                  <option value="pix">PIX ou boleto (sem taxa)</option>
                  {CARD_FEES.map((fee, index) => <option key={fee} value={String(index + 1)}>Cartão {index + 1}x · taxa {fee.toLocaleString("pt-BR")}%</option>)}
                </select></label>
                <label>Valor bruto (R$)<input required inputMode="decimal" value={saleForm.gross} onChange={(event) => setSaleForm(withPayment(saleForm, { gross: event.target.value }))} placeholder="1.500,00" /></label>
                <label>Valor líquido (R$)<input inputMode="decimal" value={saleForm.net} onChange={(event) => setSaleForm({ ...saleForm, net: event.target.value })} placeholder="Igual ao bruto se vazio" /></label>
                {saleForm.payment && saleForm.payment !== "pix" && Number.isFinite(parseMoney(saleForm.gross)) && (
                  <small className="full-field sale-fee-hint">
                    Taxa de {CARD_FEES[Number(saleForm.payment) - 1].toLocaleString("pt-BR")}% no cartão {saleForm.payment}x: − {hubMoney(parseMoney(saleForm.gross) - netAfterCardFee(parseMoney(saleForm.gross), Number(saleForm.payment)))}. Descontos como o da audiência: tire do líquido.
                  </small>
                )}
                <div className="consultant-picker full-field">
                  <span>Consultor(es)</span>
                  <div>
                    {activeConsultants.length === 0 && <small>Nenhum consultor cadastrado. Cadastre em "Consultores".</small>}
                    {Array.from(new Set([...activeConsultants.map((item) => item.nome), ...saleForm.consultants])).map((name) => (
                      <button type="button" aria-pressed={saleForm.consultants.includes(name)} className={saleForm.consultants.includes(name) ? "selected" : ""} key={name} onClick={() => toggleFormConsultant(name)}>{name}</button>
                    ))}
                  </div>
                </div>
                <label className="checkbox-label full-field"><input type="checkbox" checked={saleForm.cbk} onChange={(event) => setSaleForm({ ...saleForm, cbk: event.target.checked })} /> Houve chargeback (CBK)</label>
                <label className="full-field">Observação<textarea value={saleForm.note} maxLength={1000} onChange={(event) => setSaleForm({ ...saleForm, note: event.target.value })} /></label>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setSaleForm(null)}>Cancelar</Button>
                <Button type="submit" disabled={createVenda.isPending || updateVenda.isPending}>{createVenda.isPending || updateVenda.isPending ? "Salvando..." : "Salvar venda"}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={consultantsOpen} onOpenChange={setConsultantsOpen}>
        <DialogContent className="hub-dialog">
          <DialogHeader>
            <DialogTitle>Consultores</DialogTitle>
            <DialogDescription>Quem aparece para escolher nas vendas. {isAdmin ? "Remover tira da lista, mas as vendas antigas continuam com o nome." : "Só um administrador pode remover consultores."}</DialogDescription>
          </DialogHeader>
          {consultoresQuery.data && !consultoresQuery.data.ready && <p className="form-message">A lista de consultores ainda não existe no banco. Rode o arquivo supabase/migrations/20261010_melhorias.sql no Supabase.</p>}
          <form className="add-consultant" onSubmit={(event) => { event.preventDefault(); if (newConsultant.trim()) addConsultant.mutate({ nome: newConsultant.trim() }); }}>
            <input aria-label="Nome do novo consultor" placeholder="Nome do novo consultor" value={newConsultant} onChange={(event) => setNewConsultant(event.target.value)} />
            <button className="hub-primary" type="submit" disabled={addConsultant.isPending} aria-label="Cadastrar consultor"><Plus size={16} /></button>
          </form>
          <div className="consultant-list">
            {activeConsultants.length === 0 && <div>Nenhum consultor cadastrado.</div>}
            {activeConsultants.map((item) => (
              <div key={item.id}>
                <span>{item.nome}</span>
                {isAdmin && item.id > 0 && <button type="button" className="icon-button" disabled={removeConsultant.isPending} onClick={() => removeConsultant.mutate({ id: item.id })} aria-label={`Remover ${item.nome}`} title="Remover"><X size={15} /></button>}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={saleToDelete !== null} onOpenChange={(open) => !open && !deleteVenda.isPending && setSaleToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar esta venda?</AlertDialogTitle>
            <AlertDialogDescription>{saleToDelete && `${saleToDelete.client} · ${saleToDelete.date} · ${hubMoney(saleToDelete.gross)}. A venda sai do painel e dos relatórios. O backup diário guarda uma cópia.`}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteVenda.isPending}>Cancelar</AlertDialogCancel>
            <Button variant="destructive" disabled={deleteVenda.isPending} onClick={() => saleToDelete && deleteVenda.mutate({ id: saleToDelete.id })}><Trash2 size={16} />{deleteVenda.isPending ? "Apagando..." : "Apagar venda"}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  const evolutionChart = (
    <div className="hub-panel">
      <div className="hub-panel-heading">
        <div><h3>Evolução — últimos 12 meses</h3><p>Bruto e líquido por mês{section === "comercial" || section === "juridico" ? ` · ${SECTOR_LABEL[section]}` : ""}{consultant !== "Todos" ? ` · ${consultant}` : ""}</p></div>
        <div className="hub-chart-tools">
          <span className="hub-legend"><i className="hub-swatch-gross" /> Bruto <i className="hub-swatch-net" /> Líquido</span>
          <button type="button" className="icon-button" aria-pressed={showChartTable} onClick={() => setShowChartTable((value) => !value)} title={showChartTable ? "Ver gráfico" : "Ver como tabela"} aria-label={showChartTable ? "Ver gráfico" : "Ver como tabela"}><Table2 size={16} /></button>
        </div>
      </div>
      {showChartTable ? (
        <div className="table-wrap"><table className="hub-mini-table"><thead><tr><th>Mês</th><th>Vendas</th><th>Bruto</th><th>Líquido</th></tr></thead><tbody>{evolution.map((point) => <tr key={point.month}><td>{capitalize(monthLabel(point.month))}</td><td>{point.count}</td><td>{hubMoney(point.gross)}</td><td>{hubMoney(point.net)}</td></tr>)}</tbody></table></div>
      ) : evolutionMax === 0 ? (
        <p className="hub-chart-empty">Nenhuma venda nos últimos 12 meses{consultant !== "Todos" ? ` para ${consultant}` : ""}.</p>
      ) : (
        // Keyed on sector and consultant so the bars grow from the baseline again when those filters change.
        <div className="hub-evolution" key={`${sector}-${consultant}`} onMouseLeave={() => setHoveredMonth(null)}>
          {evolution.map((point, index) => (
            <div
              key={point.month}
              className={`hub-evolution-month ${hoveredMonth === index ? "is-hovered" : ""} ${point.month === month ? "is-selected" : ""}`}
              tabIndex={0}
              role="img"
              aria-label={`${monthLabel(point.month)}: ${point.count} venda(s), bruto ${hubMoney(point.gross)}, líquido ${hubMoney(point.net)}`}
              onMouseEnter={() => setHoveredMonth(index)}
              onFocus={() => setHoveredMonth(index)}
              onBlur={() => setHoveredMonth(null)}
              onClick={() => setMonth(point.month)}
            >
              <div className="hub-evolution-bars">
                <span className="hub-bar-gross" style={{ height: `${(point.gross / evolutionMax) * 100}%` }} />
                <span className="hub-bar-net" style={{ height: `${(point.net / evolutionMax) * 100}%` }} />
              </div>
              <small>{point.label}</small>
              {hoveredMonth === index && (
                <div className={`hub-tooltip ${index > 8 ? "hub-tooltip-left" : ""}`} role="presentation">
                  <strong>{capitalize(monthLabel(point.month))}</strong>
                  <span><i className="hub-swatch-gross" /> Bruto <b>{hubMoney(point.gross)}</b></span>
                  <span><i className="hub-swatch-net" /> Líquido <b>{hubMoney(point.net)}</b></span>
                  <span>{point.count} venda(s) · clique para ver o mês</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const heatPanel = (
    <div className="hub-panel heatmap-panel">
      <div className="hub-panel-heading"><div><h3>Horários das vendas</h3><p>Dia da semana × período do dia · {periodText}</p></div></div>
      <div className="heatmap" role="table" aria-label="Vendas por dia da semana e período do dia">
        <div role="row" className="heatmap-head"><small /> {DAY_PERIODS.map((period) => <small key={period} role="columnheader">{period}</small>)}</div>
        {WEEKDAYS.map((day, row) => (
          <div key={day} role="row">
            <small role="rowheader">{day}</small>
            {DAY_PERIODS.map((period, cell) => {
              const count = heat.grid[row][cell];
              return <i key={period} role="cell" className={`heat-${heatLevel(count, heat.max)}`} title={`${day}, ${period.toLowerCase()}: ${count} venda(s)`} aria-label={`${day}, ${period.toLowerCase()}: ${count} venda(s)`} />;
            })}
          </div>
        ))}
      </div>
      <p className="heatmap-caption">{heat.peak ? <>Pico: <b>{heat.peak.count} venda(s)</b> na {DAY_PERIODS[heat.peak.period].toLowerCase()} de {WEEKDAYS[heat.peak.weekday].toLowerCase()}.</> : "Sem vendas no período."} Madrugada 0h–6h · manhã 6h–12h · tarde 12h–18h · noite 18h–24h.</p>
    </div>
  );

  if (section === "vendas") {
    return (
      <div className="hub-dashboard">
        {tabs}
        <SalesManager
          key={salesSector}
          initialSector={salesSector}
          actions={actions}
          sales={sales}
          loading={loading}
          consultantOptions={consultantOptions}
          isAdmin={isAdmin}
          month={month}
          monthControl={monthControl}
          onEdit={openEditSale}
          onDelete={setSaleToDelete}
          onMarkPaid={markPaid}
          markingPaid={updateVenda.isPending}
          onChargeback={(sale) => onChargeback({ client: sale.client, amount: sale.gross, vendaId: sale.id, note: [sale.product, `venda de ${sale.date}`].filter(Boolean).join(" · ") })}
        />
        {dialogs}
      </div>
    );
  }

  if (section === "control") {
    const all = bySector.todos;
    return (
      <div className="hub-dashboard">
        {tabs}
        {toolbar(false)}
        <section className="control-dashboard">
          <div className="control-metrics">
            <HubMetric label="Bruto consolidado" amount={all.gross} format={hubMoney} detail={`${all.count} vendas · ticket ${all.ticket === null ? "—" : hubMoney(all.ticket)}`} tone="gold" />
            <HubMetric label="Líquido" amount={all.net} format={hubMoney} detail={`Margem líquida ${hubPercent(all.netShare)}`} tone="green" />
            <HubMetric label="Chargebacks" amount={all.cbkNet} format={hubMoney} detail={`${all.cbkCount} caso(s) · taxa ${hubPercent(all.count ? all.cbkCount / all.count : null)}`} tone="red" />
            <HubMetric label="Resultado líquido final" amount={all.resultado} format={hubMoney} detail="Líquido − perda com CBK" tone="gold" />
          </div>
          <section className="control-panel">
            <h3>Distribuição do faturamento</h3>
            <p>Participação de cada setor sobre o bruto</p>
            {(["comercial", "juridico"] as const).map((key) => (
              <div className="distribution-row" key={key}>
                <span>{SECTOR_LABEL[key]}</span>
                <div><i style={{ width: `${(sectorShare(bySector[key].gross) ?? 0) * 100}%` }} /></div>
                <strong>{hubMoney(bySector[key].gross)} · {hubPercent(sectorShare(bySector[key].gross))}</strong>
              </div>
            ))}
          </section>
          <div className="control-sector-grid">
            {(["comercial", "juridico"] as const).map((key) => {
              const data = bySector[key];
              return (
                <section className="control-sector" key={key}>
                  <h3>{SECTOR_LABEL[key]}</h3>
                  <p>{data.count} venda(s) · ticket médio {data.ticket === null ? "—" : hubMoney(data.ticket)}</p>
                  <div><span>Bruto <b>{hubMoney(data.gross)}</b></span><span>Líquido <b>{hubMoney(data.net)}</b></span><span>Margem líquida <b>{hubPercent(data.netShare)}</b></span></div>
                  <hr />
                  <p>Exposição a chargebacks</p>
                  <div><span>QTD CBK <b>{data.cbkCount}</b></span><span>VALOR CBK <b>{hubMoney(data.cbkNet)}</b></span></div>
                </section>
              );
            })}
          </div>
        </section>
        <section className="hub-analytics">{evolutionChart}{heatPanel}</section>
        {salesTable}
        {dialogs}
      </div>
    );
  }

  return (
    <div className="hub-dashboard">
      {tabs}
      {toolbar(true)}
      <div className="hub-metrics">
        <HubMetric label="Vendas" value={loading ? "…" : undefined} amount={current.count} format={formatCount} detail={`${hubPercent(sectorShare(bySector[sector === "todos" ? "todos" : sector].gross))} do bruto da empresa`} tone="blue" />
        <HubMetric label="Bruto" amount={current.gross} format={hubMoney} detail={current.ticket === null ? "Sem vendas" : `Ticket médio ${hubMoney(current.ticket)}`} tone="green" />
        <HubMetric label="Líquido" amount={current.net} format={hubMoney} detail={current.netShare === null ? "Sem vendas" : `${hubPercent(current.netShare)} do bruto`} tone="gold" />
        <HubMetric label="Chargebacks" amount={current.cbkCount} format={formatCount} detail={current.cbkCount ? `Perda de ${hubMoney(current.cbkNet)}` : "Nenhum chargeback no período"} tone="red" />
      </div>
      <section className="hub-panel ranking-panel">
        <div className="hub-panel-heading">
          <div>
            <h3><Trophy size={17} /> Ranking de consultores</h3>
            <p>{consultant !== "Todos" ? `${consultant} selecionado · tabela filtrada` : "Clique em um consultor para filtrar a tabela"}</p>
            {consultant !== "Todos" && <button type="button" className="ranking-clear" onClick={() => setConsultant("Todos")}>Limpar seleção <X size={13} /></button>}
          </div>
        </div>
        {rankingItems.length === 0 ? <p className="hub-chart-empty">Nenhuma venda com consultor em {periodText}.</p> : (
          <div className="ranking-grid">
            {rankingItems.slice(0, 9).map((item, index) => (
              <button type="button" className={`ranking-card ${consultant === item.name ? "selected" : ""}`} aria-pressed={consultant === item.name} key={item.name} onClick={() => selectRanking(item.name)}>
                <div><b>#{index + 1}</b><strong>{item.name}</strong><small>{item.count} venda(s)</small></div>
                <span>Bruto <b>{hubMoney(item.gross)}</b></span>
                <span>Líquido <b>{hubMoney(item.net)}</b></span>
                <i style={{ width: `${Math.min(100, (item.net / Math.max(1, rankingItems[0]?.net || 1)) * 100)}%` }} />
              </button>
            ))}
          </div>
        )}
      </section>
      <section className="hub-analytics">{evolutionChart}{heatPanel}</section>
      {salesTable}
      {dialogs}
    </div>
  );
}

/** `value` (e.g. "…" while loading) wins over `amount`, which counts up with `format`. */
function HubMetric({ label, value, amount, format, detail, tone }: { label: string; value?: string; amount: number; format: (value: number) => string; detail: string; tone: string }) {
  return <div className={`hub-metric hub-metric-${tone}`}><span>{label}</span><strong>{value ?? <CountUp value={amount} format={format} />}</strong><small>{detail}</small></div>;
}

/** Whole numbers while counting up; the last frame is the exact count, same as String(count). */
const formatCount = (value: number) => String(Math.round(value));
