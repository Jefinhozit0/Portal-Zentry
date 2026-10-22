import { useState } from "react";
import { ClipboardCheck, Download, FileSignature, FileSpreadsheet, Mail, MailWarning, User } from "lucide-react";
import { toast } from "sonner";
import { formatFileSize } from "@shared/processo";
import { LaudoForm } from "@/components/LaudoDialog";
import { NotificacaoForm } from "@/components/NotificacaoForm";
import { ProcuracaoForm } from "@/components/ProcuracaoForm";
import { TermoForm } from "@/components/TermoForm";
import { trpc } from "@/lib/trpc";

const formatDateTime = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

/** The documents this screen makes. A new model is one more entry here and its form. */
const MODELOS = [
  { id: "laudo", label: "Laudo", icon: FileSpreadsheet, help: "Envie o contrato em PDF ou digite os dados. O laudo sai pronto em PDF, com as tabelas e a conclusão." },
  { id: "procuracao", label: "Procuração extrajudicial", icon: FileSignature, help: "Procuração para a Zentry representar o cliente em reclamações administrativas (consumidor.gov.br)." },
  { id: "notificacao-contrato", label: "Notificação com contrato", icon: MailWarning, help: "Notificação ao banco contestando a taxa de juros do contrato e pedindo a devolução. Envie o contrato em PDF para preencher tudo." },
  { id: "notificacao", label: "Notificação manual", icon: Mail, help: "Notificação ao banco pedindo a cópia do contrato, quando o cliente não tem. Digite os dados ou envie o que houver em PDF." },
  { id: "termo", label: "Termo de prestação de serviços", icon: ClipboardCheck, help: "Termo que comunica ao cliente a notificação extrajudicial enviada ao banco." },
] as const;
type Modelo = (typeof MODELOS)[number]["id"];

/** Documents the team generates (laudos, procurações), and the ones already attached to clients. */
export default function LaudosPage({ onOpenClient }: { onOpenClient: (row: Record<string, unknown>) => void }) {
  const [modelo, setModelo] = useState<Modelo>("laudo");
  const clientesQuery = trpc.portal.clientes.useQuery(undefined, { retry: false });
  const laudosQuery = trpc.portal.laudos.useQuery(undefined, { retry: false });
  const baixarDocumento = trpc.portal.baixarDocumento.useMutation({ onError: (error) => toast.error(error.message) });

  const rows = (clientesQuery.data ?? []) as Record<string, unknown>[];
  const clients = rows
    .filter((row) => typeof row.id === "number" && typeof row.name === "string" && row.name.trim())
    .map((row) => ({ id: row.id as number, name: (row.name as string).trim(), cpf: (row.cpf as string | null) ?? null, email: (row.email as string | null) ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const documentos = laudosQuery.data ?? [];
  const current = MODELOS.find((item) => item.id === modelo)!;
  const onDone = ({ attached }: { attached: boolean }) => { if (attached) laudosQuery.refetch(); };

  async function download(id: number) {
    const { url } = await baixarDocumento.mutateAsync({ id });
    window.location.href = url;
  }

  function openClient(id: number) {
    const row = rows.find((item) => item.id === id);
    if (row) onOpenClient(row);
  }

  return <div className="page-content laudos-page">
    <section className="panel laudos-form-panel">
      <div className="panel-heading laudos-heading">
        <div><h3>Novo documento</h3><p>{current.help}</p></div>
        <div className="filter-buttons" role="tablist" aria-label="Modelo de documento">
          {MODELOS.map((item) => <button key={item.id} type="button" role="tab" aria-selected={modelo === item.id} className={modelo === item.id ? "filter-active" : ""} onClick={() => setModelo(item.id)}>
            <item.icon size={14} /> {item.label}
          </button>)}
        </div>
      </div>
      {modelo === "laudo" && <LaudoForm variant="page" clients={clients} onDone={onDone} />}
      {modelo === "procuracao" && <ProcuracaoForm clients={clients} onDone={onDone} />}
      {modelo === "notificacao-contrato" && <NotificacaoForm key="contrato" tipo="contrato" clients={clients} onDone={onDone} />}
      {modelo === "notificacao" && <NotificacaoForm key="manual" tipo="manual" clients={clients} onDone={onDone} />}
      {modelo === "termo" && <TermoForm clients={clients} onDone={onDone} />}
    </section>

    <section className="panel">
      <div className="panel-heading"><div><h3>Documentos anexados</h3><p>{laudosQuery.isLoading ? "Carregando..." : documentos.length ? `${documentos.length} documento(s) gerado(s) nos cadastros dos clientes` : "Os documentos anexados a um cliente aparecem aqui"}</p></div></div>
      <div className="laudos-list">
        {!laudosQuery.isLoading && documentos.length === 0 && <p className="detail-empty">Nenhum documento anexado ainda. Escolha um cliente no formulário e marque "Anexar" para guardar o documento no cadastro dele.</p>}
        {documentos.map((documento) => {
          const Icon = documento.nome.startsWith("Procuração") ? FileSignature : documento.nome.startsWith("Notificação extrajudicial com contrato") ? MailWarning : documento.nome.startsWith("Notificação") ? Mail : documento.nome.startsWith("Termo") ? ClipboardCheck : FileSpreadsheet;
          return <div key={documento.id} className="laudos-item">
            <span className="laudos-icon"><Icon size={18} /></span>
            <div className="laudos-info">
              <strong>{documento.nome}</strong>
              <small>{formatDateTime(documento.createdAt)} · {formatFileSize(documento.tamanho)}{documento.enviadoPor ? ` · ${documento.enviadoPor}` : ""}</small>
            </div>
            {documento.clientName && <button type="button" className="secondary-button laudos-client" onClick={() => openClient(documento.clientId)} title="Abrir cadastro do cliente"><User size={14} /> {documento.clientName}</button>}
            <button type="button" className="icon-button" onClick={() => download(documento.id).catch(() => undefined)} disabled={baixarDocumento.isPending} aria-label={`Baixar ${documento.nome}`} title="Baixar"><Download size={16} /></button>
          </div>;
        })}
      </div>
    </section>
  </div>;
}
