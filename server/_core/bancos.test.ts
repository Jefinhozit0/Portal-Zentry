import { describe, expect, it } from "vitest";
import { BANCOS, bancoConhecido } from "@shared/bancos";

/** CNPJ check digits (mod 11), so a typo like RCI's 0001-45 (the right one is 0001-15) never gets in. */
function cnpjValido(cnpj: string) {
  const digits = cnpj.replace(/\D/g, "");
  if (digits.length !== 14) return false;
  const dv = (base: string) => {
    const weights = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const rest = base.split("").reduce((sum, d, i) => sum + Number(d) * weights[i], 0) % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const first = dv(digits.slice(0, 12));
  return digits === digits.slice(0, 12) + first + dv(digits.slice(0, 12) + first);
}

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
