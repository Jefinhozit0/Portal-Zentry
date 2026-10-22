import { describe, expect, it } from "vitest";
import { formatTicketMessage } from "@shared/tickets";
import { pushText, teamPushText } from "./notificacoes";

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
