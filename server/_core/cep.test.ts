import { describe, expect, it } from "vitest";
import { enderecoDoCep } from "@shared/cep";

const se = { cep: "01001000", logradouro: "Praça da Sé", bairro: "Sé", cidade: "São Paulo", uf: "SP" };

describe("endereço pelo CEP", () => {
  it("writes the address of each document and leaves the caret for the number", () => {
    const procuracao = enderecoDoCep(se, "procuracao");
    expect(procuracao.texto).toBe("Praça da Sé,  - Sé - São Paulo - SP");
    expect(procuracao.texto.slice(0, procuracao.cursor)).toBe("Praça da Sé, ");
    const termo = enderecoDoCep(se, "termo");
    expect(termo.texto).toBe("Praça da Sé,  - Sé - São Paulo - SP - CEP: 01001-000");
    expect(termo.cursor).toBe("Praça da Sé, ".length);
  });

  it("waits at the start when the CEP covers the whole city", () => {
    expect(enderecoDoCep({ ...se, cep: "48600000", logradouro: "", bairro: "", cidade: "Paulo Afonso", uf: "BA" }, "termo"))
      .toEqual({ texto: " - Paulo Afonso - BA - CEP: 48600-000", cursor: 0 });
  });
});
