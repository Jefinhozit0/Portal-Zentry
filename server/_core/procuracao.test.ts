import { describe, expect, it } from "vitest";
import { emptyProcuracao, formatCEP, formatCPF, formatDocumento, hojeISO, localEData, nomeProprio, problemasProcuracao } from "@shared/procuracao";
import { buildProcuracaoPdf, procuracaoFileName } from "./procuracaoPdf";

const dados = { nome: "Maria da Silva", cpf: "00000000000", endereco: "Rua das Flores, 123", cep: "01234567", email: "maria@exemplo.com", cidade: "São Paulo", data: "2026-10-22" };

describe("procuração extrajudicial", () => {
  it("writes the place and date like the model", () => {
    expect(localEData(dados)).toBe("São Paulo, 22 de outubro de 2026.");
    expect(localEData({ ...dados, data: "2026-03-05" })).toBe("São Paulo, 5 de março de 2026.");
  });

  it("formats CPF and CEP typed without punctuation", () => {
    expect(formatCPF("00000000000")).toBe("000.000.000-00");
    expect(formatCEP("01234567")).toBe("01234-567");
    expect(formatCPF("123")).toBe("123");
    expect(formatDocumento("12345678000190")).toBe("12.345.678/0001-90");
    expect(formatDocumento("00000000000")).toBe("000.000.000-00");
  });

  it("asks for what is missing and accepts a complete form", () => {
    expect(problemasProcuracao(dados)).toEqual([]);
    expect(problemasProcuracao({ ...dados, cpf: "12.345.678/0001-90" })).toEqual([]);
    expect(problemasProcuracao(emptyProcuracao())).toEqual(expect.arrayContaining(["Falta o nome do outorgante.", "O CPF precisa ter 11 números (ou o CNPJ, 14).", "Falta um e-mail válido."]));
    expect(problemasProcuracao({ ...dados, cidade: "3550308" })).toEqual(['Escreva a cidade por extenso: "3550308" parece um código, não o nome da cidade.']);
  });

  it("writes the client's name with only the first letter of each name in capitals", () => {
    expect(nomeProprio("FLAVIO FERREIRA")).toBe("Flavio Ferreira");
    expect(nomeProprio("  maria DAS dores  dos santos e SILVA ")).toBe("Maria das Dores dos Santos e Silva");
    expect(nomeProprio("JOSÉ D'ÁVILA ANA-CLARA ÉRICA")).toBe("José D'Ávila Ana-Clara Érica");
    expect(nomeProprio("DA SILVA")).toBe("Da Silva");
  });

  it("starts with today's date in São Paulo", () => {
    expect(hojeISO(new Date("2026-10-23T01:30:00Z"))).toBe("2026-10-22");
    expect(emptyProcuracao().data).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("produces a one-page PDF named after the client", async () => {
    const pdf = await buildProcuracaoPdf(dados);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g)).toHaveLength(1);
    expect(procuracaoFileName(dados)).toBe("Procuração extrajudicial - Maria da Silva.pdf");
  });
});
