/**
 * Procuração extrajudicial (consumidor.gov.br): the client (outorgante) gives the company (outorgado, shared/empresa.ts) powers
 * for administrative complaints. Only the client's data and the place/date change.
 */
import { NOMES_ESTADOS } from "./cep";

export type ProcuracaoDados = {
  nome: string;
  cpf: string;
  endereco: string;
  cep: string;
  email: string;
  /** The place of signing: the state, written out ("São Paulo", "Bahia"). */
  estado: string;
  /** aaaa-mm-dd, as an <input type="date"> gives it. */
  data: string;
};

export const PODERES = "Poderes especiais para a defesa de seus direitos e interesses referentes a reclamações administrativas, especialmente no site consumidor.gov.br, podendo realizar reclamação, responder e solucionar pendências, firmar acordos, juntar documentos, praticar enfim todos os atos necessários ao bom e fiel cumprimento deste mandato.";

export const PROCURACAO_CAMPOS: { key: keyof ProcuracaoDados; label: string; placeholder?: string; wide?: boolean }[] = [
  { key: "nome", label: "Nome do outorgante (cliente)", wide: true },
  { key: "cpf", label: "CPF ou CNPJ", placeholder: "000.000.000-00" },
  { key: "email", label: "E-mail", placeholder: "cliente@email.com" },
  // The CEP comes before the address: it fills the street, the bairro, the city and the state, and the number is what is left.
  { key: "cep", label: "CEP", placeholder: "00000-000" },
  { key: "estado", label: "Estado (local da assinatura)" },
  { key: "endereco", label: "Endereço", placeholder: "Rua, número, complemento, bairro", wide: true },
  { key: "data", label: "Data" },
];

/** Today in São Paulo, as aaaa-mm-dd. */
export const hojeISO = (at = new Date()) => at.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

export const emptyProcuracao = (): ProcuracaoDados => ({ nome: "", cpf: "", endereco: "", cep: "", email: "", estado: "", data: hojeISO() });

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** "São Paulo, 22 de outubro de 2026.": the state, then the date. */
export function localEData(dados: Pick<ProcuracaoDados, "estado" | "data">) {
  const [year, month, day] = dados.data.split("-").map(Number);
  return `${dados.estado.trim()}, ${day} de ${MESES[month - 1]} de ${year}.`;
}

const PARTICULAS = new Set(["da", "das", "de", "di", "do", "dos", "du", "e"]);

/** "FLAVIO FERREIRA DA SILVA" → "Flavio Ferreira da Silva": each name capitalized, the particles in lowercase. */
export function nomeProprio(nome: string) {
  return nome.trim().toLocaleLowerCase("pt-BR").split(/\s+/).filter(Boolean)
    .map((word, index) => (index > 0 && PARTICULAS.has(word)
      ? word
      // "d'ávila", "maria-clara": each part after an apostrophe or hyphen is capitalized too.
      : word.replace(/(^|['’-])([a-zà-ÿ])/g, (_, before: string, letter: string) => before + letter.toLocaleUpperCase("pt-BR"))))
    .join(" ");
}

/** "00000000000" → "000.000.000-00"; anything else stays as typed. */
export const formatCPF = (cpf: string) => {
  const digits = cpf.replace(/\D/g, "");
  return digits.length === 11 ? digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : cpf.trim();
};

/**
 * The client may be a person (CPF, 11 digits) or a company (CNPJ, 14 digits). The field keeps the name
 * "cpf" in the data, and the documents qualify each one ("inscrito no CPF", "pessoa jurídica ... CNPJ").
 */
export const ehCnpj = (documento: string) => documento.replace(/\D/g, "").length === 14;
export const tipoDocumento = (documento: string) => (ehCnpj(documento) ? "CNPJ" : "CPF");
export const documentoValido = (documento: string) => [11, 14].includes(documento.replace(/\D/g, "").length);
export const PROBLEMA_DOCUMENTO = "O CPF precisa ter 11 números (ou o CNPJ, 14).";

/** "00000000000000" → "00.000.000/0000-00"; a CPF as formatCPF; anything else stays as typed. */
export const formatDocumento = (documento: string) => {
  const digits = documento.replace(/\D/g, "");
  return digits.length === 14 ? digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5") : formatCPF(documento);
};

/** "00000000" → "00000-000". */
export const formatCEP = (cep: string) => {
  const digits = cep.replace(/\D/g, "");
  return digits.length === 8 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : cep.trim();
};

export function problemasProcuracao(dados: ProcuracaoDados): string[] {
  const problems: string[] = [];
  if (!dados.nome.trim()) problems.push("Falta o nome do outorgante.");
  if (!documentoValido(dados.cpf)) problems.push(PROBLEMA_DOCUMENTO);
  if (!dados.endereco.trim()) problems.push("Falta o endereço.");
  if (dados.cep.replace(/\D/g, "").length !== 8) problems.push("O CEP precisa ter 8 números.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dados.email.trim())) problems.push("Falta um e-mail válido.");
  if (!dados.estado.trim()) problems.push("Escolha o estado (local da assinatura).");
  else if (!NOMES_ESTADOS.includes(dados.estado.trim())) problems.push(`O local da assinatura é o estado: "${dados.estado.trim()}" não é um estado.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dados.data)) problems.push("Falta a data.");
  return problems;
}
