/**
 * The company named in the generated documents (procuração, notificações, termo) and the accountant
 * who signs the laudo. While a field below is empty, the portal refuses to generate the documents
 * that print it, so no document goes out with a blank CNPJ or address.
 *
 * Images (optional): server/assets/notificacao/assinatura.png is the representative's signature that
 * closes the notificação com contrato, over the line with name and CNPJ (without it, the line is blank);
 * server/assets/laudo/assinatura.png is the accountant's signature (without it, a blank line to sign).
 */
export const EMPRESA = {
  /** Razão social, as on the CNPJ card ("Zentry Soluções Financeiras LTDA"). */
  nome: "Zentry Soluções Financeiras",
  /** Short name used in the documents' footers. */
  nomeCurto: "Zentry Soluções",
  cnpj: "68.039.998/0001-71",
  /** Full address of the head office, CEP included. */
  sede: "Av. Brigadeiro Faria Lima, 1811, Jardim Paulistano – São Paulo – SP, 01452-001",
  /** Where the banks send the contract by e-mail. */
  email: "zentrysolucoes@gmail.com",
  /** Where the banks send the contract by mail; empty uses the head office. */
  correspondencia: "",
};

/** Who signs the laudo (parecer técnico). */
export const PERITO = {
  nome: "Zentry Soluções Financeiras",
  cargo: "CONTADOR",
  /** Professional register ("CRC SP-000000/O"). */
  registro: "",
};

/** Missing company data, as the team should read it; empty when the documents can be generated. */
export function faltaEmpresa(): string[] {
  const missing = [
    !EMPRESA.nome.trim() && "razão social",
    !EMPRESA.cnpj.trim() && "CNPJ",
    !EMPRESA.sede.trim() && "endereço da sede",
    !EMPRESA.email.trim() && "e-mail",
  ];
  return missing.filter((item): item is string => Boolean(item));
}

/** Missing data of the accountant who signs the laudo. */
export function faltaPerito(): string[] {
  const missing = [!PERITO.nome.trim() && "nome do contador", !PERITO.registro.trim() && "registro (CRC)"];
  return missing.filter((item): item is string => Boolean(item));
}

export const correspondencia = () => EMPRESA.correspondencia.trim() || EMPRESA.sede.trim();
