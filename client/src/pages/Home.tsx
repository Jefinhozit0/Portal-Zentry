import { FormEvent, Fragment, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { hubMoney } from "./salesHubData";

// The Sales HUB is only downloaded when someone opens it, so the portal opens faster.
const SalesHubPage = lazy(() => import("./SalesHub"));
const AdminPage = lazy(() => import("./Admin"));
const TermosPage = lazy(() => import("./Termos"));
const ChargebacksPage = lazy(() => import("./Chargebacks"));
import { useQueryClient } from "@tanstack/react-query";
import { parseTicketMessage } from "@shared/tickets";
import { INITIAL_STATUS } from "@shared/processo";
import type { ChargebackDraft } from "@shared/chargebacks";
import { CHARGEBACK_LIST_FILTERS, CLIENT_LIST_FILTERS, DASHBOARD_RULES, METRIC_HELP, type ChargebackListFilter, type ClientListFilter, type ListFilter } from "@shared/dashboard";
const ClientDetail = lazy(() => import("./ClientDetail"));
const ClientPortal = lazy(() => import("./ClientPortal").then((module) => ({ default: module.ClientPortal })));
const ChangePasswordScreen = lazy(() => import("./ClientPortal").then((module) => ({ default: module.ChangePasswordScreen })));
import { toast } from "sonner";
import { showAccessResult } from "@/lib/accessToast";
import { matchesClientSearch, newestFirst } from "@/lib/clientSearch";
import { usePagination } from "@/lib/pagination";
import { Pager } from "@/components/Pager";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { Session } from "@supabase/supabase-js";
import { trpc } from "@/lib/trpc";
import { ZentryLogo } from "@/components/ZentryLogo";
import { BrandLoader } from "@/components/BrandLoader";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CountUp } from "@/components/CountUp";
import { useArrivedIds } from "@/hooks/useArrivedIds";
import { usePushDevice } from "@/hooks/usePushDevice";
import { isInstalledApp, isIosSafari } from "@/lib/installPrompt";
import { pushSupported } from "@/lib/pushNotifications";
import { playEnter } from "@/lib/motion";
import { supabase } from "@/lib/supabase";
import {
  AlertTriangle,
  Briefcase,
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  BellRing,
  CheckCheck,
  CheckCircle2,
  ChevronRight,
  Clock3,
  CreditCard,
  Eye,
  EyeOff,
  FileCheck2,
  FileText,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Menu,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Plus,
  Scale,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Trophy,
  Users,
  Trash2,
  X,
} from "lucide-react";

type View = "dashboard" | "clientes" | "chargebacks" | "atendimento" | "termos" | "saleshub" | "client-detail" | "admin";
type Client = { id?: number; name: string; cpf: string; type: string; status: string; updated: string; tone: "green" | "yellow" | "red"; email?: string; phone?: string; services?: string[]; tags?: string[] };

const clientServices = ["Financiamento Imobiliário", "Financiamento Veicular", "Empréstimo Pessoal", "Empréstimo Consignado", "Cartão de Crédito", "Outros"];

export { hubMoney } from "./salesHubData";

function Logo({ compact = false, size = "md" }: { compact?: boolean; size?: "sm" | "md" | "lg" | "xl" }) {
  return <ZentryLogo compact={compact} size={size} />;
}

/** A row of the clientes table as the client screens use it. */
function toClient(row: Record<string, unknown>): Client {
  return {
    id: typeof row.id === "number" ? row.id : undefined,
    name: String(row.name ?? ""),
    cpf: String(row.cpf ?? ""),
    type: String(row.type ?? ""),
    status: String(row.status ?? ""),
    updated: String(row.updated ?? ""),
    tone: (row.tone as "green" | "yellow" | "red") ?? "green",
    email: row.email ? String(row.email) : undefined,
    phone: row.phone ? String(row.phone) : undefined,
    services: Array.isArray(row.services) ? (row.services as string[]) : undefined,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : undefined,
  };
}

export function StatusPill({ children, tone }: { children: string; tone: string }) {
  return <span className={`status-pill status-${tone}`}><span className="status-dot" />{children}</span>;
}

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const requestVerificationCode = trpc.account.requestVerificationCode.useMutation();
  const criarConta = trpc.account.criarConta.useMutation();
  const requestPasswordReset = trpc.account.solicitarRedefinicaoSenha.useMutation();
  const resetPassword = trpc.account.redefinirSenha.useMutation();
  // Without e-mail no code can go out, so the two screens that need one are hidden.
  const emailOn = trpc.status.email.useQuery(undefined, { staleTime: Infinity }).data?.ativo ?? true;
  const [mode, setMode] = useState<"login" | "register" | "verify" | "verified" | "forgot" | "reset">("login");
  const [resetEmail, setResetEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [notice, setNotice] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [password, setPassword] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [verifiedEmail, setVerifiedEmail] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  // Switching between entrar / criar login / redefinir senha replays a short fade on the card body.
  const panelRef = useRef<HTMLDivElement>(null);
  const firstMode = useRef(true);
  useEffect(() => {
    if (firstMode.current) { firstMode.current = false; return; }
    const panel = panelRef.current;
    if (panel) playEnter(panel.querySelectorAll(":scope > h2, :scope > .login-subtitle, :scope > form, :scope > .link-button, :scope > .first-access, :scope > .login-button"));
  }, [mode]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setNotice("");
    if (!loginEmail || !password) {
      setMessage("Preencha e-mail e senha para continuar.");
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password: password,
    });
    if (error) {
      setMessage(
        error.code === "invalid_credentials" || error.message === "Invalid login credentials"
          ? "E-mail ou senha incorretos. Confira os dados ou use \"Esqueci minha senha\"."
          : error.code === "email_not_confirmed"
            ? "Seu e-mail ainda não foi confirmado."
            : "Não foi possível entrar agora. Tente novamente em instantes.",
      );
      return;
    }
    onLogin();
  }

  async function sendVerificationCode(email: string) {
    setMessage("");
    try {
      await requestVerificationCode.mutateAsync({ email: email.trim() });
      setVerifiedEmail(email.trim());
      setVerificationCode("");
      setMode("verify");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível enviar o código.");
    }
  }

  async function requestLogin(event: FormEvent) {
    event.preventDefault();
    if (password !== confirmPassword) {
      setMessage("As senhas não conferem.");
      return;
    }
    // Step 1: send verification code to the email
    await sendVerificationCode(registerEmail);
  }

  async function verifyRegistrationCode(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    try {
      // The server checks the code and creates the account already confirmed (or sets the new
      // password on an account that already existed for this e-mail).
      const created = await criarConta.mutateAsync({ email: verifiedEmail, code: verificationCode, password });
      const { error } = await supabase.auth.signInWithPassword({ email: verifiedEmail, password });
      if (!error) {
        onLogin();
        return;
      }
      setNotice(created.status === "updated" ? "Este e-mail já tinha conta. A senha foi atualizada, entre com ela." : "Conta criada! Entre para continuar.");
      setMode("login");
      setLoginEmail(verifiedEmail);
      setPassword("");
      setConfirmPassword("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível validar o código.");
    }
  }

  async function sendResetCode() {
    setMessage("");
    try {
      await requestPasswordReset.mutateAsync({ email: resetEmail.trim() });
      setResetCode("");
      setPassword("");
      setConfirmPassword("");
      setMode("reset");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível enviar o código.");
    }
  }

  async function confirmPasswordReset(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    if (password !== confirmPassword) {
      setMessage("As senhas não conferem.");
      return;
    }
    try {
      await resetPassword.mutateAsync({ email: resetEmail.trim(), code: resetCode, password });
      setMode("login");
      setLoginEmail(resetEmail.trim());
      setPassword("");
      setConfirmPassword("");
      setNotice("Senha alterada. Entre com a nova senha.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível salvar a nova senha.");
    }
  }

  function backToLogin() {
    setMode("login");
    setMessage("");
    setVerificationCode("");
  }

  return (
    <main className="login-page">
      <section className="login-hero">
        <div className="login-hero-top"><Logo size="lg" /></div>
        <div className="hero-copy">
          <span className="eyebrow"><ShieldCheck size={15} /> Portal do cliente Zentry</span>
          <h1>Seu processo,<br /><em>transparente</em> de ponta a ponta.</h1>
          <p>Acompanhe cada etapa com clareza, segurança e o cuidado de uma equipe que está do seu lado.</p>
          <ul className="login-features">
            <li><CheckCircle2 size={17} /> Status e progresso do seu processo, atualizados pela equipe</li>
            <li><CheckCircle2 size={17} /> Documentos do seu caso para baixar quando precisar</li>
            <li><CheckCircle2 size={17} /> Conversa direta com a equipe da Zentry, com aviso no WhatsApp</li>
          </ul>
        </div>
        <div className="login-hero-footer"><span>Zentry Soluções</span><strong>Acompanhamento do início ao fim</strong><small>pelo celular ou computador</small></div>
      </section>
      <section className="login-panel">
        <ThemeToggle className="login-theme-toggle" />
        <div className="login-panel-inner" ref={panelRef}>
          <div className="login-mobile-logo"><Logo size="md" /></div>
          <div className="secure-badge"><LockKeyhole size={16} /> Acesso seguro</div>
          <h2>{mode === "login" ? "Entrar no portal" : mode === "register" ? "Criar login" : mode === "verify" ? "Verificar e-mail" : mode === "forgot" ? "Redefinir senha" : mode === "reset" ? "Criar nova senha" : "E-mail verificado"}</h2>
          <p className="login-subtitle">{mode === "login" ? "Use seu e-mail e senha para acompanhar o seu processo." : mode === "register" ? "Informe um e-mail que você possa acessar. Enviaremos um código para verificar o endereço." : mode === "verify" ? `Digite o código enviado para ${verifiedEmail}.` : mode === "forgot" ? "Informe o e-mail da sua conta. Se ele estiver cadastrado, enviaremos um código para você criar uma nova senha." : mode === "reset" ? `Se ${resetEmail.trim()} tiver uma conta, enviamos um código para ele. Digite o código e a nova senha.` : "Seu e-mail foi validado. A criação persistente da conta ainda precisa ser conectada ao sistema de usuários."}</p>
          {mode === "login" ? <>
            <form onSubmit={submit} className="login-form">
              <label>E-mail<input required type="email" autoComplete="username" aria-label="E-mail" placeholder="voce@email.com" value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} /></label>
              <label>Senha<div className="password-wrap"><input aria-label="Senha" type={showPassword ? "text" : "password"} placeholder="Digite sua senha" value={password} onChange={(e) => setPassword(e.target.value)} /><button type="button" className="icon-button password-toggle" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>
              {notice && <p className="form-message form-message-success" role="status">{notice}</p>}
              {message && <p className="form-message">{message}</p>}
              <button className="primary-button login-button" type="submit">Entrar <ChevronRight size={18} /></button>
            </form>
            {emailOn && <button className="link-button" type="button" onClick={() => { setResetEmail(loginEmail); setMode("forgot"); setMessage(""); setNotice(""); }}>Esqueci minha senha</button>}
            <div className="first-access"><strong>Primeiro acesso?</strong><span>{emailOn ? "Toque no link que a Zentry Soluções enviou por e-mail ou WhatsApp para criar sua senha. Se ele venceu, peça um novo à equipe." : "Toque no link que a Zentry Soluções enviou por WhatsApp para criar sua senha. Se ele venceu ou você esqueceu a senha, peça um novo à equipe."}</span></div>
            {emailOn && <button className="link-button" type="button" onClick={() => { setMode("register"); setMessage(""); }}>Criar login</button>}
          </> : mode === "register" ? <>
            <form onSubmit={requestLogin} className="login-form">
              <label>E-mail para verificação<input required type="email" aria-label="E-mail para verificação" placeholder="voce@email.com" value={registerEmail} onChange={(event) => setRegisterEmail(event.target.value)} /></label>
              <label>Nova senha<div className="password-wrap"><input required minLength={8} aria-label="Nova senha" type={showPassword ? "text" : "password"} placeholder="Mínimo de 8 caracteres" value={password} onChange={(event) => setPassword(event.target.value)} /><button type="button" className="icon-button password-toggle" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>
              <label>Confirmar senha<input required minLength={8} aria-label="Confirmar senha" type={showPassword ? "text" : "password"} placeholder="Digite a senha novamente" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
              {message && <p className="form-message">{message}</p>}
              <button className="primary-button login-button" type="submit">Criar conta <ChevronRight size={18} /></button>
            </form>
            <button className="link-button" type="button" onClick={() => { setMode("login"); setMessage(""); }}>Voltar para entrar</button>
          </> : mode === "verify" ? <>
            <form onSubmit={verifyRegistrationCode} className="login-form">
              <label>Código de verificação<input required autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" aria-label="Código de verificação" placeholder="000000" value={verificationCode} onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 6))} /></label>
              {message && <p className="form-message">{message}</p>}
              <button className="primary-button login-button" type="submit" disabled={criarConta.isPending || verificationCode.length !== 6}>{criarConta.isPending ? "Criando conta..." : "Verificar e criar conta"} <ChevronRight size={18} /></button>
            </form>
            <button className="link-button" type="button" disabled={requestVerificationCode.isPending} onClick={() => sendVerificationCode(verifiedEmail)}>{requestVerificationCode.isPending ? "Reenviando..." : "Reenviar código"}</button>
            <button className="link-button" onClick={() => { setMode("register"); setMessage(""); }}>Alterar e-mail</button>
          </> : mode === "forgot" ? <>
            <form onSubmit={(event) => { event.preventDefault(); sendResetCode(); }} className="login-form">
              <label>E-mail<input required autoFocus type="email" autoComplete="username" aria-label="E-mail" placeholder="voce@email.com" value={resetEmail} onChange={(event) => setResetEmail(event.target.value)} /></label>
              {message && <p className="form-message">{message}</p>}
              <button className="primary-button login-button" type="submit" disabled={requestPasswordReset.isPending}>{requestPasswordReset.isPending ? "Enviando..." : "Enviar código"} <ChevronRight size={18} /></button>
            </form>
            <button className="link-button" type="button" onClick={backToLogin}>Voltar para entrar</button>
          </> : mode === "reset" ? <>
            <form onSubmit={confirmPasswordReset} className="login-form">
              <label>Código recebido por e-mail<input required autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" aria-label="Código recebido por e-mail" placeholder="000000" value={resetCode} onChange={(event) => setResetCode(event.target.value.replace(/\D/g, "").slice(0, 6))} /></label>
              <label>Nova senha<div className="password-wrap"><input required minLength={8} autoComplete="new-password" aria-label="Nova senha" type={showPassword ? "text" : "password"} placeholder="Mínimo de 8 caracteres" value={password} onChange={(event) => setPassword(event.target.value)} /><button type="button" className="icon-button password-toggle" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>
              <label>Confirmar nova senha<input required minLength={8} autoComplete="new-password" aria-label="Confirmar nova senha" type={showPassword ? "text" : "password"} placeholder="Digite a senha novamente" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
              {message && <p className="form-message">{message}</p>}
              <button className="primary-button login-button" type="submit" disabled={resetPassword.isPending || resetCode.length !== 6}>{resetPassword.isPending ? "Salvando..." : "Salvar nova senha"} <ChevronRight size={18} /></button>
            </form>
            <button className="link-button" type="button" disabled={requestPasswordReset.isPending} onClick={sendResetCode}>{requestPasswordReset.isPending ? "Reenviando..." : "Reenviar código"}</button>
            <button className="link-button" type="button" onClick={backToLogin}>Voltar para entrar</button>
          </> : <>
            <button className="primary-button login-button" onClick={backToLogin}>Voltar para entrar <ChevronRight size={18} /></button>
          </>}
          <div className="login-trust"><span><LockKeyhole size={14} /> Conexão criptografada (HTTPS)</span><span><ShieldCheck size={14} /> Acesso só com sua senha</span></div>
        </div>
      </section>
    </main>
  );
}

/** Conversations whose last message came from the client (menu badge, bell and dashboard banner). */
function useAwaitingConversations() {
  const conversasQuery = trpc.portal.conversas.useQuery(undefined, { retry: false, refetchInterval: 30_000 });
  return (conversasQuery.data ?? []).filter((conversation) => conversation.awaitingReply);
}

function Sidebar({ view, setView, collapsed, setCollapsed, onLogout, userName, isAdmin }: { view: View; setView: (view: View) => void; collapsed: boolean; setCollapsed: (value: boolean) => void; onLogout: () => void; userName: string; isAdmin: boolean }) {
  const initials = userName.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  const awaitingCount = useAwaitingConversations().length;
  const items: { id: View; label: string; icon: typeof LayoutDashboard }[] = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "clientes", label: "Clientes", icon: Users },
    { id: "chargebacks", label: "Chargebacks", icon: CreditCard },
    { id: "atendimento", label: "Atendimento", icon: MessageCircle },
    { id: "termos", label: "Termos", icon: FileCheck2 },
    { id: "saleshub", label: "Sales HUB", icon: FileText },
    ...(isAdmin ? [{ id: "admin" as View, label: "Administração", icon: ShieldCheck }] : []),
  ];
  return <aside className={`sidebar ${collapsed ? "sidebar-collapsed" : ""}`}>
    <div className="sidebar-head"><Logo compact={collapsed} size={collapsed ? "sm" : "md"} /><button className="icon-button collapse-button" onClick={() => setCollapsed(!collapsed)} aria-label="Recolher menu">{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button></div>
    <nav className="main-nav">{items.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${view === id ? "nav-item-active" : ""}`} onClick={() => setView(id)}><Icon size={18} /><span>{label}</span>{id === "atendimento" && awaitingCount > 0 && <b className="nav-count">{awaitingCount}</b>}</button>)}</nav>
    <div className="sidebar-bottom">
      {!collapsed ? (
        <div className="profile-card">
          <div className="profile-card-header">
            <div className="profile-avatar-wrap">
              <span className="avatar avatar-gold">{initials}</span>
              <span className="avatar-status-dot" />
            </div>
            <div className="profile-copy">
              <strong>{userName}</strong>
              <small>Online agora</small>
            </div>
            <button
              className="icon-button profile-logout-btn"
              onClick={onLogout}
              title="Encerrar sessão"
              aria-label="Sair"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      ) : (
        <div className="profile-card-collapsed">
          <div className="profile-avatar-wrap" title={userName}>
            <span className="avatar avatar-gold">{initials}</span>
            <span className="avatar-status-dot" />
          </div>
          <button
            className="icon-button profile-logout-btn"
            onClick={onLogout}
            title="Encerrar sessão"
            aria-label="Sair"
          >
            <LogOut size={16} />
          </button>
        </div>
      )}
    </div>
  </aside>;
}

/** Green when the corporate WhatsApp is connected; administrators open the page with the QR code. */
function WhatsAppIndicator({ onClick }: { onClick: () => void }) {
  const statusQuery = trpc.admin.whatsappStatus.useQuery(undefined, { retry: false, refetchInterval: 30_000 });
  const data = statusQuery.data;
  if (!data || data.provider !== "web") return null;
  const connected = data.status === "connected";
  const label = connected ? "WhatsApp conectado" : data.status === "waiting_qr" ? "WhatsApp aguardando QR code" : "WhatsApp desconectado";
  return <button type="button" className={`whatsapp-indicator ${connected ? "is-on" : "is-off"}`} onClick={onClick} title={connected && data.number ? `${label} (${data.number})` : label} aria-label={label}><span /> WhatsApp</button>;
}

function Topbar({ view, onMenu, onSearch, onNotifications, onWhatsApp, userName }: { view: View; onMenu: () => void; onSearch: () => void; onNotifications: () => void; onWhatsApp: () => void; userName: string }) {
  const hasAwaiting = useAwaitingConversations().length > 0;
  const titles: Record<View, [string, string]> = { dashboard: ["Dashboard", "Visão geral do seu portal"], clientes: ["Clientes", "Acompanhe pessoas e processos"], "client-detail": ["Detalhes do Cliente", "Informações completas do cliente"], chargebacks: ["Chargebacks", "Solicitações de devolução em andamento"], atendimento: ["Atendimento", "Converse com seus clientes"], termos: ["Termos", "Quem já aceitou os termos do portal e quem está pendente"], saleshub: ["Sales HUB", "Centro de inteligência comercial e jurídico"], admin: ["Administração", "WhatsApp, backup e registro de ações"] };
  const initials = userName.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  return <header className="topbar"><button className="mobile-menu-button icon-button" onClick={onMenu} aria-label="Abrir menu"><Menu size={21} /></button><div><p className="breadcrumb">Zentry Soluções <ChevronRight size={14} /> {titles[view][0]}</p><h1>{titles[view][0]}</h1><span>{titles[view][1]}</span></div><div className="topbar-actions"><button className="icon-button" aria-label="Buscar clientes" title="Buscar clientes" onClick={onSearch}><Search size={19} /></button><button className="icon-button notification-button" aria-label="Abrir atendimentos" title="Abrir atendimentos" onClick={onNotifications}><Bell size={19} />{hasAwaiting && <span />}</button><WhatsAppIndicator onClick={onWhatsApp} /><ThemeToggle /><span className="topbar-separator" /><div className="topbar-user"><span className="avatar avatar-gold">{initials}</span><div><strong>{userName}</strong><small>Online agora</small></div></div></div></header>;
}

const formatInt = (value: number) => value.toLocaleString("pt-BR");
/** Integers while counting up: intermediate frames are rounded, the last one is the exact value. */
const formatCount = (value: number) => formatInt(Math.round(value));
const formatPercent = (value: number | null) => (value === null ? "—" : `${(value * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);

/** "agora", "há 18 min", "há 2 h", "ontem", "há 3 dias" or the date. */
function timeAgo(iso: string) {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.round(hours / 24);
  if (days === 1) return "ontem";
  if (days < 7) return `há ${days} dias`;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
}

const activityIcons = { check: CheckCircle2, file: FileText, alert: AlertTriangle, arrow: ArrowUpRight, message: MessageCircle, user: Users };

function deadlinePill(daysLeft: number): { tone: string; text: string } {
  if (daysLeft < 0) return { tone: "red", text: `Venceu há ${-daysLeft} dia${daysLeft === -1 ? "" : "s"}` };
  if (daysLeft === 0) return { tone: "red", text: "Vence hoje" };
  if (daysLeft <= 3) return { tone: "red", text: `Em ${daysLeft} dia${daysLeft === 1 ? "" : "s"}` };
  if (daysLeft <= 7) return { tone: "yellow", text: `Em ${daysLeft} dias` };
  return { tone: "blue", text: `Em ${daysLeft} dias` };
}

function Dashboard({ navigate, userName }: { navigate: (view: View, filter?: ListFilter) => void; userName: string }) {
  const setView = (view: View) => navigate(view);
  const [alertVisible, setAlertVisible] = useState(true);
  const awaiting = useAwaitingConversations();
  const latest = awaiting[0];
  const dashboardQuery = trpc.portal.dashboard.useQuery(undefined, { retry: false, refetchInterval: 60_000 });
  const data = dashboardQuery.data;
  const m = data?.metrics;
  const processos = data?.processos;
  const loading = "…";

  const heroes: { id: keyof typeof METRIC_HELP; label: string; value: ReactNode; detail: string; icon: typeof Users; target: View; filter?: ListFilter; alert?: boolean }[] = [
    { id: "ativos", label: "Clientes ativos", value: m ? <CountUp value={m.ativos} format={formatCount} /> : loading, detail: m ? `${formatInt(m.andamento)} em andamento · ${formatInt(m.atencao)} com atenção` : "", icon: Users, target: "clientes", filter: "ativos" },
    { id: "pendentes", label: "Solicitações pendentes", value: m ? <CountUp value={m.pendentes} format={formatCount} /> : loading, detail: m ? (m.pendentes ? "Conversas aguardando resposta" : "Nenhuma conversa esperando") : "", icon: MessageCircle, target: "atendimento", alert: (m?.pendentes ?? 0) > 0 },
    { id: "cbkAbertos", label: "Chargebacks abertos", value: m ? <CountUp value={m.cbkAbertos} format={formatCount} /> : loading, detail: m ? (m.ticketCbk === null ? "Sem valores registrados" : `Ticket médio ${hubMoney(m.ticketCbk)}`) : "", icon: CreditCard, target: "chargebacks", filter: "abertos", alert: (m?.prazosVencidos ?? 0) > 0 },
    { id: "reversao", label: "Taxa de reversão", value: m ? (m.reversao.percent === null ? formatPercent(null) : <CountUp value={m.reversao.percent} format={formatPercent} />) : loading, detail: m ? (m.reversao.encerrados ? `${m.reversao.revertidos} de ${m.reversao.encerrados} chargebacks encerrados` : "Nenhum caso encerrado ainda") : "", icon: ArrowUpRight, target: "chargebacks" },
  ];

  const attention: { id: ListFilter; label: string; help: string; value: number | undefined; target: View; severity: "yellow" | "red" }[] = [
    { id: "ociosos", label: CLIENT_LIST_FILTERS.ociosos, help: METRIC_HELP.ociosos, value: m?.ociosos, target: "clientes", severity: "yellow" },
    { id: "semAtualizacao", label: CLIENT_LIST_FILTERS.semAtualizacao, help: METRIC_HELP.semAtualizacao, value: m?.semAtualizacao, target: "clientes", severity: "yellow" },
    { id: "atencao", label: CLIENT_LIST_FILTERS.atencao, help: "Clientes ativos marcados como \"atenção necessária\".", value: m?.atencao, target: "clientes", severity: "red" },
    { id: "vencidos", label: CHARGEBACK_LIST_FILTERS.vencidos, help: "Chargebacks em aberto cujo prazo já passou.", value: m?.prazosVencidos, target: "chargebacks", severity: "red" },
  ];
  const attentionTotal = attention.reduce((sum, item) => sum + (item.value ?? 0), 0);

  const share = (n: number) => (processos && processos.total ? (n / processos.total) * 100 : 0);
  const donutBackground = processos && processos.total
    ? `conic-gradient(var(--chart-1) 0 ${share(processos.andamento)}%, var(--chart-2) ${share(processos.andamento)}% ${share(processos.andamento + processos.atencao)}%, var(--chart-3) ${share(processos.andamento + processos.atencao)}% 100%)`
    : "var(--surface-sunken)";

  return <div className="page-content dashboard-content">
    {alertVisible && latest && <div className="alert-banner"><div className="alert-icon"><Bell size={18} /></div><div><strong>{awaiting.length === 1 ? "1 conversa aguardando resposta" : `${awaiting.length} conversas aguardando resposta`}</strong><p>{latest.name} <span>·</span> {latest.ticketTopic ? `Ticket · ${latest.ticketTopic}: ` : ""}“{latest.lastText.length > 90 ? `${latest.lastText.slice(0, 90)}…` : latest.lastText}”</p></div><button className="banner-link" onClick={() => setView("atendimento")}>Responder <ArrowUpRight size={15} /></button><button className="banner-close icon-button" aria-label="Fechar" onClick={() => setAlertVisible(false)}><X size={16} /></button></div>}

    <div className="welcome-row"><div><span className="eyebrow eyebrow-muted">{new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</span><h2>Olá, {userName.split(" ")[0]}</h2><p>{m ? (attentionTotal || m.pendentes ? "Há itens que precisam da sua atenção hoje." : "Tudo em dia por aqui.") : "Carregando o resumo do portal..."}</p></div><button className="secondary-button" onClick={() => setView("clientes")}><Users size={16} /> Ver clientes</button></div>

    {dashboardQuery.error && <p className="dashboard-error" role="alert">Não foi possível calcular os indicadores agora: {dashboardQuery.error.message}</p>}

    <div className="kpi-grid">
      {heroes.map(({ id, label, value, detail, icon: Icon, target, filter, alert }) => <button key={id} type="button" className={`kpi-card ${alert ? "kpi-card-alert" : ""}`} title={METRIC_HELP[id]} onClick={() => navigate(target, filter)}>
        <span className="kpi-head"><span>{label}</span><span className="kpi-icon"><Icon size={17} /></span></span>
        <strong className={m || dashboardQuery.error ? undefined : "is-loading"}>{value}</strong>
        <small>{detail}</small>
      </button>)}
    </div>

    <div className="dashboard-columns">
      <section className="panel">
        <div className="panel-heading"><div><h3>Carteira de clientes</h3><p>Situação dos processos</p></div><button className="text-button" onClick={() => setView("clientes")}>Ver <ChevronRight size={15} /></button></div>
        <div className="donut-wrap"><div className="donut" key={processos ? "pronto" : "carregando"} style={{ "--donut-fill": donutBackground } as CSSProperties}><div className="donut-center"><strong>{processos ? <CountUp value={processos.total} format={formatCount} /> : loading}</strong><span>clientes</span></div></div><div className="legend"><div><i className="legend-dot dot-violet" /><span>Em andamento</span><strong>{processos ? <CountUp value={processos.andamento} format={formatCount} /> : loading}</strong></div><div><i className="legend-dot dot-yellow" /><span>Atenção</span><strong>{processos ? <CountUp value={processos.atencao} format={formatCount} /> : loading}</strong></div><div><i className="legend-dot dot-green" /><span>Concluídos</span><strong>{processos ? <CountUp value={processos.concluidos} format={formatCount} /> : loading}</strong></div></div></div>
        <div className="progress-caption"><span>Taxa de conclusão</span><strong>{formatPercent(processos?.taxaConclusao ?? null)}</strong></div><div className="progress-bar"><span style={{ width: `${(processos?.taxaConclusao ?? 0) * 100}%` }} /></div>
        <p className="panel-footnote" title={METRIC_HELP.desconsiderados}>{m ? <>{formatInt(m.desconsiderados)} desconsiderado(s) — suspensos ou com chargeback, fora das métricas.{m.desconsiderados > 0 && <> <button type="button" className="inline-link" onClick={() => navigate("clientes", "desconsiderados")}>Ver quais</button></>}</> : ""}</p>
      </section>

      <section className="panel">
        <div className="panel-heading"><div><h3>Pontos de atenção</h3><p>{m ? (attentionTotal ? `${formatInt(attentionTotal)} item(ns) para revisar` : "Nada pendente") : "Calculando..."}</p></div></div>
        <div className="attention-list">
          {attention.map((item) => {
            const count = item.value;
            const ok = count === 0;
            return <button key={item.id} type="button" className="attention-row" title={item.help} onClick={() => navigate(item.target, item.id)}>
              <span className={`attention-dot ${count === undefined ? "" : ok ? "attention-ok" : `attention-${item.severity}`}`} />
              <span className="attention-label">{item.label}</span>
              <span className={`attention-count ${count === undefined ? "" : ok ? "attention-count-ok" : `attention-count-${item.severity}`}`}>{count === undefined ? loading : ok ? "Em dia" : formatInt(count)}</span>
              <ChevronRight size={15} />
            </button>;
          })}
        </div>
        {data && !data.temDataDeAtualizacao && <p className="panel-footnote">Usando a data de cadastro até a data de atualização ser ativada no banco.</p>}
      </section>

      <section className="panel">
        <div className="panel-heading"><div><h3>Portal do cliente</h3><p>Uso do portal pelos clientes</p></div></div>
        <div className="portal-stats">
          <button type="button" className="portal-stat-link" title={METRIC_HELP.aceite} onClick={() => setView("termos")}>
            <div className="portal-stat-head"><span>Aceite do termo <ChevronRight size={14} /></span><strong>{m ? formatPercent(m.aceite.percent) : loading}</strong></div>
            <div className="progress-track"><span style={{ width: `${(m?.aceite.percent ?? 0) * 100}%` }} /></div>
            <small>{m ? `${m.aceite.aceitos} de ${m.aceite.elegiveis} clientes com login` : ""}</small>
          </button>
          <div title={METRIC_HELP.conversao}>
            <div className="portal-stat-head"><span>Solicitações respondidas</span><strong>{m ? formatPercent(m.conversao.percent) : loading}</strong></div>
            <div className="progress-track"><span style={{ width: `${(m?.conversao.percent ?? 0) * 100}%` }} /></div>
            <small>{m ? `${m.conversao.respondidas} de ${m.conversao.total} conversas` : ""}</small>
          </div>
          <div title={METRIC_HELP.ativos30d}>
            <div className="portal-stat-head"><span>Acessaram nos últimos {DASHBOARD_RULES.recentLoginDays} dias</span><strong>{m ? formatInt(m.ativos30d) : loading}</strong></div>
            <small>{m ? (m.aceite.elegiveis ? `de ${m.aceite.elegiveis} cliente(s) com login` : "Nenhum cliente com login ainda") : ""}</small>
          </div>
        </div>
      </section>
    </div>

    <div className="dashboard-columns dashboard-columns-wide">
      <section className="panel recent-panel"><div className="panel-heading"><div><h3>Atividade recente</h3><p>Últimos acontecimentos no portal</p></div></div>
        <div className="activity-list">
          {data && data.atividade.length === 0 && <p className="dashboard-empty">Nenhuma atividade registrada ainda.</p>}
          {!data && <LoadingRows />}
          {data?.atividade.map((item, index) => {
            const Icon = activityIcons[item.icon];
            return <div className="activity-item" key={`${item.at}-${index}`}><span className={`activity-icon activity-${item.kind}`}><Icon size={16} /></span><div><strong>{item.title}</strong><p>{item.detail}</p></div><time dateTime={item.at}>{timeAgo(item.at)}</time></div>;
          })}
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading"><div><h3>Próximos prazos</h3><p>Chargebacks em aberto</p></div><button className="text-button" onClick={() => setView("chargebacks")}>Ver todos <ChevronRight size={15} /></button></div>
        {data && data.prazos.length === 0 && <p className="dashboard-empty">Nenhum prazo em aberto.</p>}
        {!data && <LoadingRows />}
        {data && data.prazos.length > 0 && <div className="deadline-list">{data.prazos.map((prazo) => {
          const date = new Date(prazo.date);
          const pill = deadlinePill(prazo.daysLeft);
          return <div className="deadline-row" key={`${prazo.client}-${prazo.date}`}><span className={`calendar-box ${pill.tone === "red" ? "calendar-red" : pill.tone === "yellow" ? "calendar-yellow" : ""}`}><b>{String(date.getDate()).padStart(2, "0")}</b><small>{date.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "").toUpperCase()}</small></span><div><strong>{prazo.client}</strong><p>{prazo.title}</p></div><StatusPill tone={pill.tone}>{pill.text}</StatusPill></div>;
        })}</div>}
      </section>
    </div>
  </div>;
}

/** Shows which dashboard filter a list is under, with a way out. */
export function ListFilterBar({ label, count, noun, onClear }: { label: string; count: number | undefined; noun: string; onClear: () => void }) {
  return <div className="list-filter-bar" role="status">
    <span>Filtro do painel: <b>{label}</b>{count !== undefined && <> · {count} {noun}</>}</span>
    <button type="button" className="text-button" onClick={onClear}>Limpar filtro <X size={14} /></button>
  </div>;
}

function ClientsPage({ setView, selectedClient, setSelectedClient, listFilter, onClearFilter }: { setView: (view: View) => void; selectedClient: Client | null; setSelectedClient: (client: Client | null) => void; listFilter: ClientListFilter | null; onClearFilter: () => void }) {
  const dashboardQuery = trpc.portal.dashboard.useQuery(undefined, { retry: false, enabled: listFilter !== null });
  const filterIds = listFilter ? dashboardQuery.data?.listas.clientes[listFilter] : undefined;
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "attention">("all");
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [newClient, setNewClient] = useState({ name: "", email: "", cpf: "", phone: "", services: [] as string[] });

  // Supabase-backed data
  const clientesQuery = trpc.portal.clientes.useQuery(undefined, { retry: false });
  const createClienteMutation = trpc.portal.createCliente.useMutation({
    onSuccess: (created) => {
      clientesQuery.refetch();
      showAccessResult(created.access, "Cliente cadastrado.");
    },
    onError: (error) => toast.error(`Não foi possível cadastrar o cliente: ${error.message}`),
  });
  const remoteClientes = clientesQuery.data;
  const clientList: Client[] = useMemo(() => {
    return remoteClientes ? newestFirst(remoteClientes as Record<string, unknown>[]).map(toClient) : [];
  }, [remoteClientes]);

  const filtered = useMemo(() => clientList.filter((client) => {
    if (listFilter) {
      // Same records the dashboard counted (ids computed on the server)
      if (!filterIds || client.id === undefined || !filterIds.includes(client.id)) return false;
      return matchesClientSearch(client, query);
    }
    const matchesQuery = matchesClientSearch(client, query);
    const matchesStatus = statusFilter === "all" || (statusFilter === "attention" ? client.tone === "red" : client.status !== "Concluído" && client.tone !== "red");
    return matchesQuery && matchesStatus;
  }), [clientList, query, statusFilter, listFilter, filterIds]);
  // 30 rows per page; search and filters still cover the whole portfolio.
  const pagination = usePagination(filtered, `${query}|${statusFilter}|${listFilter}`);
  const visible = pagination.visible;
  const activeCount = clientList.filter((client) => client.status !== "Concluído" && client.tone !== "red").length;
  const attentionCount = clientList.filter((client) => client.tone === "red").length;

  function registerClient(event: FormEvent) {
    event.preventDefault();
    const clientData = {
      name: newClient.name.trim(),
      cpf: newClient.cpf.trim(),
      type: newClient.services.join(", "),
      status: INITIAL_STATUS.label,
      updated: "Agora",
      tone: INITIAL_STATUS.tone,
      email: newClient.email.trim() || undefined,
      phone: newClient.phone.trim() || undefined,
      services: newClient.services,
    };
    createClienteMutation.mutate(clientData);
    setNewClient({ name: "", email: "", cpf: "", phone: "", services: [] });
    setRegistrationOpen(false);
  }

  return (
    <div className="page-content">
      <div className="page-actions">
        <div className="search-field">
          <Search size={17} />
          <input placeholder="Buscar por nome, telefone ou tipo de processo" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <button className="primary-button" onClick={() => setRegistrationOpen(true)}><Users size={16} /> Cadastrar clientes</button>
      </div>
      <section className="panel table-panel">
        <div className="panel-heading">
          <div><h3>Carteira de clientes</h3><p>{filtered.length} cliente(s) ·{clientesQuery.isLoading ? "Carregando..." : remoteClientes && remoteClientes.length > 0 ? "dados do Supabase" : "dados de demonstração"}</p></div>
          <div className="filter-buttons"><button className={statusFilter === "all" && !listFilter ? "filter-active" : ""} onClick={() => { onClearFilter(); setStatusFilter("all"); }}>Todos <b>{clientList.length}</b></button><button className={statusFilter === "active" && !listFilter ? "filter-active" : ""} onClick={() => { onClearFilter(); setStatusFilter("active"); }}>Em andamento <b>{activeCount}</b></button><button className={statusFilter === "attention" && !listFilter ? "filter-active" : ""} onClick={() => { onClearFilter(); setStatusFilter("attention"); }}>Atenção <b>{attentionCount}</b></button></div>
        </div>
        {listFilter && <ListFilterBar label={CLIENT_LIST_FILTERS[listFilter]} count={filterIds ? filtered.length : undefined} noun="cliente(s)" onClear={onClearFilter} />}
        <div className="table-wrap">
          <table>
            <thead><tr><th>Nome</th><th>CPF</th><th>Status</th><th>Tags</th><th>Atualização</th><th /></tr></thead>
            <tbody>{filtered.length === 0 && <tr className="empty-row"><td colSpan={6}>{listFilter && !filterIds ? "Carregando..." : listFilter ? "Nenhum cliente nesta situação. Tudo em dia!" : "Nenhum cliente encontrado."}</td></tr>}{visible.map((client) => <tr key={client.name} onClick={() => { setSelectedClient(client); setView("client-detail"); }}><td><div className="table-person"><span className="avatar avatar-gradient">{client.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><strong>{client.name}</strong></div></td><td>{client.cpf}</td><td><StatusPill tone={client.tone}>{client.status}</StatusPill></td><td><div className="tags-container">{client.tags && client.tags.length > 0 ? client.tags.map((tag) => <span key={tag} className="client-tag">{tag}</span>) : <span className="no-tags">-</span>}</div></td><td className="muted-cell">{client.updated}</td><td><button className="row-more icon-button" aria-label="Abrir cliente"><ChevronRight size={17} /></button></td></tr>)}</tbody>
          </table>
        </div>
        <Pager {...pagination} noun="clientes" />
      </section>
      {registrationOpen &&<div className="hub-modal-backdrop" onClick={() => setRegistrationOpen(false)}>
        <section className="hub-modal" role="dialog" aria-modal="true" aria-labelledby="client-registration-title" onClick={(event) => event.stopPropagation()}>
          <button type="button" className="drawer-close icon-button" onClick={() => setRegistrationOpen(false)} aria-label="Fechar cadastro"><X size={18} /></button>
          <span className="eyebrow saleshub-eyebrow">Carteira de clientes</span>
          <h2 id="client-registration-title">Cadastrar cliente</h2>
          <form onSubmit={registerClient}>
            <div className="new-sale-grid">
              <label>Nome completo<input required autoFocus value={newClient.name} onChange={(event) => setNewClient((current) => ({ ...current, name: event.target.value }))} /></label>
              <label>E-mail<input required type="email" value={newClient.email} onChange={(event) => setNewClient((current) => ({ ...current, email: event.target.value }))} /></label>
              <label>CPF<input required inputMode="numeric" placeholder="000.000.000-00" value={newClient.cpf} onChange={(event) => setNewClient((current) => ({ ...current, cpf: event.target.value }))} /></label>
              <label>Telefone<input required type="tel" placeholder="(11) 90000-0000" value={newClient.phone} onChange={(event) => setNewClient((current) => ({ ...current, phone: event.target.value }))} /></label>
            </div>
            <fieldset className="client-service-selection">
              <legend>Serviços contratados</legend>
              <div className="client-service-options">{clientServices.map((service) => <label key={service}><input type="checkbox" checked={newClient.services.includes(service)} required={newClient.services.length === 0} onChange={(event) => setNewClient((current) => ({ ...current, services: event.target.checked ? [...current.services, service] : current.services.filter((item) => item !== service) }))} /><span>{service}</span></label>)}</div>
            </fieldset>
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setRegistrationOpen(false)}>Cancelar</button><button type="submit" className="hub-primary">Cadastrar cliente</button></div>
          </form>
        </section>
      </div>}
    </div>
  );
}

const avatarTones = ["avatar-coral", "avatar-green", "avatar-purple", "avatar-blue"];
const initialsOf = (name: string) => name.split(" ").filter(Boolean).slice(0, 2).map((word) => word[0].toUpperCase()).join("");
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const yesterday = () => new Date(Date.now() - 86_400_000);

/** "09:42" today, "Ontem", or "26/09" for the conversation list. */
function shortWhen(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  if (sameDay(date, new Date())) return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (sameDay(date, yesterday())) return "Ontem";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/** Separator shown in the chat when the day changes. */
function dayLabel(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  if (sameDay(date, new Date())) return "Hoje";
  if (sameDay(date, yesterday())) return "Ontem";
  return date.toLocaleDateString("pt-BR", { day: "numeric", month: "long" });
}

function AtendimentoPage({ isAdmin }: { isAdmin: boolean }) {
  const utils = trpc.useUtils();
  const conversasQuery = trpc.portal.conversas.useQuery(undefined, { retry: false, refetchInterval: 15_000 });
  const conversations = conversasQuery.data ?? [];
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const activeId = selectedId ?? conversations[0]?.clientId ?? null;
  const selected = conversations.find((conversation) => conversation.clientId === activeId) ?? null;
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [draft, setDraft] = useState("");
  const chatBody = useRef<HTMLDivElement>(null);

  const mensagensQuery = trpc.portal.mensagens.useQuery({ clientId: activeId ?? 0 }, { enabled: activeId !== null, retry: false, refetchInterval: 15_000 });
  const messages = activeId === null ? [] : mensagensQuery.data ?? [];
  // Only messages that arrive while the conversation is open slide in, not the loaded history.
  const arrived = useArrivedIds(activeId, activeId === null ? undefined : mensagensQuery.data?.map((message) => message.id));
  const sendMensagemMutation = trpc.portal.sendMensagem.useMutation({
    // Stays pending until the reply shows in the chat and the list stops flagging the conversation.
    onSuccess: () => Promise.all([mensagensQuery.refetch(), utils.portal.conversas.invalidate()]),
    onError: (_error, variables) => setDraft((current) => current || variables.text),
  });
  const pendingText = sendMensagemMutation.isPending ? sendMensagemMutation.variables?.text : undefined;
  const marcarRespondida = trpc.portal.marcarRespondida.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.portal.conversas.invalidate(), utils.portal.dashboard.invalidate()]);
      toast.success("Conversa marcada como respondida.");
    },
    onError: (error) => toast.error(error.message),
  });
  const [confirmClear, setConfirmClear] = useState(false);
  const apagarConversa = trpc.portal.apagarConversa.useMutation({
    onSuccess: async () => {
      toast.success("Conversa apagada.");
      setConfirmClear(false);
      setSelectedId(null);
      await Promise.all([utils.portal.conversas.invalidate(), utils.portal.mensagens.invalidate(), utils.portal.dashboard.invalidate()]);
    },
    onError: (error) => toast.error(error.message),
  });

  const visibleConversations = conversations.filter((conversation) => conversation.name.toLowerCase().includes(searchQuery.toLowerCase()));
  const awaitingCount = conversations.filter((conversation) => conversation.awaitingReply).length;

  useEffect(() => {
    const body = chatBody.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [activeId, messages.length, pendingText]);

  function sendMessage(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !selected || sendMensagemMutation.isPending) return;
    sendMensagemMutation.mutate({ clientId: selected.clientId, clientName: selected.name, sender: "team", text });
    setDraft("");
  }

  function downloadTranscript() {
    if (!selected) return;
    const transcript = messages.map((message) => `${message.time} · ${message.from === "team" ? "Equipe" : selected.name}: ${message.text}`).join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([transcript], { type: "text/plain;charset=utf-8" }));
    link.download = `conversa-${selected.name.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-")}.txt`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return <div className="page-content support-page"><div className="support-layout">
    <section className="panel conversation-list">
      <div className="conversation-head"><div><h3>Conversas</h3><p>{conversations.length} conversa(s){awaitingCount > 0 && <> · <b className="conversation-waiting-count">{awaitingCount} aguardando resposta</b></>}</p></div><button className="icon-button" aria-label="Buscar conversas" title="Buscar conversas" onClick={() => { setSearchOpen((open) => !open); setSearchQuery(""); }}><Search size={17} /></button></div>
      {searchOpen && <div className="conversation-search"><input autoFocus placeholder="Buscar pelo nome do cliente..." value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} /></div>}
      {conversasQuery.isLoading && <p className="conversation-empty">Carregando conversas...</p>}
      {!conversasQuery.isLoading && visibleConversations.length === 0 && <p className="conversation-empty">{searchQuery ? "Nenhuma conversa encontrada." : "Nenhuma conversa ainda. Quando um cliente escrever pelo portal, ela aparece aqui."}</p>}
      {visibleConversations.map((conversation) => <button key={conversation.clientId} className={`conversation conversation-button ${activeId === conversation.clientId ? "active-conversation" : ""}`} onClick={() => setSelectedId(conversation.clientId)}>
        <span className={`avatar ${avatarTones[conversation.clientId % avatarTones.length]}`}>{initialsOf(conversation.name)}</span>
        <div>
          <strong>{conversation.name}</strong>
          <p>{conversation.lastFrom === "team" ? "Você: " : ""}{conversation.lastText}</p>
          <small>{shortWhen(conversation.lastAt)}{conversation.awaitingReply && <span className="conversation-waiting">{conversation.ticketTopic ? `Ticket · ${conversation.ticketTopic}` : "Aguardando resposta"}</span>}</small>
        </div>
        {conversation.awaitingReply && <span className="unread-dot" />}
      </button>)}
    </section>
    <section className="panel chat-panel">
      {selected ? <>
        <div className="chat-head"><div className="table-person"><span className={`avatar ${avatarTones[selected.clientId % avatarTones.length]}`}>{initialsOf(selected.name)}</span><div><strong>{selected.name}</strong><small>{[selected.type, selected.status].filter(Boolean).join(" · ") || "Processo acompanhado pela equipe"}</small></div></div><div className="chat-head-actions">{selected.awaitingReply && <button className="secondary-button chat-mark-answered" aria-label="Marcar como respondida" title="Tira a conversa de &quot;aguardando resposta&quot; sem mandar mensagem. Se o cliente escrever de novo, ela volta." disabled={marcarRespondida.isPending} onClick={() => marcarRespondida.mutate({ clientId: selected.clientId })}><CheckCheck size={16} /><span>{marcarRespondida.isPending ? "Marcando..." : "Marcar como respondida"}</span></button>}<button className="icon-button" aria-label="Baixar conversa" title="Baixar conversa" onClick={downloadTranscript}><FileText size={17} /></button>{isAdmin && <button className="icon-button chat-clear-button" aria-label="Apagar conversa" title="Apagar conversa" onClick={() => setConfirmClear(true)}><Trash2 size={17} /></button>}</div></div>
        <AlertDialog open={confirmClear} onOpenChange={(open) => !apagarConversa.isPending && setConfirmClear(open)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Apagar a conversa com {selected.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                Todas as mensagens, chamados e respostas do assistente serão apagados para sempre, aqui e no portal do cliente. O cadastro do cliente continua. Se precisar guardar uma cópia, baixe a conversa antes.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={apagarConversa.isPending}>Cancelar</AlertDialogCancel>
              <Button variant="destructive" disabled={apagarConversa.isPending} onClick={() => apagarConversa.mutate({ clientId: selected.clientId })}>
                <Trash2 size={16} />
                {apagarConversa.isPending ? "Apagando..." : "Apagar conversa"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <div className="chat-body" ref={chatBody}>
          {mensagensQuery.isLoading && <div className="chat-date">Carregando mensagens...</div>}
          {messages.map((message, index) => {
            const ticket = parseTicketMessage(message.text);
            const day = dayLabel(message.createdAt);
            const showDay = day && day !== dayLabel(messages[index - 1]?.createdAt ?? null);
            return <Fragment key={message.id}>
              {showDay && <div className="chat-date">{day}</div>}
              <div className={`chat-message ${message.from === "team" ? "message-team" : "message-client"}${message.from !== "team" && arrived(message.id) ? " chat-message-new" : ""}`}>
                {ticket && <span className="ticket-label">Ticket · {ticket.topic}</span>}
                <p>{ticket ? ticket.body : message.text}</p>
                <small>{message.time} {message.from === "team" && <CheckCircle2 size={12} />}</small>
              </div>
            </Fragment>;
          })}
          {pendingText && <div className="chat-message message-team chat-message-pending"><p>{pendingText}</p><small>Enviando...</small></div>}
        </div>
        {sendMensagemMutation.error && <p className="chat-send-error" role="alert">Não foi possível enviar a mensagem. Tente novamente.</p>}
        <form className="chat-composer" onSubmit={sendMessage}><input aria-label={`Responder a ${selected.name}`} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={`Responder a ${selected.name.split(" ")[0]}...`} maxLength={2000} /><button type="submit" className="send-button" aria-label="Enviar mensagem" title="Enviar mensagem" disabled={sendMensagemMutation.isPending || !draft.trim()}><Send size={17} /></button></form>
      </> : <div className="chat-empty"><MessageCircle size={28} /><p>{conversasQuery.isLoading ? "Carregando..." : "Selecione uma conversa para ver as mensagens."}</p></div>}
    </section>
  </div></div>;
}

/** Warns the team while the notebook that runs the portal is on battery and about to go offline. */
function PowerBanner() {
  const energia = trpc.portal.energia.useQuery(undefined, { retry: false, refetchInterval: 30_000, refetchIntervalInBackground: true });
  const state = energia.data?.energia;
  const clientsBlocked = energia.data?.manutencaoClientes === true;
  if (!clientsBlocked && (!state || state.naTomada)) return null;
  if (!state || state.naTomada) {
    return <div className="power-banner" role="status"><Plug size={18} /><div><strong>Portal em manutenção para os clientes</strong><p>Ligado à mão com MANUTENCAO=on no .env. A equipe continua usando normalmente.</p></div></div>;
  }
  const battery = [state.bateria !== null && `bateria em ${state.bateria}%`, state.minutosRestantes && `cerca de ${state.minutosRestantes} min restantes`].filter(Boolean).join(" · ");
  return <div className={`power-banner ${clientsBlocked ? "" : "power-banner-soft"}`} role="alert"><Plug size={18} /><div><strong>O notebook do portal está fora da tomada{battery ? ` (${battery})` : ""}</strong><p>{clientsBlocked
    ? "Bateria acabando: os clientes já estão vendo a tela \"Em manutenção\". Ligue o carregador agora."
    : "Por enquanto tudo funciona para a equipe e para os clientes. Não feche a tampa nem deixe o notebook parado: se ele dormir, o portal sai do ar."}</p></div></div>;
}

const STAFF_PUSH_DISMISSED_KEY = "zentry-staff-push-dismissed";

/** Offers this team member a notice on the phone or computer whenever a client writes in the portal. */
function StaffPushBanner() {
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem(STAFF_PUSH_DISMISSED_KEY) === "1"; } catch { return false; } });
  const chave = trpc.portal.chaveNotificacoes.useQuery(undefined, { retry: false, enabled: pushSupported(), staleTime: Infinity });
  const ativar = trpc.portal.ativarNotificacoes.useMutation();
  const push = usePushDevice(chave.data?.publicKey, ativar.mutateAsync);
  // On iPhone the notices only exist in the app added to the home screen.
  const iosBrowser = !push.supported && isIosSafari() && !isInstalledApp();
  if (dismissed || push.state === null || push.state === "on" || (push.state === "unsupported" && !iosBrowser)) return null;
  function dismiss() {
    setDismissed(true);
    try { localStorage.setItem(STAFF_PUSH_DISMISSED_KEY, "1"); } catch { /* only a convenience */ }
  }
  return <div className="power-banner staff-push-banner" role="status"><BellRing size={18} /><div>
    <strong>Receba um aviso quando um cliente mandar mensagem</strong>
    <p>{iosBrowser
      ? "No iPhone, toque em Compartilhar → Adicionar à Tela de Início e abra o portal pelo ícone; o botão para ativar aparece lá."
      : push.state === "denied"
        ? "As notificações do portal estão bloqueadas neste aparelho. Libere nas configurações do navegador ou do celular."
        : "A notificação chega neste aparelho mesmo com o portal fechado, e abre o Atendimento."}</p>
    {push.error && <p className="form-message">{push.error}</p>}
  </div>
  {push.state === "off" && <button type="button" className="primary-button" disabled={push.busy || !chave.data} onClick={() => void push.enable()}>{push.busy ? "Ativando..." : "Ativar notificações"}</button>}
  <button type="button" className="icon-button" aria-label="Fechar" onClick={dismiss}><X size={16} /></button></div>;
}

/** Shimmering placeholder rows while a panel loads. */
function LoadingRows() { return <div className="skeleton-list" role="status" aria-label="Carregando..."><i /><i /><i /></div>; }

function MoreIcon() { return <span className="more-icon"><i /><i /><i /></span>; }

export default function Home() {
  const [loggedIn, setLoggedIn] = useState(false);
  // Until the saved session has been read, it is not known whether to show the login or the portal.
  const [sessionChecked, setSessionChecked] = useState(false);
  // A tap on a notice opens its page (see sw.js): a client's message opens Atendimento, new sales open the Sales HUB.
  const [view, setView] = useState<View>(() => {
    const requested = new URLSearchParams(window.location.search).get("view");
    return requested === "atendimento" || requested === "saleshub" ? requested : "dashboard";
  });
  // Filter chosen on the dashboard; opening a page from the menu clears it.
  const [listFilter, setListFilter] = useState<ListFilter | null>(null);
  function navigate(next: View, filter?: ListFilter) {
    setListFilter(filter ?? null);
    setView(next);
  }
  const clientFilter = listFilter && listFilter in CLIENT_LIST_FILTERS ? (listFilter as ClientListFilter) : null;
  const chargebackFilter = listFilter && listFilter in CHARGEBACK_LIST_FILTERS ? (listFilter as ChargebackListFilter) : null;
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [userName, setUserName] = useState("Usuário");
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  // A sale marked with chargeback in the Sales HUB opens the chargeback form already filled in.
  const [chargebackDraft, setChargebackDraft] = useState<ChargebackDraft | null>(null);
  const clearChargebackDraft = useCallback(() => setChargebackDraft(null), []);
  const openClientRow = (row: Record<string, unknown>) => { setSelectedClient(toClient(row)); setView("client-detail"); };
  // Logins created automatically when a client is registered carry role "client" in app_metadata.
  const [isClientUser, setIsClientUser] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(false);

  function applySession(session: Session | null) {
    if (!session) return;
    const meta = session.user.user_metadata;
    const name = meta?.full_name || meta?.name || session.user.email?.split("@")[0] || "Usuário";
    setUserName(name);
    setIsClientUser(session.user.app_metadata?.role === "client");
    setMustChangePassword(meta?.must_change_password === true);
  }

  // On mount, check if there's already an active session
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        applySession(data.session);
        setLoggedIn(true);
      }
    }).finally(() => setSessionChecked(true));
  }, []);

  function handleLogin() {
    supabase.auth.getSession().then(({ data }) => {
      applySession(data.session);
      setLoggedIn(true);
    });
  }

  // Logging in is not enough for the team area: the server says whether this account was released for it.
  const acessoQuery = trpc.account.meuAcesso.useQuery(undefined, { enabled: loggedIn && !isClientUser, retry: false, staleTime: Infinity });
  const isAdmin = acessoQuery.data?.kind === "staff" && acessoQuery.data.isAdmin === true;
  const queryClient = useQueryClient();

  async function handleLogout() {
    await supabase.auth.signOut();
    // Nothing loaded for one account may show up for the next one on this browser.
    queryClient.clear();
    setLoggedIn(false);
    setUserName("Usuário");
    setIsClientUser(false);
    setMustChangePassword(false);
  }

  if (!sessionChecked) return <BrandLoader />;
  if (!loggedIn) return <LoginScreen onLogin={handleLogin} />;
  if (mustChangePassword) return <ChangePasswordScreen onDone={() => setMustChangePassword(false)} onLogout={handleLogout} />;
  if (isClientUser) return <ClientPortal onLogout={handleLogout} />;
  if (acessoQuery.isPending) return <BrandLoader />;
  if (acessoQuery.data?.kind === "pending") {
    return (
      <main className="client-portal-center">
        <div className="login-panel-inner">
          <ZentryLogo size="md" />
          <h2>Acesso em análise</h2>
          <p className="login-subtitle">Sua conta foi criada, mas ainda precisa ser liberada pela administração da Zentry Soluções para abrir a área da equipe. Assim que for liberada, é só entrar de novo.</p>
          <button className="link-button" type="button" onClick={handleLogout}>Sair</button>
        </div>
      </main>
    );
  }
  return (
    <div className="app-shell">
      {mobileMenu && (
        <>
          <div className="sidebar-overlay visible" onClick={() => setMobileMenu(false)} />
          <div className="mobile-sidebar mobile-sidebar-open">
            <div className="mobile-sidebar-head">
              <Logo size="md" />
              <button className="icon-button" onClick={() => setMobileMenu(false)} aria-label="Fechar menu">
                <X size={20} />
              </button>
            </div>
            <Sidebar view={view} setView={(next) => { navigate(next); setMobileMenu(false); }} collapsed={false} setCollapsed={() => undefined} onLogout={handleLogout} userName={userName} isAdmin={isAdmin} />
          </div>
        </>
      )}
      <Sidebar view={view} setView={(next) => navigate(next)} collapsed={collapsed} setCollapsed={setCollapsed} onLogout={handleLogout} userName={userName} isAdmin={isAdmin} />
      <main className={`main-area ${collapsed ? "main-area-wide" : ""}`}>
        <Topbar view={view} onMenu={() => setMobileMenu(true)} onSearch={() => navigate("clientes")} onNotifications={() => navigate("atendimento")} onWhatsApp={() => navigate(isAdmin ? "admin" : "atendimento")} userName={userName} />
        <PowerBanner />
        <StaffPushBanner />
        {view === "dashboard" && <Dashboard navigate={navigate} userName={userName} />}
        {view === "clientes" && <ClientsPage setView={setView} selectedClient={selectedClient} setSelectedClient={setSelectedClient} listFilter={clientFilter} onClearFilter={() => setListFilter(null)} />}
        {view === "client-detail" && selectedClient && <Suspense fallback={<div className="page-content"><LoadingRows /></div>}><ClientDetail client={selectedClient} onBack={() => setView("clientes")} isAdmin={isAdmin} /></Suspense>}
        {view === "chargebacks" && <Suspense fallback={<div className="page-content"><LoadingRows /></div>}><ChargebacksPage listFilter={chargebackFilter} onClearFilter={() => setListFilter(null)} isAdmin={isAdmin} draft={chargebackDraft} onDraftUsed={clearChargebackDraft} onOpenClient={openClientRow} /></Suspense>}
        {view === "atendimento" && <AtendimentoPage isAdmin={isAdmin} />}
        {view === "termos" && <Suspense fallback={<div className="page-content"><LoadingRows /></div>}><TermosPage onOpenClient={openClientRow} /></Suspense>}
        {view === "admin" && isAdmin && <Suspense fallback={<div className="page-content"><LoadingRows /></div>}><AdminPage /></Suspense>}
        {view === "saleshub" && <Suspense fallback={<div className="page-content"><LoadingRows /></div>}><SalesHubPage userName={userName} isAdmin={isAdmin} onChargeback={(draft) => { setChargebackDraft(draft); navigate("chargebacks"); }} /></Suspense>}
        <footer className="app-footer">© 2026 Zentry Soluções <span>·</span> Todos os direitos reservados.</footer>
      </main>
    </div>
  );
}
