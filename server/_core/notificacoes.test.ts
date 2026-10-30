import { describe, expect, it } from "vitest";
import { formatTicketMessage } from "@shared/tickets";
import { clientTexts, GOVBR_SIGNATURE_STEPS, pushText, teamPushText } from "./notificacoes";

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
