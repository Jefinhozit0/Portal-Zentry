import type { User } from "@supabase/supabase-js";
import { DASHBOARD_RULES, chargebackOutcome, type ChargebackListFilter, type ClientListFilter } from "@shared/dashboard";
import { isValidTermsVersion } from "@shared/termos";
import { parseTicketMessage } from "@shared/tickets";
import { supabase } from "./supabase";

const DAY = 86_400_000;
const normalize = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const inList = (list: readonly string[], value: unknown) => list.some((item) => normalize(item) === normalize(value));
const time = (value: unknown) => {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isNaN(parsed) ? null : parsed;
};

/** "R$ 8.420,55" → 8420.55; plain numbers pass through. */
export function parseMoney(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value ?? "").replace(/[^\d,.-]/g, "");
  if (!cleaned) return null;
  const number = Number(cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned);
  return Number.isFinite(number) ? number : null;
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Accepts "03 out 2026", "03/10/2026" or an ISO date. Null when it can't tell. */
export function parseDeadline(value: unknown): Date | null {
  const text = normalize(value);
  if (!text) return null;
  let match = /^(\d{1,2})\s+de\s+([a-z]{3})[a-z]*\s+(?:de\s+)?(\d{4})$/.exec(text) ?? /^(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+(\d{4})$/.exec(text);
  if (match) {
    const month = MONTHS.indexOf(match[2]);
    return month < 0 ? null : new Date(Number(match[3]), month, Number(match[1]));
  }
  match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (match) return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  const iso = time(String(value));
  return iso === null ? null : new Date(iso);
}

export async function listAllUsers(): Promise<User[]> {
  const users: User[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}

type Row = Record<string, unknown>;
type Activity = { kind: "green" | "blue" | "yellow" | "purple"; icon: "check" | "file" | "alert" | "arrow" | "message" | "user"; title: string; detail: string; at: string };

/**
 * Every open team tab polls the dashboard, and each computation reads four whole tables plus the
 * logins. One result is shared for CACHE_MS; any change saved through the portal clears it
 * (see clearDashboardCache in routers.ts), so the numbers never lag behind an edit.
 */
const CACHE_MS = 30_000;
let cached: { at: number; data: ReturnType<typeof computeDashboard> } | null = null;

export function getDashboard() {
  if (!cached || Date.now() - cached.at > CACHE_MS) {
    const data = computeDashboard();
    cached = { at: Date.now(), data };
    // A failed read is not kept: the next call tries again.
    data.catch(() => { if (cached?.data === data) cached = null; });
  }
  return cached.data;
}

export function clearDashboardCache() {
  cached = null;
}

export async function computeDashboard(now = Date.now()) {
  const [clientesRes, chargebacksRes, vendasRes, mensagensRes, users] = await Promise.all([
    supabase.from("clientes").select("*").limit(10000),
    supabase.from("chargebacks").select("*").limit(10000),
    supabase.from("vendas").select("client, product, cbk, created_at").limit(10000),
    supabase.from("mensagens").select("client_id, client_name, sender, text, created_at").in("sender", ["client", "team"]).order("created_at", { ascending: true }).limit(20000),
    listAllUsers().catch((error) => {
      console.warn("[dashboard] Could not list auth users:", error);
      return [] as User[];
    }),
  ]);
  for (const res of [clientesRes, chargebacksRes, vendasRes, mensagensRes]) {
    if (res.error) throw new Error(res.error.message);
  }
  const clientes = (clientesRes.data ?? []) as Row[];
  const chargebacks = (chargebacksRes.data ?? []) as Row[];
  const vendas = (vendasRes.data ?? []) as Row[];
  const mensagens = (mensagensRes.data ?? []) as Row[];

  // ── Clients ───────────────────────────────────────────────
  const chargebackClients = new Set(vendas.filter((v) => v.cbk === true).map((v) => normalize(v.client)));
  const lastMessageAt = new Map<number, number>();
  const lastSender = new Map<number, string>();
  const hasClientMessage = new Set<number>();
  for (const m of mensagens) {
    const id = m.client_id as number | null;
    const at = time(m.created_at);
    if (id === null || at === null) continue;
    lastMessageAt.set(id, Math.max(lastMessageAt.get(id) ?? 0, at));
    lastSender.set(id, m.sender as string); // rows come oldest first, so the last write wins
    if (m.sender === "client") hasClientMessage.add(id);
  }

  let ativos = 0, desconsiderados = 0, andamento = 0, atencao = 0, concluidos = 0, ociosos = 0, semAtualizacao = 0;
  const clientIds: Record<ClientListFilter, number[]> = { ativos: [], ociosos: [], semAtualizacao: [], atencao: [], concluidos: [], desconsiderados: [] };
  for (const c of clientes) {
    const id = c.id as number;
    const concluded = inList(DASHBOARD_RULES.concludedStatuses, c.status);
    const disregarded = inList(DASHBOARD_RULES.disregardedStatuses, c.status) || chargebackClients.has(normalize(c.name));
    if (disregarded) { desconsiderados++; clientIds.desconsiderados.push(id); continue; }
    if (concluded) { concluidos++; clientIds.concluidos.push(id); continue; }
    ativos++;
    clientIds.ativos.push(id);
    if (c.tone === "red") { atencao++; clientIds.atencao.push(id); } else andamento++;
    // Until the atualizado_em column exists, the registration date stands in for the last status update.
    const statusAt = time(c.atualizado_em) ?? time(c.created_at) ?? now;
    const activityAt = Math.max(statusAt, lastMessageAt.get(c.id as number) ?? 0);
    if (now - activityAt >= DASHBOARD_RULES.idleDays * DAY) { ociosos++; clientIds.ociosos.push(id); }
    if (now - statusAt >= DASHBOARD_RULES.staleDays * DAY) { semAtualizacao++; clientIds.semAtualizacao.push(id); }
  }

  // ── Conversations ─────────────────────────────────────────
  // A conversation the team marked as answered stops waiting until the client writes again.
  const markedAnsweredAt = new Map(clientes.map((c) => [c.id as number, time(c.conversa_respondida_em) ?? 0]));
  const waiting = (id: number) => lastSender.get(id) === "client" && (lastMessageAt.get(id) ?? 0) > (markedAnsweredAt.get(id) ?? 0);
  const pendentes = Array.from(lastSender.keys()).filter(waiting).length;
  const conversasDeClientes = hasClientMessage.size;
  const respondidas = Array.from(hasClientMessage).filter((id) => !waiting(id)).length;

  // ── Client accounts (portal logins and terms) ─────────────
  // Only logins of clients that still exist: a client removed straight in the database leaves its login behind.
  const existingClientIds = new Set(clientes.map((c) => c.id as number));
  const accounts = users.filter((u) => u.app_metadata?.role === "client" && existingClientIds.has(u.app_metadata?.cliente_id as number));
  const aceitos = accounts.filter((u) => isValidTermsVersion((u.app_metadata?.terms as { version?: string } | undefined)?.version)).length;
  const ativos30d = accounts.filter((u) => (time(u.last_sign_in_at) ?? 0) >= now - DASHBOARD_RULES.recentLoginDays * DAY).length;

  // ── Chargebacks ───────────────────────────────────────────
  const cbks = chargebacks.map((cb) => ({
    row: cb,
    amount: parseMoney(cb.amount),
    success: chargebackOutcome(cb.status) === "won",
    failed: chargebackOutcome(cb.status) === "lost",
  }));
  const abertos = cbks.filter((cb) => !cb.success && !cb.failed);
  const revertidos = cbks.filter((cb) => cb.success);
  const encerrados = revertidos.length + cbks.filter((cb) => cb.failed).length;
  const amounts = cbks.map((cb) => cb.amount).filter((a): a is number => a !== null);
  const year = new Date(now).getFullYear();
  const recuperadoNoAno = revertidos
    .filter((cb) => new Date(time(cb.row.created_at) ?? now).getFullYear() === year)
    .reduce((sum, cb) => sum + (cb.amount ?? 0), 0);

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const datedOpen = abertos
    .map((cb) => ({ cb, date: parseDeadline(cb.row.deadline) }))
    .filter((item): item is { cb: (typeof abertos)[number]; date: Date } => item.date !== null)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const vencidos = datedOpen.filter((item) => item.date.getTime() < today.getTime());
  const prazosVencidos = vencidos.length;
  const chargebackIds: Record<ChargebackListFilter, number[]> = {
    abertos: abertos.map((cb) => cb.row.id as number),
    vencidos: vencidos.map((item) => item.cb.row.id as number),
  };
  const prazos = datedOpen
    .slice(0, 5)
    .map(({ cb, date }) => ({
      client: String(cb.row.client ?? ""),
      title: cb.row.bank ? `Chargeback · ${cb.row.bank}` : "Chargeback",
      status: String(cb.row.status ?? ""),
      date: date.toISOString(),
      daysLeft: Math.round((date.getTime() - today.getTime()) / DAY),
    }));

  // ── Recent activity (newest first) ────────────────────────
  const activity: Activity[] = [];
  for (const c of clientes) if (c.created_at) activity.push({ kind: "blue", icon: "user", title: "Cliente cadastrado", detail: String(c.name ?? ""), at: String(c.created_at) });
  for (const m of mensagens) {
    if (!m.created_at) continue;
    const name = String(m.client_name ?? "Cliente");
    if (m.sender === "client") {
      const ticket = parseTicketMessage(String(m.text ?? ""));
      activity.push({ kind: "yellow", icon: "message", title: ticket ? `Ticket · ${ticket.topic}` : "Mensagem do cliente", detail: name, at: String(m.created_at) });
    } else {
      activity.push({ kind: "green", icon: "check", title: "Resposta enviada", detail: `Para ${name}`, at: String(m.created_at) });
    }
  }
  for (const cb of chargebacks) if (cb.created_at) activity.push({ kind: "purple", icon: "arrow", title: "Chargeback registrado", detail: [cb.client, cb.bank].filter(Boolean).join(" · "), at: String(cb.created_at) });
  for (const v of vendas) if (v.created_at) activity.push({ kind: "blue", icon: "file", title: "Venda registrada", detail: [v.client, v.product].filter(Boolean).join(" · "), at: String(v.created_at) });
  for (const u of accounts) {
    const terms = u.app_metadata?.terms as { accepted_at?: string } | undefined;
    if (terms?.accepted_at) activity.push({ kind: "green", icon: "check", title: "Termos aceitos", detail: String(u.user_metadata?.name ?? u.email ?? ""), at: terms.accepted_at });
  }
  activity.sort((a, b) => (time(b.at) ?? 0) - (time(a.at) ?? 0));

  const totalProcessos = ativos + concluidos;
  return {
    metrics: {
      ativos, desconsiderados, andamento, concluidos, ociosos, semAtualizacao, pendentes, ativos30d,
      aceite: { aceitos, elegiveis: accounts.length, percent: accounts.length ? aceitos / accounts.length : null },
      conversao: { respondidas, total: conversasDeClientes, percent: conversasDeClientes ? respondidas / conversasDeClientes : null },
      cbkAbertos: abertos.length,
      reversao: { revertidos: revertidos.length, encerrados, percent: encerrados ? revertidos.length / encerrados : null },
      prazosVencidos,
      atencao,
      ticketCbk: amounts.length ? amounts.reduce((a, b) => a + b, 0) / amounts.length : null,
    },
    processos: { andamento, atencao, concluidos, total: totalProcessos, taxaConclusao: totalProcessos ? concluidos / totalProcessos : null },
    chargebacks: { abertos: abertos.length, recuperadoNoAno, ano: year, taxaSucesso: encerrados ? revertidos.length / encerrados : null, encerrados },
    prazos,
    /** Which rows make up each number, so the lists open with exactly the same records. */
    listas: { clientes: clientIds, chargebacks: chargebackIds },
    atividade: activity.slice(0, 5),
    /** False until the SQL that adds clientes.atualizado_em is run; idle numbers are then approximate. */
    temDataDeAtualizacao: clientes.length === 0 || "atualizado_em" in clientes[0],
    geradoEm: new Date(now).toISOString(),
  };
}

export type DashboardData = Awaited<ReturnType<typeof computeDashboard>>;
