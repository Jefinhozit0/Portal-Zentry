import { useState } from "react";
import { ArrowLeft, FileText, Phone, Mail, Upload, Trash2, Sparkles, AlertTriangle, ChevronDown, Clock, Plus, Download, RefreshCw, FileSpreadsheet } from "lucide-react";
import LaudoDialog from "@/components/LaudoDialog";
import { MAX_DOCUMENT_BYTES, OLD_SYSTEM_TAG, PROCESS_STATUSES, caseSummary, formatFileSize } from "@shared/processo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill } from "./Home";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { showAccessResult } from "@/lib/accessToast";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

type Client = {
  id?: number;
  name: string;
  cpf: string;
  type: string;
  status: string;
  updated: string;
  tone: "green" | "yellow" | "red";
  email?: string;
  phone?: string;
  services?: string[];
  tags?: string[];
};

type ClientDetailProps = {
  client: Client;
  onBack: () => void;
  /** Only administrators may delete the client and its documents. */
  isAdmin: boolean;
};

/** "09/10/2026" */
const formatDate = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
/** "09/10/2026 às 14:32" */
const formatDateTime = (iso: string) => `${formatDate(iso)} às ${new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}`;

export default function ClientDetail({ client, onBack, isAdmin }: ClientDetailProps) {
  const utils = trpc.useUtils();
  const detalhe = trpc.portal.detalheCliente.useQuery({ id: client.id ?? 0 }, { enabled: client.id !== undefined });
  const cliente = detalhe.data?.cliente;
  const documents = detalhe.data?.documentos ?? [];
  const timeline = detalhe.data?.eventos ?? [];
  const progress = cliente?.progresso ?? 0;
  const status: string = cliente?.status ?? client.status ?? "";
  const tone = (cliente?.tone ?? client.tone ?? "yellow") as "green" | "yellow" | "red";
  const [timelineFilter, setTimelineFilter] = useState<"all" | "documento" | "status" | "progresso">("all");
  const visibleTimeline = timelineFilter === "all" ? timeline : timeline.filter((event) => event.tipo === timelineFilter);
  const [isEditingProgress, setIsEditingProgress] = useState(false);
  const [progressInput, setProgressInput] = useState("0");
  const [uploading, setUploading] = useState(0);

  const refreshAll = () => Promise.all([detalhe.refetch(), utils.portal.clientes.invalidate(), utils.portal.dashboard.invalidate()]);
  const atualizarProcesso = trpc.portal.atualizarProcesso.useMutation({
    onSuccess: () => refreshAll(),
    onError: (error) => toast.error(error.message),
  });
  const enviarDocumento = trpc.portal.enviarDocumento.useMutation();
  const baixarDocumento = trpc.portal.baixarDocumento.useMutation({ onError: (error) => toast.error(error.message) });
  const apagarDocumento = trpc.portal.apagarDocumento.useMutation({
    onSuccess: () => { toast.success("Documento apagado."); detalhe.refetch(); },
    onError: (error) => toast.error(error.message),
  });
  const [documentToDelete, setDocumentToDelete] = useState<{ id: number; nome: string } | null>(null);
  /** Open with null for a laudo typed by hand (or from a PDF picked in the dialog), with a document to read that contract. */
  const [laudo, setLaudo] = useState<{ documento: { id: number; nome: string } | null } | null>(null);

  const reenviarAcesso = trpc.portal.reenviarAcesso.useMutation({
    onSuccess: (result) => showAccessResult(result, "Novo link gerado (o anterior deixou de valer)."),
    onError: (error) => toast.error(error.message),
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteCliente = trpc.portal.deleteCliente.useMutation({
    onSuccess: async () => {
      toast.success(`${client.name} foi apagado.`);
      setConfirmDelete(false);
      await Promise.all([utils.portal.clientes.invalidate(), utils.portal.dashboard.invalidate(), utils.portal.conversas.invalidate()]);
      onBack();
    },
    onError: (error) => toast.error(error.message),
  });
  const [summary, setSummary] = useState("");
  const [riskAnalysis, setRiskAnalysis] = useState("");
  const [tags, setTags] = useState<string[]>(client.tags ?? []);
  const [customTag, setCustomTag] = useState("");
  const savedTags: string[] = Array.isArray(cliente?.tags) ? (cliente.tags as string[]) : client.tags ?? [];
  const fromOldSystem = savedTags.includes(OLD_SYSTEM_TAG);
  const salvarTags = trpc.portal.salvarTags.useMutation({
    onSuccess: (result) => {
      toast.success("Tags salvas.");
      setTags(result.tags);
      setIsEditingTags(false);
      detalhe.refetch();
      utils.portal.clientes.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });
  const [isEditingTags, setIsEditingTags] = useState(false);

  const availableTags = ["Urgente", "Documentação pendente", "Aguardando cliente", "VIP", "Em revisão", "Financiamento Veicular"];
  const statusOptions: string[] = PROCESS_STATUSES.map((option) => option.label);
  // A status typed before this list existed still shows up, so the select never looks empty.
  if (status && !statusOptions.includes(status)) statusOptions.unshift(status);

  /** Summary built only from what is registered for this client. */
  function handleGenerateSummary() {
    setSummary(caseSummary({ name: client.name, type: cliente?.type || client.type, status, progress, documents, events: timeline }, "equipe"));
  }

  /** Simple warning signs from the real data: time without updates, pending status and no documents. */
  function handleAnalyzeRisk() {
    const lastUpdate = cliente?.atualizado_em ?? cliente?.created_at;
    const days = lastUpdate ? Math.floor((Date.now() - Date.parse(lastUpdate)) / 86_400_000) : 0;
    const signs = [
      days >= 15 ? `está há ${days} dias sem atualização` : "",
      /pendente|atenção/i.test(status) ? `está com status "${status}"` : "",
      documents.length === 0 ? "ainda não tem documentos" : "",
    ].filter(Boolean);
    setRiskAnalysis(signs.length === 0
      ? "Nenhum sinal de risco: o processo foi atualizado recentemente e tem documentos."
      : `Atenção: o processo ${signs.join(", ")}. Vale entrar em contato com o cliente.`);
  }

  function readAsBase64(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function handleUploadDocument() {
    if (client.id === undefined) return;
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.onchange = async () => {
      const files = Array.from(input.files ?? []);
      for (const file of files) {
        if (file.size > MAX_DOCUMENT_BYTES) {
          toast.error(`${file.name} passa de 10 MB e não foi enviado.`);
          continue;
        }
        setUploading((count) => count + 1);
        try {
          await enviarDocumento.mutateAsync({ clientId: client.id!, nome: file.name, tipo: file.type || undefined, conteudo: await readAsBase64(file) });
          toast.success(`${file.name} anexado.`);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : `Não foi possível enviar ${file.name}.`);
        } finally {
          setUploading((count) => count - 1);
        }
      }
      detalhe.refetch();
    };
    input.click();
  }

  async function handleDownload(id: number) {
    const { url } = await baixarDocumento.mutateAsync({ id });
    // The link is signed to download the file, so the page stays where it is.
    window.location.href = url;
  }

  function handleEditProgress() {
    setIsEditingProgress(true);
    setProgressInput(String(progress));
  }

  function handleSaveProgress() {
    const newProgress = Number(progressInput);
    if (!Number.isInteger(newProgress) || newProgress < 0 || newProgress > 100) {
      toast.error("Informe um número de 0 a 100.");
      return;
    }
    if (client.id === undefined) return;
    atualizarProcesso.mutate({ id: client.id, progresso: newProgress }, { onSuccess: () => setIsEditingProgress(false) });
  }

  function handleCancelProgress() {
    setIsEditingProgress(false);
    setProgressInput(String(progress));
  }

  function toggleTag(tag: string) {
    if (isEditingTags) {
      setTags((prev) =>
        prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
      );
    }
  }

  return (
    <div className="client-detail-page">
      <div className="client-detail-header">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="back-button"
        >
          <ArrowLeft size={18} />
          Voltar
        </Button>
        {client.id !== undefined && isAdmin && (
          <Button variant="outline" size="sm" className="client-delete-button" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={16} />
            Apagar cliente
          </Button>
        )}
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={(open) => !deleteCliente.isPending && setConfirmDelete(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar {client.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              O cadastro, a conversa e o acesso do cliente ao portal serão apagados para sempre. O link de primeiro acesso deixa de funcionar. As vendas e os chargebacks continuam registrados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteCliente.isPending}>Cancelar</AlertDialogCancel>
            <Button variant="destructive" disabled={deleteCliente.isPending} onClick={() => deleteCliente.mutate({ id: client.id! })}>
              <Trash2 size={16} />
              {deleteCliente.isPending ? "Apagando..." : "Apagar para sempre"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="client-detail-content">
        {/* Client Header */}
        <section className="client-header-section">
          <div className="client-avatar">
            {client.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}
          </div>
          <div className="client-info">
            <h1>{client.name}</h1>
            <div className="client-contact">
              <span className="contact-item">
                <Phone size={14} />
                {cliente?.phone || client.phone || "Sem telefone"}
              </span>
              <span className="contact-item">
                <Mail size={14} />
                {cliente?.email || client.email || "Sem e-mail"}
              </span>
              {client.id !== undefined && client.email && (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={reenviarAcesso.isPending}
                  onClick={() => reenviarAcesso.mutate({ id: client.id! })}
                  title={fromOldSystem ? "Veio do sistema antigo: a mensagem apresenta o novo portal e convida o cliente a migrar." : undefined}
                >
                  {reenviarAcesso.isPending ? "Enviando..." : fromOldSystem ? "Enviar convite para o novo portal" : "Reenviar acesso ao portal"}
                </button>
              )}
            </div>
            <div className="client-tags">
              {status && <StatusPill tone={tone}>{status}</StatusPill>}
              <span className="tag service-tag">{client.type}</span>
              {isEditingTags ? (
                <div className="tags-edit-container">
                  {availableTags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className={`tag-edit-btn ${tags.includes(tag) ? "active" : ""}`}
                      onClick={() => toggleTag(tag)}
                    >
                      {tag}
                    </button>
                  ))}
                  {tags.filter((tag) => !availableTags.includes(tag)).map((tag) => (
                    <button key={tag} type="button" className="tag-edit-btn active" onClick={() => toggleTag(tag)}>{tag}</button>
                  ))}
                  <input
                    className="tag-custom-input"
                    aria-label="Nova tag"
                    placeholder="Nova tag"
                    maxLength={40}
                    value={customTag}
                    onChange={(event) => setCustomTag(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      const tag = customTag.trim();
                      if (tag && !tags.includes(tag)) setTags([...tags, tag]);
                      setCustomTag("");
                    }}
                  />
                  <Button size="sm" disabled={salvarTags.isPending || client.id === undefined} onClick={() => client.id !== undefined && salvarTags.mutate({ id: client.id, tags })} className="tags-save-btn">
                    {salvarTags.isPending ? "Salvando..." : "Salvar"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setTags(savedTags); setIsEditingTags(false); }}>
                    Cancelar
                  </Button>
                </div>
              ) : (
                <div className="tags-display">
                  {savedTags.map((tag) => (
                    <span key={tag} className="tag detail-tag">{tag}</span>
                  ))}
                  <Button size="sm" variant="ghost" onClick={() => { setTags(savedTags); setIsEditingTags(true); }} className="tags-edit-trigger">
                    Editar tags
                  </Button>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Progress Bar */}
        <section className="progress-section">
          <div className="progress-header">
            <span>Progresso do caso</span>
            {isEditingProgress ? (
              <div className="progress-edit-controls">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={progressInput}
                  onChange={(e) => setProgressInput(e.target.value)}
                  className="progress-input"
                />
                <span className="progress-percent">%</span>
                <Button size="sm" onClick={handleSaveProgress} className="progress-save-btn">
                  Salvar
                </Button>
                <Button size="sm" variant="ghost" onClick={handleCancelProgress} className="progress-cancel-btn">
                  Cancelar
                </Button>
              </div>
            ) : (
              <div className="progress-display-controls">
                <span className="progress-percent">{progress}%</span>
                <Button size="sm" variant="ghost" onClick={handleEditProgress} className="progress-edit-btn">
                  Editar
                </Button>
              </div>
            )}
          </div>
          <div className="progress-bar-container">
            <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
          </div>
        </section>

        {/* Action Panels */}
        <div className="action-panels-grid">
          {/* Automatic Summary */}
          <section className="action-panel">
            <div className="panel-header">
              <Sparkles size={18} />
              <h3>Resumo automático</h3>
            </div>
            {summary ? (
              <p className="panel-content">{summary}</p>
            ) : (
              <p className="panel-content placeholder">Clique em gerar para montar um resumo com os dados do caso.</p>
            )}
            <Button
              size="sm"
              onClick={handleGenerateSummary}
              disabled={detalhe.isLoading}
              className="panel-button"
            >
              Gerar
            </Button>
          </section>

          {/* Risk Detection */}
          <section className="action-panel">
            <div className="panel-header">
              <AlertTriangle size={18} />
              <h3>Detecção de risco</h3>
            </div>
            {riskAnalysis ? (
              <p className="panel-content">{riskAnalysis}</p>
            ) : (
              <p className="panel-content placeholder">Veja se o processo tem sinais de risco, como muito tempo sem atualização.</p>
            )}
            <Button
              size="sm"
              onClick={handleAnalyzeRisk}
              disabled={detalhe.isLoading}
              className="panel-button"
            >
              Analisar
            </Button>
          </section>

          {/* Status & Actions */}
          <section className="action-panel">
            <div className="panel-header">
              <Clock size={18} />
              <h3>Status & ações</h3>
            </div>
            <div className="status-select">
              <label>Status</label>
              <Select value={status || undefined} disabled={atualizarProcesso.isPending || client.id === undefined} onValueChange={(next) => client.id !== undefined && atualizarProcesso.mutate({ id: client.id, status: next }, { onSuccess: () => toast.success(`Status alterado para ${next}.`) })}>
                <SelectTrigger className="w-full" aria-label="Status">
                  <SelectValue placeholder="Escolha um status" />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </section>
        </div>

        {/* Documents Section */}
        <section className="documents-section">
          <div className="section-header">
            <h2>Documentos</h2>
            <div className="section-header-actions">
              <Button size="sm" variant="outline" onClick={() => setLaudo({ documento: null })} disabled={client.id === undefined}>
                <FileSpreadsheet size={16} />
                Gerar laudo
              </Button>
              <Button size="sm" onClick={handleUploadDocument} disabled={uploading > 0 || client.id === undefined} className="upload-button">
                <Upload size={16} />
                {uploading > 0 ? "Enviando..." : "Anexar documentos"}
              </Button>
            </div>
          </div>
          <div className="documents-list">
            {detalhe.isLoading && <p className="detail-empty">Carregando documentos...</p>}
            {!detalhe.isLoading && documents.length === 0 && (
              <p className="detail-empty">Nenhum documento anexado. Os arquivos que você anexar aqui aparecem também no portal do cliente, até 10 MB cada.</p>
            )}
            {documents.map((doc) => (
              <div key={doc.id} className="document-item">
                <div className="document-icon">
                  <FileText size={20} />
                </div>
                <div className="document-info">
                  <strong>{doc.nome}</strong>
                  <div className="document-meta">
                    <span>{formatDate(doc.created_at)}</span>
                    <span>•</span>
                    <span>{formatFileSize(doc.tamanho)}</span>
                  </div>
                  {doc.descricao && <p className="document-description">{doc.descricao}</p>}
                </div>
                {(doc.tipo === "application/pdf" || /\.pdf$/i.test(doc.nome)) && !/^Laudo - /.test(doc.nome) && <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setLaudo({ documento: { id: doc.id, nome: doc.nome } })}
                  className="delete-button"
                  aria-label={`Gerar laudo a partir de ${doc.nome}`}
                  title="Gerar laudo a partir deste contrato"
                >
                  <FileSpreadsheet size={16} />
                </Button>}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDownload(doc.id).catch(() => undefined)}
                  disabled={baixarDocumento.isPending}
                  className="delete-button"
                  aria-label={`Baixar ${doc.nome}`}
                  title="Baixar documento"
                >
                  <Download size={16} />
                </Button>
                {isAdmin && <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDocumentToDelete({ id: doc.id, nome: doc.nome })}
                  className="delete-button"
                  aria-label={`Apagar ${doc.nome}`}
                  title="Apagar documento"
                >
                  <Trash2 size={16} />
                </Button>}
              </div>
            ))}
          </div>
        </section>

        {client.id !== undefined && <LaudoDialog
          open={laudo !== null}
          onOpenChange={(open) => !open && setLaudo(null)}
          client={{ id: client.id, name: client.name }}
          documento={laudo?.documento}
          onAttached={() => detalhe.refetch()}
        />}

        <AlertDialog open={documentToDelete !== null} onOpenChange={(open) => !open && !apagarDocumento.isPending && setDocumentToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Apagar este documento?</AlertDialogTitle>
              <AlertDialogDescription>
                {documentToDelete?.nome} será apagado para sempre e deixa de aparecer para o cliente.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={apagarDocumento.isPending}>Cancelar</AlertDialogCancel>
              <Button
                variant="destructive"
                disabled={apagarDocumento.isPending}
                onClick={() => documentToDelete && apagarDocumento.mutate({ id: documentToDelete.id }, { onSettled: () => setDocumentToDelete(null) })}
              >
                <Trash2 size={16} />
                {apagarDocumento.isPending ? "Apagando..." : "Apagar documento"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Timeline Section */}
        <section className="timeline-section">
          <div className="section-header">
            <h2>Linha do tempo</h2>
            <Select value={timelineFilter} onValueChange={(value) => setTimelineFilter(value as typeof timelineFilter)}>
              <SelectTrigger className="timeline-filter" aria-label="Filtrar linha do tempo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tudo</SelectItem>
                <SelectItem value="documento">Documentos</SelectItem>
                <SelectItem value="status">Status</SelectItem>
                <SelectItem value="progresso">Progresso</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="timeline-list">
            {!detalhe.isLoading && visibleTimeline.length === 0 && <p className="detail-empty">Nada registrado ainda.</p>}
            {visibleTimeline.map((event) => (
              <div key={event.id} className="timeline-item">
                <div className="timeline-icon">
                  {event.tipo === "documento" && <FileText size={16} />}
                  {event.tipo === "progresso" && <Clock size={16} />}
                  {event.tipo === "status" && <RefreshCw size={16} />}
                  {event.tipo === "cadastro" && <Plus size={16} />}
                </div>
                <div className="timeline-content">
                  <strong>{event.titulo}</strong>
                  {event.descricao && <p>{event.descricao}</p>}
                  <span className="timeline-date">
                    {formatDateTime(event.created_at)}{event.autor ? ` · ${event.autor}` : ""}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
