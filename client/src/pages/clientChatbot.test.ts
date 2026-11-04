import { describe, expect, it } from "vitest";
import { BOT_STEPS, readTypedMessage, type ProcessInfo } from "./clientChatbot";

const process: ProcessInfo = {
  firstName: "Ana",
  type: "Revisão de Juros",
  status: "Pendente documentação",
  updated: "há 2 dias",
  progress: 40,
  documents: [{ nome: "Contrato.pdf", created_at: "2026-10-15T15:00:00Z" }],
  lastEvent: { titulo: "Status alterado", created_at: "2026-10-18T15:00:00Z" },
};

describe("readTypedMessage", () => {
  it("recognizes the topic of what the client types, ignoring accents and case", () => {
    expect(readTypedMessage("Quanto tempo DEMORA?")).toEqual({ kind: "step", step: "prazos" });
    expect(readTypedMessage("como está meu processo")).toEqual({ kind: "step", step: "andamento" });
    expect(readTypedMessage("preciso mandar meu RG")).toEqual({ kind: "step", step: "documentos" });
    expect(readTypedMessage("quero falar com um atendente")).toEqual({ kind: "step", step: "atendente" });
  });

  it("puts money questions first, even when they mention other topics", () => {
    expect(readTypedMessage("quando vence o boleto do meu processo?")).toEqual({ kind: "step", step: "pagamentos" });
  });

  it("answers short greetings and thanks itself", () => {
    expect(readTypedMessage("Oi")).toEqual({ kind: "saudacao" });
    expect(readTypedMessage("bom dia!")).toEqual({ kind: "saudacao" });
    expect(readTypedMessage("muito obrigado")).toEqual({ kind: "agradecimento" });
  });

  it("does not take a real question for a greeting", () => {
    expect(readTypedMessage("oi, quanto tempo falta para terminar meu processo de revisão?")).toEqual({ kind: "step", step: "prazos" });
    expect(readTypedMessage("recebi uma ligação estranha")).toEqual({ kind: "step", step: "atendente" });
    expect(readTypedMessage("xyz")).toEqual({ kind: "nenhum" });
  });
});

describe("assistant replies", () => {
  it("explains the status, the progress and the last movement", () => {
    const text = BOT_STEPS.andamento.reply(process, "Andamento do processo");
    expect(text).toContain('"Pendente documentação", com 40% de progresso');
    expect(text).toContain("aguardando documentos");
    expect(text).toContain("status alterado, em 18/10/2026");
  });

  it("counts only what the team attached and says how to send a signed document", () => {
    const reply = BOT_STEPS.documentos.reply({ ...process, status: "Em andamento", documents: [{ nome: "foto.jpg", created_at: "2026-11-01T15:00:00Z", enviadoPeloCliente: true }, ...process.documents] }, "Documentos");
    expect(reply).toContain('1 documento ao seu processo (o mais recente: "Contrato.pdf"');
    expect(reply).toContain("Enviar documento assinado");
  });

  it("lists what the team attached and says when documents are missing", () => {
    const text = BOT_STEPS.documentos.reply(process, "Documentos");
    expect(text).toContain('1 documento ao seu processo (o mais recente: "Contrato.pdf", em 15/10/2026)');
    expect(text).toContain("aguardando documentos");
    expect(BOT_STEPS.documentos.reply({ ...process, documents: [], status: "Em andamento" }, "Documentos")).toContain("ainda não anexou");
  });

  it("does not promise a date, and knows when the case is finished", () => {
    expect(BOT_STEPS.prazos.reply({ ...process, status: "Em andamento judicial" }, "Prazos")).toContain("depende do tribunal");
    expect(BOT_STEPS.prazos.reply({ ...process, status: "Concluído" }, "Prazos")).toContain("já foi concluído");
  });
});
