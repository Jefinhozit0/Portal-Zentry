/** An address found by CEP (ViaCEP or BrasilAPI). Small cities have one CEP for the whole city: no street or bairro. */
export type EnderecoCep = { cep: string; logradouro: string; bairro: string; cidade: string; uf: string };

/** "01001000" → "01001-000". */
export const formatCepDigits = (digits: string) => `${digits.slice(0, 5)}-${digits.slice(5)}`;

/**
 * The address text a CEP fills in, as each document writes it, with the place where the number goes
 * (right after "Rua X, "), so the caret can wait there:
 * - procuração (CEP and city have their own fields): "Rua das Flores, | - Centro"
 * - termo (one field, CEP included): "Rua das Flores, | - Centro - São Paulo - SP - CEP: 01001-000"
 * Without a street (a city-wide CEP) the caret stays at the start, for the street and the number.
 */
export function enderecoDoCep(endereco: EnderecoCep, estilo: "procuracao" | "termo"): { texto: string; cursor: number } {
  const inicio = endereco.logradouro ? `${endereco.logradouro}, ` : "";
  const partes = estilo === "procuracao"
    ? [endereco.bairro]
    : [endereco.bairro, endereco.cidade, endereco.uf, `CEP: ${formatCepDigits(endereco.cep)}`];
  const resto = partes.filter(Boolean).map((parte) => ` - ${parte}`).join("");
  return { texto: inicio + resto, cursor: inicio.length };
}
