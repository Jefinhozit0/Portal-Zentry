import { describe, expect, it } from "vitest";
import { BANCOS, bancoConhecido, bancoDoCadastro, cnpjValido, formatCnpj, listaDeBancos, problemasBanco } from "@shared/bancos";

describe("bancos cadastrados pela equipe", () => {
  // Valid check digits, and not on the fixed list.
  const novo = { nome: "Banco Exemplo S.A.", cnpj: "11.222.333/0001-81", endereco: "Rua A, nº 1, Centro, Blumenau - SC, CEP: 89010-923" };
  const cadastrado = bancoDoCadastro({ id: 7, ...novo });

  it("accepts a complete bank and says what is wrong with an incomplete one", () => {
    expect(problemasBanco(novo)).toEqual([]);
    expect(problemasBanco({ nome: "", cnpj: "", endereco: "" })).toHaveLength(3);
    expect(problemasBanco({ ...novo, endereco: "Rua A, nº 1, Centro" })).toEqual(["Informe o endereço da sede com o CEP."]);
  });

  it("refuses a CNPJ with wrong check digits, a repeated digit or one already on the list", () => {
    expect(cnpjValido("62.307.848/0001-45")).toBe(false);
    expect(cnpjValido("11.111.111/1111-11")).toBe(false);
    expect(problemasBanco({ ...novo, cnpj: "62307848000115" })).toEqual(["Este CNPJ já está na lista de bancos."]);
    expect(formatCnpj("11222333000181")).toBe("11.222.333/0001-81");
  });

  it("finds it in contracts by CNPJ and by legal name, with or without the S.A.", () => {
    expect(bancoConhecido("QUALQUER NOME", "11222333000181", [cadastrado])?.id).toBe("cadastro-7");
    expect(bancoConhecido("BANCO EXEMPLO S.A.", "", [cadastrado])?.id).toBe("cadastro-7");
    expect(bancoConhecido("Banco Exemplo", "", [cadastrado])?.id).toBe("cadastro-7");
    expect(bancoConhecido("Banco Exemplo")).toBeUndefined();
  });

  it("does not take over a bank of the fixed list", () => {
    expect(bancoConhecido("BANCO SANTANDER (BRASIL) S.A.", "", [cadastrado])?.id).toBe("santander");
  });

  it("joins the fixed list in alphabetical order", () => {
    const nomes = listaDeBancos([cadastrado]).map((banco) => banco.nome);
    expect(nomes).toContain(novo.nome);
    expect(nomes).toHaveLength(BANCOS.length + 1);
    expect(nomes).toEqual([...nomes].sort((a, b) => a.localeCompare(b, "pt-BR")));
  });
});

describe("base de bancos", () => {
  it("has valid, unique CNPJs, unique ids and a full address with CEP for every bank", () => {
    for (const banco of BANCOS) {
      expect([banco.id, cnpjValido(banco.cnpj)]).toEqual([banco.id, true]);
      expect([banco.id, /CEP: \d{5}-\d{3}$/.test(banco.endereco)]).toEqual([banco.id, true]);
    }
    expect(new Set(BANCOS.map((banco) => banco.id)).size).toBe(BANCOS.length);
    expect(new Set(BANCOS.map((banco) => banco.cnpj)).size).toBe(BANCOS.length);
  });

  it("finds the bank by the contract's CNPJ before the name", () => {
    expect(bancoConhecido("QUALQUER NOME", "07.707.650/0001-10")?.id).toBe("aymore");
    expect(bancoConhecido("", "62307848000115")?.id).toBe("rci");
  });

  it("finds the bank by the names it goes by, the most specific one first", () => {
    expect(bancoConhecido("ITAÚ UNIBANCO S.A.")?.id).toBe("itau-unibanco");
    expect(bancoConhecido("BANCO ITAUCARD S.A.")?.id).toBe("itaucard");
    expect(bancoConhecido("BANCO SANTANDER (BRASIL) S.A.")?.id).toBe("santander");
    expect(bancoConhecido("SANTANDER SOCIEDADE DE CREDITO, FINANCIAMENTO E INVESTIMENTO S.A.")?.id).toBe("aymore");
    expect(bancoConhecido("Chevrolet Serviços Financeiros")?.id).toBe("gm");
    expect(bancoConhecido("PARATI - CREDITO FINANCIAMENTO E INVESTIMENTO S.A.")?.id).toBe("meutudo");
    expect(bancoConhecido("Eagle Sociedade de Crédito Direto S.A.")?.id).toBe("futuro");
    expect(bancoConhecido("Banco C6 S.A.")?.id).toBe("c6");
    expect(bancoConhecido("Nissan")?.id).toBe("rci");
    expect(bancoConhecido("Japan Bank")).toBeUndefined();
  });
});
