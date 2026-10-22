import { useState } from "react";
import { Bell, BellOff, CheckCircle2, Download, Share, Smartphone, SquarePlus, X } from "lucide-react";
import { isInstalledApp, isIosSafari, useInstallPrompt } from "@/lib/installPrompt";
import { pushSupported } from "@/lib/pushNotifications";
import { usePushDevice } from "@/hooks/usePushDevice";
import { trpc } from "@/lib/trpc";

const DISMISSED_KEY = "zentry-install-card-dismissed";

function wasDismissed() {
  try { return localStorage.getItem(DISMISSED_KEY) === "1"; } catch { return false; }
}

/**
 * The two steps the client agreed to with the terms: the portal as an app on the device, and its
 * notifications (reply from the team, status change, new document). Each step needs a tap of its
 * own, because browsers only show these questions after one. Hidden once both are done or dismissed.
 */
export function AppSetupCard() {
  const { canPrompt, installedNow, install } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(wasDismissed);
  const chave = trpc.cliente.chaveNotificacoes.useQuery(undefined, { retry: false, enabled: pushSupported(), staleTime: Infinity });
  const ativar = trpc.cliente.ativarNotificacoes.useMutation();
  const { state: push, busy, error: message, enable: enableNotifications } = usePushDevice(chave.data?.publicKey, ativar.mutateAsync);

  const installed = isInstalledApp();
  const ios = isIosSafari();

  // iPhone/iPad: notifications only exist inside the installed app.
  const installStep = installed || installedNow ? "done" : canPrompt ? "button" : ios ? "ios" : null;
  const pushStep = push === "on" ? "done" : push === "denied" ? "denied" : push === "off" ? "button" : ios && !installed ? "after-install" : null;
  const pending = (installStep && installStep !== "done") || (pushStep && pushStep !== "done");
  if (dismissed || push === null || !pending) return null;

  function dismiss() {
    setDismissed(true);
    try { localStorage.setItem(DISMISSED_KEY, "1"); } catch { /* only a convenience */ }
  }

  return (
    <section className="client-portal-card install-app-card">
      <button type="button" className="icon-button install-app-close" onClick={dismiss} aria-label="Fechar"><X size={16} /></button>
      <span className="install-app-icon" aria-hidden="true"><Smartphone size={20} /></span>
      <div>
        <h2>Receba os avisos do seu processo</h2>
        <p>Com o app da Zentry no aparelho, você é avisado na hora quando a equipe responde, quando o processo muda de situação e quando chega um documento novo.</p>
        <ol className="app-setup-steps">
          {installStep && <li className={installStep === "done" ? "app-setup-done" : undefined}>
            <strong>{installStep === "done" ? <CheckCircle2 size={16} /> : <span className="app-setup-number">1</span>} Instalar o app</strong>
            {installStep === "button" && <button type="button" className="primary-button install-app-button" onClick={() => void install()}><Download size={16} /> Instalar app</button>}
            {installStep === "ios" && <p>No Safari, toque em <b><Share size={14} className="install-inline-icon" /> Compartilhar</b> e depois em <b><SquarePlus size={14} className="install-inline-icon" /> Adicionar à Tela de Início</b>. Depois abra o portal pelo ícone da Zentry.</p>}
          </li>}
          {pushStep && <li className={pushStep === "done" ? "app-setup-done" : undefined}>
            <strong>{pushStep === "done" ? <CheckCircle2 size={16} /> : <span className="app-setup-number">{installStep ? 2 : 1}</span>} Ativar as notificações</strong>
            {pushStep === "button" && <button type="button" className="primary-button install-app-button" disabled={busy || !chave.data} onClick={() => void enableNotifications()}><Bell size={16} /> {busy ? "Ativando..." : "Ativar notificações"}</button>}
            {pushStep === "after-install" && <p>Aparece aqui quando você abrir o portal pelo ícone da tela inicial.</p>}
            {pushStep === "denied" && <p><BellOff size={14} className="install-inline-icon" /> As notificações estão bloqueadas neste aparelho. Para receber os avisos, libere as notificações do portal nas configurações do navegador ou do celular.</p>}
          </li>}
        </ol>
        {message && <p className="form-message">{message}</p>}
      </div>
    </section>
  );
}
