import { readFile } from "node:fs/promises";
import path from "node:path";
import { notifyTeam } from "./notificacoes";

/**
 * Whether the notebook that runs the portal is plugged in. scripts/iniciar-zentry.ps1 writes
 * logs/energia.json every 15 seconds; on battery Windows soon puts the notebook to sleep and the
 * portal goes offline, so the team is warned in the portal and by e-mail/WhatsApp.
 */

export type PowerState = { naTomada: boolean; bateria: number | null; minutosRestantes: number | null; desde: string | null };

/** POWER_STATE_FILE="" turns the check off (the tests do, so they never depend on this machine's battery). */
const STATE_FILE = process.env.POWER_STATE_FILE ?? path.resolve("logs", "energia.json");
/** Older than this, the file is from a watchdog that is not running (or another machine): ignore it. */
const STALE_MS = 90_000;
/** A quick unplug (moving the cable) does not send a notice. */
const NOTIFY_AFTER_MS = 60_000;
const CHECK_EVERY_MS = 30_000;

let onBatterySince: number | null = null;
let noticeSent = false;
let lowBatteryNoticeSent = false;

export function parsePowerFile(content: string, now = Date.now()): Omit<PowerState, "desde"> | null {
  try {
    const data = JSON.parse(content.replace(/^﻿/, "")) as { naTomada?: unknown; bateria?: unknown; minutosRestantes?: unknown; em?: unknown };
    const at = typeof data.em === "string" ? Date.parse(data.em) : NaN;
    if (Number.isNaN(at) || now - at > STALE_MS || typeof data.naTomada !== "boolean") return null;
    return {
      naTomada: data.naTomada,
      bateria: typeof data.bateria === "number" ? data.bateria : null,
      minutosRestantes: typeof data.minutosRestantes === "number" ? data.minutosRestantes : null,
    };
  } catch {
    return null;
  }
}

/** Null when unknown (not running on the notebook, or the watchdog is not running). */
export async function getPowerState(now = Date.now()): Promise<PowerState | null> {
  const content = STATE_FILE ? await readFile(STATE_FILE, "utf8").catch(() => null) : null;
  const state = content ? parsePowerFile(content, now) : null;
  if (!state) return null;
  return { ...state, desde: !state.naTomada && onBatterySince ? new Date(onBatterySince).toISOString() : null };
}

/** On battery at or below this, the notebook is about to shut down: clients see "em manutenção". */
export const LOW_BATTERY_PERCENT = 15;

/** Clients may keep using the portal on battery; only a nearly empty battery sends them to maintenance. */
export function maintenanceFromPower(state: Pick<PowerState, "naTomada" | "bateria"> | null): boolean {
  return state !== null && !state.naTomada && state.bateria !== null && state.bateria <= LOW_BATTERY_PERCENT;
}

/**
 * Clients see "em manutenção" when the battery is nearly empty or while MANUTENCAO=on is set in .env.
 * If the notebook sleeps without warning (lid closed), the service worker shows the same page.
 * The team keeps working, with a warning.
 */
export async function isUnderMaintenance(): Promise<boolean> {
  if ((process.env.MANUTENCAO ?? "").toLowerCase() === "on") return true;
  return maintenanceFromPower(await getPowerState());
}

export const MAINTENANCE_MESSAGE = "MANUTENCAO";

async function check() {
  const now = Date.now();
  const state = await getPowerState(now);
  if (!state) return;
  if (state.naTomada) {
    if (noticeSent) {
      notifyTeam(
        "O notebook do portal voltou para a tomada",
        ["O carregador foi ligado de novo. O portal segue no ar normalmente para a equipe e para os clientes."],
        "✅ *O notebook do portal Zentry voltou para a tomada.* O portal segue no ar normalmente.",
        // Unplugging and plugging back in happen often: no e-mail for them, only the low battery one.
        { email: false },
      );
    }
    onBatterySince = null;
    noticeSent = false;
    lowBatteryNoticeSent = false;
    return;
  }
  onBatterySince ??= now;
  const battery = [state.bateria !== null && `bateria em ${state.bateria}%`, state.minutosRestantes && `cerca de ${state.minutosRestantes} minutos restantes`].filter(Boolean).join(", ");
  if (!lowBatteryNoticeSent && maintenanceFromPower(state)) {
    lowBatteryNoticeSent = noticeSent = true;
    notifyTeam(
      "Bateria do notebook do portal acabando: clientes em manutenção",
      [`O notebook que mantém o portal no ar está quase sem bateria${battery ? ` (${battery})` : ""}.`, "Os clientes já estão vendo a tela \"Em manutenção\". Ligue o carregador agora: quando a bateria acabar, o portal sai do ar para todos."],
      `🔴 *Bateria do notebook do portal Zentry acabando*${battery ? ` (${battery})` : ""}.\n\nOs clientes já estão vendo a tela "Em manutenção". Ligue o carregador agora.`,
    );
    return;
  }
  if (!noticeSent && now - onBatterySince >= NOTIFY_AFTER_MS) {
    noticeSent = true;
    notifyTeam(
      "O notebook do portal saiu da tomada",
      [`O notebook que mantém o portal no ar está na bateria${battery ? ` (${battery})` : ""}. Por enquanto, tudo funciona normalmente para a equipe e para os clientes.`, `Mas não feche a tampa nem deixe o notebook parado: se ele dormir, o portal sai do ar. Com a bateria em ${LOW_BATTERY_PERCENT}%, os clientes passam a ver a tela "Em manutenção".`],
      `⚠️ *O notebook do portal Zentry saiu da tomada*${battery ? ` (${battery})` : ""}.\n\nPor enquanto tudo funciona. Não feche a tampa nem deixe parado: se ele dormir, o portal cai. Ligue o carregador assim que puder.`,
      { email: false },
    );
  }
}

export function startPowerWatch() {
  if (process.platform !== "win32") return;
  setInterval(() => void check().catch((error) => console.warn("[energia] Check failed:", error)), CHECK_EVERY_MS);
}
