import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendPushToStaff, sendFreeText } = vi.hoisted(() => ({ sendPushToStaff: vi.fn(async () => undefined), sendFreeText: vi.fn(async () => undefined) }));
vi.mock("./whatsapp", () => ({ canSendFreeText: () => true, normalizeBrazilPhone: (raw: string) => (/^\d{10,13}$/.test(raw) ? `55${raw}` : null), sendFreeText }));
vi.mock("./push", () => ({ sendPushToClient: vi.fn(async () => undefined), sendPushToStaff }));
vi.mock("./email", () => ({ isEmailEnabled: () => true, sendNoticeEmail: vi.fn(async () => undefined) }));
vi.mock("./publicUrl", () => ({ getPublicUrl: vi.fn(async () => "https://portal.exemplo") }));

import { ENV } from "./env";
import { CLIENT_DOCUMENT_NOTICE_WAIT_MS, clientDocumentNotice, notifyTeam, notifyTeamClientDocument } from "./notificacoes";

describe("aviso de documento enviado pelo cliente", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sendPushToStaff.mockClear();
    sendFreeText.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    ENV.documentNotifyWhatsApp = [];
    ENV.teamNotifyWhatsApp = [];
  });

  it("sends the document notice to the document numbers", () => {
    ENV.documentNotifyWhatsApp = ["11999999999", "11988888888"];
    notifyTeamClientDocument(6, "Lia", "termo.pdf");
    vi.advanceTimersByTime(CLIENT_DOCUMENT_NOTICE_WAIT_MS);
    expect(sendFreeText.mock.calls.map((call) => (call as unknown[])[0])).toEqual(["5511999999999", "5511988888888"]);
    expect((sendFreeText.mock.calls[0] as unknown[])[1]).toContain("Lia enviou um documento pelo portal");
  });

  it("sends the other team alerts only to the team numbers, never to the document numbers", async () => {
    ENV.documentNotifyWhatsApp = ["11999999999"];
    ENV.teamNotifyWhatsApp = ["11977777777"];
    notifyTeam("Bateria acabando", ["texto"], "🔴 Bateria acabando");
    await vi.advanceTimersByTimeAsync(0);
    expect(sendFreeText.mock.calls.map((call) => (call as unknown[])[0])).toEqual(["5511977777777"]);
  });

  it("does not send twice to a number on both lists, and skips an invalid one", async () => {
    ENV.documentNotifyWhatsApp = ["11977777777", "abc"];
    ENV.teamNotifyWhatsApp = ["11977777777"];
    notifyTeamClientDocument(7, "Leo", "a.pdf");
    await vi.advanceTimersByTimeAsync(CLIENT_DOCUMENT_NOTICE_WAIT_MS);
    expect(sendFreeText).toHaveBeenCalledTimes(1);
  });

  const pushes = () => sendPushToStaff.mock.calls.map((call) => (call as unknown[])[1] as { title: string; body: string; tag: string });

  it("warns about a single file", () => {
    notifyTeamClientDocument(1, "Maria", "termo.pdf");
    expect(pushes()).toHaveLength(0);
    vi.advanceTimersByTime(CLIENT_DOCUMENT_NOTICE_WAIT_MS);
    expect(pushes()).toHaveLength(1);
    expect(pushes()[0]).toMatchObject({ title: "Maria enviou um documento pelo portal", body: "termo.pdf" });
  });

  it("joins the files of one upload and leaves none out", () => {
    notifyTeamClientDocument(2, "Ana", "pagina 1.jpg");
    vi.advanceTimersByTime(CLIENT_DOCUMENT_NOTICE_WAIT_MS - 1000);
    notifyTeamClientDocument(2, "Ana", "pagina 2.jpg");
    vi.advanceTimersByTime(CLIENT_DOCUMENT_NOTICE_WAIT_MS - 1000);
    notifyTeamClientDocument(2, "Ana", "pagina 3.jpg");
    expect(pushes()).toHaveLength(0);
    vi.advanceTimersByTime(CLIENT_DOCUMENT_NOTICE_WAIT_MS);
    expect(pushes()).toHaveLength(1);
    expect(pushes()[0]).toMatchObject({ title: "Ana enviou 3 documentos pelo portal", body: "pagina 1.jpg, pagina 2.jpg, pagina 3.jpg" });
  });

  it("warns again about every later upload, with no minimum interval", () => {
    for (const file of ["a.pdf", "b.pdf", "c.pdf"]) {
      notifyTeamClientDocument(3, "Rui", file);
      vi.advanceTimersByTime(CLIENT_DOCUMENT_NOTICE_WAIT_MS);
      // Different moments, so a notice never replaces the previous one on the phone.
      vi.advanceTimersByTime(1);
    }
    expect(pushes().map((push) => push.body)).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
    expect(new Set(pushes().map((push) => push.tag)).size).toBe(3);
  });

  it("keeps clients apart", () => {
    notifyTeamClientDocument(4, "Bia", "x.pdf");
    notifyTeamClientDocument(5, "Caio", "y.pdf");
    vi.advanceTimersByTime(CLIENT_DOCUMENT_NOTICE_WAIT_MS);
    expect(pushes().map((push) => push.title).sort()).toEqual(["Bia enviou um documento pelo portal", "Caio enviou um documento pelo portal"]);
  });

  it("lists all the files in the e-mail and WhatsApp text", () => {
    const notice = clientDocumentNotice("Ana", ["a.jpg", "b.jpg"]);
    expect(notice.paragraphs[0]).toBe("Arquivos:\n- a.jpg\n- b.jpg");
    expect(notice.paragraphs[1]).toContain("estão assinados e legíveis");
    expect(notice.whatsapp).toContain("- b.jpg");
  });
});
