import { parseTicketMessage } from "@shared/tickets";
import { isEmailEnabled, sendNoticeEmail } from "./email";
import { ENV } from "./env";
import { getPublicUrl } from "./publicUrl";
import { sendPushToClient, sendPushToStaff, type PushMessage } from "./push";
import { supabase } from "./supabase";
import { canSendFreeText, normalizeBrazilPhone, sendFreeText } from "./whatsapp";

/**
 * Automatic notices.
 * - Client: app notification (see push.ts), WhatsApp and e-mail when the team replies in the chat,
 *   changes the status or attaches a document, so the client comes back to the portal.
 * - Team: app notification, e-mail (and WhatsApp, if TEAM_NOTIFY_WHATSAPP is set) when a client writes.
 * Each kind of notice has a minimum interval per client, so a burst of messages or uploads turns
 * into a single notice instead of spam (which would also put the WhatsApp number at risk).
 * Nothing here ever fails the action that triggered it.
 */

export type ClientNoticeKind = "resposta" | "status" | "documento";

const CLIENT_INTERVAL_MS: Record<ClientNoticeKind, number> = {
  resposta: 15 * 60_000,
  status: 2 * 60_000,
  documento: 10 * 60_000,
};
const PUSH_INTERVAL_MS = 30_000;
const TEAM_INTERVAL_MS = 10 * 60_000;
const lastSent = new Map<string, number>();

/** True when this notice may go out now (and records it), false when one went out too recently. */
function claimSlot(key: string, intervalMs: number) {
  const now = Date.now();
  if (now - (lastSent.get(key) ?? 0) < intervalMs) return false;
  lastSent.set(key, now);
  return true;
}

function clientTexts(kind: ClientNoticeKind, firstName: string, detail: string | undefined, url: string) {
  if (kind === "resposta") {
    return {
      whatsapp: `Olá, ${firstName}! 💬 A equipe da *Zentry Soluções* respondeu sua mensagem no portal.\n\nToque para ver: ${url}`,
      email: { subject: "A equipe da Zentry respondeu sua mensagem", title: `Olá, ${firstName}!`, paragraphs: ["A equipe da Zentry Soluções respondeu sua mensagem no portal."] },
    };
  }
  if (kind === "status") {
    return {
      whatsapp: `Olá, ${firstName}! 📌 Seu processo na *Zentry Soluções* foi atualizado e agora está como *${detail}*.\n\nVeja os detalhes no portal: ${url}`,
      email: { subject: `Seu processo foi atualizado: ${detail}`, title: `Olá, ${firstName}!`, paragraphs: [`Seu processo na Zentry Soluções foi atualizado e agora está como "${detail}".`] },
    };
  }
  return {
    whatsapp: `Olá, ${firstName}! 📄 A *Zentry Soluções* adicionou um documento ao seu processo${detail ? `: ${detail}` : ""}.\n\nVeja no portal: ${url}`,
    email: { subject: "Novo documento no seu processo", title: `Olá, ${firstName}!`, paragraphs: [`A Zentry Soluções adicionou um documento ao seu processo${detail ? `: ${detail}` : ""}.`] },
  };
}

/**
 * The app notification: short, and without the client's name (it shows on the lock screen).
 * The address is relative, so it opens wherever the app was installed from.
 */
export function pushText(kind: ClientNoticeKind, detail?: string): PushMessage {
  if (kind === "resposta") return { title: "Nova mensagem da Zentry", body: "A equipe respondeu sua mensagem. Toque para ver.", url: "/?aba=conversa", tag: "resposta" };
  if (kind === "status") return { title: "Seu processo foi atualizado", body: detail ? `Situação atual: ${detail}.` : "Veja a situação atual no portal.", url: "/", tag: "status" };
  return { title: "Novo documento no seu processo", body: detail ? `A Zentry adicionou: ${detail}.` : "A Zentry adicionou um documento ao seu processo.", url: "/", tag: "documento" };
}

/** Tells the client about a change. Runs in the background; call it without await. */
export function notifyClient(clientId: number, kind: ClientNoticeKind, detail?: string) {
  if (!ENV.notifyClients) return;
  // The app notification costs nothing and puts no number at risk, so it only skips repeats a few seconds apart.
  if (claimSlot(`push:${clientId}:${kind}`, PUSH_INTERVAL_MS)) {
    void sendPushToClient(clientId, pushText(kind, detail))
      .catch((error) => console.warn(`[notificacoes] App notice to client #${clientId} failed:`, error instanceof Error ? error.message : error));
  }
  if (!claimSlot(`client:${clientId}:${kind}`, CLIENT_INTERVAL_MS[kind])) return;
  void (async () => {
    const { data: cliente } = await supabase.from("clientes").select("name, email, phone").eq("id", clientId).maybeSingle();
    if (!cliente) return;
    const firstName = String(cliente.name ?? "").trim().split(/\s+/)[0] || "cliente";
    const url = await getPublicUrl();
    const texts = clientTexts(kind, firstName, detail, url);
    const phone = normalizeBrazilPhone(cliente.phone as string | null);
    await Promise.all([
      phone && canSendFreeText()
        ? sendFreeText(phone, texts.whatsapp).catch((error) => console.warn(`[notificacoes] WhatsApp to client #${clientId} failed:`, error instanceof Error ? error.message : error))
        : undefined,
      cliente.email && isEmailEnabled()
        ? sendNoticeEmail(String(cliente.email), { ...texts.email, button: { label: "Abrir o portal", url } }).catch((error) => console.warn(`[notificacoes] E-mail to client #${clientId} failed:`, error instanceof Error ? error.message : error))
        : undefined,
    ]);
  })().catch((error) => console.warn("[notificacoes] Client notice failed:", error));
}

/** A notice about the portal itself to the team, by e-mail and WhatsApp. Runs in the background. */
export function notifyTeam(subject: string, paragraphs: string[], whatsappText: string) {
  void (async () => {
    const url = await getPublicUrl();
    const recipients = !isEmailEnabled() ? [] : ENV.teamNotifyEmails.length > 0 ? ENV.teamNotifyEmails : ENV.staffEmails;
    await Promise.all([
      ...recipients.map((to) =>
        sendNoticeEmail(to, { subject, title: subject, paragraphs, button: { label: "Abrir o portal", url } })
          .catch((error) => console.warn(`[notificacoes] Team e-mail to ${to} failed:`, error instanceof Error ? error.message : error))),
      ...(canSendFreeText() ? ENV.teamNotifyWhatsApp : []).map((raw) => {
        const phone = normalizeBrazilPhone(raw);
        return phone
          ? sendFreeText(phone, whatsappText).catch((error) => console.warn("[notificacoes] Team WhatsApp failed:", error instanceof Error ? error.message : error))
          : undefined;
      }),
    ]);
  })().catch((error) => console.warn("[notificacoes] Team notice failed:", error));
}

/** The team's app notification about a client's message; tapping it opens Atendimento. */
export function teamPushText(clientId: number, clientName: string, storedText: string): PushMessage {
  const ticket = parseTicketMessage(storedText);
  const body = ticket ? ticket.body : storedText;
  return {
    title: ticket ? `Novo ticket de ${clientName}: ${ticket.topic}` : `Nova mensagem de ${clientName}`,
    body: body.length > 140 ? `${body.slice(0, 140)}…` : body,
    url: "/?view=atendimento",
    // One notice per client: a new message replaces the previous one instead of piling up.
    tag: `cliente-${clientId}`,
  };
}

/** Tells the team a client wrote in the portal. Runs in the background; call it without await. */
export function notifyTeamNewMessage(clientId: number, clientName: string, storedText: string) {
  // App notification on the phones of the team members who turned it on: every message, a few seconds apart at most.
  if (claimSlot(`team-push:${clientId}`, PUSH_INTERVAL_MS)) {
    void sendPushToStaff(ENV.staffEmails, teamPushText(clientId, clientName, storedText))
      .catch((error) => console.warn("[notificacoes] Team app notice failed:", error instanceof Error ? error.message : error));
  }
  if (!claimSlot(`team:${clientId}`, TEAM_INTERVAL_MS)) return;
  void (async () => {
    const ticket = parseTicketMessage(storedText);
    const body = ticket ? ticket.body : storedText;
    const preview = body.length > 300 ? `${body.slice(0, 300)}…` : body;
    const url = await getPublicUrl();
    const subject = ticket ? `Novo ticket de ${clientName}: ${ticket.topic}` : `Nova mensagem de ${clientName} no portal`;
    const recipients = !isEmailEnabled() ? [] : ENV.teamNotifyEmails.length > 0 ? ENV.teamNotifyEmails : ENV.staffEmails;
    const whatsappText = `🔔 *${subject}*\n\n"${preview}"\n\nResponder no portal: ${url}`;

    await Promise.all([
      ...recipients.map((to) =>
        sendNoticeEmail(to, { subject, title: subject, paragraphs: [`"${preview}"`, "A conversa está na tela de Atendimento do portal."], button: { label: "Responder no portal", url } })
          .catch((error) => console.warn(`[notificacoes] Team e-mail to ${to} failed:`, error instanceof Error ? error.message : error))),
      ...(canSendFreeText() ? ENV.teamNotifyWhatsApp : []).map((raw) => {
        const phone = normalizeBrazilPhone(raw);
        return phone
          ? sendFreeText(phone, whatsappText).catch((error) => console.warn("[notificacoes] Team WhatsApp failed:", error instanceof Error ? error.message : error))
          : undefined;
      }),
    ]);
  })().catch((error) => console.warn("[notificacoes] Team notice failed:", error));
}
