import { afterEach, describe, expect, it, vi } from "vitest";
import nodemailer from "nodemailer";
import { sendClientAccessEmail, sendVerificationCodeEmail } from "./email";

const { sendMailMock, createTransportMock } = vi.hoisted(() => ({
  sendMailMock: vi.fn(),
  createTransportMock: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: createTransportMock },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("sendVerificationCodeEmail", () => {
  it("sends to the entered recipient using Gmail SMTP when configured", async () => {
    createTransportMock.mockReturnValue({ sendMail: sendMailMock });

    await sendVerificationCodeEmail("customer@example.com", "123456", {
      resendApiKey: "",
      emailFrom: "",
      gmailUser: "owner@gmail.com",
      gmailAppPassword: "FAKE TEST ONLY XXXX",
    });

    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: "owner@gmail.com", pass: "FAKETESTONLYXXXX" },
    });
    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({
      from: { name: "Zentry Soluções", address: "owner@gmail.com" },
      to: "customer@example.com",
      text: expect.stringContaining("123456"),
    }));
  });

  it("requires provider configuration", async () => {
    await expect(sendVerificationCodeEmail("client@example.com", "123456", {
      resendApiKey: "",
      emailFrom: "",
    })).rejects.toThrow("RESEND_API_KEY e EMAIL_FROM");
  });

  it("sends the verification code through Resend", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await sendVerificationCodeEmail("client@example.com", "123456", {
      resendApiKey: "re_test_key",
      emailFrom: "Zentry Solucoes <no-reply@example.com>",
    });

    expect(fetchMock).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({
      method: "POST",
      headers: {
        Authorization: "Bearer re_test_key",
        "Content-Type": "application/json",
      },
    }));
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(payload.to).toEqual(["client@example.com"]);
    expect(payload.text).toContain("123456");
  });

  it("explains the recipient restriction of a Resend onboarding key", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));

    await expect(sendVerificationCodeEmail("client@example.com", "123456", {
      resendApiKey: "re_test_key",
      emailFrom: "Zentry Solucoes <no-reply@example.com>",
    })).rejects.toThrow("só permite enviar para o e-mail proprietário da conta");
  });

  it("explains when Resend rejects the sender address", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 422 }));

    await expect(sendVerificationCodeEmail("client@example.com", "123456", {
      resendApiKey: "re_test_key",
      emailFrom: "Zentry Solucoes <no-reply@example.com>",
    })).rejects.toThrow("Gmail não pode ser usado como remetente");
  });
});

describe("sendClientAccessEmail", () => {
  it("sends the first-access link, never a password", async () => {
    createTransportMock.mockReturnValue({ sendMail: sendMailMock });

    await sendClientAccessEmail("cliente@example.com", {
      name: "Joana <Ribeiro>",
      link: "https://portal.example.com/primeiro-acesso?u=abc&t=xyz",
    }, {
      resendApiKey: "",
      emailFrom: "",
      gmailUser: "owner@gmail.com",
      gmailAppPassword: "FAKETESTONLYXXXX",
    });

    const message = sendMailMock.mock.calls[0][0];
    expect(message.to).toBe("cliente@example.com");
    expect(message.text).toContain("https://portal.example.com/primeiro-acesso?u=abc&t=xyz");
    expect(message.html).toContain("primeiro-acesso?u=abc&amp;t=xyz");
    expect(message.text).not.toMatch(/senha provisória/i);
    expect(message.html).not.toContain("<Ribeiro>");
  });

  it("presents the new portal to a client from the old system", async () => {
    createTransportMock.mockReturnValue({ sendMail: sendMailMock });

    await sendClientAccessEmail("cliente@example.com", {
      name: "Joana Ribeiro",
      link: "https://portal.example.com/a/K7p2XqM4bN9w",
      migrated: true,
    }, {
      resendApiKey: "",
      emailFrom: "",
      gmailUser: "owner@gmail.com",
      gmailAppPassword: "FAKETESTONLYXXXX",
    });

    const message = sendMailMock.mock.calls.at(-1)![0];
    expect(message.subject).toContain("novo portal");
    expect(message.text).toContain("sistema anterior");
    expect(message.text).toContain("https://portal.example.com/a/K7p2XqM4bN9w");
    expect(message.html).toContain("Criar minha senha");
  });
});
