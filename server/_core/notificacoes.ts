import { NO_NOTICES_TAG } from "@shared/processo";
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
 *   changes the status, attaches a document or attaches one the client has to sign, so the client
 *   comes back to the portal.
 * - Team: app notification, e-mail (and WhatsApp, if TEAM_NOTIFY_WHATSAPP is set) when a client writes.
 * A client tagged NO_NOTICES_TAG gets none of them except chat replies.
 * Each kind of notice has a minimum interval per client, so a burst of messages or uploads turns
 * into a single notice instead of spam (which would also put the WhatsApp number at risk).
 * Nothing here ever fails the action that triggered it.
 */

export type ClientNoticeKind = "resposta" | "status" | "documento" | "assinatura";

const CLIENT_INTERVAL_MS: Record<ClientNoticeKind, number> = {
  resposta: 15 * 60_000,
  status: 2 * 60_000,
  documento: 10 * 60_000,
  // Short, so a procuração and a termo generated a few minutes apart each get their own notice.
  assinatura: 2 * 60_000,
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

/** The last step of both ways to sign. The button's name is the one in ClientPortal. */
const ATTACH_IN_PORTAL = (what: string) => `Anexe ${what} no portal, em Documentos, no botão "Enviar documento assinado". Se preferir, envie respondendo esta mensagem.`;

/** How the client signs a document for free with the gov.br account (ITI's Assinador), sent with the "assinatura" notice. */
export const GOVBR_SIGNATURE_STEPS = [
  "1. Entre no portal pelo link acima e baixe o documento.",
  "2. Acesse https://assinador.iti.br e entre com a sua conta gov.br (ela precisa ser nível prata ou ouro).",
  "3. Toque em \"Escolher arquivo\" e selecione o documento que você baixou.",
  // Every generated document sends these steps, and the notificações and the parecer have no line for the client.
  "4. Coloque a assinatura na linha com o seu nome (se não houver, no fim do documento) e toque em \"Assinar\".",
  "5. Confirme com o código que o gov.br envia para o seu celular.",
  "6. Baixe o documento assinado.",
  `7. ${ATTACH_IN_PORTAL("o arquivo assinado")}`,
];
const GOVBR_LEVEL_TIP = "Se a sua conta gov.br for nível bronze, dá para subir de nível no app gov.br, pelo reconhecimento facial ou pelo seu banco.";
/** For a client who prefers to sign on paper. */
export const PHOTO_SIGNATURE_STEPS = [
  "1. Baixe o documento no portal e imprima.",
  "2. Assine à caneta na linha com o seu nome (se não houver, no fim do documento).",
  "3. Tire uma foto de cada página, inteira, nítida e com boa luz.",
  `4. ${ATTACH_IN_PORTAL("as fotos")}`,
];

export function clientTexts(kind: ClientNoticeKind, firstName: string, detail: string | undefined, url: string) {
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
  if (kind === "assinatura") {
    const documento = detail ? `: ${detail}` : "";
    return {
      whatsapp: [
        `Olá, ${firstName}! ✍️ A *Zentry Soluções* gerou um novo documento para o seu processo${detail ? `: *${detail}*` : ""}.`,
        "",
        `Ele precisa da sua *assinatura*. O documento está no portal: ${url}`,
        "",
        "📝 *Como assinar pelo gov.br (é gratuito):*",
        ...GOVBR_SIGNATURE_STEPS,
        "",
        `💡 ${GOVBR_LEVEL_TIP}`,
        "",
        "📷 *Prefere assinar à mão e mandar fotos?*",
        ...PHOTO_SIGNATURE_STEPS,
        "",
        "Qualquer dúvida, é só responder esta mensagem.",
      ].join("\n"),
      email: {
        subject: `Documento para assinar${documento}`,
        title: `Olá, ${firstName}!`,
        paragraphs: [
          `A Zentry Soluções gerou um novo documento para o seu processo${documento}. Ele precisa da sua assinatura e está no portal (botão abaixo).`,
          ["Como assinar pelo gov.br (é gratuito):", ...GOVBR_SIGNATURE_STEPS.map((step) => step.replace("respondendo esta mensagem", "respondendo este e-mail"))].join("\n"),
          GOVBR_LEVEL_TIP,
          ["Prefere assinar à mão e mandar fotos?", ...PHOTO_SIGNATURE_STEPS.map((step) => step.replace("respondendo esta mensagem", "respondendo este e-mail"))].join("\n"),
        ],
      },
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
  if (kind === "assinatura") return { title: "Documento para assinar", body: detail ? `${detail}: baixe no portal, assine e nos envie.` : "Um novo documento precisa da sua assinatura.", url: "/", tag: "assinatura" };
  return { title: "Novo documento no seu processo", body: detail ? `A Zentry adicionou: ${detail}.` : "A Zentry adicionou um documento ao seu processo.", url: "/", tag: "documento" };
}

/** Tells the client about a change. Runs in the background; call it without await. */
export function notifyClient(clientId: number, kind: ClientNoticeKind, detail?: string) {
  if (!ENV.notifyClients) return;
  void (async () => {
    const { data: cliente } = await supabase.from("clientes").select("name, email, phone, tags").eq("id", clientId).maybeSingle();
    if (!cliente) return;
    if (kind !== "resposta" && Array.isArray(cliente.tags) && cliente.tags.includes(NO_NOTICES_TAG)) return;
    // The app notification costs nothing and puts no number at risk, so it only skips repeats a few seconds apart.
    if (claimSlot(`push:${clientId}:${kind}`, PUSH_INTERVAL_MS)) {
      void sendPushToClient(clientId, pushText(kind, detail))
        .catch((error) => console.warn(`[notificacoes] App notice to client #${clientId} failed:`, error instanceof Error ? error.message : error));
    }
    if (!claimSlot(`client:${clientId}:${kind}`, CLIENT_INTERVAL_MS[kind])) return;
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

/** A notice about the portal itself to the team, by e-mail and WhatsApp (email: false skips the e-mail). Runs in the background. */
export function notifyTeam(subject: string, paragraphs: string[], whatsappText: string, { email = true }: { email?: boolean } = {}) {
  void (async () => {
    const url = await getPublicUrl();
    const recipients = !email || !isEmailEnabled() ? [] : ENV.teamNotifyEmails.length > 0 ? ENV.teamNotifyEmails : ENV.staffEmails;
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

/** A pause this long ends a client's upload: the files sent one by one (photos of each page) become one notice. */
export const CLIENT_DOCUMENT_NOTICE_WAIT_MS = 45_000;
const pendingClientDocuments = new Map<number, { clientName: string; files: string[]; timer: ReturnType<typeof setTimeout> }>();

export function clientDocumentNotice(clientName: string, files: string[]) {
  const subject = files.length === 1 ? `${clientName} enviou um documento pelo portal` : `${clientName} enviou ${files.length} documentos pelo portal`;
  const list = files.length === 1 ? `Arquivo: ${files[0]}` : `Arquivos:\n${files.map((file) => `- ${file}`).join("\n")}`;
  const check = `${files.length === 1 ? "Está" : "Estão"} nos documentos do cadastro do cliente. Confira se ${files.length === 1 ? "está assinado e legível" : "estão assinados e legíveis"}.`;
  const preview = files.join(", ");
  return {
    subject,
    paragraphs: [list, check],
    whatsapp: `📎 *${subject}*\n\n${list}\n\n${check}`,
    pushBody: preview.length > 140 ? `${preview.slice(0, 140)}…` : preview,
  };
}

/** Every file the client attaches is told to the team: no minimum interval here, only the wait above. */
export function notifyTeamClientDocument(clientId: number, clientName: string, fileName: string) {
  const pending = pendingClientDocuments.get(clientId);
  if (pending) clearTimeout(pending.timer);
  const files = [...(pending?.files ?? []), fileName];
  const timer = setTimeout(() => {
    pendingClientDocuments.delete(clientId);
    const notice = clientDocumentNotice(clientName, files);
    // Its own tag: a new upload never replaces the notice of an earlier one on the phone.
    void sendPushToStaff(ENV.staffEmails, { title: notice.subject, body: notice.pushBody, url: "/?view=clientes", tag: `documento-cliente-${clientId}-${Date.now()}` })
      .catch((error) => console.warn("[notificacoes] Team app notice failed:", error instanceof Error ? error.message : error));
    notifyTeam(notice.subject, notice.paragraphs, notice.whatsapp);
    // Numbers that get only this notice; one that also gets every team alert already has it from notifyTeam.
    if (canSendFreeText()) {
      for (const raw of ENV.documentNotifyWhatsApp.filter((number) => !ENV.teamNotifyWhatsApp.includes(number))) {
        const phone = normalizeBrazilPhone(raw);
        if (!phone) {
          console.warn("[notificacoes] Invalid number in DOCUMENT_NOTIFY_WHATSAPP.");
          continue;
        }
        void sendFreeText(phone, notice.whatsapp).catch((error) => console.warn("[notificacoes] Document WhatsApp failed:", error instanceof Error ? error.message : error));
      }
    }
  }, CLIENT_DOCUMENT_NOTICE_WAIT_MS);
  pendingClientDocuments.set(clientId, { clientName, files, timer });
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
