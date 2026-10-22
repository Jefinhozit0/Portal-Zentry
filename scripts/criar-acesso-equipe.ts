/**
 * Creates (or sets a new password for) a team login without e-mail. Use it while EMAIL_PROVIDER=off,
 * when "Criar login" and "Esqueci minha senha" are hidden because no code can be e-mailed.
 *
 *   npx tsx scripts/criar-acesso-equipe.ts <e-mail> <senha>
 *
 * The e-mail must also be in STAFF_EMAILS (and ADMIN_EMAILS for an administrator) to open the team area.
 * Client logins are left alone: send them a new access link from the portal instead.
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

async function main() {
  const [rawEmail, password] = process.argv.slice(2);
  const email = rawEmail?.trim().toLowerCase();
  if (!email || !password) {
    console.log("Uso: npx tsx scripts/criar-acesso-equipe.ts <e-mail> <senha>");
    process.exit(1);
  }
  if (password.length < 8) throw new Error("A senha precisa ter pelo menos 8 caracteres.");

  const supabase = createClient(process.env.SUPABASE_URL ?? "", process.env.SUPABASE_SECRET_KEY ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let existing = null;
  for (let page = 1; !existing; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    existing = data.users.find((user) => user.email?.toLowerCase() === email) ?? null;
    if (data.users.length < 1000) break;
  }

  if (existing?.app_metadata?.role === "client") {
    throw new Error("Este e-mail é de um cliente. Envie um novo link de acesso pelo portal.");
  }
  if (existing) {
    const { error } = await supabase.auth.admin.updateUserById(existing.id, { password, email_confirm: true });
    if (error) throw error;
    console.log(`Senha nova salva para ${email}.`);
  } else {
    const { error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    console.log(`Acesso criado para ${email}.`);
  }

  const staff = (process.env.STAFF_EMAILS ?? "").toLowerCase().split(/[,;\s]+/);
  if (!staff.includes(email)) console.log("Atenção: este e-mail não está em STAFF_EMAILS no .env, então ainda não abre a área da equipe.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
