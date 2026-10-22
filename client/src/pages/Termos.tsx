import { useMemo, useState } from "react";
import { CheckCircle2, ChevronRight, Clock3, FileCheck2, Search, Send, UserX, Users } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { showAccessResult } from "@/lib/accessToast";
import { usePagination } from "@/lib/pagination";
import { Pager } from "@/components/Pager";
import { StatusPill } from "./Home";

type Situation = "aceito" | "versao-antiga" | "sem-aceite" | "primeiro-acesso" | "link-expirado" | "sem-login";
type Filter = "todos" | "pendentes" | Situation;

const SITUATIONS: Record<Situation, { label: string; tone: string; help: string }> = {
  aceito: { label: "Aceitou", tone: "green", help: "Aceitou a versão atual dos termos." },
  "versao-antiga": { label: "Versão antiga", tone: "yellow", help: "Aceitou uma versão anterior. Vai ver os termos novos no próximo acesso." },
  "sem-aceite": { label: "Entrou, não aceitou", tone: "yellow", help: "Criou a senha, mas ainda não aceitou os termos." },
  "primeiro-acesso": { label: "Aguardando 1º acesso", tone: "blue", help: "Recebeu o link, mas ainda não criou a senha." },
  "link-expirado": { label: "Link expirado", tone: "red", help: "O link de primeiro acesso venceu sem ser usado. Reenvie o acesso." },
  "sem-login": { label: "Sem login", tone: "red", help: "Ainda não tem acesso ao portal. Precisa de e-mail cadastrado." },
};
const PENDING: Situation[] = ["primeiro-acesso", "link-expirado", "sem-aceite", "versao-antiga"];

const formatInt = (value: number) => value.toLocaleString("pt-BR");
const formatPercent = (value: number | null) => (value === null ? "—" : `${(value * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "America/Sao_Paulo" }) : "—");
const formatDateTime = (iso: string) => `${formatDate(iso)} ${new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}`;
const daysSince = (iso: string | null) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / 86_400_000) : null);
function formatHours(hours: number | null) {
  if (hours === null) return "—";
  if (hours < 1) return "menos de 1 h";
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.round(hours / 24)} dias`;
}

export default function TermosPage({ onOpenClient }: { onOpenClient: (row: Record<string, unknown>) => void }) {
  const reportQuery = trpc.portal.termos.useQuery(undefined, { retry: false, refetchInterval: 60_000 });
  const clientesQuery = trpc.portal.clientes.useQuery(undefined, { retry: false });
  const reenviarAcesso = trpc.portal.reenviarAcesso.useMutation({
    onSuccess: (result) => { showAccessResult(result, "Novo link gerado (o anterior deixou de valer)."); reportQuery.refetch(); },
    onError: (error) => toast.error(error.message),
  });
  const [filter, setFilter] = useState<Filter>("todos");
  const [query, setQuery] = useState("");

  const report = reportQuery.data;
  const t = report?.totals;
  const loading = "…";

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return (report?.clients ?? []).filter((row) => {
      if (filter === "pendentes" ? !PENDING.includes(row.situation) : filter !== "todos" && row.situation !== filter) return false;
      return !term || row.name.toLowerCase().includes(term) || (row.email ?? "").toLowerCase().includes(term);
    });
  }, [report, filter, query]);
  const pagination = usePagination(visible, `${filter}|${query}`);

  function openClient(id: number) {
    const row = (clientesQuery.data as Record<string, unknown>[] | undefined)?.find((item) => item.id === id);
    if (row) onOpenClient(row);
  }

  const kpis: { label: string; value: string; detail: string; icon: typeof Users; filter: Filter; alert?: boolean }[] = [
    { label: "Taxa de aceite", value: t ? formatPercent(t.percent) : loading, detail: t ? `${formatInt(t.accepted)} de ${formatInt(t.withLogin)} clientes com login` : "", icon: FileCheck2, filter: "aceito" },
    { label: "Aceitaram", value: t ? formatInt(t.accepted) : loading, detail: t ? `${formatInt(t.acceptedLast7Days)} nos últimos 7 dias` : "", icon: CheckCircle2, filter: "aceito" },
    { label: "Pendentes", value: t ? formatInt(t.pending) : loading, detail: t ? (t.pending ? "Têm login, mas ainda não aceitaram" : "Ninguém pendente") : "", icon: Clock3, filter: "pendentes", alert: (t?.pending ?? 0) > 0 },
    { label: "Sem login", value: t ? formatInt(t.withoutLogin) : loading, detail: t ? (t.withoutEmail ? `${formatInt(t.withoutEmail)} sem e-mail cadastrado` : "Todos têm e-mail") : "", icon: UserX, filter: "sem-login", alert: (t?.withoutLogin ?? 0) > 0 },
  ];

  const passwordCreated = t ? t.withLogin - t.awaitingFirstAccess - t.expiredLink : 0;
  const funnel = t ? [
    { label: "Clientes cadastrados", value: t.clients },
    { label: "Receberam login", value: t.withLogin },
    { label: "Criaram a senha", value: passwordCreated },
    { label: "Aceitaram os termos", value: t.accepted },
    { label: "Ativaram as notificações do app", value: t.withNotifications },
  ] : [];
  const maxDay = Math.max(1, ...(report?.days ?? []).map((day) => day.accepted));
  const reasons: Situation[] = ["primeiro-acesso", "link-expirado", "sem-aceite", "versao-antiga", "sem-login"];
  const countOf = (situation: Situation) => (report?.clients ?? []).filter((row) => row.situation === situation).length;

  const filters: { id: Filter; label: string; count: number }[] = [
    { id: "todos", label: "Todos", count: t?.clients ?? 0 },
    { id: "aceito", label: "Aceitaram", count: t?.accepted ?? 0 },
    { id: "pendentes", label: "Pendentes", count: t?.pending ?? 0 },
    { id: "sem-login", label: "Sem login", count: t?.withoutLogin ?? 0 },
  ];

  return <div className="page-content dashboard-content">
    {reportQuery.error && <p className="dashboard-error" role="alert">Não foi possível carregar os termos agora: {reportQuery.error.message}</p>}

    <div className="kpi-grid">
      {kpis.map(({ label, value, detail, icon: Icon, filter: target, alert }) => <button key={label} type="button" className={`kpi-card ${alert ? "kpi-card-alert" : ""}`} onClick={() => setFilter(target)}>
        <span className="kpi-head"><span>{label}</span><span className="kpi-icon"><Icon size={17} /></span></span>
        <strong className={t || reportQuery.error ? undefined : "is-loading"}>{value}</strong>
        <small>{detail}</small>
      </button>)}
    </div>

    <div className="dashboard-columns">
      <section className="panel">
        <div className="panel-heading"><div><h3>Do cadastro ao aceite</h3><p>Em que etapa os clientes estão</p></div></div>
        <div className="terms-funnel">
          {funnel.map((step) => <div key={step.label}>
            <div className="portal-stat-head"><span>{step.label}</span><strong>{formatInt(step.value)}</strong></div>
            <div className="progress-track"><span style={{ width: `${t && t.clients ? (step.value / t.clients) * 100 : 0}%` }} /></div>
          </div>)}
        </div>
        <p className="panel-footnote">{t ? `Tempo típico entre receber o login e aceitar: ${formatHours(t.medianHoursToAccept)}. Versão atual dos termos: ${report.version}.` : ""}</p>
      </section>

      <section className="panel">
        <div className="panel-heading"><div><h3>Aceites por dia</h3><p>Últimos 14 dias</p></div></div>
        <div className="terms-days" role="img" aria-label="Aceites por dia nos últimos 14 dias">
          {(report?.days ?? []).map((day) => <div key={day.start} title={`${formatDate(day.start)}: ${day.accepted} aceite(s)`}>
            <b>{day.accepted || ""}</b>
            <span style={{ height: `${(day.accepted / maxDay) * 100}%` }} />
            <small>{new Date(day.start).toLocaleDateString("pt-BR", { day: "2-digit", timeZone: "America/Sao_Paulo" })}</small>
          </div>)}
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading"><div><h3>Por que ainda não aceitaram</h3><p>{t ? (t.pending + t.withoutLogin ? `${formatInt(t.pending + t.withoutLogin)} cliente(s) sem aceite` : "Todos aceitaram") : "Calculando..."}</p></div></div>
        <div className="attention-list">
          {reasons.map((situation) => {
            const count = report ? countOf(situation) : undefined;
            const ok = count === 0;
            return <button key={situation} type="button" className="attention-row" title={SITUATIONS[situation].help} onClick={() => setFilter(situation)}>
              <span className={`attention-dot ${count === undefined ? "" : ok ? "attention-ok" : SITUATIONS[situation].tone === "red" ? "attention-red" : "attention-yellow"}`} />
              <span className="attention-label">{SITUATIONS[situation].label}</span>
              <span className={`attention-count ${count === undefined ? "" : ok ? "attention-count-ok" : SITUATIONS[situation].tone === "red" ? "attention-count-red" : "attention-count-yellow"}`}>{count === undefined ? loading : ok ? "Nenhum" : formatInt(count)}</span>
              <ChevronRight size={15} />
            </button>;
          })}
        </div>
      </section>
    </div>

    <div className="page-actions terms-actions">
      <div className="search-field">
        <Search size={17} />
        <input placeholder="Buscar por nome ou e-mail" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
    </div>
    <section className="panel table-panel">
      <div className="panel-heading">
        <div><h3>Clientes e termos</h3><p>{report ? `${visible.length} cliente(s) exibido(s)${filter in SITUATIONS ? ` · ${SITUATIONS[filter as Situation].label}` : ""}` : "Carregando..."}</p></div>
        <div className="filter-buttons">{filters.map((item) => <button key={item.id} className={filter === item.id ? "filter-active" : ""} onClick={() => setFilter(item.id)}>{item.label} <b>{item.count}</b></button>)}</div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Cliente</th><th>Situação</th><th>Login enviado</th><th>Último acesso</th><th>Aceite</th><th>Notificações</th><th /></tr></thead>
          <tbody>
            {report && visible.length === 0 && <tr className="empty-row"><td colSpan={7}>{filter === "pendentes" ? "Nenhum cliente pendente. Tudo em dia!" : "Nenhum cliente nesta situação."}</td></tr>}
            {pagination.visible.map((row) => {
              const info = SITUATIONS[row.situation];
              const waiting = daysSince(row.linkSentAt ?? row.loginCreatedAt);
              const canResend = row.situation !== "aceito" && row.situation !== "versao-antiga" && Boolean(row.email);
              return <tr key={row.id} onClick={() => openClient(row.id)}>
                <td><div className="table-person"><span className="avatar avatar-gradient">{row.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><div><strong>{row.name}</strong><small className="terms-sub">{row.email ?? "Sem e-mail"}</small></div></div></td>
                <td><span title={info.help}><StatusPill tone={info.tone}>{info.label}</StatusPill></span></td>
                <td>{formatDate(row.linkSentAt ?? row.loginCreatedAt)}{(row.situation === "primeiro-acesso" || row.situation === "link-expirado") && waiting !== null && <small className="terms-sub">há {waiting} dia(s){row.reminded ? " · lembrete enviado" : ""}</small>}</td>
                <td>{row.lastSignInAt ? formatDate(row.lastSignInAt) : "Nunca entrou"}</td>
                <td>{row.acceptedAt ? <>{formatDateTime(row.acceptedAt)}<small className="terms-sub">{[row.acceptedDevice, row.acceptedIp && `IP ${row.acceptedIp}`, row.acceptedVersion && row.acceptedVersion !== report?.version && `versão ${row.acceptedVersion}`].filter(Boolean).join(" · ") || "—"}</small></> : "—"}</td>
                <td>{row.notificationDevices > 0 ? <><StatusPill tone="green">Ativas</StatusPill><small className="terms-sub">{row.notificationDevices === 1 ? "1 aparelho" : `${row.notificationDevices} aparelhos`}{row.appInstalled ? " · app instalado" : ""}</small></> : "—"}</td>
                <td>{canResend && <button type="button" className="secondary-button terms-resend" disabled={reenviarAcesso.isPending} onClick={(event) => { event.stopPropagation(); reenviarAcesso.mutate({ id: row.id }); }}><Send size={14} /> {row.situation === "sem-login" ? "Enviar acesso" : "Reenviar"}</button>}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      <Pager {...pagination} noun="clientes" />
    </section>
  </div>;
}
