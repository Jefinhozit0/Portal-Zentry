import { rm } from "node:fs/promises";
import path from "node:path";
import type { WASocket } from "baileys";

/**
 * Unofficial WhatsApp connection (Baileys): the server acts as a linked device of a regular
 * WhatsApp number, paired once by scanning the QR code printed in the server terminal.
 * This is not the official API, so WhatsApp may block a number that looks like spam. To keep
 * the risk low, messages go out one at a time with a pause between them, and only for the
 * first-access link of a client the team has just registered.
 */

export type WhatsAppWebStatus = "off" | "connecting" | "waiting_qr" | "connected" | "conflict";

const AUTH_DIR = path.resolve(process.env.WHATSAPP_WEB_AUTH_DIR || ".whatsapp-auth");
/** Minimum gap between two messages, plus a random extra, so sends never come in bursts. */
const MIN_GAP_MS = 8_000;
const EXTRA_GAP_MS = 7_000;

let sock: WASocket | null = null;
let status: WhatsAppWebStatus = "off";
let retries = 0;
let queue: Promise<unknown> = Promise.resolve();
let lastSentAt = 0;

export const getWhatsAppWebStatus = () => status;

/** Latest QR code (while waiting to be scanned) and the connected number, for the admin screen. */
let lastQr: string | null = null;
let connectedNumber: string | null = null;
let lastChange = new Date().toISOString();

export function getWhatsAppWebInfo() {
  return { status, qr: status === "waiting_qr" ? lastQr : null, number: status === "connected" ? connectedNumber : null, since: lastChange };
}

/** Unlinks the device (to connect another number). A new QR code shows up a few seconds later. */
export async function logoutWhatsAppWeb() {
  if (!sock) throw new Error("O WhatsApp não está conectado.");
  await sock.logout();
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function startWhatsAppWeb(): Promise<void> {
  status = "connecting";
  const [{ default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers, DisconnectReason }, { default: pino }, { default: qrcode }] =
    await Promise.all([import("baileys"), import("pino"), import("qrcode-terminal")]);

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

  const socket = makeWASocket({
    auth: state,
    version,
    browser: Browsers.windows("Portal Zentry"),
    logger: pino({ level: "silent" }),
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });
  sock = socket;

  socket.ev.on("creds.update", saveCreds);
  socket.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      status = "waiting_qr";
      lastQr = qr;
      lastChange = new Date().toISOString();
      console.log("\n[WhatsApp] Escaneie o QR code abaixo no celular do número da empresa:");
      console.log("[WhatsApp] WhatsApp > Configurações > Dispositivos conectados > Conectar um dispositivo\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      status = "connected";
      lastQr = null;
      connectedNumber = socket.user?.id?.split(":")[0] ?? null;
      lastChange = new Date().toISOString();
      retries = 0;
      console.log(`[WhatsApp] Conectado como ${socket.user?.id?.split(":")[0] ?? "número desconhecido"}.`);
    }

    if (connection === "close") {
      if (sock === socket) sock = null;
      const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
      if (code === DisconnectReason.connectionReplaced) {
        status = "conflict";
        lastQr = null;
        connectedNumber = null;
        lastChange = new Date().toISOString();
        console.error("[WhatsApp] Esta sessão foi substituída por outra conexão. Verifique se há outra instância do portal usando o mesmo número.");
        return;
      }
      if (code === DisconnectReason.loggedOut) {
        // The device was removed on the phone: forget the old session and show a new QR code.
        console.warn("[WhatsApp] O aparelho foi desconectado no celular. Gerando um novo QR code.");
        status = "connecting";
        rm(AUTH_DIR, { recursive: true, force: true }).finally(() => restart(1_000));
        return;
      }
      status = "connecting";
      // Pairing asks for a restart right after the QR is scanned; anything else backs off.
      const delay = code === DisconnectReason.restartRequired ? 0 : Math.min(60_000, 2_000 * 2 ** retries++);
      if (delay) console.warn(`[WhatsApp] Conexão caiu (código ${code ?? "?"}). Tentando de novo em ${Math.round(delay / 1000)} s.`);
      restart(delay);
    }
  });
}

function restart(delay: number) {
  setTimeout(() => {
    startWhatsAppWeb().catch((error) => {
      console.error("[WhatsApp] Falha ao reconectar:", error);
      restart(30_000);
    });
  }, delay);
}

/** Brazilian mobile numbers may be registered with or without the extra 9; try both. */
function phoneVariants(phone: string): string[] {
  if (phone.length === 13 && phone[4] === "9") return [phone, phone.slice(0, 4) + phone.slice(5)];
  if (phone.length === 12) return [phone, `${phone.slice(0, 4)}9${phone.slice(4)}`];
  return [phone];
}

/** Sends a text message. Waits its turn in the queue, so it can take a few seconds. */
export function sendWhatsAppWebText(phone: string, text: string): Promise<void> {
  const job = queue.then(async () => {
    const socket = sock;
    if (status === "conflict") {
      throw new Error("A sessão do WhatsApp foi substituída por outra conexão. Feche as outras instâncias do portal e reinicie o servidor.");
    }
    if (!socket || status !== "connected") {
      throw new Error("O WhatsApp do portal não está conectado. Escaneie o QR code no terminal do servidor.");
    }

    const results = (await socket.onWhatsApp(...phoneVariants(phone))) ?? [];
    const target = results.find((result) => result.exists);
    if (!target) throw new Error("Este número não tem WhatsApp.");

    const gap = MIN_GAP_MS + Math.random() * EXTRA_GAP_MS - (Date.now() - lastSentAt);
    if (gap > 0) await wait(gap);

    // A short "typing..." before the message, as a person would.
    await socket.sendPresenceUpdate("composing", target.jid).catch(() => undefined);
    await wait(1_500 + Math.random() * 1_500);
    await socket.sendPresenceUpdate("paused", target.jid).catch(() => undefined);

    await socket.sendMessage(target.jid, { text });
    lastSentAt = Date.now();
  });
  // A failed send must not block the ones behind it.
  queue = job.catch(() => undefined);
  return job;
}
