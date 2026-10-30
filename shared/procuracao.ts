/**
 * Procuração extrajudicial (consumidor.gov.br): the client (outorgante) gives the company (outorgado, shared/empresa.ts) powers
 * for administrative complaints. Only the client's data and the place/date change.
 */

export type ProcuracaoDados = {
  nome: string;
  cpf: string;
  endereco: string;
  cep: string;
  email: string;
  cidade: string;
  /** aaaa-mm-dd, as an <input type="date"> gives it. */
  data: string;
};

export const PODERES = "Poderes especiais para a defesa de seus direitos e interesses referentes a reclamações administrativas, especialmente no site consumidor.gov.br, podendo realizar reclamação, responder e solucionar pendências, firmar acordos, juntar documentos, praticar enfim todos os atos necessários ao bom e fiel cumprimento deste mandato.";

export const PROCURACAO_CAMPOS: { key: keyof ProcuracaoDados; label: string; placeholder?: string; wide?: boolean }[] = [
  { key: "nome", label: "Nome do outorgante (cliente)", wide: true },
  { key: "cpf", label: "CPF ou CNPJ", placeholder: "000.000.000-00" },
  { key: "email", label: "E-mail", placeholder: "cliente@email.com" },
  // The CEP comes before the address: it fills the street, the bairro and the city, and the number is what is left.
  { key: "cep", label: "CEP", placeholder: "00000-000" },
  { key: "cidade", label: "Cidade (local da assinatura)", placeholder: "São Paulo" },
  { key: "endereco", label: "Endereço", placeholder: "Rua, número, complemento, bairro", wide: true },
  { key: "data", label: "Data" },
];

/** Today in São Paulo, as aaaa-mm-dd. */
export const hojeISO = (at = new Date()) => at.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

export const emptyProcuracao = (): ProcuracaoDados => ({ nome: "", cpf: "", endereco: "", cep: "", email: "", cidade: "", data: hojeISO() });

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** "São Paulo, 22 de outubro de 2026." */
export function localEData(dados: Pick<ProcuracaoDados, "cidade" | "data">) {
  const [year, month, day] = dados.data.split("-").map(Number);
  return `${dados.cidade.trim()}, ${day} de ${MESES[month - 1]} de ${year}.`;
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
  if (!dados.cidade.trim()) problems.push("Falta a cidade.");
  // The browser's autofill sometimes brings the IBGE code (3550308 = São Paulo) instead of the name.
  else if (/\d/.test(dados.cidade)) problems.push(`Escreva a cidade por extenso: "${dados.cidade.trim()}" parece um código, não o nome da cidade.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dados.data)) problems.push("Falta a data.");
  return problems;
}
