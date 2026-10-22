import path from "node:path";
import { COOKIE_NAME } from "@shared/const";
import type { User } from "@supabase/supabase-js";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { isEmailEnabled, sendPasswordResetCodeEmail, sendVerificationCodeEmail } from "./_core/email";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { checkCode, codeErrorMessage, createVerificationCode, discardVerificationCode } from "./_core/verificationCodes";
import { supabase } from "./_core/supabase";
import { completeFirstAccess, findFirstAccessUser, findUserByEmail, getClienteId, provisionClientAccess, removeClientLogins } from "./_core/clientAccess";
import { TERMS_VERSION, isValidTermsVersion } from "@shared/termos";
import { clearDashboardCache, getDashboard } from "./_core/dashboard";
import { computeTermsReport } from "./_core/termsReport";
import { computeSupabaseUsage } from "./_core/usoSupabase";
import { chargebackErrorMessage, chargebackInput, chargebackRow, describeChanges, historyEntry } from "./_core/chargebacks";
import { MAINTENANCE_MESSAGE, getPowerState, isUnderMaintenance } from "./_core/energia";
import { ENV } from "./_core/env";
import { getPublicUrl } from "./_core/publicUrl";
import { listarAcoes, registrarAcao } from "./_core/auditoria";
import { notifyClient, notifyTeamNewMessage } from "./_core/notificacoes";
import { checkNewSales } from "./_core/vendasNovas";
import { getPushPublicKey, savePushSubscription } from "./_core/push";
import { getWhatsAppWebInfo, logoutWhatsAppWeb } from "./_core/whatsappWeb";
import { backupJob, jobState } from "./_core/tarefas";
import QRCode from "qrcode";
import type { TrpcContext } from "./_core/context";
import { TICKET_TOPICS, formatTicketMessage, parseTicketMessage } from "@shared/tickets";
import { MAX_DOCUMENT_BYTES, PROCESS_STATUSES, toneForStatus } from "@shared/processo";
import { addEvent, deleteDocument, documentDownloadUrl, listDocuments, listEvents, removeClientFiles, uploadDocument } from "./_core/processo";

const verificationRequestTimes = new Map<string, number>();
const verificationRequestCooldownMs = 60_000;
const verificationCodeInput = z.object({ email: z.string().trim().email().max(320) });

/** One e-mail per minute per IP and per address, for anything that sends a code. */
function enforceEmailCooldown(req: TrpcContext["req"], email: string) {
  const requester = `ip:${req.ip || "unknown"}`;
  const emailKey = `email:${email.toLowerCase()}`;
  const now = Date.now();
  const lastRequest = Math.max(verificationRequestTimes.get(requester) ?? 0, verificationRequestTimes.get(emailKey) ?? 0);
  if (now - lastRequest < verificationRequestCooldownMs) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Aguarde um minuto antes de solicitar outro código." });
  }
  verificationRequestTimes.set(requester, now);
  verificationRequestTimes.set(emailKey, now);
}

/** Reset codes live apart from sign-up codes, so one can never be used as the other. */
const resetCodeKey = (email: string) => `reset:${email}`;

const getPortalUrl = (req: TrpcContext["req"]) => getPublicUrl(req);

/** The Supabase user behind the request's session token, or null when there is no valid session. */
/**
 * A screen batches several queries into one request and each of them checks the session; polling
 * repeats that every few seconds. One check per token is reused for SESSION_CACHE_MS. Mutations
 * always check again and drop the entry afterwards, since some of them change the account itself
 * (accepting the terms, for instance).
 */
const SESSION_CACHE_MS = 15_000;
const sessionCache = new Map<string, { at: number; user: Promise<User | null> }>();

const sessionToken = (ctx: TrpcContext) => {
  const token = ctx.req.headers["x-supabase-token"];
  return typeof token === "string" && token ? token : null;
};

async function getSessionUser(ctx: TrpcContext, fresh = false) {
  const token = sessionToken(ctx);
  if (!token) return null;
  const now = Date.now();
  const hit = sessionCache.get(token);
  if (!fresh && hit && now - hit.at < SESSION_CACHE_MS) return hit.user;
  if (sessionCache.size > 1000) {
    sessionCache.forEach((entry, key) => { if (now - entry.at >= SESSION_CACHE_MS) sessionCache.delete(key); });
  }
  const user = supabase.auth.getUser(token).then(({ data, error }) => (error ? null : data.user));
  sessionCache.set(token, { at: now, user });
  user.catch(() => sessionCache.delete(token));
  return user;
}

/** After a change: the account may be different now, and the dashboard numbers are. */
function afterMutation(ctx: TrpcContext) {
  const token = sessionToken(ctx);
  if (token) sessionCache.delete(token);
  clearDashboardCache();
}

/** Clients that still exist, checked recently (a client removed in the database loses access within CLIENT_CHECK_MS). */
const CLIENT_CHECK_MS = 15_000;
const clientCheckedAt = new Map<number, number>();

/**
 * Anyone can create an account on the login screen, so a login alone does not make someone
 * part of the team: the e-mail must be in STAFF_EMAILS, or the account must carry role "staff"
 * in app_metadata (which only the service key can set).
 */
function isStaffUser(user: { email?: string; app_metadata?: Record<string, unknown> }) {
  if (user.app_metadata?.role === "client") return false;
  if (user.app_metadata?.role === "staff" || user.app_metadata?.role === "admin") return true;
  return Boolean(user.email && ENV.staffEmails.includes(user.email.toLowerCase()));
}

/**
 * Administrators are the team members who may delete things and read the action log:
 * ADMIN_EMAILS in .env, or role "admin" in app_metadata.
 */
function isAdminUser(user: { email?: string; app_metadata?: Record<string, unknown> }) {
  if (!isStaffUser(user)) return false;
  if (user.app_metadata?.role === "admin") return true;
  return Boolean(user.email && ENV.adminEmails.includes(user.email.toLowerCase()));
}

/** Procedures for the Zentry team: every route with data from all clients goes through here. */
const staffProcedure = publicProcedure.use(async ({ ctx, next, type }) => {
  const user = await getSessionUser(ctx, type === "mutation");
  if (!user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Faça login para continuar." });
  if (!isStaffUser(user)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Sua conta ainda não foi liberada para a área da equipe." });
  }
  const result = await next({ ctx: { ...ctx, staffUser: user } });
  if (type === "mutation") afterMutation(ctx);
  return result;
});

/** Only administrators: deleting clients, conversations, documents and sales, and the action log. */
const adminOnlyProcedure = staffProcedure.use(({ ctx, next }) => {
  if (!isAdminUser(ctx.staffUser)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Só um administrador pode fazer isso. Peça a um administrador da Zentry." });
  }
  return next();
});

/** Procedures for a logged-in client: resolves which cliente row the Supabase session belongs to. */
const clientProcedure = publicProcedure.use(async ({ ctx, next, type }) => {
  const user = await getSessionUser(ctx, type === "mutation");
  if (!user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Faça login para continuar." });
  }
  const clienteId = getClienteId(user);
  if (clienteId === null) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Esta conta não está vinculada a um cliente." });
  }
  // A client removed straight in the database leaves its login behind: that login opens nothing.
  if (type === "mutation" || Date.now() - (clientCheckedAt.get(clienteId) ?? 0) >= CLIENT_CHECK_MS) {
    const { data: cliente, error } = await supabase.from("clientes").select("id").eq("id", clienteId).maybeSingle();
    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível abrir o portal agora. Tente novamente." });
    if (!cliente) {
      clientCheckedAt.delete(clienteId);
      throw new TRPCError({ code: "FORBIDDEN", message: "Este acesso foi encerrado. Fale com a equipe da Zentry." });
    }
    clientCheckedAt.set(clienteId, Date.now());
  }
  // The client screen turns into "em manutenção" on this error (see MaintenanceScreen).
  if (await isUnderMaintenance()) {
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: MAINTENANCE_MESSAGE });
  }
  const result = await next({ ctx: { ...ctx, clienteId, clienteUser: user } });
  if (type === "mutation") afterMutation(ctx);
  return result;
});

const hasAcceptedTerms = (user: { app_metadata?: Record<string, unknown> }) =>
  isValidTermsVersion((user.app_metadata?.terms as { version?: string } | undefined)?.version);

/** The process and the chat only open after the current version of the terms was accepted. */
const clientWithTermsProcedure = clientProcedure.use(({ ctx, next }) => {
  if (!hasAcceptedTerms(ctx.clienteUser)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Aceite os termos de uso para continuar." });
  }
  return next();
});

/** A device turning on the app notifications (PushSubscription from the browser). */
const pushSubscriptionInput = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
  instalado: z.boolean(),
});

/** "Hoje, 09:42", "Ontem, 16:18" or "26 set, 11:05", for the "Atualização" column. */
function formatUpdatedLabel(iso: string) {
  const date = new Date(iso);
  const hour = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
  const day = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  if (day(date) === day(new Date())) return `Hoje, ${hour}`;
  if (day(date) === day(new Date(Date.now() - 86_400_000))) return `Ontem, ${hour}`;
  const label = date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", timeZone: "America/Sao_Paulo" }).replace(".", "").replace(" de ", " ");
  return `${label}, ${hour}`;
}

/** Whether the SQL that adds clientes.atualizado_em was run (checked until it is). */
let clientesHasUpdatedAt = false;
async function hasUpdatedAtColumn() {
  if (!clientesHasUpdatedAt) {
    const { error } = await supabase.from("clientes").select("atualizado_em").limit(1);
    clientesHasUpdatedAt = !error;
  }
  return clientesHasUpdatedAt;
}

/**
 * The client's chat with the virtual assistant is saved in the same table as the real messages,
 * so it survives logging out and opening the portal on another device. Those rows use their own
 * senders and never reach the team's inbox, the dashboard or the ticket counts.
 */
const TEAM_VISIBLE_SENDERS = ["client", "team"];
const ASSISTANT_SENDERS = { bot: "assistant", choice: "assistant_choice" } as const;
const clientMessageFrom: Record<string, "client" | "team" | "bot" | "choice"> = {
  client: "client",
  team: "team",
  [ASSISTANT_SENDERS.bot]: "bot",
  [ASSISTANT_SENDERS.choice]: "choice",
};

const nowHHmm = () => new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

const MIGRATION_MELHORIAS = "Rode o arquivo supabase/migrations/20261010_melhorias.sql no SQL Editor do Supabase.";

const MIGRATION_CONVERSA_RESPONDIDA = "supabase/migrations/20261013_conversa_respondida.sql";

/** A clearer message when a table or column from a migration that was not run is missing. */
function missingTableMessage(message: string, what: string) {
  return /does not exist|schema cache|column/i.test(message) ? `O banco ainda não tem ${what}. ${MIGRATION_MELHORIAS}` : message;
}

const saleInput = z.object({
  date: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/, "Informe a data da venda."),
  client: z.string().trim().min(1, "Informe o cliente.").max(200),
  phone: z.string().trim().max(40).default(""),
  consultants: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
  product: z.string().trim().max(120).default(""),
  status: z.enum(["Pendente", "OK"]).default("Pendente"),
  cbk: z.boolean().default(false),
  gross: z.number().min(0, "O valor bruto não pode ser negativo.").max(100_000_000),
  net: z.number().min(0, "O valor líquido não pode ser negativo.").max(100_000_000),
  note: z.string().max(1000).default(""),
  setor: z.enum(["comercial", "juridico"]).default("comercial"),
});

/** Saves a sale; before the migration that adds "setor", saves it without that field. */
async function insertOrUpdateSale(input: z.infer<typeof saleInput> & { id?: number }, id?: number) {
  const { id: _id, ...row } = input;
  const write = (values: Record<string, unknown>) =>
    id ? supabase.from("vendas").update(values).eq("id", id).select().maybeSingle() : supabase.from("vendas").insert(values).select().single();
  let result = await write(row);
  if (result.error && /setor/.test(result.error.message)) {
    const { setor: _setor, ...withoutSector } = row;
    result = await write(withoutSector);
  }
  return result;
}

const saleErrorMessage = (message: string) => missingTableMessage(message, "o campo de setor das vendas");

const firstAccessInput = z.object({ u: z.string().max(64), t: z.string().max(128) });

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,

  /** Public: whether clients should see the maintenance screen. */
  status: router({
    manutencao: publicProcedure.query(async () => ({ manutencao: await isUnderMaintenance() })),
    /** Whether e-mail is on; off hides "Criar login" and "Esqueci minha senha", which need an e-mailed code. */
    email: publicProcedure.query(() => ({ ativo: isEmailEnabled() })),
  }),
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
  account: router({
    requestVerificationCode: publicProcedure
      .input(z.object({ email: z.string().trim().email().max(320) }))
      .mutation(async ({ ctx, input }) => {
        const requester = `ip:${ctx.req.ip || "unknown"}`;
        const emailKey = `email:${input.email.toLowerCase()}`;
        const now = Date.now();
        const lastRequest = Math.max(verificationRequestTimes.get(requester) ?? 0, verificationRequestTimes.get(emailKey) ?? 0);

        if (now - lastRequest < verificationRequestCooldownMs) {
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Aguarde um minuto antes de solicitar outro código." });
        }

        const code = createVerificationCode(input.email);
        try {
          await sendVerificationCodeEmail(input.email, code);
        } catch (error) {
          discardVerificationCode(input.email, code);
          console.error("[Email] Verification code delivery failed:", error);
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: error instanceof Error ? error.message : "Não foi possível enviar o e-mail.",
          });
        }

        verificationRequestTimes.set(requester, now);
        verificationRequestTimes.set(emailKey, now);
        return { success: true } as const;
      }),
    /** Which area the logged-in account may open: the team's, the client's, or neither yet. */
    meuAcesso: publicProcedure.query(async ({ ctx }) => {
      const user = await getSessionUser(ctx);
      if (!user) return { kind: "none" } as const;
      if (getClienteId(user) !== null) return { kind: "client" } as const;
      if (!isStaffUser(user)) return { kind: "pending" } as const;
      return { kind: "staff", isAdmin: isAdminUser(user), email: user.email ?? "" } as const;
    }),

    /**
     * "Criar login": checks the e-mailed code and creates the account here, already confirmed.
     * The code proves the person owns the e-mail, so an account that already exists for it
     * (one that was never confirmed, or whose password was forgotten) just gets the new password,
     * the same thing "Esqueci minha senha" would do. Client logins are left alone.
     */
    criarConta: publicProcedure
      .input(verificationCodeInput.extend({
        code: z.string().regex(/^\d{6}$/, "Informe o código de 6 dígitos."),
        password: z.string().min(8, "A senha precisa ter pelo menos 8 caracteres.").max(72),
      }))
      .mutation(async ({ input }) => {
        const email = input.email.toLowerCase();
        // The code comes first, so nobody can find out who has an account without owning the e-mail.
        const result = checkCode(email, input.code);
        if (result !== "ok") throw new TRPCError({ code: "BAD_REQUEST", message: codeErrorMessage(result) });

        const existing = await findUserByEmail(email).catch((error) => {
          console.error("[criarConta] Lookup failed:", error);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível criar a conta agora. Tente novamente." });
        });
        if (existing && getClienteId(existing) !== null) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Este e-mail é de um cliente da Zentry. Entre com a senha criada no primeiro acesso ou use \"Esqueci minha senha\"." });
        }

        if (!existing) {
          const { error } = await supabase.auth.admin.createUser({ email, password: input.password, email_confirm: true });
          if (error) {
            console.error("[criarConta] Create failed:", error);
            throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível criar a conta agora. Tente novamente." });
          }
          return { status: "created" } as const;
        }

        const { error } = await supabase.auth.admin.updateUserById(existing.id, { password: input.password, email_confirm: true });
        if (error) {
          console.error("[criarConta] Update failed:", error);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível salvar a senha agora. Tente novamente." });
        }
        return { status: "updated" } as const;
      }),

    /** Opening the link from the e-mail / WhatsApp: is it still valid, and for whom? */
    primeiroAcessoInfo: publicProcedure
      .input(firstAccessInput)
      .query(async ({ input }) => {
        const user = await findFirstAccessUser(input.u, input.t);
        if (!user?.email) return { valid: false } as const;
        const name = (user.user_metadata?.name as string | undefined) ?? "";
        return { valid: true, firstName: name.trim().split(/\s+/)[0] ?? "", email: user.email } as const;
      }),

    definirSenhaPrimeiroAcesso: publicProcedure
      .input(firstAccessInput.extend({ password: z.string().min(8, "A senha precisa ter pelo menos 8 caracteres.").max(72) }))
      .mutation(async ({ input }) => {
        const user = await findFirstAccessUser(input.u, input.t);
        if (!user?.email) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Este link expirou ou já foi usado. Peça um novo link à equipe da Zentry." });
        }
        try {
          await completeFirstAccess(user, input.password);
        } catch (error) {
          console.error("[FirstAccess] Update failed:", error);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível salvar a senha. Tente novamente." });
        }
        return { email: user.email };
      }),

    /** Step 1 of "Esqueci minha senha": e-mails a 6-digit code if the account exists. */
    solicitarRedefinicaoSenha: publicProcedure
      .input(verificationCodeInput)
      .mutation(async ({ ctx, input }) => {
        enforceEmailCooldown(ctx.req, input.email);
        // Same answer whether or not the account exists, so the form cannot be used to find out who is registered.
        const user = await findUserByEmail(input.email).catch((error) => {
          console.error("[PasswordReset] Lookup failed:", error);
          return null;
        });
        if (!user) return { success: true } as const;

        const code = createVerificationCode(resetCodeKey(input.email));
        try {
          await sendPasswordResetCodeEmail(input.email, code);
        } catch (error) {
          discardVerificationCode(resetCodeKey(input.email), code);
          console.error("[PasswordReset] E-mail delivery failed:", error);
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Não foi possível enviar o e-mail agora. Tente novamente em alguns minutos." });
        }
        return { success: true } as const;
      }),

    /** Step 2: checks the code and sets the new password. */
    redefinirSenha: publicProcedure
      .input(verificationCodeInput.extend({
        code: z.string().regex(/^\d{6}$/, "Informe o código de 6 dígitos."),
        password: z.string().min(8, "A senha precisa ter pelo menos 8 caracteres.").max(72),
      }))
      .mutation(async ({ input }) => {
        const result = checkCode(resetCodeKey(input.email), input.code);
        if (result !== "ok") throw new TRPCError({ code: "BAD_REQUEST", message: codeErrorMessage(result) });
        const user = await findUserByEmail(input.email);
        if (!user) throw new TRPCError({ code: "BAD_REQUEST", message: "Código inválido ou expirado. Solicite um novo código." });
        const { error } = await supabase.auth.admin.updateUserById(user.id, {
          password: input.password,
          // The e-mailed code proves the address, so an account never confirmed starts working too.
          email_confirm: true,
          // The person just chose this password, so a client is not asked to change it again.
          user_metadata: { ...user.user_metadata, must_change_password: false },
        });
        if (error) {
          console.error("[PasswordReset] Update failed:", error);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível salvar a nova senha. Tente novamente." });
        }
        return { success: true } as const;
      }),
  }),

  // ── Portal data routers backed by Supabase ──────────────────────────────
  portal: router({
    /** List all clients */
    clientes: staffProcedure.query(async () => {
      const { data, error } = await supabase
        .from("clientes")
        .select("*")
        .order("id", { ascending: true });
      if (error) {
        console.warn("[portal.clientes] Supabase error:", error.message);
        return [];
      }
      // The "Atualização" column is computed from real dates instead of text typed by hand.
      // Until the atualizado_em migration is run, the registration date stands in for it.
      return (data ?? []).map((row) => {
        const at = row.atualizado_em ?? row.created_at;
        return at ? { ...row, updated: formatUpdatedLabel(at) } : row;
      });
    }),

    /** Every number on the dashboard, computed from the real data */
    dashboard: staffProcedure.query(() => getDashboard()),

    /** Who accepted the portal terms, who is still pending and why, client by client */
    termos: staffProcedure.query(() => computeTermsReport()),

    /** Key the browser needs to turn on, on this device, the notice of new messages from clients. */
    chaveNotificacoes: staffProcedure.query(() => ({ publicKey: getPushPublicKey() })),

    /** Keeps this team member's device; also called again on each visit to stay in sync. */
    ativarNotificacoes: staffProcedure
      .input(pushSubscriptionInput)
      .mutation(async ({ ctx, input }) => {
        if (!ctx.staffUser.email) throw new TRPCError({ code: "BAD_REQUEST", message: "Sua conta não tem e-mail para receber as notificações." });
        try {
          await savePushSubscription({ staffEmail: ctx.staffUser.email }, input, String(ctx.req.headers["user-agent"] ?? ""), input.instalado);
        } catch (error) {
          console.warn("[push] Could not save team device:", error instanceof Error ? error.message : error);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error instanceof Error && /migrations/.test(error.message) ? error.message : "Não foi possível ativar as notificações agora. Tente novamente mais tarde." });
        }
        return { active: true } as const;
      }),
    /** Whether the notebook running the portal is plugged in (null when unknown) */
    energia: staffProcedure.query(async () => {
      const state = await getPowerState();
      return { energia: state, manutencaoClientes: await isUnderMaintenance() };
    }),

    /** Create a client */
    createCliente: staffProcedure
      .input(z.object({
        name: z.string().min(1),
        cpf: z.string().optional(),
        type: z.string().optional(),
        status: z.string().optional(),
        updated: z.string().optional(),
        tone: z.enum(["green", "yellow", "red"]).optional(),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        services: z.array(z.string()).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { data, error } = await supabase.from("clientes").insert(input).select().single();
        if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
        await addEvent(data.id, {
          tipo: "cadastro",
          titulo: "Cadastro realizado",
          descricao: input.type ? `Início do processo: ${input.type}` : "Início do processo",
          autor: ctx.staffUser.email,
        });
        await registrarAcao(ctx.staffUser.email, "Cadastrou cliente", data.name, data.id);
        // Login link goes out right away, by e-mail and from the corporate WhatsApp.
        const access = await provisionClientAccess({ id: data.id, name: data.name, email: input.email, phone: input.phone }, await getPortalUrl(ctx.req));
        return { ...data, access };
      }),

    /** Generate a new temporary password for a client and e-mail it again */
    reenviarAcesso: staffProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const { data, error } = await supabase.from("clientes").select("id, name, email, phone, tags").eq("id", input.id).single();
        if (error || !data) throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado." });
        if (!data.email) throw new TRPCError({ code: "BAD_REQUEST", message: "Cadastre um e-mail para este cliente primeiro." });
        // A new link replaces the previous one, which stops working.
        await registrarAcao(ctx.staffUser.email, "Reenviou acesso ao portal", data.name, data.id);
        return provisionClientAccess({ id: data.id, name: data.name, email: data.email, phone: data.phone, tags: data.tags }, await getPortalUrl(ctx.req));
      }),

    /** Update a client */
    updateCliente: staffProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().optional(),
        cpf: z.string().optional(),
        type: z.string().optional(),
        status: z.string().optional(),
        updated: z.string().optional(),
        tone: z.enum(["green", "yellow", "red"]).optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        services: z.array(z.string()).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { id, ...patch } = input;
        const changes = (await hasUpdatedAtColumn()) ? { ...patch, atualizado_em: new Date().toISOString() } : patch;
        const { data, error } = await supabase.from("clientes").update(changes).eq("id", id).select().single();
        if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
        await registrarAcao(ctx.staffUser.email, "Editou cadastro do cliente", `${data.name}: ${Object.keys(patch).join(", ")}`, id);
        return data;
      }),

    /** Tags shown on the client's page and in the list. */
    salvarTags: staffProcedure
      .input(z.object({ id: z.number().int().positive(), tags: z.array(z.string().trim().min(1).max(40)).max(20) }))
      .mutation(async ({ ctx, input }) => {
        const tags = Array.from(new Set(input.tags));
        const { data, error } = await supabase.from("clientes").update({ tags }).eq("id", input.id).select("name").maybeSingle();
        if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: missingTableMessage(error.message, "o campo de tags") });
        if (!data) throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado." });
        await registrarAcao(ctx.staffUser.email, "Alterou tags", `${data.name}: ${tags.join(", ") || "sem tags"}`, input.id);
        return { tags };
      }),

    /** List chargebacks */
    chargebacks: staffProcedure.query(async () => {
      const { data, error } = await supabase
        .from("chargebacks")
        .select("*")
        .order("id", { ascending: true });
      if (error) {
        console.warn("[portal.chargebacks] Supabase error:", error.message);
        return [];
      }
      return data ?? [];
    }),

    /** Register a chargeback */
    createChargeback: staffProcedure
      .input(chargebackInput)
      .mutation(async ({ ctx, input }) => {
        const row = chargebackRow(input);
        const now = new Date();
        const historico = [historyEntry(ctx.staffUser.email, `Registrado com status ${input.status}`, now)];
        const { data, error } = await supabase.from("chargebacks").insert({ ...row, historico, atualizado_em: now.toISOString() }).select().single();
        if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: chargebackErrorMessage(error.message) });
        await registrarAcao(ctx.staffUser.email, "Registrou chargeback", [input.client, input.bank, row.amount, input.status].filter(Boolean).join(" · "), input.clienteId ?? undefined);
        return data;
      }),

    /** Edit a chargeback; each change goes to its history with who made it */
    updateChargeback: staffProcedure
      .input(chargebackInput.extend({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const { data: before, error: readError } = await supabase.from("chargebacks").select("*").eq("id", input.id).maybeSingle();
        if (readError) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: readError.message });
        if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "Chargeback não encontrado." });
        const row = chargebackRow(input);
        const changes = describeChanges(before, row);
        if (changes.length === 0) return before;
        const now = new Date();
        const previous = Array.isArray(before.historico) ? before.historico : [];
        const historico = [...previous, ...changes.map((acao) => historyEntry(ctx.staffUser.email, acao, now))];
        const { data, error } = await supabase.from("chargebacks").update({ ...row, historico, atualizado_em: now.toISOString() }).eq("id", input.id).select().single();
        if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: chargebackErrorMessage(error.message) });
        await registrarAcao(ctx.staffUser.email, "Editou chargeback", `#${input.id} · ${input.client} · ${changes.join("; ")}`, input.clienteId ?? undefined);
        return data;
      }),

    /** Delete a chargeback (administrators only) */
    deleteChargeback: adminOnlyProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const { data, error } = await supabase.from("chargebacks").delete().eq("id", input.id).select("client, bank, amount, status").maybeSingle();
        if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
        if (!data) throw new TRPCError({ code: "NOT_FOUND", message: "Este chargeback já foi apagado." });
        await registrarAcao(ctx.staffUser.email, "Apagou chargeback", `#${input.id} · ${[data.client, data.bank, data.amount, data.status].filter(Boolean).join(" · ")}`);
        return { success: true };
      }),

    /** List sales (vendas) */
    vendas: staffProcedure.query(async () => {
      const { data, error } = await supabase
        .from("vendas")
        .select("*")
        .order("id", { ascending: false });
      if (error) {
        console.warn("[portal.vendas] Supabase error:", error.message);
        return [];
      }
      return (data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id as number,
        date: (row.date as string) ?? "",
        client: (row.client as string) ?? "",
        phone: (row.phone as string) ?? "",
        consultants: ((row.consultants as string[]) ?? []).filter((name) => name && name !== "—"),
        product: (row.product as string) ?? "",
        status: (row.status as "Pendente" | "OK") ?? "Pendente",
        cbk: (row.cbk as boolean) ?? false,
        gross: Number(row.gross ?? 0),
        net: Number(row.net ?? 0),
        note: (row.note as string) ?? "",
        /** Before the migration that adds it, every sale counts as Comercial. */
        setor: (row.setor === "juridico" ? "juridico" : "comercial") as "comercial" | "juridico",
        createdAt: (row.created_at as string) ?? null,
      }));
    }),

    /** Create a sale */
    createVenda: staffProcedure
      .input(saleInput)
      .mutation(async ({ ctx, input }) => {
        const { data, error } = await insertOrUpdateSale(input);
        if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: saleErrorMessage(error.message) });
        await registrarAcao(ctx.staffUser.email, "Cadastrou venda", `${input.client} · ${input.product || "sem produto"} · bruto R$ ${input.gross.toFixed(2)}`);
        // Administrators hear about it now instead of at the next minute check.
        void checkNewSales();
        return data;
      }),

    /** Update a sale */
    updateVenda: staffProcedure
      .input(saleInput.extend({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const { data, error } = await insertOrUpdateSale(input, input.id);
        if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: saleErrorMessage(error.message) });
        if (!data) throw new TRPCError({ code: "NOT_FOUND", message: "Venda não encontrada." });
        await registrarAcao(ctx.staffUser.email, "Editou venda", `#${input.id} · ${input.client} · ${input.status} · bruto R$ ${input.gross.toFixed(2)}`);
        return data;
      }),

    /** Consultants for the Sales HUB: active ones, plus inactive ones that still appear on old sales. */
    consultores: staffProcedure.query(async () => {
      const { data, error } = await supabase.from("consultores").select("id, nome, ativo").order("nome", { ascending: true });
      if (error) {
        console.warn("[portal.consultores] Supabase error:", error.message);
        return { ready: false as const, consultores: [] as { id: number; nome: string; ativo: boolean }[] };
      }
      return { ready: true as const, consultores: (data ?? []) as { id: number; nome: string; ativo: boolean }[] };
    }),

    adicionarConsultor: staffProcedure
      .input(z.object({ nome: z.string().trim().min(2, "Informe o nome do consultor.").max(60) }))
      .mutation(async ({ ctx, input }) => {
        // Bringing back someone who was removed reactivates the same entry.
        const { data: existing } = await supabase.from("consultores").select("id, ativo").ilike("nome", input.nome).maybeSingle();
        if (existing?.ativo) throw new TRPCError({ code: "CONFLICT", message: "Esse consultor já está cadastrado." });
        const { error } = existing
          ? await supabase.from("consultores").update({ ativo: true, nome: input.nome }).eq("id", existing.id)
          : await supabase.from("consultores").insert({ nome: input.nome });
        if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: missingTableMessage(error.message, "consultores") });
        await registrarAcao(ctx.staffUser.email, "Cadastrou consultor", input.nome);
        return { success: true } as const;
      }),

    /** Removing keeps the name on past sales and in the reports; the consultant just leaves the lists. */
    removerConsultor: adminOnlyProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const { data, error } = await supabase.from("consultores").update({ ativo: false }).eq("id", input.id).select("nome").maybeSingle();
        if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
        if (!data) throw new TRPCError({ code: "NOT_FOUND", message: "Consultor não encontrado." });
        await registrarAcao(ctx.staffUser.email, "Removeu consultor", data.nome as string);
        return { success: true } as const;
      }),

    /**
     * Deletes a client for good: the registration, the conversation (removed by the database
     * together with the row) and the portal login, so the old first-access link stops working too.
     * Sales and chargebacks are kept, since they are the company's records.
     */
    deleteCliente: adminOnlyProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const { data: cliente, error: findError } = await supabase.from("clientes").select("id, name").eq("id", input.id).maybeSingle();
        if (findError) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: findError.message });
        if (!cliente) throw new TRPCError({ code: "NOT_FOUND", message: "Este cliente já foi apagado." });

        // The login goes first: if anything fails after that, the client still can't get in.
        try {
          await removeClientLogins(input.id);
          clientCheckedAt.delete(input.id);
          await removeClientFiles(input.id);
        } catch (error) {
          console.error("[portal.deleteCliente] Could not remove the portal login:", error);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível remover o acesso do cliente ao portal. Nada foi apagado." });
        }
        const { error: messagesError } = await supabase.from("mensagens").delete().eq("client_id", input.id);
        if (messagesError) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: messagesError.message });
        const { error } = await supabase.from("clientes").delete().eq("id", input.id);
        if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

        await registrarAcao(ctx.staffUser.email, "Apagou cliente", `#${cliente.id} · ${cliente.name}`, cliente.id);
        return { success: true } as const;
      }),

    /** Everything on the client's detail page: the registration, the documents and the timeline. */
    detalheCliente: staffProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(async ({ input }) => {
        const { data, error } = await supabase.from("clientes").select("*").eq("id", input.id).maybeSingle();
        if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
        if (!data) throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado." });
        const [documentos, eventos] = await Promise.all([listDocuments(input.id), listEvents(input.id)]);
        return {
          cliente: { ...data, progresso: typeof data.progresso === "number" ? data.progresso : 0 },
          documentos,
          eventos,
        };
      }),

    /** Changes the status and/or the progress; the client sees it on the next refresh. */
    atualizarProcesso: staffProcedure
      .input(z.object({
        id: z.number().int().positive(),
        status: z.enum(PROCESS_STATUSES.map((option) => option.label) as [string, ...string[]]).optional(),
        progresso: z.number().int().min(0).max(100).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { data: current, error: findError } = await supabase.from("clientes").select("*").eq("id", input.id).maybeSingle();
        if (findError || !current) throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado." });

        const patch: Record<string, unknown> = {};
        if (input.status !== undefined && input.status !== current.status) {
          patch.status = input.status;
          patch.tone = toneForStatus(input.status);
        }
        if (input.progresso !== undefined && input.progresso !== current.progresso) patch.progresso = input.progresso;
        if (Object.keys(patch).length === 0) return { changed: false } as const;
        if (await hasUpdatedAtColumn()) patch.atualizado_em = new Date().toISOString();

        const { error } = await supabase.from("clientes").update(patch).eq("id", input.id);
        if (error) {
          const missingProgress = /progresso/.test(error.message);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: missingProgress ? "O banco ainda não tem o campo de progresso. Rode o arquivo supabase/migrations/20261009_documentos_e_historico.sql no SQL Editor do Supabase." : error.message,
          });
        }

        if (patch.status) {
          await addEvent(input.id, { tipo: "status", titulo: "Status atualizado", descricao: `${current.status || "Sem status"} → ${input.status}`, autor: ctx.staffUser.email });
          await registrarAcao(ctx.staffUser.email, "Mudou status", `${current.name}: ${current.status || "sem status"} → ${input.status}`, input.id);
          notifyClient(input.id, "status", input.status);
        }
        if (patch.progresso !== undefined) {
          await addEvent(input.id, { tipo: "progresso", titulo: "Progresso atualizado", descricao: `Progresso do caso atualizado para ${input.progresso}%`, autor: ctx.staffUser.email });
          await registrarAcao(ctx.staffUser.email, "Mudou progresso", `${current.name}: ${current.progresso ?? 0}% → ${input.progresso}%`, input.id);
        }
        return { changed: true } as const;
      }),

    enviarDocumento: staffProcedure
      .input(z.object({
        clientId: z.number().int().positive(),
        nome: z.string().trim().min(1).max(200),
        tipo: z.string().max(150).optional(),
        descricao: z.string().trim().max(300).optional(),
        /** File content in base64. */
        conteudo: z.string().min(1).max(Math.ceil(MAX_DOCUMENT_BYTES / 3) * 4 + 4),
      }))
      .mutation(async ({ ctx, input }) => {
        const bytes = Buffer.from(input.conteudo, "base64");
        if (bytes.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "O arquivo está vazio." });
        if (bytes.length > MAX_DOCUMENT_BYTES) throw new TRPCError({ code: "BAD_REQUEST", message: "O arquivo passa de 10 MB." });
        const { data: cliente } = await supabase.from("clientes").select("id, name").eq("id", input.clientId).maybeSingle();
        if (!cliente) throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado." });
        const document = await uploadDocument(input.clientId, { nome: input.nome, tipo: input.tipo, descricao: input.descricao, bytes }, ctx.staffUser.email ?? "equipe");
        await registrarAcao(ctx.staffUser.email, "Anexou documento", `${cliente.name}: ${input.nome}`, input.clientId);
        notifyClient(input.clientId, "documento", input.nome);
        return document;
      }),

    baixarDocumento: staffProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        const url = await documentDownloadUrl(input.id);
        if (!url) throw new TRPCError({ code: "NOT_FOUND", message: "Documento não encontrado." });
        return { url };
      }),

    apagarDocumento: adminOnlyProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const removed = await deleteDocument(input.id, ctx.staffUser.email ?? "equipe");
        await registrarAcao(ctx.staffUser.email, "Apagou documento", removed.nome, removed.clientId);
        return { success: true } as const;
      }),

    /** Clears a client's whole conversation (messages, tickets and the assistant's lines). The client stays registered. */
    /** "Marcar como respondida": the client's messages so far stop counting as waiting for a reply. */
    marcarRespondida: staffProcedure
      .input(z.object({ clientId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const { data, error } = await supabase
          .from("clientes")
          .update({ conversa_respondida_em: new Date().toISOString() })
          .eq("id", input.clientId)
          .select("name")
          .maybeSingle();
        if (error) {
          const message = /does not exist|schema cache|column/i.test(error.message)
            ? `O banco ainda não tem essa opção. Rode o arquivo ${MIGRATION_CONVERSA_RESPONDIDA} no SQL Editor do Supabase.`
            : error.message;
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
        }
        if (!data) throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado." });
        await registrarAcao(ctx.staffUser.email, "Marcou conversa como respondida", data.name, input.clientId);
        return { success: true } as const;
      }),

    apagarConversa: adminOnlyProcedure
      .input(z.object({ clientId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const { error, count } = await supabase.from("mensagens").delete({ count: "exact" }).eq("client_id", input.clientId);
        if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
        const { data: cliente } = await supabase.from("clientes").select("name").eq("id", input.clientId).maybeSingle();
        await registrarAcao(ctx.staffUser.email, "Apagou conversa", `${cliente?.name ?? `cliente #${input.clientId}`}: ${count ?? 0} mensagem(ns)`, input.clientId);
        return { apagadas: count ?? 0 };
      }),

    /** Delete a sale */
    deleteVenda: adminOnlyProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const { data, error } = await supabase.from("vendas").delete().eq("id", input.id).select("client, product, gross").maybeSingle();
        if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
        if (!data) throw new TRPCError({ code: "NOT_FOUND", message: "Esta venda já foi apagada." });
        await registrarAcao(ctx.staffUser.email, "Apagou venda", `#${input.id} · ${data.client} · ${data.product || "sem produto"} · bruto R$ ${Number(data.gross ?? 0).toFixed(2)}`);
        return { success: true };
      }),

    /** Get messages for a client */
    mensagens: staffProcedure
      .input(z.object({ clientId: z.number() }))
      .query(async ({ input }) => {
        const { data, error } = await supabase
          .from("mensagens")
          .select("*")
          .in("sender", TEAM_VISIBLE_SENDERS)
          .eq("client_id", input.clientId)
          .order("created_at", { ascending: true });
        if (error) {
          console.warn("[portal.mensagens] Supabase error:", error.message);
          return [];
        }
        return (data ?? []).map((row: Record<string, unknown>) => ({
          id: row.id as number,
          from: (row.sender as "client" | "team") ?? "team",
          text: row.text as string,
          time: (row.time as string) ?? "",
          createdAt: (row.created_at as string) ?? null,
        }));
      }),

    /** One entry per client who has written or been written to, newest activity first */
    conversas: staffProcedure.query(async () => {
      const { data: rows, error } = await supabase
        .from("mensagens")
        .select("client_id, client_name, sender, text, created_at")
        .in("sender", TEAM_VISIBLE_SENDERS)
        .order("created_at", { ascending: false })
        .limit(5000);
      if (error) {
        console.warn("[portal.conversas] Supabase error:", error.message);
        return [];
      }

      type Row = { client_id: number | null; client_name: string | null; sender: "client" | "team"; text: string; created_at: string };
      const byClient = new Map<number, Row[]>();
      for (const row of (rows ?? []) as Row[]) {
        if (row.client_id === null) continue;
        const list = byClient.get(row.client_id) ?? [];
        list.push(row);
        byClient.set(row.client_id, list);
      }

      const ids = Array.from(byClient.keys());
      const fetchClientes = (columns: string) => supabase.from("clientes").select(columns).in("id", ids);
      let clientes: Record<string, unknown>[] = [];
      if (ids.length) {
        // Before the migration that adds conversa_respondida_em, reads the clients without it.
        let result = await fetchClientes("id, name, type, status, tone, conversa_respondida_em");
        if (result.error) result = await fetchClientes("id, name, type, status, tone");
        clientes = (result.data ?? []) as unknown as Record<string, unknown>[];
      }
      const clienteById = new Map(clientes.map((c) => [c.id as number, c]));

      return ids.map((clientId) => {
        const history = byClient.get(clientId)!; // newest first
        const last = history[0];
        const cliente = clienteById.get(clientId);
        // Client messages since the team last answered (or marked the conversation as answered): those are what is still waiting.
        const markedAt = cliente?.conversa_respondida_em ? Date.parse(String(cliente.conversa_respondida_em)) : 0;
        const answered = (m: Row) => m.sender === "team" || Date.parse(m.created_at) <= markedAt;
        const lastAnswered = history.findIndex(answered);
        const unanswered = lastAnswered === -1 ? history : history.slice(0, lastAnswered);
        const openTicket = unanswered.map((m) => parseTicketMessage(m.text)).find(Boolean) ?? null;
        return {
          clientId,
          name: (cliente?.name as string) ?? last.client_name ?? `Cliente #${clientId}`,
          type: (cliente?.type as string | null) ?? null,
          status: (cliente?.status as string | null) ?? null,
          tone: (cliente?.tone as "green" | "yellow" | "red" | null) ?? null,
          lastText: parseTicketMessage(last.text)?.body ?? last.text,
          lastFrom: last.sender,
          lastAt: last.created_at,
          awaitingReply: unanswered.length > 0,
          ticketTopic: openTicket?.topic ?? null,
        };
      });
    }),

    /** Send a message */
    sendMensagem: staffProcedure
      .input(z.object({
        clientId: z.number(),
        clientName: z.string().optional(),
        sender: z.enum(["client", "team"]),
        text: z.string().trim().min(1).max(2000),
        time: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        // Brazil's time, so it is right even on a server in another time zone.
        const time = input.time ?? nowHHmm();
        if (input.sender === "team") notifyClient(input.clientId, "resposta");
        const { data, error } = await supabase.from("mensagens").insert({
          client_id: input.clientId,
          client_name: input.clientName,
          sender: input.sender,
          text: input.text,
          time,
        }).select().single();
        if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
        return { ...data, from: data.sender as "client" | "team", time: data.time };
      }),
  }),

  // ── Administration: WhatsApp connection, backup, reminders and the action log ──
  admin: router({
    /** Whether the corporate WhatsApp is connected; any team member can see it. */
    whatsappStatus: staffProcedure.query(() => {
      if (ENV.whatsappProvider !== "web") return { provider: ENV.whatsappProvider, status: "off" as const };
      const info = getWhatsAppWebInfo();
      return { provider: "web", status: info.status, number: info.number };
    }),

    sistema: adminOnlyProcedure.query(async () => {
      const info = ENV.whatsappProvider === "web" ? getWhatsAppWebInfo() : null;
      return {
        whatsapp: {
          provider: ENV.whatsappProvider,
          status: info?.status ?? "off",
          number: info?.number ?? null,
          since: info?.since ?? null,
          // The QR only goes to administrators: scanning it links a phone to the company's sender.
          qr: info?.qr ? await QRCode.toDataURL(info.qr, { margin: 1, width: 300 }) : null,
        },
        backup: { ...jobState.backup, pasta: path.resolve(ENV.backupDir) },
        lembretes: jobState.lembretes,
        enderecoPublico: await getPublicUrl(),
        avisosParaClientes: ENV.notifyClients,
      };
    }),

    desconectarWhatsApp: adminOnlyProcedure.mutation(async ({ ctx }) => {
      try {
        await logoutWhatsAppWeb();
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Não foi possível desconectar." });
      }
      await registrarAcao(ctx.staffUser.email, "Desconectou o WhatsApp do portal");
      return { success: true } as const;
    }),

    fazerBackup: adminOnlyProcedure.mutation(async ({ ctx }) => {
      await backupJob();
      if (jobState.backup.lastError) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `O backup falhou: ${jobState.backup.lastError}` });
      await registrarAcao(ctx.staffUser.email, "Fez backup manual", jobState.backup.lastResult ?? undefined);
      return jobState.backup;
    }),

    /** Space and logins used against the Supabase plan limits */
    usoSupabase: adminOnlyProcedure.query(() => computeSupabaseUsage()),

    auditoria: adminOnlyProcedure
      .input(z.object({ busca: z.string().max(100).optional(), limite: z.number().int().min(10).max(1000).default(200) }))
      .query(({ input }) => listarAcoes({ limit: input.limite, busca: input.busca })),
  }),

  // ── Area for the client themselves (only ever sees their own process) ──
  cliente: router({
    /** Whether the client still has to accept the current terms (read fresh from the server, not from the session). */
    termos: clientProcedure.query(({ ctx }) => ({ version: TERMS_VERSION, accepted: hasAcceptedTerms(ctx.clienteUser) })),

    aceitarTermos: clientProcedure
      .input(z.object({ version: z.literal(TERMS_VERSION) }))
      .mutation(async ({ ctx }) => {
        const user = ctx.clienteUser;
        const forwarded = String(ctx.req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
        // Kept in app_metadata (only the server can write it) as evidence of the acceptance.
        const { error } = await supabase.auth.admin.updateUserById(user.id, {
          app_metadata: {
            ...user.app_metadata,
            terms: {
              version: TERMS_VERSION,
              accepted_at: new Date().toISOString(),
              ip: forwarded || ctx.req.ip || null,
              user_agent: String(ctx.req.headers["user-agent"] ?? "").slice(0, 300),
            },
          },
        });
        if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível registrar o aceite. Tente novamente." });
        return { accepted: true } as const;
      }),

    /** Key the browser needs to turn on the app notifications on this device. */
    chaveNotificacoes: clientWithTermsProcedure.query(() => ({ publicKey: getPushPublicKey() })),

    /** Keeps the device that turned the notices on; also called again on each visit to stay in sync. */
    ativarNotificacoes: clientWithTermsProcedure
      .input(pushSubscriptionInput)
      .mutation(async ({ ctx, input }) => {
        try {
          await savePushSubscription({ clientId: ctx.clienteId }, input, String(ctx.req.headers["user-agent"] ?? ""), input.instalado);
        } catch (error) {
          console.warn("[push] Could not save device:", error instanceof Error ? error.message : error);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível ativar as notificações agora. Tente novamente mais tarde." });
        }
        return { active: true } as const;
      }),

    meuProcesso: clientWithTermsProcedure.query(async ({ ctx }) => {
      // "*" keeps working before and after the migration that adds progresso and atualizado_em.
      const { data, error } = await supabase.from("clientes").select("*").eq("id", ctx.clienteId).single();
      if (error || !data) throw new TRPCError({ code: "NOT_FOUND", message: "Processo não encontrado." });
      const updatedAt = (data.atualizado_em ?? data.created_at) as string | null;
      return {
        id: data.id as number,
        name: data.name as string,
        type: (data.type as string | null) ?? null,
        status: (data.status as string | null) ?? null,
        updated: updatedAt ? formatUpdatedLabel(updatedAt) : ((data.updated as string | null) ?? null),
        tone: (data.tone as "green" | "yellow" | "red" | null) ?? null,
        services: (data.services as string[] | null) ?? null,
        progresso: typeof data.progresso === "number" ? data.progresso : 0,
      };
    }),

    /** The client's own documents. */
    documentos: clientWithTermsProcedure.query(async ({ ctx }) => {
      const rows = await listDocuments(ctx.clienteId);
      return rows.map(({ enviado_por: _author, ...row }) => row);
    }),

    /** The client's own timeline, without the names of who made each change. */
    historico: clientWithTermsProcedure.query(async ({ ctx }) => {
      const rows = await listEvents(ctx.clienteId);
      return rows.map(({ autor: _author, ...row }) => row);
    }),

    baixarDocumento: clientWithTermsProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        // Passing the client id makes a document of someone else look like it doesn't exist.
        const url = await documentDownloadUrl(input.id, ctx.clienteId);
        if (!url) throw new TRPCError({ code: "NOT_FOUND", message: "Documento não encontrado." });
        return { url };
      }),

    mensagens: clientWithTermsProcedure.query(async ({ ctx }) => {
      const { data, error } = await supabase
        .from("mensagens")
        .select("id, sender, text, time")
        .eq("client_id", ctx.clienteId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
      if (error) {
        console.warn("[cliente.mensagens] Supabase error:", error.message);
        return [];
      }
      return (data ?? []).flatMap((row) => {
        const from = clientMessageFrom[row.sender as string];
        return from ? [{ id: row.id as number, from, text: row.text as string, time: (row.time as string) ?? "" }] : [];
      });
    }),

    /** Saves what the assistant said and which options the client picked, in order. */
    registrarAssistente: clientWithTermsProcedure
      .input(z.object({
        entries: z.array(z.object({ from: z.enum(["bot", "choice"]), text: z.string().trim().min(1).max(4000) })).min(1).max(4),
      }))
      .mutation(async ({ ctx, input }) => {
        const time = nowHHmm();
        // Inserted one by one so created_at keeps the order of the conversation.
        for (const entry of input.entries) {
          const { error } = await supabase.from("mensagens").insert({
            client_id: ctx.clienteId,
            sender: ASSISTANT_SENDERS[entry.from],
            text: entry.text,
            time,
          });
          if (error) {
            // Until the migration that allows these senders runs, the assistant still works, it just isn't saved.
            console.warn("[cliente.registrarAssistente] Not saved:", error.message);
            return { saved: false } as const;
          }
        }
        return { saved: true } as const;
      }),

    enviarMensagem: clientWithTermsProcedure
      .input(z.object({
        text: z.string().trim().min(1).max(2000),
        /** Set when the chatbot handed the client over to the team: the message becomes a ticket. */
        assunto: z.enum(TICKET_TOPICS).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const time = nowHHmm();
        const { data: cliente } = await supabase.from("clientes").select("name").eq("id", ctx.clienteId).single();
        const text = input.assunto ? formatTicketMessage(input.assunto, input.text) : input.text;
        const { error } = await supabase.from("mensagens").insert({
          client_id: ctx.clienteId,
          client_name: cliente?.name,
          sender: "client",
          text,
          time,
        });
        if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
        notifyTeamNewMessage(ctx.clienteId, cliente?.name ?? "Cliente", text);
        return { success: true } as const;
      }),
  }),
});

export type AppRouter = typeof appRouter;

