import { FormEvent, useMemo, useState } from "react";
import { ChevronRight, Eye, EyeOff, LinkIcon } from "lucide-react";
import { ZentryLogo } from "@/components/ZentryLogo";
import { MaintenanceScreen, useMaintenance } from "@/components/MaintenanceScreen";
import { ThemeToggle } from "@/components/ThemeToggle";
import { supabase } from "@/lib/supabase";
import { trpc } from "@/lib/trpc";

/**
 * Opened from the link sent by e-mail / WhatsApp when the client is registered.
 * The client creates their password here and lands in the portal (terms come next).
 */
export default function FirstAccess() {
  const { maintenance, retry, checking } = useMaintenance();
  if (maintenance) return <MaintenanceScreen onRetry={retry} checking={checking} />;
  return <FirstAccessForm />;
}

function FirstAccessForm() {
  const { u, t } = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return { u: params.get("u") ?? "", t: params.get("t") ?? "" };
  }, []);
  const info = trpc.account.primeiroAcessoInfo.useQuery({ u, t }, { retry: false, refetchOnWindowFocus: false });
  const definirSenha = trpc.account.definirSenhaPrimeiroAcesso.useMutation();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [signingIn, setSigningIn] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    if (password.length < 8) return setMessage("A senha precisa ter pelo menos 8 caracteres.");
    if (password !== confirmPassword) return setMessage("As senhas não conferem.");
    try {
      const { email } = await definirSenha.mutateAsync({ u, t, password });
      setSigningIn(true);
      await supabase.auth.signInWithPassword({ email, password });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível salvar a senha.");
      return;
    }
    // Full reload drops the token from the address bar and opens the portal with the new session.
    window.location.replace("/");
  }

  const valid = info.data?.valid ? info.data : null;

  return (
    <main className="client-portal-center">
      <ThemeToggle className="login-theme-toggle" />
      <div className="login-panel-inner">
        <ZentryLogo size="md" />
        {info.isLoading ? (
          <p className="login-subtitle first-access-loading">Abrindo seu link de acesso...</p>
        ) : !valid ? (
          <>
            <h2>Link expirado</h2>
            <p className="login-subtitle">Este link de acesso expirou ou já foi usado. Peça um novo link à equipe da Zentry Soluções ou, se você já criou sua senha, entre normalmente.</p>
            <a className="primary-button login-button" href="/">Ir para o login <ChevronRight size={18} /></a>
          </>
        ) : (
          <>
            <h2>Olá, {valid.firstName || "cliente"}!</h2>
            <p className="login-subtitle">Crie sua senha para acessar o portal. Depois disso, você aceita os termos de uso e já vê o andamento do seu processo.</p>
            <form onSubmit={submit} className="login-form">
              <label>Seu login<input type="email" value={valid.email} readOnly aria-readonly="true" className="input-readonly" /></label>
              <label>Crie uma senha<div className="password-wrap"><input required minLength={8} autoFocus autoComplete="new-password" type={showPassword ? "text" : "password"} placeholder="Mínimo de 8 caracteres" value={password} onChange={(event) => setPassword(event.target.value)} /><button type="button" className="password-toggle" aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
              <label>Confirme a senha<input required minLength={8} autoComplete="new-password" type={showPassword ? "text" : "password"} placeholder="Digite a senha novamente" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
              {message && <p className="form-message">{message}</p>}
              <button className="primary-button login-button" type="submit" disabled={definirSenha.isPending || signingIn}>{definirSenha.isPending || signingIn ? "Entrando..." : "Criar senha e entrar"} <ChevronRight size={18} /></button>
            </form>
            <p className="first-access-note"><LinkIcon size={13} /> Este link funciona uma única vez.</p>
          </>
        )}
      </div>
    </main>
  );
}
