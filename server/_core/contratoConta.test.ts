import { describe, expect, it } from "vitest";
import { emptyLaudo } from "@shared/laudo";
import { cnpjValido, conferirContrato, cpfValido, fechaConta } from "./contratoConta";

// Santander CDC: 26.041,53 in 48 × 848,37 at 2,00% a.m. written (1,9963% implied).
const santander = { valorFinanciado: 26041.53, valorParcela: 848.37, parcelas: 48, taxaMensal: 2 };
const dados = (over: Partial<typeof santander> = {}) => ({ ...emptyLaudo(), ...santander, taxaAnual: 26.82, ...over });
/** The contract's own lines with the values the labels read (a value read is always written in it). */
const escritos = ["Valor total financiado R$ 26.041,53", "Quantidade de parcelas: 48", "Taxa de juros: mensal % a.m.: 2,00% anual % a.a.: 26,82%"];

describe("conferência pela conta da tabela Price", () => {
  it("accepts the payment a little above the written rate, never below or far above", () => {
    expect(fechaConta(santander)).toBe(true);
    // Santander consignado: 3,63% written, 4,19% implied (the divergence the laudo shows).
    expect(fechaConta({ valorFinanciado: 22128.62, valorParcela: 1201, parcelas: 36, taxaMensal: 3.63 })).toBe(true);
    expect(fechaConta({ ...santander, taxaMensal: 2.5 })).toBe(false);
    expect(fechaConta({ ...santander, parcelas: 36 })).toBe(false);
    expect(fechaConta({ ...santander, valorParcela: 0 })).toBe(false);
  });

  it("confirms a reading that closes, changing nothing", () => {
    const lidos = dados();
    expect(conferirContrato(lidos, [])).toEqual({ conferido: true, corrigidos: [], avisos: [] });
    expect(lidos).toMatchObject(santander);
  });

  it("finds a value the labels missed anywhere in the document", () => {
    const lidos = dados({ valorParcela: 0 });
    const documento = [...escritos, "Cláusula 3. O valor do seguro é R$ 1.200,00.", "Prestações mensais", "R$ 848,37", "Tarifa de cadastro R$ 650,00"];
    const conferencia = conferirContrato(lidos, documento);
    expect(conferencia).toMatchObject({ conferido: true, corrigidos: ["valorParcela"] });
    expect(lidos.valorParcela).toBe(848.37);
  });

  it("points at a misread value and the one that closes the account, without overwriting it", () => {
    // OCR read the grace period (30) as the term; the table has 48.
    const lidos = dados({ parcelas: 30 });
    const conferencia = conferirContrato(lidos, [...escritos, "Valor da parcela R$ 848,37", "Carência 30 dias", "Prazo da operação (parcelas)", "48"]);
    expect(conferencia).toMatchObject({ conferido: false, corrigidos: [] });
    expect(conferencia.avisos[0]).toBe("Confira o quantidade de parcelas: li 30, mas a conta da tabela Price fecha com 48, que também está no contrato.");
    expect(lidos.parcelas).toBe(30);
  });

  it("does not guess when the document doesn't settle it", () => {
    // Without the payment anywhere, nothing closes: the field stays blank and is named.
    const semParcela = dados({ valorParcela: 0 });
    expect(conferirContrato(semParcela, ["Tarifa de cadastro R$ 650,00"])).toMatchObject({ conferido: false, corrigidos: [] });
    expect(semParcela.valorParcela).toBe(0);
    expect(conferirContrato(dados({ valorParcela: 0 }), []).avisos[0]).toContain("valor da parcela");
    // Numbers with no label of their kind are not brought in.
    const semRotulo = dados({ valorParcela: 0 });
    expect(conferirContrato(semRotulo, ["R$ 848,37"])).toMatchObject({ conferido: false });
    expect(semRotulo.valorParcela).toBe(0);
  });

  it("says so when the four values read don't close the account", () => {
    const conferencia = conferirContrato(dados({ taxaMensal: 3.5, taxaAnual: 51.11 }), []);
    expect(conferencia.conferido).toBe(false);
    expect(conferencia.avisos[0]).toContain("não fecham a conta");
  });

  it("checks the yearly rate against the monthly one", () => {
    expect(conferirContrato(dados({ taxaAnual: 62.5 }), []).avisos).toEqual([expect.stringContaining("taxa anual lida")]);
    // Bradesco prints the yearly rate of the rate really charged (2,87% a.m. written, 41,17% a.a.): accepted.
    expect(conferirContrato({ ...emptyLaudo(), valorFinanciado: 31593.55, valorParcela: 1121.02, parcelas: 60, taxaMensal: 2.87, taxaAnual: 41.17 }, []).avisos).toEqual([]);
  });

  it("knows a CPF or CNPJ misread by its check digits", () => {
    expect(cpfValido("529.982.247-25")).toBe(true);
    expect(cpfValido("529.982.247-24")).toBe(false);
    expect(cpfValido("000.000.000-00")).toBe(false);
    expect(cnpjValido("07.207.996/0001-50")).toBe(true);
    expect(cnpjValido("07.207.996/0001-51")).toBe(false);
  });
});
