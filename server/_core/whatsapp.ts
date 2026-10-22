import { ENV } from "./env";
import { sendWhatsAppWebText } from "./whatsappWeb";

/**
 * WhatsApp Business Platform (official Meta Cloud API). Messages leave from the corporate
 * number registered in Meta Business. A message that starts a conversation must use a
 * template approved by Meta; see .env.example for the template this portal expects.
 */

export type WhatsAppConfig = Pick<typeof ENV, "whatsappToken" | "whatsappPhoneNumberId" | "whatsappAccessTemplate" | "whatsappTemplateLanguage" | "whatsappApiVersion">;

export function isWhatsAppConfigured(config: WhatsAppConfig = ENV) {
  return Boolean(config.whatsappToken && config.whatsappPhoneNumberId && config.whatsappAccessTemplate);
}

/** Turns "(31) 99538-6202", "31 99538 6202" or "+55 31 99538-6202" into "5531995386202". Null if it can't be a Brazilian number. */
export function normalizeBrazilPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = digits.replace(/^0+/, "");
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  if (!digits.startsWith("55") || (digits.length !== 12 && digits.length !== 13)) return null;
  return digits;
}

/** Sends the "first access" template: {{1}} = first name, {{2}} = access link. */
export async function sendAccessWhatsApp(
  phone: string,
  params: { firstName: string; link: string },
  config: WhatsAppConfig = ENV,
): Promise<void> {
  const response = await fetch(`https://graph.facebook.com/${config.whatsappApiVersion}/${config.whatsappPhoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.whatsappToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        name: config.whatsappAccessTemplate,
        language: { code: config.whatsappTemplateLanguage },
        components: [{
          type: "body",
          parameters: [
            { type: "text", text: params.firstName },
            { type: "text", text: params.link },
          ],
        }],
      },
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string; code?: number } } | null;
    const code = body?.error?.code;
    if (response.status === 401 || code === 190) throw new Error("O token do WhatsApp foi recusado. Gere um novo token no Meta Business.");
    if (code === 132001) throw new Error("O modelo de mensagem do WhatsApp não existe ou ainda não foi aprovado pela Meta.");
    if (code === 131030) throw new Error("A conta do WhatsApp ainda está em modo de teste: só envia para números liberados na lista de teste da Meta.");
    if (code === 131026) throw new Error("Este número não pode receber mensagens pelo WhatsApp.");
    throw new Error(`O WhatsApp recusou o envio${body?.error?.message ? `: ${body.error.message}` : ` (HTTP ${response.status})`}.`);
  }
}

/** Same words as the Meta template, sent as plain text through the unofficial connection. */
export function accessMessageText(params: { firstName: string; link: string }) {
  return [
    `Olá, ${params.firstName}! 👋 Que bom ter você com a gente na *Zentry Soluções*! 🎉`,
    "",
    "Seu cadastro está pronto e agora você acompanha o seu processo de pertinho, direto do celular:",
    "",
    "✅ Veja cada atualização do seu caso",
    "💬 Fale com a nossa equipe pelo chat",
    "📲 Tudo em um só lugar, sem precisar ligar",
    "",
    "É só tocar no link, criar sua senha e pronto. Leva menos de 1 minuto! 🚀",
    "",
    params.link,
    "",
    "⏳ O link vale por 7 dias e só pode ser usado uma vez.",
    "Ficou com alguma dúvida? É só responder esta mensagem. 😉",
  ].join("\n");
}

/** Whether a first-access link should go out by WhatsApp at all, given WHATSAPP_PROVIDER. */
export function isWhatsAppEnabled(env: Pick<typeof ENV, "whatsappProvider"> & WhatsAppConfig = ENV) {
  if (env.whatsappProvider === "web") return true;
  if (env.whatsappProvider === "cloud") return isWhatsAppConfigured(env);
  return false;
}

/**
 * First access for a client who came from the old system: explains the new portal and why it is
 * worth switching. Their case is already there, so all that is left is creating the password.
 */
export function migrationMessageText(params: { firstName: string; link: string }) {
  return [
    `Olá, ${params.firstName}! 👋 Aqui é da *Zentry Soluções*.`,
    "",
    "Temos uma novidade: o acompanhamento do seu processo agora é feito pelo nosso *novo portal*, mais simples e completo que o sistema anterior. 🚀",
    "",
    "Seu caso já está lá, com o andamento e o histórico. Você só precisa criar sua senha. No novo portal você:",
    "",
    "✅ Vê o andamento e cada atualização do seu caso",
    "🔔 Recebe aviso no celular quando houver novidade",
    "📄 Acessa os documentos do seu processo",
    "💬 Fala com a nossa equipe pelo chat, sem precisar ligar",
    "",
    "Toque no link e crie sua senha. Leva menos de 1 minuto:",
    "",
    params.link,
    "",
    "⏳ O link vale por 7 dias e só pode ser usado uma vez.",
    "Ficou com alguma dúvida? É só responder esta mensagem. 😉",
  ].join("\n");
}

/** Reminder for a client from the old system who has not created the password yet. */
export function migrationReminderText(params: { firstName: string; link: string }) {
  return [
    `Oi, ${params.firstName}! 😊 Aqui é da *Zentry Soluções*.`,
    "",
    "Seu processo já está no nosso novo portal, esperando por você. Por lá você vê cada atualização, recebe aviso quando algo muda e fala com a equipe sem precisar ligar.",
    "",
    "É rapidinho: toque no link, crie sua senha e pronto.",
    "",
    params.link,
    "",
    "⏳ Este link substitui o anterior e vale por 7 dias.",
    "Qualquer dúvida, é só responder esta mensagem.",
  ].join("\n");
}

function accessText(params: { firstName: string; link: string; reminder?: boolean; migrated?: boolean }) {
  if (params.migrated) return params.reminder ? migrationReminderText(params) : migrationMessageText(params);
  return params.reminder ? accessReminderText(params) : accessMessageText(params);
}

/**
 * Sends the first-access link through whichever WhatsApp provider is configured. The official API
 * only sends the approved template, so the old-system version only goes out over the unofficial one.
 */
export async function sendAccessMessage(phone: string, params: { firstName: string; link: string; reminder?: boolean; migrated?: boolean }) {
  if (ENV.whatsappProvider === "web") return sendWhatsAppWebText(phone, accessText(params));
  return sendAccessWhatsApp(phone, params);
}

/** Reminder for a client who has not created the password yet; the link is a new one. */
export function accessReminderText(params: { firstName: string; link: string }) {
  return [
    `Oi, ${params.firstName}! 😊 Aqui é da *Zentry Soluções*.`,
    "",
    "Vimos que você ainda não entrou no portal para acompanhar o seu processo. É rapidinho: toque no link, crie sua senha e pronto.",
    "",
    params.link,
    "",
    "⏳ Este link substitui o anterior e vale por 7 dias.",
    "Qualquer dúvida, é só responder esta mensagem.",
  ].join("\n");
}

/**
 * Free text (notices about replies, status, documents). Only the unofficial connection can send
 * it: the official API only starts conversations with templates approved by Meta.
 */
export function canSendFreeText() {
  return ENV.whatsappProvider === "web";
}

export async function sendFreeText(phone: string, text: string) {
  if (!canSendFreeText()) throw new Error("Avisos em texto livre só funcionam com WHATSAPP_PROVIDER=web.");
  return sendWhatsAppWebText(phone, text);
}
