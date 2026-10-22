/** "a@x.com, b@y.com" -> ["a@x.com", "b@y.com"], lowercase. */
function emailList(value: string | undefined) {
  return (value ?? "").split(/[,;\s]+/).map((email) => email.trim().toLowerCase()).filter(Boolean);
}

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  emailFrom: process.env.EMAIL_FROM ?? "",
  gmailUser: process.env.GMAIL_USER ?? "",
  gmailAppPassword: process.env.GMAIL_APP_PASSWORD ?? "",
  /** E-mails of the Zentry team, comma separated. Only these accounts open the team area. */
  staffEmails: emailList(process.env.STAFF_EMAILS),
  /** Team members who may also delete (clients, conversations, documents, sales) and see the action log. */
  adminEmails: emailList(process.env.ADMIN_EMAILS),
  /** Who gets an e-mail when a client writes in the portal. Empty: everyone in STAFF_EMAILS. */
  teamNotifyEmails: emailList(process.env.TEAM_NOTIFY_EMAILS),
  /** Team WhatsApp numbers (with area code) that also get those alerts. Optional. */
  teamNotifyWhatsApp: (process.env.TEAM_NOTIFY_WHATSAPP ?? "").split(/[,;]+/).map((phone) => phone.trim()).filter(Boolean),
  /** "off" stops the WhatsApp messages to clients about replies, status changes and documents. */
  notifyClients: (process.env.NOTIFY_CLIENTS ?? "on").toLowerCase() !== "off",
  /** Key pair of the app notifications (Web Push). Empty: created once and kept in .push-keys.json. */
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? "",
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? "",
  /** Where the daily backup goes. A Google Drive / OneDrive synced folder keeps a copy off the notebook. */
  backupDir: process.env.BACKUP_DIR || "backups",
  /** cloudflared metrics address, used to find the tunnel's current address when APP_URL=auto. */
  cloudflaredMetrics: process.env.CLOUDFLARED_METRICS || "127.0.0.1:20241",
  /** Public URL of the portal, used in the access e-mail sent to new clients. */
  appUrl: process.env.APP_URL ?? "",
  /**
   * How the first-access link goes out by WhatsApp: "web" (unofficial, number paired by QR code),
   * "cloud" (official Meta API) or "off". Unset: "cloud" when a Meta token exists, else "web".
   */
  whatsappProvider: (process.env.WHATSAPP_PROVIDER || (process.env.WHATSAPP_TOKEN ? "cloud" : "web")).toLowerCase(),
  /** WhatsApp Business Platform (Meta Cloud API) for messages from the corporate number. */
  whatsappToken: process.env.WHATSAPP_TOKEN ?? "",
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
  whatsappAccessTemplate: process.env.WHATSAPP_ACCESS_TEMPLATE ?? "",
  whatsappTemplateLanguage: process.env.WHATSAPP_TEMPLATE_LANGUAGE ?? "pt_BR",
  whatsappApiVersion: process.env.WHATSAPP_API_VERSION ?? "v23.0",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
};
