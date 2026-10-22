import type { User } from "@supabase/supabase-js";
import { TERMS_VERSION, isValidTermsVersion } from "@shared/termos";
import { listAllUsers } from "./dashboard";
import { listPushDevices } from "./push";
import { supabase } from "./supabase";

const DAY = 86_400_000;
const DAYS = 14;

/** Where each client stands with the portal terms, from best to worst. */
export type TermsSituation = "aceito" | "versao-antiga" | "sem-aceite" | "primeiro-acesso" | "link-expirado" | "sem-login";

type ClienteRow = { id: number; name: string; email?: string | null; phone?: string | null; status?: string | null; created_at?: string | null };
type Terms = { version?: string; accepted_at?: string; ip?: string | null; user_agent?: string };
type FirstAccess = { expires_at?: string; sent_at?: string; reminded?: boolean } | null | undefined;

const time = (value: unknown) => {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isNaN(parsed) ? null : parsed;
};

/** "iPhone · Safari" from the browser's user agent, enough to recognise the device. */
export function describeDevice(userAgent: string | undefined): string | null {
  if (!userAgent) return null;
  const device = /iphone/i.test(userAgent) ? "iPhone" : /ipad/i.test(userAgent) ? "iPad" : /android/i.test(userAgent) ? "Android" : /windows/i.test(userAgent) ? "Windows" : /mac os/i.test(userAgent) ? "Mac" : /linux/i.test(userAgent) ? "Linux" : "Outro";
  const browser = /edg\//i.test(userAgent) ? "Edge" : /samsungbrowser/i.test(userAgent) ? "Samsung Internet" : /crios|chrome/i.test(userAgent) ? "Chrome" : /fxios|firefox/i.test(userAgent) ? "Firefox" : /safari/i.test(userAgent) ? "Safari" : null;
  return browser ? `${device} · ${browser}` : device;
}

function situationOf(account: User | undefined, now: number): TermsSituation {
  if (!account) return "sem-login";
  const terms = account.app_metadata?.terms as Terms | undefined;
  if (isValidTermsVersion(terms?.version)) return "aceito";
  if (terms?.version) return "versao-antiga";
  const firstAccess = account.app_metadata?.first_access as FirstAccess;
  // first_access is cleared once the client creates a password.
  if (firstAccess) return (time(firstAccess.expires_at) ?? Infinity) < now ? "link-expirado" : "primeiro-acesso";
  return "sem-aceite";
}

const median = (values: number[]) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Start of the day (00:00 in São Paulo, UTC-3) that contains the given moment. */
function dayStart(at: number) {
  const local = new Date(at - 3 * 3_600_000);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + 3 * 3_600_000;
}

/** pushDevices: devices with the app notifications on, per client (see push.ts). */
export function buildTermsReport(clientes: ClienteRow[], users: User[], now = Date.now(), pushDevices = new Map<number, { devices: number; installed: boolean }>()) {
  // One login per client; if a client somehow has more, the most recently created one counts.
  const accountByClient = new Map<number, User>();
  for (const user of users) {
    if (user.app_metadata?.role !== "client") continue;
    const id = Number(user.app_metadata?.cliente_id);
    const current = accountByClient.get(id);
    if (!current || (time(user.created_at) ?? 0) > (time(current.created_at) ?? 0)) accountByClient.set(id, user);
  }

  const rows = clientes.map((cliente) => {
    const account = accountByClient.get(cliente.id);
    const terms = account?.app_metadata?.terms as Terms | undefined;
    const firstAccess = account?.app_metadata?.first_access as FirstAccess;
    return {
      id: cliente.id,
      name: cliente.name,
      email: cliente.email ?? null,
      phone: cliente.phone ?? null,
      processStatus: cliente.status ?? null,
      situation: situationOf(account, now),
      loginCreatedAt: account?.created_at ?? null,
      linkSentAt: firstAccess?.sent_at ?? null,
      reminded: firstAccess?.reminded === true,
      lastSignInAt: account?.last_sign_in_at ?? null,
      acceptedAt: terms?.accepted_at ?? null,
      acceptedVersion: terms?.version ?? null,
      acceptedIp: terms?.ip ?? null,
      acceptedDevice: describeDevice(terms?.user_agent),
      notificationDevices: pushDevices.get(cliente.id)?.devices ?? 0,
      appInstalled: pushDevices.get(cliente.id)?.installed === true,
    };
  });

  const count = (situation: TermsSituation) => rows.filter((row) => row.situation === situation).length;
  const withLogin = rows.filter((row) => row.situation !== "sem-login").length;
  const accepted = count("aceito");
  const acceptedRows = rows.filter((row) => row.situation === "aceito");

  // Hours from the login being created until the client accepted the terms.
  const hoursToAccept = acceptedRows
    .map((row) => {
      const from = time(row.loginCreatedAt), to = time(row.acceptedAt);
      return from !== null && to !== null && to >= from ? (to - from) / 3_600_000 : null;
    })
    .filter((hours): hours is number => hours !== null);

  const today = dayStart(now);
  const days = Array.from({ length: DAYS }, (_, index) => ({ start: new Date(today - (DAYS - 1 - index) * DAY).toISOString(), accepted: 0 }));
  for (const row of acceptedRows) {
    const at = time(row.acceptedAt);
    if (at === null) continue;
    const index = DAYS - 1 - Math.round((today - dayStart(at)) / DAY);
    if (index >= 0 && index < DAYS) days[index].accepted++;
  }

  return {
    version: TERMS_VERSION,
    totals: {
      clients: rows.length,
      withLogin,
      accepted,
      pending: withLogin - accepted,
      percent: withLogin ? accepted / withLogin : null,
      oldVersion: count("versao-antiga"),
      signedInWithoutAccepting: count("sem-aceite"),
      awaitingFirstAccess: count("primeiro-acesso"),
      expiredLink: count("link-expirado"),
      withoutLogin: count("sem-login"),
      withoutEmail: rows.filter((row) => row.situation === "sem-login" && !row.email).length,
      acceptedLast7Days: acceptedRows.filter((row) => (time(row.acceptedAt) ?? 0) >= now - 7 * DAY).length,
      medianHoursToAccept: median(hoursToAccept),
      withNotifications: rows.filter((row) => row.notificationDevices > 0).length,
    },
    days,
    // Pending clients first, the oldest invitation at the top; then the ones who accepted, newest first.
    clients: rows.sort((a, b) => {
      const pa = a.situation === "aceito" ? 1 : 0, pb = b.situation === "aceito" ? 1 : 0;
      if (pa !== pb) return pa - pb;
      if (pa) return (time(b.acceptedAt) ?? 0) - (time(a.acceptedAt) ?? 0);
      return (time(a.loginCreatedAt) ?? Infinity) - (time(b.loginCreatedAt) ?? Infinity);
    }),
  };
}

export async function computeTermsReport(now = Date.now()) {
  const [clientesRes, users, pushDevices] = await Promise.all([
    supabase.from("clientes").select("id, name, email, phone, status, created_at").limit(10000),
    listAllUsers(),
    listPushDevices(),
  ]);
  if (clientesRes.error) throw new Error(clientesRes.error.message);
  return buildTermsReport((clientesRes.data ?? []) as ClienteRow[], users, now, pushDevices);
}

export type TermsReport = ReturnType<typeof buildTermsReport>;
