/** An address found by CEP (ViaCEP or BrasilAPI). Small cities have one CEP for the whole city: no street or bairro. */
export type EnderecoCep = { cep: string; logradouro: string; bairro: string; cidade: string; uf: string };

/** "01001000" → "01001-000". */
export const formatCepDigits = (digits: string) => `${digits.slice(0, 5)}-${digits.slice(5)}`;

/**
 * The address text a CEP fills in, as each document writes it, with the place where the number goes
 * (right after "Rua X, "), so the caret can wait there:
 * - procuração (the CEP has its own field): "Rua das Flores, | - Centro - São Paulo - SP"
 * - termo (one field, CEP included): "Rua das Flores, | - Centro - São Paulo - SP - CEP: 01001-000"
 * Without a street (a city-wide CEP) the caret stays at the start, for the street and the number.
 */
export function enderecoDoCep(endereco: EnderecoCep, estilo: "procuracao" | "termo"): { texto: string; cursor: number } {
  const inicio = endereco.logradouro ? `${endereco.logradouro}, ` : "";
  const partes = estilo === "procuracao"
    ? [endereco.bairro, endereco.cidade, endereco.uf]
    : [endereco.bairro, endereco.cidade, endereco.uf, `CEP: ${formatCepDigits(endereco.cep)}`];
  const resto = partes.filter(Boolean).map((parte) => ` - ${parte}`).join("");
  return { texto: inicio + resto, cursor: inicio.length };
}

/** The 27 states by UF, as written in a document's place of signing ("Bahia, 30 de outubro de 2026."). */
export const ESTADOS: Record<string, string> = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará", DF: "Distrito Federal",
  ES: "Espírito Santo", GO: "Goiás", MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais",
  PA: "Pará", PB: "Paraíba", PR: "Paraná", PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte",
  RS: "Rio Grande do Sul", RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina", SP: "São Paulo", SE: "Sergipe", TO: "Tocantins",
};

/** The states' names, in alphabetical order (for a list to choose from). */
export const NOMES_ESTADOS = Object.values(ESTADOS).sort((a, b) => a.localeCompare(b, "pt-BR"));
