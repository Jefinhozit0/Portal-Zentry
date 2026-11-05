import { afterEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import { supabase } from "./_core/supabase";
import type { TrpcContext } from "./_core/context";

const dados = {
  pedido: "REVISIONAL DE FINANCIAMENTO DE VEÍCULO",
  reclamante: { nome: "MARIA DA SILVA", rg: "", documento: "", profissao: "", estadoCivil: "", telefone: "", whatsapp: "", email: "" },
  reclamado: { nome: "BANCO EXEMPLO S.A.", documento: "" },
  itens: [{ id: "reducao" as const, texto: "Revisão do contrato" }],
  data: "2026-11-03",
};

/** Each test uses its own token: the router caches the user of a session by token. */
function chamador(token: string | null, role?: string) {
  if (role) vi.spyOn(supabase.auth, "getUser").mockResolvedValue({ data: { user: { id: "1", email: `${role}@exemplo.com`, app_metadata: { role } } }, error: null } as never);
  const ctx = { user: undefined, req: { headers: token ? { "x-supabase-token": token } : {} } as TrpcContext["req"], res: {} as TrpcContext["res"] } satisfies TrpcContext;
  return appRouter.createCaller(ctx).portal;
}

describe("acesso ao formulário CCMA", () => {
  afterEach(() => vi.restoreAllMocks());

  it("asks for login without a session", async () => {
    await expect(chamador(null).lerDocumentoCcma({ nome: "a.pdf", conteudo: "QQ==" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("refuses team members who are not administrators, on both routes", async () => {
    const equipe = chamador("token-equipe", "staff");
    await expect(equipe.lerDocumentoCcma({ nome: "a.pdf", conteudo: "QQ==" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(equipe.gerarFormularioCcma({ aprovado: true, dados })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses clients", async () => {
    await expect(chamador("token-cliente", "client").gerarFormularioCcma({ aprovado: true, dados })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets an administrator through, but never generates without the express approval", async () => {
    const admin = chamador("token-admin", "admin");
    await expect(admin.lerDocumentoCcma({ nome: "a.exe", conteudo: Buffer.from("MZ").toString("base64") })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Envie um PDF ou uma imagem (JPG ou PNG)." });
    await expect(admin.gerarFormularioCcma({ aprovado: false as true, dados })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(admin.gerarFormularioCcma({ aprovado: true, dados: { ...dados, data: "" } })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Informe a data do formulário." });
  });
});
