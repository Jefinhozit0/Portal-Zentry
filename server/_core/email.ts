import { ENV } from "./env";
import nodemailer from "nodemailer";

export type EmailProviderConfig = Pick<typeof ENV, "resendApiKey" | "emailFrom"> &
  Partial<Pick<typeof ENV, "gmailUser" | "gmailAppPassword">>;

type EmailMessage = { to: string; subject: string; text: string; html: string };

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export async function sendVerificationCodeEmail(
  to: string,
  code: string,
  config: EmailProviderConfig = ENV,
): Promise<void> {
  const subject = `${code} é seu código de verificação | Zentry Soluções`;
  const text = `Seu código de verificação da Zentry Soluções é: ${code}. Se você não solicitou este código, ignore esta mensagem.`;
  const html = `<div style="font-family:Arial,sans-serif;color:#202124"><h1 style="font-size:20px">Verificação de e-mail</h1><p>Use este código para continuar:</p><p style="font-size:32px;font-weight:700;letter-spacing:6px">${code}</p><p>Se você não solicitou este código, ignore esta mensagem.</p></div>`;
  await sendEmail({ to, subject, text, html }, config);
}

export async function sendPasswordResetCodeEmail(
  to: string,
  code: string,
  config: EmailProviderConfig = ENV,
): Promise<void> {
  const subject = `${code} é seu código para redefinir a senha | Zentry Soluções`;
  const text = `Seu código para criar uma nova senha no portal da Zentry Soluções é: ${code}. Ele vale por 10 minutos. Se você não pediu para redefinir a senha, ignore esta mensagem; sua senha atual continua valendo.`;
  const html = `<div style="font-family:Arial,sans-serif;color:#202124"><h1 style="font-size:20px">Redefinição de senha</h1><p>Use este código para criar uma nova senha no portal da Zentry Soluções:</p><p style="font-size:32px;font-weight:700;letter-spacing:6px">${code}</p><p>O código vale por 10 minutos.</p><p style="color:#5f6368;font-size:13px">Se você não pediu para redefinir a senha, ignore esta mensagem. Sua senha atual continua valendo.</p></div>`;
  await sendEmail({ to, subject, text, html }, config);
}

export async function sendClientAccessEmail(
  to: string,
  access: { name: string; link: string; reminder?: boolean; migrated?: boolean },
  config: EmailProviderConfig = ENV,
): Promise<void> {
  const firstName = access.name.trim().split(/\s+/)[0] || "cliente";
  if (access.migrated) return sendMigrationEmail(to, firstName, access.link, Boolean(access.reminder), config);
  if (access.reminder) return sendAccessReminderEmail(to, firstName, access.link, config);
  const subject = "Seu acesso ao portal | Zentry Soluções";
  const text = [
    `Olá, ${firstName}!`,
    "",
    "Seu cadastro na Zentry Soluções foi concluído. Pelo link abaixo você cria sua senha, aceita os termos de uso e passa a acompanhar o seu processo:",
    "",
    access.link,
    "",
    `Seu login é este e-mail: ${to}`,
    "O link vale por 7 dias e só pode ser usado uma vez.",
    "Se você não reconhece este cadastro, ignore esta mensagem.",
  ].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;color:#101216;max-width:520px"><h1 style="font-size:20px">Olá, ${escapeHtml(firstName)}!</h1><p>Seu cadastro na Zentry Soluções foi concluído. Pelo botão abaixo você cria sua senha, aceita os termos de uso e passa a acompanhar o seu processo.</p><p style="margin:24px 0"><a href="${escapeHtml(access.link)}" style="display:inline-block;background:#060708;color:#ffffff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700">Criar minha senha</a></p><p>Seu login é este e-mail: <strong>${escapeHtml(to)}</strong></p><p style="color:#5f6672;font-size:13px">O link vale por 7 dias e só pode ser usado uma vez. Se você não reconhece este cadastro, ignore esta mensagem.</p></div>`;
  await sendEmail({ to, subject, text, html }, config);
}

/** Reminder for a client who has not opened the first-access link yet (a new link replaces the old one). */
async function sendAccessReminderEmail(to: string, firstName: string, link: string, config: EmailProviderConfig) {
  const subject = "Seu acesso ao portal ainda está esperando por você | Zentry Soluções";
  const text = [
    `Olá, ${firstName}!`,
    "",
    "Notamos que você ainda não criou sua senha no portal da Zentry Soluções. Por lá você acompanha cada etapa do seu processo e fala com a nossa equipe.",
    "",
    "Use este novo link (o anterior deixou de valer):",
    link,
    "",
    `Seu login é este e-mail: ${to}`,
    "O link vale por 7 dias e só pode ser usado uma vez.",
  ].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;color:#101216;max-width:520px"><h1 style="font-size:20px">Olá, ${escapeHtml(firstName)}!</h1><p>Notamos que você ainda não criou sua senha no portal da Zentry Soluções. Por lá você acompanha cada etapa do seu processo e fala com a nossa equipe.</p><p style="margin:24px 0"><a href="${escapeHtml(link)}" style="display:inline-block;background:#060708;color:#ffffff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700">Criar minha senha</a></p><p>Seu login é este e-mail: <strong>${escapeHtml(to)}</strong></p><p style="color:#5f6672;font-size:13px">Este link substitui o anterior. Ele vale por 7 dias e só pode ser usado uma vez.</p></div>`;
  await sendEmail({ to, subject, text, html }, config);
}

const MIGRATION_BENEFITS = [
  "Ver o andamento e cada atualização do seu caso",
  "Receber aviso no celular quando houver novidade",
  "Acessar os documentos do seu processo",
  "Falar com a nossa equipe pelo chat, sem precisar ligar",
];

/**
 * Access for a client who came from the old system: explains the new portal and invites them to
 * switch. Their case is already there, so all that is left is creating the password.
 */
async function sendMigrationEmail(to: string, firstName: string, link: string, reminder: boolean, config: EmailProviderConfig) {
  const subject = reminder
    ? "Seu processo já está no novo portal esperando por você | Zentry Soluções"
    : "Conheça o novo portal da Zentry Soluções: seu acesso chegou";
  const intro = reminder
    ? "Notamos que você ainda não criou sua senha no novo portal da Zentry Soluções. Seu processo já está lá, com o andamento e o histórico, esperando por você."
    : "Temos uma novidade: o acompanhamento do seu processo agora é feito pelo nosso novo portal, mais simples e completo que o sistema anterior. Seu caso já está lá, com o andamento e o histórico. Você só precisa criar sua senha.";
  const expiry = reminder ? "Este link substitui o anterior. Ele vale por 7 dias e só pode ser usado uma vez." : "O link vale por 7 dias e só pode ser usado uma vez.";
  const text = [
    `Olá, ${firstName}!`,
    "",
    intro,
    "",
    "No novo portal você pode:",
    ...MIGRATION_BENEFITS.map((benefit) => `- ${benefit}`),
    "",
    "Crie sua senha pelo link abaixo (leva menos de 1 minuto):",
    link,
    "",
    `Seu login é este e-mail: ${to}`,
    expiry,
    "Ficou com alguma dúvida? É só responder este e-mail.",
  ].join("\n");
  const benefits = MIGRATION_BENEFITS.map((benefit) => `<li style="margin:4px 0">${escapeHtml(benefit)}</li>`).join("");
  const html = `<div style="font-family:Arial,sans-serif;color:#101216;max-width:520px"><h1 style="font-size:20px">Olá, ${escapeHtml(firstName)}!</h1><p>${escapeHtml(intro)}</p><p style="margin-bottom:4px">No novo portal você pode:</p><ul style="padding-left:20px;margin-top:4px">${benefits}</ul><p style="margin:24px 0"><a href="${escapeHtml(link)}" style="display:inline-block;background:#060708;color:#ffffff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700">Criar minha senha</a></p><p>Seu login é este e-mail: <strong>${escapeHtml(to)}</strong></p><p style="color:#5f6672;font-size:13px">${expiry} Ficou com alguma dúvida? É só responder este e-mail.</p></div>`;
  await sendEmail({ to, subject, text, html }, config);
}

/** A short notice with an optional button, for alerts to clients and to the team. */
export async function sendNoticeEmail(
  to: string,
  notice: { subject: string; title: string; paragraphs: string[]; button?: { label: string; url: string } },
  config: EmailProviderConfig = ENV,
): Promise<void> {
  const text = [notice.title, "", ...notice.paragraphs, ...(notice.button ? ["", `${notice.button.label}: ${notice.button.url}`] : [])].join("\n");
  const paragraphs = notice.paragraphs.map((paragraph) => `<p style="white-space:pre-wrap">${escapeHtml(paragraph)}</p>`).join("");
  const button = notice.button
    ? `<p style="margin:24px 0"><a href="${escapeHtml(notice.button.url)}" style="display:inline-block;background:#060708;color:#ffffff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700">${escapeHtml(notice.button.label)}</a></p>`
    : "";
  const html = `<div style="font-family:Arial,sans-serif;color:#101216;max-width:520px"><h1 style="font-size:20px">${escapeHtml(notice.title)}</h1>${paragraphs}${button}</div>`;
  await sendEmail({ to, subject: notice.subject, text, html }, config);
}

async function sendEmail({ to, subject, text, html }: EmailMessage, config: EmailProviderConfig): Promise<void> {

  if (config.gmailUser || config.gmailAppPassword) {
    if (!config.gmailUser || !config.gmailAppPassword) {
      throw new Error("Configure GMAIL_USER e GMAIL_APP_PASSWORD juntas para usar o Gmail.");
    }

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: config.gmailUser,
        pass: config.gmailAppPassword.replace(/\s+/g, ""),
      },
    });

    try {
      await transporter.sendMail({ from: { name: "Zentry Soluções", address: config.gmailUser }, to, subject, text, html });
      return;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "EAUTH") {
        throw new Error("O Gmail recusou a autenticação. Use uma senha de app do Google, não a senha normal da conta.");
      }
      throw new Error("Não foi possível enviar pelo Gmail. Confira a senha de app e tente novamente.");
    }
  }

  if (!config.resendApiKey || !config.emailFrom) {
    throw new Error("Configure GMAIL_USER e GMAIL_APP_PASSWORD ou, alternativamente, RESEND_API_KEY e EMAIL_FROM.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.emailFrom,
      to: [to],
      subject,
      html,
      text,
    }),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("A chave RESEND_API_KEY foi recusada. Confira se ela está ativa e copiada corretamente.");
    }
    if (response.status === 403) {
      throw new Error("A chave Resend está no modo Onboarding, que só permite enviar para o e-mail proprietário da conta. Para enviar a outros endereços, verifique um domínio próprio no Resend.");
    }
    if (response.status === 422) {
      throw new Error("O remetente foi recusado. Use onboarding@resend.dev para testes ou um endereço de domínio verificado no Resend; Gmail não pode ser usado como remetente.");
    }
    if (response.status === 429) {
      throw new Error("O Resend limitou os envios. Aguarde alguns minutos e tente novamente.");
    }
    throw new Error(`O Resend recusou o envio (HTTP ${response.status}). Confira a configuração do provedor.`);
  }
}
