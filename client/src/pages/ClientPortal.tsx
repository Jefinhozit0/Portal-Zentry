import { FormEvent, useEffect, useRef, useState } from "react";
import { AlertTriangle, Bell, CheckCircle2, ChevronRight, ClipboardList, Clock3, Download, Eye, EyeOff, FileText, Headset, LayoutGrid, LockKeyhole, LogOut, MessageCircle, Send, Wallet, X, type LucideIcon } from "lucide-react";
import { caseSummary, formatFileSize } from "@shared/processo";

const formatDay = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric", timeZone: "America/Sao_Paulo" }).replace(" de ", " ").replace(".", "");
import type { TicketTopic } from "@shared/tickets";
import { TERMS_SECTIONS, TERMS_TITLE, TERMS_VERSION } from "@shared/termos";
import { BOT_STEPS, GREETING_REPLY, LONG_QUESTION, THANKS_REPLY, TICKET_SENT_REPLY, WHILE_WAITING, greeting, readTypedMessage, type BotStepId, type ProcessInfo } from "./clientChatbot";

/** Icon on each of the assistant's buttons. */
const STEP_ICONS: Record<BotStepId, LucideIcon> = {
  menu: LayoutGrid, andamento: ClipboardList, documentos: FileText, prazos: Clock3, pagamentos: Wallet, novidades: Bell, atendente: Headset,
};
/** How long the assistant shows "typing" before each reply. */
const BOT_TYPING_MS = 700;
import { ZentryLogo } from "@/components/ZentryLogo";
import { BrandLoader } from "@/components/BrandLoader";
import { MaintenanceScreen, useMaintenance } from "@/components/MaintenanceScreen";
import { AppSetupCard } from "@/components/AppSetupCard";
import { ThemeToggle } from "@/components/ThemeToggle";
import { supabase } from "@/lib/supabase";
import { isIosSafari, isInstalledApp, useInstallPrompt } from "@/lib/installPrompt";
import { trpc } from "@/lib/trpc";
import { useArrivedIds } from "@/hooks/useArrivedIds";
import { useSlidingMarker } from "@/hooks/useSlidingMarker";
import { StatusPill } from "./Home";

/** Shown on the first login with the temporary password sent by e-mail. */
export function ChangePasswordScreen({ onDone, onLogout }: { onDone: () => void; onLogout: () => void }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 8) return setMessage("A senha precisa ter pelo menos 8 caracteres.");
    if (password !== confirmPassword) return setMessage("As senhas não conferem.");
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password, data: { must_change_password: false } });
    setSaving(false);
    if (error) return setMessage(error.code === "same_password" ? "Escolha uma senha diferente da provisória." : "Não foi possível salvar a senha. Tente novamente.");
    onDone();
  }

  return (
    <main className="client-portal-center">
      <div className="login-panel-inner">
        <ZentryLogo size="md" />
        <h2>Crie sua senha</h2>
        <p className="login-subtitle">Este é seu primeiro acesso. Troque a senha provisória recebida por e-mail por uma senha só sua.</p>
        <form onSubmit={submit} className="login-form">
          <label>Nova senha<div className="password-wrap"><input required minLength={8} autoFocus autoComplete="new-password" type={showPassword ? "text" : "password"} placeholder="Mínimo de 8 caracteres" value={password} onChange={(event) => setPassword(event.target.value)} /><button type="button" className="password-toggle" aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
          <label>Confirmar senha<input required minLength={8} autoComplete="new-password" type={showPassword ? "text" : "password"} placeholder="Digite a senha novamente" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
          {message && <p className="form-message">{message}</p>}
          <button className="primary-button login-button" type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar e continuar"} <ChevronRight size={18} /></button>
        </form>
        <button className="link-button" type="button" onClick={onLogout}>Sair</button>
      </div>
    </main>
  );
}

/** What a logged-in client sees: only their own process and the conversation with the team. */
/** While the portal is in maintenance (or unreachable), clients see only the maintenance screen. */
export function ClientPortal({ onLogout }: { onLogout: () => void }) {
  const { maintenance, retry, checking } = useMaintenance();
  if (maintenance) return <MaintenanceScreen onRetry={retry} checking={checking} />;
  return <ClientPortalContent onLogout={onLogout} />;
}

function ClientPortalContent({ onLogout }: { onLogout: () => void }) {
  // The process and the chat only load once the current terms are accepted (the server enforces it too).
  const termosQuery = trpc.cliente.termos.useQuery(undefined, { retry: false });
  const termsAccepted = termosQuery.data?.accepted === true;
  const aceitarTermos = trpc.cliente.aceitarTermos.useMutation({ onSuccess: () => termosQuery.refetch() });
  const installPrompt = useInstallPrompt();
  function acceptTerms() {
    // The terms include installing the app: the browser only offers it during a tap, so it opens
    // right here. Notifications get their own tap next, on the card at the top of the portal.
    if (installPrompt.canPrompt) void installPrompt.install();
    aceitarTermos.mutate({ version: TERMS_VERSION });
  }
  const [agreed, setAgreed] = useState(false);
  const processoQuery = trpc.cliente.meuProcesso.useQuery(undefined, { retry: false, enabled: termsAccepted, refetchInterval: 60_000 });
  const documentosQuery = trpc.cliente.documentos.useQuery(undefined, { retry: false, enabled: termsAccepted, refetchInterval: 60_000 });
  const historicoQuery = trpc.cliente.historico.useQuery(undefined, { retry: false, enabled: termsAccepted, refetchInterval: 60_000 });
  const documentos = documentosQuery.data ?? [];
  const historico = historicoQuery.data ?? [];
  const baixarDocumento = trpc.cliente.baixarDocumento.useMutation();
  async function downloadDocument(id: number) {
    const { url } = await baixarDocumento.mutateAsync({ id }).catch(() => ({ url: "" }));
    // The link is signed to download the file, so the portal stays open.
    if (url) window.location.href = url;
  }
  const mensagensQuery = trpc.cliente.mensagens.useQuery(undefined, { retry: false, refetchInterval: 30_000, enabled: termsAccepted });
  const [draft, setDraft] = useState("");
  // On a phone the process and the chat are two tabs; on a computer both stay on screen.
  // A tap on the notice of a reply opens the chat (?aba=conversa, see sw.js).
  const [tab, setTab] = useState<"processo" | "conversa">(() => new URLSearchParams(window.location.search).get("aba") === "conversa" ? "conversa" : "processo");
  const enviarMensagem = trpc.cliente.enviarMensagem.useMutation({
    // Returning the refetch keeps the mutation pending until the new message is in the list,
    // so the "Enviando..." bubble is replaced without flicker.
    onSuccess: async (_data, variables) => {
      await mensagensQuery.refetch();
      if (variables.assunto) {
        setTicketOpen(false);
        setTopic("Outros assuntos");
        const extra = followUp.current;
        followUp.current = null;
        botSays(TICKET_SENT_REPLY, () => (extra ? botSays(extra.text, () => setBotOptions(extra.options)) : setBotOptions(["menu"])));
      }
    },
    onError: (_error, variables) => {
      followUp.current = null;
      setDraft((current) => current || variables.text);
    },
  });
  const chatBody = useRef<HTMLDivElement>(null);

  // Scripted assistant. What it says and what the client picks is saved with the messages, so the
  // conversation is still there after logging out. Only tickets reach the team.
  // botTrail holds the lines shown right away while they are being saved.
  const [botTrail, setBotTrail] = useState<{ id: number; from: "bot" | "choice"; text: string }[]>([]);
  const [botOptions, setBotOptions] = useState<BotStepId[]>(BOT_STEPS.menu.options);
  const [topic, setTopic] = useState<TicketTopic>("Outros assuntos");
  const [ticketOpen, setTicketOpen] = useState(false);
  const [botTyping, setBotTyping] = useState(false);
  const typingTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(typingTimer.current), []);
  // The assistant's answer shown after the "sent to the team" notice, when the client typed about a topic it knows.
  const followUp = useRef<{ text: string; options: BotStepId[] } | null>(null);
  const botIdRef = useRef(0);
  const nextBotId = () => ++botIdRef.current;
  const registrarAssistente = trpc.cliente.registrarAssistente.useMutation();
  // Saves run one after another so the conversation keeps its order.
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const greeted = useRef(false);

  const processo = processoQuery.data;
  // On a phone, the tabs' pill glides to the open one (".tab-marker" in index.css); the tabs only exist once there is a process.
  const [tabsRef, tabMarker] = useSlidingMarker<HTMLDivElement>('[aria-selected="true"]', [tab, Boolean(processo)]);
  const firstName = processo?.name.split(" ")[0] ?? "";
  const messages = mensagensQuery.data ?? [];
  // Team replies that arrive while the page is open slide in; the loaded history and saved copies of
  // lines already on screen (assistant, own messages) do not animate again.
  const arrived = useArrivedIds("conversa", mensagensQuery.data?.map((message) => message.id));
  const pendingText = enviarMensagem.isPending ? enviarMensagem.variables?.text : undefined;
  const processInfo: ProcessInfo = {
    firstName,
    type: processo?.type || "processo em definição",
    status: processo?.status || "Em andamento",
    updated: processo?.updated || "sem data registrada",
    progress: processo?.progresso ?? 0,
    documents: documentos,
    lastEvent: historico[0] ?? null,
  };
  // Once the team has answered, what the client types goes straight to them and the assistant stays quiet,
  // until the client opens the assistant's options again.
  const talkingToTeam = botTrail.length === 0 && messages.filter((message) => message.from !== "client").at(-1)?.from === "team";

  function saveAssistant(entries: { from: "bot" | "choice"; text: string }[]) {
    const shown = entries.map((entry) => ({ ...entry, id: nextBotId() }));
    setBotTrail((trail) => [...trail, ...shown]);
    saveQueue.current = saveQueue.current
      .then(() => registrarAssistente.mutateAsync({ entries }))
      .then(async (result) => {
        // Once saved, the lines come back with the messages; if saving failed they stay on screen.
        if (!result.saved) return;
        await mensagensQuery.refetch();
        setBotTrail((trail) => trail.filter((line) => !shown.some((saved) => saved.id === line.id)));
      })
      .catch(() => undefined);
  }

  useEffect(() => {
    // Greet only on the first visit; after that the saved conversation is shown as it was.
    if (!processo || !mensagensQuery.isSuccess || greeted.current) return;
    greeted.current = true;
    if (!messages.some((message) => message.from === "bot")) saveAssistant([{ from: "bot", text: greeting(processInfo) }]);
  }, [processo, mensagensQuery.isSuccess]);

  useEffect(() => {
    const body = chatBody.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [messages.length, pendingText, botTrail.length, tab]);

  /** The assistant "types" for a moment, then its reply appears; `then` runs once it is on screen. */
  function botSays(text: string, then?: () => void) {
    setBotOptions([]);
    setBotTyping(true);
    window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => {
      setBotTyping(false);
      saveAssistant([{ from: "bot", text }]);
      then?.();
    }, BOT_TYPING_MS);
  }

  function chooseOption(stepId: BotStepId) {
    const step = BOT_STEPS[stepId];
    const nextTopic: TicketTopic = stepId === "menu" ? "Outros assuntos" : step.topic ?? topic;
    saveAssistant([{ from: "choice", text: step.label }]);
    setTopic(nextTopic);
    setTicketOpen(Boolean(step.opensTicket));
    botSays(step.reply(processInfo, nextTopic), () => setBotOptions(step.options));
  }

  /**
   * A message the client typed. Greetings and thanks are answered by the assistant only; anything else
   * goes to the team as a ticket with the subject the assistant recognized, and when it has an answer
   * for that subject it gives it while the team does not reply.
   */
  function handleTyped(text: string) {
    const intent = readTypedMessage(text);
    if (intent.kind === "saudacao" || intent.kind === "agradecimento") {
      saveAssistant([{ from: "choice", text }]);
      if (intent.kind === "saudacao") botSays(GREETING_REPLY(firstName), () => setBotOptions(BOT_STEPS.menu.options));
      else botSays(THANKS_REPLY, () => setBotOptions(["menu"]));
      return;
    }
    const step = intent.kind === "step" ? BOT_STEPS[intent.step] : null;
    const assunto: TicketTopic = step?.topic ?? "Outros assuntos";
    followUp.current = step && !step.opensTicket && text.length <= LONG_QUESTION
      ? { text: `${WHILE_WAITING}\n\n${step.reply(processInfo, assunto)}`, options: step.options.filter((id) => id !== "atendente") }
      : null;
    enviarMensagem.mutate({ text, assunto });
  }

  function cancelTicket() {
    setTicketOpen(false);
    setTopic("Outros assuntos");
    setBotOptions(BOT_STEPS.menu.options);
  }

  function sendMessage(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || enviarMensagem.isPending) return;
    if (ticketOpen) enviarMensagem.mutate({ text, assunto: topic });
    else if (talkingToTeam) enviarMensagem.mutate({ text });
    else handleTyped(text);
    setDraft("");
  }

  if (termosQuery.isLoading) return <BrandLoader />;

  return (
    <div className="client-portal">
      <header className="client-portal-header">
        <ZentryLogo size="sm" />
        <div className="client-portal-header-actions">
          <ThemeToggle />
          <button className="secondary-button" onClick={onLogout}><LogOut size={15} /> Sair</button>
        </div>
      </header>
      <main className={`client-portal-main ${processo ? "client-portal-main-wide" : ""}`}>
        {termosQuery.error && (
          <section className="client-portal-card client-portal-problem">
            <AlertTriangle size={22} />
            <div>
              <h2>Não foi possível abrir o portal</h2>
              <p>{termosQuery.error.message} Fale com a equipe Zentry Soluções.</p>
            </div>
          </section>
        )}
        {termosQuery.data && !termsAccepted && (
          <section className="client-portal-card client-terms">
            <h1>{TERMS_TITLE}</h1>
            <p className="client-portal-muted">Leia e aceite para acompanhar seu processo. Versão {TERMS_VERSION}.</p>
            <div className="client-terms-text" tabIndex={0} aria-label="Texto dos termos">
              {TERMS_SECTIONS.map((section) => <section key={section.title}><h2>{section.title}</h2><p>{section.text}</p></section>)}
            </div>
            <label className="client-terms-agree"><input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} /> Li e aceito os termos de uso, o tratamento dos meus dados e a instalação do app da Zentry com notificações neste aparelho.</label>
            {!isInstalledApp() && (installPrompt.canPrompt || isIosSafari()) && <p className="client-portal-muted client-terms-app-hint">{installPrompt.canPrompt ? "Ao continuar, o aparelho pergunta se pode instalar o app da Zentry." : "Ao continuar, mostramos como colocar o app da Zentry na tela de início."}</p>}
            {aceitarTermos.error && <p className="form-message">{aceitarTermos.error.message}</p>}
            <div className="client-terms-actions">
              <button className="primary-button" disabled={!agreed || aceitarTermos.isPending} onClick={acceptTerms}>{aceitarTermos.isPending ? "Registrando..." : "Aceitar e continuar"}</button>
            </div>
          </section>
        )}
        {termsAccepted && processoQuery.isLoading && <section className="client-portal-card" aria-busy="true"><p className="client-portal-muted">Carregando seu processo...</p></section>}
        {processoQuery.error && (
          <section className="client-portal-card client-portal-problem">
            <AlertTriangle size={22} />
            <div>
              <h2>Não encontramos seu processo</h2>
              <p>{processoQuery.error.message} Fale com a equipe Zentry Soluções.</p>
            </div>
          </section>
        )}
        {processo && <>
          <AppSetupCard />
          <div className="client-portal-tabs" role="tablist" aria-label="Seções do portal" ref={tabsRef}>
            {tabMarker && <span className="tab-marker" aria-hidden="true" style={tabMarker} />}
            <button type="button" role="tab" aria-selected={tab === "processo"} onClick={() => setTab("processo")}><ClipboardList size={16} /> Meu processo</button>
            <button type="button" role="tab" aria-selected={tab === "conversa"} onClick={() => setTab("conversa")}><MessageCircle size={16} /> Conversa</button>
          </div>
          <div className="client-portal-layout" data-tab={tab}>
          <div className="client-portal-side">
          <section className="client-portal-card client-portal-hero">
            <h1>Olá, {firstName}</h1>
            <div className="client-portal-status">
              <div><small>Tipo de processo</small><strong>{processo.type || "Em definição"}</strong></div>
              <div><small>Situação</small><StatusPill tone={processo.tone ?? "green"}>{processo.status || "Em andamento"}</StatusPill></div>
              <div><small>Última atualização</small><strong><Clock3 size={16} /> {processo.updated || "—"}</strong></div>
            </div>
            <div className="client-portal-progress">
              <div><small>Progresso do caso</small><strong>{`${Math.round(processo.progresso ?? 0)}%`}</strong></div>
              <div className="progress-bar-container" role="progressbar" aria-valuenow={processo.progresso ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso do caso">
                <div className="progress-bar-fill" style={{ width: `${processo.progresso ?? 0}%` }} />
              </div>
            </div>
            {processo.services && processo.services.length > 0 && (
              <div className="client-portal-services">
                <small>Serviços contratados</small>
                <div>{processo.services.map((service) => <span key={service} className="client-portal-chip">{service}</span>)}</div>
              </div>
            )}
            <button type="button" className="primary-button client-portal-to-chat" onClick={() => setTab("conversa")}><MessageCircle size={17} /> Falar com a equipe</button>
          </section>


          {documentosQuery.isSuccess && historicoQuery.isSuccess && (
            <section className="client-portal-card client-portal-block">
              <h2><ClipboardList size={17} /> Resumo do seu caso</h2>
              <p className="client-portal-summary">{caseSummary({ name: processo.name ?? "", type: processo.type, status: processo.status, progress: processo.progresso ?? 0, documents: documentos, events: historico }, "cliente")}</p>
            </section>
          )}

          <section className="client-portal-card client-portal-block">
            <h2>Documentos</h2>
            {documentosQuery.isLoading && <p className="client-portal-muted">Carregando...</p>}
            {documentosQuery.isSuccess && documentos.length === 0 && <p className="client-portal-muted">Nenhum documento por enquanto. Quando a equipe anexar um arquivo, ele aparece aqui.</p>}
            <ul className="client-doc-list">
              {documentos.map((doc) => (
                <li key={doc.id}>
                  <FileText size={18} />
                  <div><strong>{doc.nome}</strong><small>{formatDay(doc.created_at)} · {formatFileSize(doc.tamanho)}</small></div>
                  <button type="button" className="icon-button" disabled={baixarDocumento.isPending} onClick={() => downloadDocument(doc.id)} aria-label={`Baixar ${doc.nome}`} title="Baixar"><Download size={17} /></button>
                </li>
              ))}
            </ul>
            {baixarDocumento.error && <p className="form-message">{baixarDocumento.error.message}</p>}
          </section>

          <section className="client-portal-card client-portal-block">
            <h2>Histórico</h2>
            {historicoQuery.isSuccess && historico.length === 0 && <p className="client-portal-muted">Nada registrado ainda.</p>}
            <ol className="client-history">
              {historico.map((event) => (
                <li key={event.id}>
                  <strong>{event.titulo}</strong>
                  {event.descricao && <p>{event.descricao}</p>}
                  <small>{formatDay(event.created_at)}</small>
                </li>
              ))}
            </ol>
          </section>
          </div>

          <section className="client-portal-card client-portal-chat">
            <div className="client-portal-chat-head">
              <h2>Fale com a equipe</h2>
              <p><LockKeyhole size={13} /> Conversa privada com a Zentry Soluções</p>
            </div>
            <div className="client-portal-chat-body" ref={chatBody} aria-live="polite">
              {mensagensQuery.isLoading && <p className="client-portal-empty">Carregando mensagens...</p>}
              {messages.map((message) => message.from === "bot" ? (
                <div key={message.id} className="client-bubble client-bubble-team client-bubble-bot">
                  <span className="client-bubble-author">Atendimento automático</span>
                  <p>{message.text}</p>
                  <small>{message.time}</small>
                </div>
              ) : message.from === "choice" ? (
                <div key={message.id} className="client-bubble client-bubble-own client-bubble-choice"><p>{message.text}</p></div>
              ) : (
                <div key={message.id} className={`client-bubble ${message.from === "client" ? "client-bubble-own" : "client-bubble-team"}${message.from === "team" && arrived(message.id) ? " client-bubble-new" : ""}`}>
                  {message.from === "team" && <span className="client-bubble-author">Equipe Zentry</span>}
                  <p>{message.text}</p>
                  <small>{message.time} {message.from === "client" && <CheckCircle2 size={12} />}</small>
                </div>
              ))}
              {botTrail.map((entry) => entry.from === "bot" ? (
                <div key={`local-${entry.id}`} className="client-bubble client-bubble-team client-bubble-bot client-bubble-new">
                  <span className="client-bubble-author">Atendimento automático</span>
                  <p>{entry.text}</p>
                </div>
              ) : (
                <div key={`local-${entry.id}`} className="client-bubble client-bubble-own client-bubble-choice client-bubble-new"><p>{entry.text}</p></div>
              ))}
              {pendingText && <div className="client-bubble client-bubble-own client-bubble-pending"><p>{pendingText}</p><small>Enviando...</small></div>}
              {botTyping && (
                <div className="client-bubble client-bubble-team client-bubble-bot client-bubble-new" role="status" aria-label="O assistente está digitando">
                  <span className="client-bubble-author">Atendimento automático</span>
                  <span className="client-typing-dots" aria-hidden="true"><i /><i /><i /></span>
                </div>
              )}
              {!enviarMensagem.isPending && !botTyping && !talkingToTeam && botOptions.length > 0 && (
                <div className="client-bot-options" role="group" aria-label="Opções do assistente">
                  {botOptions.map((stepId) => {
                    const Icon = STEP_ICONS[stepId];
                    return <button key={stepId} type="button" className={stepId === "atendente" ? "client-bot-option-team" : undefined} onClick={() => chooseOption(stepId)}><Icon size={15} aria-hidden="true" /> {BOT_STEPS[stepId].label}</button>;
                  })}
                </div>
              )}
            </div>
            {enviarMensagem.error && <p className="client-portal-send-error" role="alert">Não foi possível enviar sua mensagem. Tente novamente.</p>}
            {ticketOpen && (
              <div className="client-ticket-bar">
                <span>Novo ticket · <b>{topic}</b></span>
                <button type="button" className="icon-button" onClick={cancelTicket} aria-label="Cancelar ticket" title="Cancelar ticket"><X size={15} /></button>
              </div>
            )}
            <form className="chat-composer" onSubmit={sendMessage}>
              <button type="button" className="icon-button" onClick={() => chooseOption("menu")} disabled={botTyping || enviarMensagem.isPending} aria-label="Abrir as opções do assistente" title="Opções do assistente"><LayoutGrid size={17} /></button>
              <input aria-label="Mensagem para a equipe" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={ticketOpen ? `Escreva sua dúvida sobre "${topic}"...` : "Digite sua mensagem..."} maxLength={2000} />
              <button type="submit" className="send-button" aria-label="Enviar mensagem" disabled={enviarMensagem.isPending || !draft.trim()}><Send size={17} /></button>
            </form>
          </section>
          </div>
        </>}
      </main>
      <footer className="app-footer">© 2026 Zentry Soluções <span>·</span> Todos os direitos reservados.</footer>
    </div>
  );
}
