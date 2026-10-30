import { useState } from "react";
import { AlertTriangle, DatabaseBackup, HardDrive, History, Link2, MessageCircle, RefreshCw, Search, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { usePagination } from "@/lib/pagination";
import { Pager } from "@/components/Pager";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) : "ainda não rodou";

const STATUS_TEXT: Record<string, string> = {
  connected: "Conectado",
  waiting_qr: "Aguardando o QR code",
  connecting: "Conectando...",
  conflict: "Conflito com outra conexão",
  off: "Desligado",
};

/** "12,4 MB" */
function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit]}`;
}

/** "cerca de 3 meses", "mais de 10 anos" */
function formatMonths(months: number | null) {
  if (months === null) return "sem crescimento no último mês";
  if (months < 1) return "menos de 1 mês";
  if (months < 24) return `cerca de ${Math.round(months)} ${Math.round(months) === 1 ? "mês" : "meses"}`;
  const years = months / 12;
  return years > 10 ? "mais de 10 anos" : `cerca de ${Math.round(years)} anos`;
}

type UsageItem = { usado: number; limite: number; percent: number; alerta: boolean; mesesAteOLimite: number | null };

function UsageGauge({ label, item, format, detail, projection = true }: { label: string; item: UsageItem; format: (n: number) => string; detail: string; projection?: boolean }) {
  const tone = item.percent >= 0.9 ? "red" : item.alerta ? "yellow" : "ok";
  return (
    <div className={`admin-gauge admin-gauge-${tone}`}>
      <div className="admin-gauge-head"><span>{label}</span><strong>{format(item.usado)} <small>de {format(item.limite)}</small></strong></div>
      <div className="progress-track" role="progressbar" aria-label={label} aria-valuenow={Math.round(item.percent * 100)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.min(100, Math.max(item.percent * 100, item.usado > 0 ? 1 : 0))}%` }} /></div>
      <small>{`${(item.percent * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`} usado · {detail}{projection ? ` · no ritmo atual, chega ao limite em ${formatMonths(item.mesesAteOLimite)}` : ""}</small>
    </div>
  );
}

/** Administration: corporate WhatsApp, daily backup, reminders and the team's action log. */
export default function AdminPage() {
  // Refreshes often while a QR code is on screen, since WhatsApp replaces it every ~20 seconds.
  const sistema = trpc.admin.sistema.useQuery(undefined, {
    retry: false,
    refetchInterval: (query) => (query.state.data?.whatsapp.status === "connected" ? 30_000 : 5_000),
  });
  const [busca, setBusca] = useState("");
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const auditoria = trpc.admin.auditoria.useQuery({ busca: buscaAplicada || undefined, limite: 200 }, { retry: false });
  const auditPages = usePagination(auditoria.data?.entries ?? [], buscaAplicada);
  const uso = trpc.admin.usoSupabase.useQuery(undefined, { retry: false, refetchInterval: 10 * 60_000 });
  const [confirmLogout, setConfirmLogout] = useState(false);
  const desconectar = trpc.admin.desconectarWhatsApp.useMutation({
    onSuccess: () => { toast.success("WhatsApp desconectado. Um novo QR code aparece em alguns segundos."); setConfirmLogout(false); sistema.refetch(); },
    onError: (error) => toast.error(error.message),
  });
  const fazerBackup = trpc.admin.fazerBackup.useMutation({
    onSuccess: () => { toast.success("Backup feito."); sistema.refetch(); auditoria.refetch(); },
    onError: (error) => toast.error(error.message),
  });

  const data = sistema.data;
  const whatsapp = data?.whatsapp;

  return (
    <div className="page-content admin-page">
      <div className="admin-grid">
        <section className="panel admin-card">
          <div className="admin-card-head"><Smartphone size={18} /><h3>WhatsApp da empresa</h3></div>
          {!whatsapp ? <p className="admin-muted">Carregando...</p> : whatsapp.provider !== "web" ? (
            <p className="admin-muted">{whatsapp.provider === "cloud" ? "O portal usa a API oficial da Meta" : "O WhatsApp do portal está desligado"} (WHATSAPP_PROVIDER={whatsapp.provider} no .env).</p>
          ) : (
            <>
              <p className={`admin-status admin-status-${whatsapp.status}`}><span /> {STATUS_TEXT[whatsapp.status] ?? whatsapp.status}{whatsapp.number ? ` · ${whatsapp.number}` : ""}</p>
              {whatsapp.status === "conflict" && (
                <p className="admin-muted">Outra instância do portal está usando a mesma sessão. Feche os servidores duplicados e reinicie o portal para reconectar.</p>
              )}
              {whatsapp.qr && (
                <div className="admin-qr">
                  <img src={whatsapp.qr} alt="QR code para conectar o WhatsApp da empresa" width={240} height={240} />
                  <p>No celular da empresa: WhatsApp, Configurações, Dispositivos conectados, Conectar um dispositivo. Aponte a câmera para este código.</p>
                </div>
              )}
              <p className="admin-muted">Desde {when(whatsapp.since)}. Os links de acesso e os avisos aos clientes saem por este número.</p>
              {whatsapp.status === "connected" && (
                <Button variant="outline" size="sm" onClick={() => setConfirmLogout(true)}>Desconectar para trocar o número</Button>
              )}
            </>
          )}
        </section>

        <section className="panel admin-card">
          <div className="admin-card-head"><DatabaseBackup size={18} /><h3>Backup diário</h3></div>
          {data && (
            <>
              <p className="admin-muted">Último backup: <b>{when(data.backup.lastRun)}</b>{data.backup.lastResult ? ` · ${data.backup.lastResult}` : ""}</p>
              {data.backup.lastError && <p className="form-message">O último backup falhou: {data.backup.lastError}</p>}
              <p className="admin-muted">Pasta: <code>{data.backup.pasta}</code>. Guarda os últimos 30 dias e uma cópia de cada documento.</p>
              <p className="admin-muted">Para ter uma cópia fora do notebook, aponte BACKUP_DIR no .env para uma pasta do Google Drive ou OneDrive.</p>
              <Button size="sm" disabled={fazerBackup.isPending} onClick={() => fazerBackup.mutate()}><RefreshCw size={15} /> {fazerBackup.isPending ? "Fazendo backup..." : "Fazer backup agora"}</Button>
            </>
          )}
        </section>

        <section className="panel admin-card">
          <div className="admin-card-head"><MessageCircle size={18} /><h3>Avisos automáticos</h3></div>
          {data && (
            <>
              <p className="admin-muted">Clientes recebem aviso por WhatsApp e e-mail quando a equipe responde, muda o status ou anexa um documento: <b>{data.avisosParaClientes ? "ligado" : "desligado (NOTIFY_CLIENTS=off)"}</b>.</p>
              <p className="admin-muted">Lembrete para quem não criou a senha em 2 dias, uma vez, das 9h às 20h. Última verificação: <b>{when(data.lembretes.lastRun)}</b>{data.lembretes.lastResult ? ` · ${data.lembretes.lastResult}` : ""}.</p>
              {data.lembretes.lastError && <p className="form-message">A última verificação falhou: {data.lembretes.lastError}</p>}
            </>
          )}
        </section>

        <section className="panel admin-card admin-usage">
          <div className="admin-card-head"><HardDrive size={18} /><h3>Uso do Supabase</h3></div>
          {uso.isLoading && <p className="admin-muted">Calculando...</p>}
          {uso.error && <p className="form-message">Não foi possível calcular o uso agora: {uso.error.message}</p>}
          {uso.data && (
            <>
              {uso.data.alerta && <p className="form-message admin-usage-alert"><AlertTriangle size={15} /> Algum item passou de {Math.round(uso.data.avisarEm * 100)}% do limite do plano grátis. Hora de considerar o plano Pro (US$ 25/mês).</p>}
              <UsageGauge label="Documentos dos clientes" item={uso.data.arquivos} format={formatBytes} detail={`${uso.data.detalhes.documentos} arquivo(s) · ${formatBytes(uso.data.detalhes.bytesUltimos30Dias)} nos últimos 30 dias`} />
              <UsageGauge label={uso.data.tamanhoExato ? "Banco de dados" : "Banco de dados (estimativa)"} item={uso.data.banco} format={formatBytes} detail={`${uso.data.detalhes.linhas.toLocaleString("pt-BR")} registros · ${uso.data.detalhes.linhasUltimos30Dias.toLocaleString("pt-BR")} nos últimos 30 dias`} />
              <UsageGauge label="Logins ativos no mês" item={uso.data.usuarios} format={(n) => n.toLocaleString("pt-BR")} detail={`${uso.data.detalhes.logins} login(s) no total, entre equipe e clientes`} projection={false} />
              {uso.data.detalhes.maioresClientes.length > 0 && (
                <div className="admin-usage-top">
                  <small>Clientes com mais documentos</small>
                  <ol>{uso.data.detalhes.maioresClientes.map((item) => <li key={item.id}><span>{item.nome}</span><b>{formatBytes(item.bytes)}</b></li>)}</ol>
                </div>
              )}
              {!uso.data.tamanhoExato && <p className="admin-muted">Para ver o tamanho exato do banco, rode o arquivo supabase/migrations/20261013_tamanho_banco.sql no Supabase.</p>}
              <p className="admin-muted">Projeção pelo ritmo dos últimos 30 dias. O tráfego de downloads não aparece aqui: veja em <a href="https://supabase.com/dashboard/org/_/usage" target="_blank" rel="noreferrer">Supabase → Usage</a>.</p>
            </>
          )}
        </section>

        <section className="panel admin-card">
          <div className="admin-card-head"><Link2 size={18} /><h3>Endereço do portal</h3></div>
          {data && (
            <>
              <p className="admin-address"><a href={data.enderecoPublico} target="_blank" rel="noreferrer">{data.enderecoPublico}</a></p>
              <p className="admin-muted">É o endereço que vai nos links para os clientes. Com APP_URL=auto no .env, ele acompanha o túnel do Cloudflare quando muda.</p>
            </>
          )}
        </section>
      </div>

      <section className="panel admin-log">
        <div className="admin-log-head">
          <div className="admin-card-head"><History size={18} /><h3>Registro de ações</h3></div>
          <form className="admin-search" onSubmit={(event) => { event.preventDefault(); setBuscaAplicada(busca.trim()); }}>
            <Search size={15} />
            <input aria-label="Buscar no registro" placeholder="Buscar por pessoa, ação ou cliente" value={busca} onChange={(event) => setBusca(event.target.value)} />
          </form>
        </div>
        {auditoria.data && !auditoria.data.ready && <p className="form-message">O registro de ações ainda não existe no banco. Rode o arquivo supabase/migrations/20261010_melhorias.sql no Supabase.</p>}
        {auditoria.isLoading && <p className="admin-muted">Carregando...</p>}
        {auditoria.data?.ready && auditoria.data.entries.length === 0 && <p className="admin-muted">{buscaAplicada ? "Nada encontrado." : "Nenhuma ação registrada ainda."}</p>}
        {auditoria.data && auditoria.data.entries.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Detalhes</th></tr></thead>
              <tbody>
                {auditPages.visible.map((entry) => (
                  <tr key={entry.id}><td>{when(entry.created_at)}</td><td>{entry.autor}</td><td><strong>{entry.acao}</strong></td><td>{entry.detalhes ?? "—"}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager {...auditPages} noun="ações" />
      </section>

      <AlertDialog open={confirmLogout} onOpenChange={(open) => !desconectar.isPending && setConfirmLogout(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desconectar o WhatsApp?</AlertDialogTitle>
            <AlertDialogDescription>O portal para de enviar links e avisos até alguém escanear o novo QR code. Use isto para trocar o número da empresa.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={desconectar.isPending}>Cancelar</AlertDialogCancel>
            <Button variant="destructive" disabled={desconectar.isPending} onClick={() => desconectar.mutate()}>{desconectar.isPending ? "Desconectando..." : "Desconectar"}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
