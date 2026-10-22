import { describe, expect, it } from "vitest";
import { flexiona, generoDoNome } from "@shared/genero";
import { BANCOS_CONHECIDOS } from "@shared/notificacao";
import { notificacaoContratoDefinition, notificacaoDefinition } from "./notificacaoPdf";

describe("generoDoNome", () => {
  it("knows common women's names, by ending and by list", () => {
    for (const nome of ["MARIA ODETE DE PAULA LESSA ROCHA", "Fabiana", "Aline", "Denise", "Odete", "Daniele", "Kelly", "Beatriz", "Raquel", "Isabel", "Ingrid", "Carmen", "Thaís", "Sueli", "Josiane"]) {
      expect([nome, generoDoNome(nome)]).toEqual([nome, "F"]);
    }
  });

  it("knows common men's names, including the ones the endings would get wrong", () => {
    for (const nome of ["JAHIR ANTONIO DE OLIVEIRA JUNIOR", "Jorge Luiz Rodrigues", "Elivelton Alexandre", "José", "Henrique", "Felipe", "Luiz", "Davi", "Gabriel", "Rafael", "Luca", "Kauã", "Lucas"]) {
      expect([nome, generoDoNome(nome)]).toEqual([nome, "M"]);
    }
  });

  it("does not guess names used by both, nor an empty field", () => {
    for (const nome of ["Darci Silva", "Andrea", "Juraci", "", " "]) expect(generoDoNome(nome)).toBeNull();
  });

  it("writes the word for each case", () => {
    expect(flexiona("inscrito", "inscrita", "M")).toBe("inscrito");
    expect(flexiona("inscrito", "inscrita", "F")).toBe("inscrita");
    expect(flexiona("inscrito", "inscrita", null)).toBe("inscrito(a)");
  });
});

describe("notificações with the client's gender", () => {
  const banco = BANCOS_CONHECIDOS[0];
  const base = { cpf: "00000000000", bancoNome: banco.nome, bancoCnpj: banco.cnpj, bancoEndereco: banco.endereco, cidade: "São Paulo", data: "2026-10-22" };
  const text = (definition: unknown) => JSON.stringify(definition);

  it("writes inscrita, inscrito or inscrito(a) in both models", () => {
    const manual = (genero: "M" | "F" | null) => text(notificacaoDefinition({ ...base, nome: "Maria Exemplo", genero, valor: 1000, parcelas: 10, valorParcela: 120 }));
    expect(manual("F")).toContain(", inscrita no CPF");
    expect(manual("M")).toContain(", inscrito no CPF");
    expect(manual(null)).toContain(", inscrito(a) no CPF");
    const contrato = text(notificacaoContratoDefinition({ ...base, nome: "Maria Exemplo", genero: "F", contrato: "1", taxaMensal: 2, modalidade: "financiamento" }));
    expect(contrato).toContain(", inscrita no ");
  });
});
