import { FormEvent, useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, ChevronDown, ChevronRight, FileText, History, Link2, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { CHARGEBACK_PERIODS, CHARGEBACK_STATUSES, brToIsoDate, chargebackDate, inDateRange, isoToBrDate, parseBrlInput, periodRange, saoPauloDate, summarizeChargebacks, type ChargebackDraft, type ChargebackHistoryEntry, type ChargebackPeriod, type ChargebackStatus } from "@shared/chargebacks";
import { CHARGEBACK_LIST_FILTERS, type ChargebackListFilter } from "@shared/dashboard";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ListFilterBar, StatusPill } from "./Home";
import { hubMoney } from "./salesHubData";
import { usePagination } from "@/lib/pagination";
import { Pager } from "@/components/Pager";

type Chargeback = {
  id: number; client: string; bank: string; amount: string; deadline: string; status: string; tone: string;
  clienteId: number | null; vendaId: number | null; observacao: string; atualizadoEm: string | null; createdAt: string | null; historico: ChargebackHistoryEntry[];
  /** Contestation date, or the day it was registered (AAAA-MM-DD). The period filter goes by this. */
  date: string;
};
type Form = { id?: number; client: string; clienteId: number | null; vendaId: number | null; bank: string; amount: string; deadline: string; oldDeadline: string; status: ChargebackStatus; observacao: string };

const csvCell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
const formatPercent = (value: number | null) => (value === null ? "—" : `${(value * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
const formatDateTime = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const initials = (name: string) => name.split(" ").filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
const emptyForm = (): Form => ({ client: "", clienteId: null, vendaId: null, bank: "", amount: "", deadline: "", oldDeadline: "", status: "Em conferência", observacao: "" });

function toChargeback(row: Record<string, unknown>): Chargeback {
  return {
    id: Number(row.id),
    client: String(row.client ?? ""),
    bank: String(row.bank ?? ""),
    amount: String(row.amount ?? ""),
    deadline: String(row.deadline ?? ""),
    status: String(row.status ?? ""),
    tone: String(row.tone ?? "blue"),
    clienteId: typeof row.cliente_id === "number" ? row.cliente_id : null,
    vendaId: typeof row.venda_id === "number" ? row.venda_id : null,
    observacao: String(row.observacao ?? ""),
    atualizadoEm: typeof row.atualizado_em === "string" ? row.atualizado_em : null,
    createdAt: typeof row.created_at === "string" ? row.created_at : null,
    historico: Array.isArray(row.historico) ? (row.historico as ChargebackHistoryEntry[]) : [],
    date: chargebackDate(row),
  };
}

const DATE_BASIS_HINT = "Vale a data da contestação; sem ela, a data de registro.";

/** Sits next to the search field. The trigger always says which period the whole page is showing. */
function PeriodFilter({ period, onChange, from, to, onFrom, onTo, rangeText }: {
  period: ChargebackPeriod;
  onChange: (period: ChargebackPeriod) => void;
  from: string;
  to: string;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
  rangeText: string;
}) {
  const [open, setOpen] = useState(false);
  const label = CHARGEBACK_PERIODS.find((option) => option.id === period)?.label;
  const custom = period === "personalizado";
  const detail = rangeText || (custom ? "Escolha as datas" : "");
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <button type="button" className={`cbk-period-trigger${period !== "todos" ? " is-active" : ""}`} aria-label={`Período: ${[label, detail].filter(Boolean).join(", ")}`}>
        <CalendarDays size={16} aria-hidden="true" />
        <span>{label}</span>
        {detail && <small>{detail}</small>}
        <ChevronDown size={15} className="cbk-period-chevron" aria-hidden="true" />
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" sideOffset={6} className="cbk-period-menu">
      <div className="cbk-period-options" role="group" aria-label="Período">
        {CHARGEBACK_PERIODS.map((option) => <button key={option.id} type="button" aria-pressed={period === option.id} className={period === option.id ? "is-selected" : ""} onClick={() => { onChange(option.id); if (option.id !== "personalizado") setOpen(false); }}>
          {option.label}
          {period === option.id && <Check size={15} aria-hidden="true" />}
        </button>)}
      </div>
      {/* Stays mounted so it can slide open; hidden from the keyboard while closed (see the CSS). */}
      <div className={`cbk-period-custom${custom ? " is-open" : ""}`}>
        <div className="cbk-period-dates">
          <label>De<input type="date" value={from} onChange={(event) => onFrom(event.target.value)} /></label>
          <label>Até<input type="date" value={to} onChange={(event) => onTo(event.target.value)} /></label>
        </div>
      </div>
      <small className="cbk-period-hint">{DATE_BASIS_HINT}</small>
    </PopoverContent>
  </Popover>;
}

export default function ChargebacksPage({ listFilter, onClearFilter, isAdmin, draft, onDraftUsed, onOpenClient }: {
  listFilter: ChargebackListFilter | null;
  onClearFilter: () => void;
  isAdmin: boolean;
  /** Filled in by the Sales HUB when a sale is marked with chargeback. */
  draft: ChargebackDraft | null;
  onDraftUsed: () => void;
  onOpenClient: (row: Record<string, unknown>) => void;
}) {
  const utils = trpc.useUtils();
  const chargebacksQuery = trpc.portal.chargebacks.useQuery(undefined, { retry: false });
  const dashboardQuery = trpc.portal.dashboard.useQuery(undefined, { retry: false });
  const clientesQuery = trpc.portal.clientes.useQuery(undefined, { retry: false });
  const clientes = (clientesQuery.data ?? []) as Record<string, unknown>[];
  const cbSummary = dashboardQuery.data?.chargebacks;
  const reversao = dashboardQuery.data?.metrics.reversao;

  const refresh = () => Promise.all([utils.portal.chargebacks.invalidate(), utils.portal.dashboard.invalidate()]);
  const createChargeback = trpc.portal.createChargeback.useMutation();
  const updateChargeback = trpc.portal.updateChargeback.useMutation();
  const deleteChargeback = trpc.portal.deleteChargeback.useMutation({
    onSuccess: () => { toast.success("Chargeback apagado."); setToDelete(null); setSelectedId(null); refresh(); },
    onError: (error) => toast.error(error.message),
  });

  const chargebackList = useMemo(
    () => ((chargebacksQuery.data ?? []) as Record<string, unknown>[]).map(toChargeback).sort((a, b) => b.id - a.id),
    [chargebacksQuery.data],
  );
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = chargebackList.find((item) => item.id === selectedId) ?? null;
  const [form, setForm] = useState<Form | null>(null);
  const [toDelete, setToDelete] = useState<Chargeback | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("todos");
  const [period, setPeriod] = useState<ChargebackPeriod>("todos");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  // A sale marked with chargeback in the Sales HUB arrives here as a prefilled form.
  useEffect(() => {
    if (!draft || clientesQuery.isLoading) return;
    const cliente = clientes.find((row) => String(row.name ?? "").trim().toLowerCase() === draft.client.trim().toLowerCase());
    setForm({
      ...emptyForm(),
      client: draft.client,
      clienteId: typeof cliente?.id === "number" ? cliente.id : null,
      vendaId: draft.vendaId ?? null,
      amount: draft.amount !== undefined ? draft.amount.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "",
      observacao: draft.note ?? "",
    });
    onDraftUsed();
  }, [draft, clientes, clientesQuery.isLoading, onDraftUsed]);

  const filterIds = listFilter ? dashboardQuery.data?.listas.chargebacks[listFilter] : undefined;
  const range = periodRange(period, saoPauloDate(new Date()), { from: customFrom, to: customTo });
  const periodActive = !!(range.from || range.to);
  const rangeKey = `${range.from}|${range.to}`;
  const inPeriod = chargebackList.filter((item) => inDateRange(item.date, range));
  // With no period the cards keep the dashboard's numbers, so both screens always agree.
  const periodSummary = periodActive ? summarizeChargebacks(inPeriod) : null;
  const revertidos = periodSummary ? periodSummary.revertidos : reversao?.revertidos;
  const encerrados = periodSummary ? periodSummary.encerrados : reversao?.encerrados;
  const rangeText = range.from && range.to ? `${isoToBrDate(range.from)} a ${isoToBrDate(range.to)}` : range.from ? `A partir de ${isoToBrDate(range.from)}` : range.to ? `Até ${isoToBrDate(range.to)}` : "";
  const visible = inPeriod.filter((item) => {
    if (listFilter && !(filterIds ?? []).includes(item.id)) return false;
    if (statusFilter !== "todos" && item.status !== statusFilter) return false;
    const term = query.trim().toLowerCase();
    return !term || item.client.toLowerCase().includes(term) || item.bank.toLowerCase().includes(term);
  });
  const pagination = usePagination(visible, `${query}|${statusFilter}|${listFilter}|${rangeKey}`);
  // Old rows may carry a status that is not on the list anymore; they still get a filter button.
  const statusOptions = Array.from(new Set([...CHARGEBACK_STATUSES.map((status) => status.label), ...chargebackList.map((item) => item.status).filter(Boolean)]));

  function exportReport() {
    const rows = [
      ["Cliente", "Instituição", "Data", "Valor estimado", "Prazo", "Status", "Observação", "Última alteração"],
      ...visible.map((item) => [item.client, item.bank, item.date ? isoToBrDate(item.date) : "", item.amount, item.deadline, item.status, item.observacao, item.atualizadoEm ? formatDateTime(item.atualizadoEm) : ""]),
    ];
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([`﻿${rows.map((row) => row.map(csvCell).join(";")).join("\r\n")}`], { type: "text/csv;charset=utf-8" }));
    link.download = "solicitacoes-chargeback.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function openEdit(item: Chargeback) {
    const iso = brToIsoDate(item.deadline);
    setForm({
      id: item.id, client: item.client, clienteId: item.clienteId, vendaId: item.vendaId, bank: item.bank,
      amount: item.amount.replace(/^R\$\s*/, ""), deadline: iso, oldDeadline: iso ? "" : item.deadline,
      status: (CHARGEBACK_STATUSES.some((status) => status.label === item.status) ? item.status : "Em conferência") as ChargebackStatus,
      observacao: item.observacao,
    });
  }

  function setClientName(name: string) {
    const cliente = clientes.find((row) => String(row.name ?? "") === name);
    setForm((current) => current && { ...current, client: name, clienteId: typeof cliente?.id === "number" ? cliente.id : null });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    if (!form.client.trim()) return toast.error("Informe o cliente.");
    const amount = form.amount.trim() ? parseBrlInput(form.amount) : null;
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) return toast.error("O valor não é um número válido. Use, por exemplo, 1.500,00.");
    const payload = {
      client: form.client.trim(), clienteId: form.clienteId, vendaId: form.vendaId, bank: form.bank.trim(), amount,
      deadline: form.deadline || null, status: form.status, observacao: form.observacao.trim(),
    };
    try {
      if (form.id) await updateChargeback.mutateAsync({ id: form.id, ...payload });
      else {
        const created = await createChargeback.mutateAsync(payload);
        if (created && typeof created.id === "number") setSelectedId(created.id);
      }
      toast.success(form.id ? "Chargeback atualizado." : "Chargeback registrado.");
      setForm(null);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar o chargeback.");
    }
  }

  function openClient(id: number) {
    const row = clientes.find((item) => item.id === id);
    if (row) onOpenClient(row);
  }

  const saving = createChargeback.isPending || updateChargeback.isPending;

  return <div className="page-content">
    <div className="chargeback-summary"><div title={periodSummary ? "Soma dos chargebacks revertidos dentro do período." : "Soma dos chargebacks revertidos registrados neste ano."}><span>{periodSummary ? "Valor recuperado no período" : `Valor recuperado em ${cbSummary?.ano ?? new Date().getFullYear()}`}</span><strong key={rangeKey} className="cbk-value-in">{periodSummary ? hubMoney(periodSummary.recuperado) : cbSummary ? hubMoney(cbSummary.recuperadoNoAno) : "…"}</strong><small>{revertidos !== undefined ? `${revertidos} caso(s) revertido(s)` : "Calculando..."}</small></div><div title="Chargebacks que ainda não foram revertidos nem negados."><span>Solicitações abertas</span><strong key={rangeKey} className="cbk-value-in">{periodSummary ? periodSummary.abertos : cbSummary ? cbSummary.abertos : "…"}</strong><small>{inPeriod.length} registrada(s) {periodSummary ? "no período" : "no total"}</small></div><div title="Revertidos dentre os já encerrados (revertidos + negados)."><span>Taxa de sucesso</span><strong key={rangeKey} className="cbk-value-in">{periodSummary ? formatPercent(periodSummary.taxaSucesso) : cbSummary ? formatPercent(cbSummary.taxaSucesso) : "…"}</strong><small>{encerrados !== undefined ? (encerrados ? `${revertidos} de ${encerrados} encerrados` : periodSummary ? "Nenhum caso encerrado no período" : "Nenhum caso encerrado ainda") : "Calculando..."}</small></div></div>

    <div className="page-actions">
      <div className="cbk-filters">
        <div className="search-field">
          <Search size={17} />
          <input placeholder="Buscar por cliente ou instituição" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <PeriodFilter period={period} onChange={setPeriod} from={customFrom} to={customTo} onFrom={setCustomFrom} onTo={setCustomTo} rangeText={rangeText} />
      </div>
      <button className="primary-button" onClick={() => setForm(emptyForm())}><Plus size={16} /> Novo chargeback</button>
    </div>

    <section className="panel table-panel">
      <div className="panel-heading">
        <div><h3>Solicitações de chargeback</h3><p>Acompanhe devoluções e recuperações financeiras</p></div>
        <button className="secondary-button" onClick={exportReport}><FileText size={16} /> Exportar CSV</button>
      </div>
      <div className="filter-buttons cbk-status-filters">
        <button className={statusFilter === "todos" ? "filter-active" : ""} onClick={() => setStatusFilter("todos")}>Todos <b>{inPeriod.length}</b></button>
        {statusOptions.map((status) => {
          const count = inPeriod.filter((item) => item.status === status).length;
          // The chosen status stays on screen even at zero, so changing the period doesn't hide what is filtering the list.
          return (count > 0 || statusFilter === status) && <button key={status} className={statusFilter === status ? "filter-active" : ""} onClick={() => setStatusFilter(status)}>{status} <b>{count}</b></button>;
        })}
      </div>
      {listFilter && <ListFilterBar label={CHARGEBACK_LIST_FILTERS[listFilter]} count={filterIds ? visible.length : undefined} noun="chargeback(s)" onClear={onClearFilter} />}
      <div className="table-wrap"><table>
        <thead><tr><th>Cliente</th><th>Instituição</th><th title={DATE_BASIS_HINT}>Data</th><th>Valor estimado</th><th>Prazo</th><th>Status</th><th /></tr></thead>
        <tbody>
          {visible.length === 0 && <tr className="empty-row"><td colSpan={7}>{chargebacksQuery.isLoading || (listFilter && !filterIds) ? "Carregando..." : chargebackList.length === 0 ? "Nenhum chargeback registrado. Use \"Novo chargeback\" para registrar o primeiro." : "Nenhum chargeback nesta situação."}</td></tr>}
          {pagination.visible.map((item) => <tr key={item.id} onClick={() => setSelectedId(item.id)}>
            <td><div className="table-person"><span className="avatar avatar-gradient">{initials(item.client)}</span><strong>{item.client}</strong></div></td>
            <td>{item.bank || "—"}</td>
            <td className="muted-cell">{item.date ? isoToBrDate(item.date) : "—"}</td>
            <td><strong>{item.amount || "—"}</strong></td>
            <td className="muted-cell">{item.deadline || "—"}</td>
            <td><StatusPill tone={item.tone}>{item.status || "Sem status"}</StatusPill></td>
            <td><button className="row-more icon-button" aria-label={`Ver solicitação de ${item.client}`} onClick={(event) => { event.stopPropagation(); setSelectedId(item.id); }}><ChevronRight size={17} /></button></td>
          </tr>)}
        </tbody>
      </table></div>
      <Pager {...pagination} noun="chargebacks" />
    </section>

    {selected && <div className="detail-drawer cbk-drawer">
      <button className="drawer-close icon-button" onClick={() => setSelectedId(null)} aria-label="Fechar detalhes"><X size={18} /></button>
      <span className="eyebrow eyebrow-muted">Solicitação de chargeback</span>
      <div className="drawer-person"><span className="avatar avatar-large avatar-gradient">{initials(selected.client)}</span><div><h2>{selected.client}</h2><p>{selected.bank || "Instituição não informada"}</p></div></div>
      <StatusPill tone={selected.tone}>{selected.status || "Sem status"}</StatusPill>
      <div className="cbk-drawer-actions">
        <button type="button" className="secondary-button" onClick={() => openEdit(selected)}><Pencil size={15} /> Editar</button>
        {isAdmin && <button type="button" className="secondary-button cbk-delete" onClick={() => setToDelete(selected)}><Trash2 size={15} /> Apagar</button>}
      </div>
      <div className="drawer-section"><span>Valor estimado</span><strong>{selected.amount || "—"}</strong></div>
      <div className="drawer-section"><span>Prazo</span><strong>{selected.deadline || "—"}</strong></div>
      {selected.observacao && <div className="drawer-section"><span>Observação</span><p className="cbk-note">{selected.observacao}</p></div>}
      {(selected.clienteId || selected.vendaId) && <div className="drawer-section"><span>Ligações</span>
        {selected.clienteId && <button type="button" className="inline-link cbk-link" onClick={() => openClient(selected.clienteId!)}><Link2 size={14} /> Abrir cadastro do cliente</button>}
        {selected.vendaId && <small className="cbk-muted">Venda #{selected.vendaId} no Sales HUB</small>}
      </div>}
      <div className="drawer-section"><span><History size={14} /> Histórico</span>
        {selected.historico.length === 0 && <small className="cbk-muted">{selected.createdAt ? `Registrado em ${formatDateTime(selected.createdAt)}. Alterações feitas a partir de agora aparecem aqui.` : "Nenhuma alteração registrada."}</small>}
        <ol className="cbk-history">{[...selected.historico].reverse().map((entry, index) => <li key={`${entry.at}-${index}`}><strong>{entry.acao}</strong><small>{formatDateTime(entry.at)} · {entry.autor}</small></li>)}</ol>
      </div>
    </div>}

    <Dialog open={form !== null} onOpenChange={(open) => !open && !saving && setForm(null)}>
      <DialogContent className="hub-dialog">
        {form && <form onSubmit={save}>
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar chargeback" : "Novo chargeback"}</DialogTitle>
            <DialogDescription>{form.vendaId && !form.id ? "Preenchido com os dados da venda marcada com CBK no Sales HUB. Confira e complete." : "Os números do painel são atualizados assim que você salvar."}</DialogDescription>
          </DialogHeader>
          <div className="new-sale-grid">
            <label className="full-field">Cliente
              <input required list="cbk-clientes" value={form.client} onChange={(event) => setClientName(event.target.value)} placeholder="Escolha da lista ou digite o nome" />
              <small className="cbk-hint">{form.clienteId ? "Ligado ao cadastro do cliente." : "Escolha um nome da lista para ligar ao cadastro do cliente."}</small>
            </label>
            <datalist id="cbk-clientes">{clientes.map((row) => <option key={String(row.id)} value={String(row.name ?? "")} />)}</datalist>
            <label>Instituição (banco)<input value={form.bank} onChange={(event) => setForm({ ...form, bank: event.target.value })} placeholder="Ex.: Nubank" /></label>
            <label>Valor estimado (R$)<input inputMode="decimal" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="1.500,00" /></label>
            <label>Prazo<input type="date" value={form.deadline} onChange={(event) => setForm({ ...form, deadline: event.target.value, oldDeadline: "" })} />
              {form.oldDeadline && <small className="cbk-hint">Prazo anterior: {form.oldDeadline}. Escolha a data de novo para mantê-lo.</small>}
            </label>
            <label>Status<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as ChargebackStatus })}>{CHARGEBACK_STATUSES.map((status) => <option key={status.label}>{status.label}</option>)}</select></label>
            <label className="full-field">Observação<textarea value={form.observacao} maxLength={2000} onChange={(event) => setForm({ ...form, observacao: event.target.value })} placeholder="Número do protocolo, o que foi enviado ao banco, próximos passos..." /></label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setForm(null)}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? "Salvando..." : form.id ? "Salvar alterações" : "Registrar chargeback"}</Button>
          </DialogFooter>
        </form>}
      </DialogContent>
    </Dialog>

    <AlertDialog open={toDelete !== null} onOpenChange={(open) => !open && setToDelete(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Apagar chargeback?</AlertDialogTitle>
          <AlertDialogDescription>O chargeback de {toDelete?.client} sai da lista e dos números do painel. Não dá para desfazer, a não ser pelo backup diário.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <Button variant="destructive" disabled={deleteChargeback.isPending} onClick={() => toDelete && deleteChargeback.mutate({ id: toDelete.id })}>{deleteChargeback.isPending ? "Apagando..." : "Apagar"}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}
