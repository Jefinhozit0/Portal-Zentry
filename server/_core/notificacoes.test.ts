import { describe, expect, it } from "vitest";
import { formatTicketMessage } from "@shared/tickets";
import { clientTexts, GOVBR_SIGNATURE_STEPS, PHOTO_SIGNATURE_STEPS, pushText, teamPushText } from "./notificacoes";

describe("clientTexts", () => {
  it("sends the gov.br step by step with a document to sign", () => {
    const texts = clientTexts("assinatura", "Maria", "Procuração extrajudicial", "https://portal.exemplo");
    expect(texts.whatsapp).toContain("*Procuração extrajudicial*");
    expect(texts.whatsapp).toContain("https://portal.exemplo");
    for (const step of GOVBR_SIGNATURE_STEPS) expect(texts.whatsapp).toContain(step);
    expect(texts.email.subject).toBe("Documento para assinar: Procuração extrajudicial");
    expect(texts.email.paragraphs.join("\n")).toContain("https://assinador.iti.br");
    expect(texts.email.paragraphs.join("\n")).toContain("respondendo este e-mail");
  });

  it("also explains how to sign by hand and send photos, in each channel's words", () => {
    const texts = clientTexts("assinatura", "Maria", "Termo de prestação de serviços", "https://portal.exemplo");
    for (const step of PHOTO_SIGNATURE_STEPS) expect(texts.whatsapp).toContain(step);
    const email = texts.email.paragraphs.join("\n");
    expect(email).toContain("Prefere assinar à mão e mandar fotos?");
    expect(email).toContain("envie respondendo este e-mail");
    expect(email).not.toContain("respondendo esta mensagem");
  });

  it("tells the client to attach the signed document in the portal, in both ways to sign", () => {
    const { whatsapp } = clientTexts("assinatura", "Maria", "Termo de prestação de serviços", "https://portal.exemplo");
    expect(whatsapp).toContain('7. Anexe o arquivo assinado no portal, em Documentos, no botão "Enviar documento assinado".');
    expect(whatsapp).toContain('4. Anexe as fotos no portal, em Documentos, no botão "Enviar documento assinado".');
  });

  it("does not depend on a line for the client, which the notificações and the parecer do not have", () => {
    for (const documento of ["Notificação extrajudicial", "Parecer técnico"]) {
      const texts = clientTexts("assinatura", "Maria", documento, "https://portal.exemplo");
      expect(texts.whatsapp).toContain(`*${documento}*`);
      expect(texts.whatsapp).toContain("no fim do documento");
      expect(texts.email.subject).toBe(`Documento para assinar: ${documento}`);
    }
  });
});

describe("pushText", () => {
  it("opens the chat for a reply and the portal for the rest", () => {
    expect(pushText("resposta").url).toBe("/?aba=conversa");
    expect(pushText("status", "Concluído").url).toBe("/");
  });

  it("says what changed without the client's name (it shows on the lock screen)", () => {
    expect(pushText("status", "Concluído")).toMatchObject({ title: "Seu processo foi atualizado", body: "Situação atual: Concluído.", tag: "status" });
    expect(pushText("documento", "Contrato.pdf").body).toBe("A Zentry adicionou: Contrato.pdf.");
    expect(pushText("documento").body).toBe("A Zentry adicionou um documento ao seu processo.");
  });

  it("asks for the signature of a document the client has to sign", () => {
    expect(pushText("assinatura", "Procuração extrajudicial")).toEqual({
      title: "Documento para assinar",
      body: "Procuração extrajudicial: baixe no portal, assine e nos envie.",
      url: "/",
      tag: "assinatura",
    });
  });
});

describe("teamPushText", () => {
  it("shows who wrote and what, and opens Atendimento", () => {
    expect(teamPushText(7, "Ana Souza", "Oi, mandei o RG")).toEqual({ title: "Nova mensagem de Ana Souza", body: "Oi, mandei o RG", url: "/?view=atendimento", tag: "cliente-7" });
  });

  it("names the ticket subject and shortens long messages", () => {
    const notice = teamPushText(7, "Ana", formatTicketMessage("Prazos", "x".repeat(200)));
    expect(notice.title).toBe("Novo ticket de Ana: Prazos");
    expect(notice.body).toBe(`${"x".repeat(140)}…`);
  });
});
