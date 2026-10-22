import { Wrench } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { ZentryLogo } from "./ZentryLogo";

const CHECK_EVERY_MS = 20_000;

/**
 * True while clients should see the maintenance screen: the server says so (notebook on battery,
 * or MANUTENCAO=on), or the server cannot be reached at all (no answer, or the tunnel's error page).
 */
export function useMaintenance() {
  const status = trpc.status.manutencao.useQuery(undefined, {
    retry: false,
    refetchInterval: CHECK_EVERY_MS,
    refetchIntervalInBackground: true,
  });
  // A TRPCClientError without data never reached the portal: network failure or a non-JSON error page.
  const unreachable = status.isError && !(status.error as { data?: unknown }).data;
  return { maintenance: status.data?.manutencao === true || unreachable, retry: () => status.refetch(), checking: status.isFetching };
}

/** Same message as public/manutencao.html, which the service worker shows when the page cannot even load. */
export function MaintenanceScreen({ onRetry, checking }: { onRetry: () => void; checking: boolean }) {
  return (
    <main className="client-portal-center maintenance-screen">
      <div className="login-panel-inner">
        <ZentryLogo size="md" />
        <span className="maintenance-icon" aria-hidden="true"><Wrench size={26} /></span>
        <h2>Estamos em manutenção</h2>
        <p className="login-subtitle">O portal da Zentry Soluções está passando por uma manutenção rápida. Seus dados e o andamento do seu processo estão seguros.</p>
        <p className="login-subtitle">Esta página volta sozinha assim que tudo estiver pronto.</p>
        <button type="button" className="primary-button" disabled={checking} onClick={onRetry}>{checking ? "Verificando..." : "Tentar agora"}</button>
        <small className="maintenance-note">Verificando de novo a cada {CHECK_EVERY_MS / 1000} segundos.</small>
      </div>
    </main>
  );
}
