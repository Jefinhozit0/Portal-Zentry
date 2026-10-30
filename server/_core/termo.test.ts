import { describe, expect, it } from "vitest";
import { EMPRESA } from "@shared/empresa";
import { problemasTermo } from "@shared/termo";
import { buildTermoPdf, termoDefinition, termoFileName } from "./termoPdf";

const dados = { nome: "José Claudio Exemplo", genero: "M" as const, cpf: "00000000000", email: "jose@exemplo.com", endereco: "Rua Nova, 591 - Paulo Afonso - BA - CEP: 48609-116", banco: "Banco C6 S.A.", modalidade: "financiamento" as const };
const text = (definition: unknown) => JSON.stringify(definition);

describe("termo de prestação de serviços", () => {
  it("asks for what is missing", () => {
    expect(problemasTermo(dados)).toEqual([]);
    expect(problemasTermo({ ...dados, email: "", endereco: "", banco: "" })).toEqual(["Falta um e-mail válido.", "Falta o endereço do cliente.", "Falta a instituição financeira."]);
  });

  it("writes the words of the client's gender", () => {
    expect(text(termoDefinition(dados))).toContain(" brasileiro, inscrito no CPF: ");
    const feminino = text(termoDefinition({ ...dados, nome: "Maria Exemplo", genero: "F" }));
    expect(feminino).toContain(" brasileira, inscrita no CPF: ");
    expect(feminino).toContain("doravante denominada CONTRATANTE, neste ato representada");
    expect(text(termoDefinition({ ...dados, genero: null }))).toContain(" brasileiro(a), inscrito(a) no CPF: ");
  });

  it("qualifies a company client by its CNPJ", () => {
    const empresa = { ...dados, nome: "Transportes Exemplo Ltda", genero: "M" as const, cpf: "12345678000190" };
    expect(problemasTermo(empresa)).toEqual([]);
    expect(problemasTermo({ ...dados, cpf: "1234567800019" })).toEqual(["O CPF precisa ter 11 números (ou o CNPJ, 14)."]);
    const texto = text(termoDefinition(empresa));
    expect(texto).toContain(" pessoa jurídica de direito privado, inscrita no CNPJ: ");
    expect(texto).toContain("12.345.678/0001-90,");
    expect(texto).toContain("doravante denominada CONTRATANTE, neste ato representada");
    expect(texto).not.toContain("brasileiro");
  });

  it("uses the company's CNPJ and the contract type", () => {
    const empréstimo = text(termoDefinition({ ...dados, modalidade: "empréstimo" }));
    expect(empréstimo).toContain(EMPRESA.cnpj);
    expect(empréstimo).toContain("Contrato de empréstimo Banco C6 S.A.");
  });

  it("produces a one-page PDF named after the client", async () => {
    const pdf = await buildTermoPdf(dados);
    expect(pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g)).toHaveLength(1);
    expect(termoFileName(dados)).toBe("Termo de prestação de serviços - JOSÉ CLAUDIO EXEMPLO.pdf");
  });
});
