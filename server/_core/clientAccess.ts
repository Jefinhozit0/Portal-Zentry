import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { OLD_SYSTEM_TAG } from "@shared/processo";
import { isEmailEnabled, sendClientAccessEmail } from "./email";
import { supabase } from "./supabase";
import { isWhatsAppEnabled, normalizeBrazilPhone, sendAccessMessage } from "./whatsapp";

export type ChannelResult = { sent: true } | { sent: false; reason: string };
export type ClientAccessResult = { email: ChannelResult; whatsapp: ChannelResult };

const FIRST_ACCESS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Role and cliente_id live in app_metadata, which only the service key can change. */
export function getClienteId(user: Pick<User, "app_metadata">): number | null {
  const meta = user.app_metadata ?? {};
  return meta.role === "client" && typeof meta.cliente_id === "number" ? meta.cliente_id : null;
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const target = email.toLowerCase();
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const match = data.users.find((user) => user.email?.toLowerCase() === target);
    if (match) return match;
    if (data.users.length < 1000) return null;
  }
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const SHORT_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
/**
 * The token of the short link (/a/K7p2XqM4bN9w). Letters and digits only, so WhatsApp never cuts
 * the link, and without look-alikes (0/O, 1/l/I). 12 characters give about 70 bits: guessing one
 * is out of reach, even more so with the rate limit on /a/.
 */
function newShortToken() {
  return Array.from({ length: 12 }, () => SHORT_ALPHABET[randomInt(SHORT_ALPHABET.length)]).join("");
}

/** Finds whose first-access link a short token belongs to (only the hash of it is stored). */
export async function findFirstAccessUserByToken(token: string): Promise<User | null> {
  if (!/^[A-Za-z0-9]{12}$/.test(token)) return null;
  const target = hashToken(token);
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const match = data.users.find((user) => {
      const stored = user.app_metadata?.first_access as { hash?: string; expires_at?: string } | undefined;
      return stored?.hash === target && Boolean(stored.expires_at) && Date.parse(stored.expires_at!) >= Date.now();
    });
    if (match) return match;
    if (data.users.length < 1000) return null;
  }
}

/**
 * Checks a first-access link. Only the hash of the token is stored (in app_metadata,
 * which the client cannot edit), the link works once and expires after 7 days.
 */
export async function findFirstAccessUser(userId: string, token: string): Promise<User | null> {
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !/^[A-Za-z0-9_-]{12,100}$/.test(token)) return null;
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error || !data.user) return null;
  const stored = data.user.app_metadata?.first_access as { hash?: string; expires_at?: string } | undefined;
  if (!stored?.hash || !stored.expires_at || Date.parse(stored.expires_at) < Date.now()) return null;
  const expected = Buffer.from(stored.hash, "hex");
  const received = Buffer.from(hashToken(token), "hex");
  return expected.length === received.length && timingSafeEqual(expected, received) ? data.user : null;
}

/** Sets the password the client chose on the first-access page and burns the link. */
export async function completeFirstAccess(user: User, password: string) {
  const { first_access: _used, ...appMetadata } = user.app_metadata ?? {};
  const { error } = await supabase.auth.admin.updateUserById(user.id, {
    password,
    app_metadata: { ...appMetadata, first_access: null },
    user_metadata: { ...user.user_metadata, must_change_password: false },
  });
  if (error) throw error;
}

export function isFromOldSystem(cliente: { tags?: string[] | null }) {
  return Array.isArray(cliente.tags) && cliente.tags.includes(OLD_SYSTEM_TAG);
}

/**
 * Creates (or refreshes) the client's login and sends the first-access link by e-mail and by
 * WhatsApp from the corporate number. Clients tagged as coming from the old system get a message
 * that presents the new portal. Never throws: each channel reports its own result.
 */
export async function provisionClientAccess(
  cliente: { id: number; name: string; email?: string | null; phone?: string | null; tags?: string[] | null },
  portalUrl: string,
  options: { reminder?: boolean } = {},
): Promise<ClientAccessResult> {
  const email = cliente.email?.trim().toLowerCase();
  if (!email) {
    const reason = "O cliente precisa de um e-mail cadastrado para ter login no portal.";
    return { email: { sent: false, reason }, whatsapp: { sent: false, reason } };
  }

  const token = newShortToken();
  // sent_at drives the automatic reminder; reminded keeps it to a single reminder per link.
  const firstAccess = { hash: hashToken(token), expires_at: new Date(Date.now() + FIRST_ACCESS_TTL_MS).toISOString(), sent_at: new Date().toISOString(), reminded: Boolean(options.reminder) };
  let userId: string;

  try {
    // The client never sees this password: they choose their own through the link.
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: randomBytes(24).toString("base64url"),
      email_confirm: true,
      user_metadata: { name: cliente.name },
      app_metadata: { role: "client", cliente_id: cliente.id, first_access: firstAccess },
    });
    if (error) {
      if (error.code !== "email_exists" && error.status !== 422) throw error;
      const existing = await findUserByEmail(email);
      if (!existing) throw error;
      // Never take over a team member's account just because a client was registered with the same e-mail.
      if (existing.app_metadata?.role !== "client") {
        const reason = "Este e-mail já é usado por uma conta da equipe.";
        return { email: { sent: false, reason }, whatsapp: { sent: false, reason } };
      }
      const { error: updateError } = await supabase.auth.admin.updateUserById(existing.id, {
        user_metadata: { ...existing.user_metadata, name: cliente.name },
        app_metadata: { ...existing.app_metadata, role: "client", cliente_id: cliente.id, first_access: firstAccess },
      });
      if (updateError) throw updateError;
      userId = existing.id;
    } else {
      userId = data.user.id;
    }
  } catch (error) {
    console.error("[ClientAccess] Failed to create login:", error);
    const reason = "Não foi possível criar o login do cliente.";
    return { email: { sent: false, reason }, whatsapp: { sent: false, reason } };
  }

  // Short link: /a/<token> leads to the first-access page (see registerShortLinks).
  const link = `${portalUrl.replace(/\/$/, "")}/a/${token}`;
  const firstName = cliente.name.trim().split(/\s+/)[0] || "cliente";
  const migrated = isFromOldSystem(cliente);

  const [emailResult, whatsappResult] = await Promise.all([
    !isEmailEnabled()
      ? Promise.resolve<ChannelResult>({ sent: false, reason: "Envio por e-mail desligado." })
      : sendClientAccessEmail(email, { name: cliente.name, link, reminder: options.reminder, migrated })
        .then((): ChannelResult => ({ sent: true }))
        .catch((error): ChannelResult => {
          console.error("[ClientAccess] Access e-mail failed:", error);
          return { sent: false, reason: error instanceof Error ? error.message : "Não foi possível enviar o e-mail." };
        }),
    (async (): Promise<ChannelResult> => {
      if (!isWhatsAppEnabled()) return { sent: false, reason: "WhatsApp corporativo ainda não configurado." };
      const phone = normalizeBrazilPhone(cliente.phone);
      if (!phone) return { sent: false, reason: cliente.phone ? `Telefone "${cliente.phone}" inválido. Use DDD + número.` : "Cliente sem telefone cadastrado." };
      try {
        await sendAccessMessage(phone, { firstName, link, reminder: options.reminder, migrated });
        return { sent: true };
      } catch (error) {
        console.error("[ClientAccess] Access WhatsApp failed:", error);
        return { sent: false, reason: error instanceof Error ? error.message : "Não foi possível enviar pelo WhatsApp." };
      }
    })(),
  ]);

  return { email: emailResult, whatsapp: whatsappResult };
}

/**
 * Deletes the client logins whose cliente row no longer exists. "Apagar cliente" already takes the
 * login with it; this catches clients removed straight in the database (e.g. limpar-dados-de-exemplo.sql).
 * Returns the e-mails of the logins removed.
 */
export async function removeOrphanClientLogins(): Promise<string[]> {
  const logins: { id: string; clienteId: number; email: string }[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const user of data.users) {
      const clienteId = getClienteId(user);
      if (clienteId !== null) logins.push({ id: user.id, clienteId, email: user.email ?? user.id });
    }
    if (data.users.length < 1000) break;
  }

  const ids = Array.from(new Set(logins.map((login) => login.clienteId)));
  const existing = new Set<number>();
  for (let start = 0; start < ids.length; start += 200) {
    const { data, error } = await supabase.from("clientes").select("id").in("id", ids.slice(start, start + 200));
    // Never guess: if the clients can't be read, nothing is removed.
    if (error) throw error;
    for (const row of data ?? []) existing.add(row.id as number);
  }

  const orphans = logins.filter((login) => !existing.has(login.clienteId));
  for (const orphan of orphans) {
    const { error } = await supabase.auth.admin.deleteUser(orphan.id);
    if (error) throw error;
  }
  return orphans.map((orphan) => orphan.email);
}

/** Deletes every portal login tied to a cliente row, so a removed client can no longer sign in. */
export async function removeClientLogins(clienteId: number): Promise<number> {
  const linked: string[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const user of data.users) if (getClienteId(user) === clienteId) linked.push(user.id);
    if (data.users.length < 1000) break;
  }
  for (const id of linked) {
    const { error } = await supabase.auth.admin.deleteUser(id);
    if (error) throw error;
  }
  return linked.length;
}
