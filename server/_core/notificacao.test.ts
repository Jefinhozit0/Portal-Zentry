import { describe, expect, it } from "vitest";
import { impliedRate } from "@shared/laudo";
import { BANCOS_CONHECIDOS, avisoTaxa, modalidadeDoTitulo, bancoConhecido, dataPorExtenso, moeda, problemasNotificacao, problemasNotificacaoContrato, reaisPorExtenso } from "@shared/notificacao";
import { buildNotificacaoContratoPdf, buildNotificacaoPdf, notificacaoContratoFileName, notificacaoFileName } from "./notificacaoPdf";

const santander = BANCOS_CONHECIDOS[0];
const dados = { nome: "Maria da Silva", cpf: "00000000000", valor: 50000, parcelas: 60, valorParcela: 1845.54, bancoNome: santander.nome, bancoCnpj: santander.cnpj, bancoEndereco: santander.endereco, cidade: "São Paulo", data: "2025-11-14" };

describe("notificação extrajudicial", () => {
  it("writes amounts in words like the model", () => {
    expect(reaisPorExtenso(50000)).toBe("cinquenta mil reais");
    expect(reaisPorExtenso(1845.54)).toBe("um mil oitocentos e quarenta e cinco reais e cinquenta e quatro centavos");
    expect(reaisPorExtenso(848.37)).toBe("oitocentos e quarenta e oito reais e trinta e sete centavos");
    expect(reaisPorExtenso(1100)).toBe("um mil e cem reais");
    expect(reaisPorExtenso(2_000_000)).toBe("dois milhões de reais");
    expect(reaisPorExtenso(1)).toBe("um real");
    expect(reaisPorExtenso(0.5)).toBe("cinquenta centavos");
    expect(moeda(50000)).toBe("R$50.000,00");
  });

  it("finds the bank of an Aymoré contract and others by name", () => {
    expect(bancoConhecido("AYMORÉ CRÉDITO, FINANCIAMENTO E INVESTIMENTO S.A.")?.cnpj).toBe("07.707.650/0001-10");
    expect(bancoConhecido("BANCO PAN S.A.")?.id).toBe("pan");
    expect(bancoConhecido("FINANCEIRA DESCONHECIDA S.A.")).toBeUndefined();
  });

  it("writes the place and date", () => {
    expect(dataPorExtenso("São Paulo", "2025-11-14")).toBe("São Paulo, 14 de novembro de 2025.");
  });

  it("asks for what is missing", () => {
    expect(problemasNotificacao(dados)).toEqual([]);
    expect(problemasNotificacao({ ...dados, bancoEndereco: "" })).toEqual(["Falta o endereço da sede da instituição."]);
    expect(problemasNotificacao({ ...dados, valorParcela: 0, cidade: "3550308" })).toHaveLength(2);
  });

  it("notifies Banco do Brasil with its own qualification", () => {
    expect(bancoConhecido("BANCO DO BRASIL S.A.")?.cnpj).toBe("00.000.000/0001-91");
  });

  it("produces a one-page PDF named after the client, even with long names and amounts", async () => {
    const pdf = await buildNotificacaoPdf({ ...dados, nome: "Maria Odete de Paula Lessa Rocha Albuquerque", valor: 123456.78, valorParcela: 7777.77 });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g)).toHaveLength(1);
    expect(notificacaoFileName(dados)).toBe("Notificação extrajudicial - MARIA DA SILVA.pdf");
  });
});

describe("notificação com contrato", () => {
  const bb = BANCOS_CONHECIDOS.find((bank) => bank.id === "bb")!;
  const dadosContrato = { nome: "Jorge Exemplo Rodrigues", cpf: "00000000000", contrato: "147126013", taxaMensal: 1.96, modalidade: "empréstimo" as const, bancoNome: bb.nome, bancoCnpj: bb.cnpj, bancoEndereco: bb.endereco, cidade: "Teresina", data: "2026-10-06" };

  it("tells financiamento from empréstimo by the contract title", () => {
    expect(modalidadeDoTitulo("CÉDULA DE CRÉDITO BANCÁRIO - CRÉDITO PESSOAL COM GARANTIA DE VEÍCULO")).toBe("empréstimo");
    expect(modalidadeDoTitulo("CONDIÇÕES ESPECÍFICAS DE OPERAÇÃO DE CRÉDITO DIRETO AO CONSUMIDOR (CDC) – VEÍCULOS")).toBe("financiamento");
    expect(modalidadeDoTitulo("CONTRATO")).toBeNull();
  });

  it("asks for the contract number and the rate", () => {
    expect(problemasNotificacaoContrato(dadosContrato)).toEqual([]);
    expect(problemasNotificacaoContrato({ ...dadosContrato, contrato: "", taxaMensal: 0 })).toEqual(["Falta o número do contrato.", "Falta a taxa de juros mensal do contrato."]);
  });

  it("checks the claim against the rate the payments imply", () => {
    // Santander CDC: 26.041,53 in 48 × 848,37 is 1,9963% a.m.
    const rate = impliedRate(26041.53, 848.37, 48);
    expect(avisoTaxa(1.96, rate)).toMatchObject({ ok: true });
    expect(avisoTaxa(2, rate)).toMatchObject({ ok: false });
    expect(avisoTaxa(1.96, null)).toBeNull();
  });

  it("takes at most two pages, the stamp and the CDC footnote kept together, even with long names, addresses and contract numbers", async () => {
    const pdf = await buildNotificacaoContratoPdf({ ...dadosContrato, nome: "Maria Odete de Paula Lessa Rocha Albuquerque", bancoEndereco: `${bb.endereco}, Edifício Sede III, 10º andar, sala 1001`, contrato: "0139677475718485232641484552566277378267" });
    expect(pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g)!.length).toBeLessThanOrEqual(2);
    expect(notificacaoContratoFileName(dadosContrato)).toBe("Notificação extrajudicial com contrato - JORGE EXEMPLO RODRIGUES - 147126013.pdf");
  });
});
