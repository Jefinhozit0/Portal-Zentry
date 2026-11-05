import type { CampoCcma, Candidato, Evidencia, EvidenciaTipo, LeituraArquivo, TipoDocumento } from "@shared/ccma";
import { cpfValido } from "./contratoConta";
import { ocrImagem } from "./contratoOcr";
import { type Line, extrairContrato, readLines } from "./laudoContrato";

/**
 * Reads one document for the CCMA form on this machine only (PDF text, or Tesseract for scans and photos):
 * the Anthropic reader is never called, since these documents may only go out with express authorization.
 * Each value keeps its file, page and excerpt, so the administrator can check it against the document.
 */

const MAX_PAGINAS = 20;
const MAX_EVIDENCIAS = 3;
const trecho = (text: string) => (text.length > 160 ? `${text.slice(0, 157)}...` : text);

/** A label of the next column read on the same line, where a value must stop. */
const PROXIMO_ROTULO = /\s+(?:Estado Civil|Profiss[ãa]o|Ocupa[çc][ãa]o|Renda|CPF|RG|Telefone|Celular|E-?mail|Nacionalidade|Data|Sexo|Naturalidade)\b.*$/i;

const REGRAS: { campo: CampoCcma; regex: RegExp; aceita?: (valor: string) => boolean }[] = [
  { campo: "documento", regex: /\bCPF\b[^\d]{0,20}(\d{3}\.?\s?\d{3}\.?\s?\d{3}\s?-?\s?\d{2})\b/i, aceita: (valor) => cpfValido(valor) },
  { campo: "rg", regex: /\b(?:R\.?G\.?|Registro Geral|Identidade)\b[^\dA-Za-z]{0,10}(?:n[º°o.]*\s*)?((?:[A-Z]{1,2}-?)?\d[\d.\-xX]{4,14})/i },
  { campo: "profissao", regex: /\b(?:Profiss[ãa]o|Ocupa[çc][ãa]o)\s*[:-]\s*([^\d,;|]{3,50})/i },
  { campo: "estadoCivil", regex: /\bEstado Civil\s*[:-]?\s*(solteir[oa](?:\(a\))?|casad[oa](?:\(a\))?|divorciad[oa](?:\(a\))?|vi[úu]v[oa](?:\(a\))?|separad[oa](?:\(a\))?|uni[ãa]o est[áa]vel)/i },
  { campo: "telefone", regex: /\b(?:Telefone|Celular|Fone|Tel\.)\s*[^\d(]{0,15}(\(?[1-9]\d\)?\s?9?\d{4}[-\s]?\d{4})\b/i },
  { campo: "email", regex: /\bE-?mail\s*[^\s@]{0,5}\s*([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/i },
  { campo: "nome", regex: /^(?:Nome(?: Completo)?)\s*[:-]\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .'-]{4,69})$/i },
];
/** An e-mail on these lines is the bank's or the store's, not the client's. */
const EMAIL_DE_TERCEIRO = /ouvidoria|\bsac\b|atendimento|privacidade|\bdpo\b/i;

const EVIDENCIAS: { tipo: EvidenciaTipo; regex: RegExp }[] = [
  { tipo: "busca", regex: /busca\s+e\s+apreens/i },
  { tipo: "rotativo", regex: /\brotativo/i },
  { tipo: "quitacao", regex: /\bquitad[oa]\b|\bquita[çc][ãa]o\b/i },
];

function classificar(texto: string): TipoDocumento {
  if (/c[ée]dula de cr[ée]dito|contrato de (?:financiamento|empr[ée]stimo)|quadro resumo|\bCCB\b/i.test(texto)) return "Contrato";
  if (/registro geral|carteira de identidade|carteira nacional de habilita|\bCNH\b/i.test(texto)) return "Documento de identidade";
  if (/fatura|conta de (?:luz|[áa]gua|energia|g[áa]s)|comprovante de (?:endere[çc]o|resid[êe]ncia)/i.test(texto)) return "Comprovante de endereço";
  return "Não classificado";
}

/** The first line where a value the contract reader found is written, for its page and excerpt. */
function localizar(lines: Line[], valor: string) {
  const digitos = /^[\d./\s-]+$/.test(valor);
  const procurado = digitos ? valor.replace(/\D/g, "") : valor.toLowerCase();
  return lines.find((line) => (digitos ? line.text.replace(/\D/g, "") : line.text.toLowerCase()).includes(procurado));
}

const TELEFONE = /\(\d{2}\)\s?9?\d{4}[-\s]?\d{4}\b/;
/** Tables with the label above the value, read by column (Santander's insurance proposal: "NOME  RG OU Nº PASSAPORTE  UF"). */
const COLUNAS: { campo: CampoCcma; rotulo: RegExp; aceita: (valor: string) => boolean }[] = [
  { campo: "nome", rotulo: /^NOME$/, aceita: (valor) => /^[A-ZÀ-Ý][A-ZÀ-Ý .'-]{4,69}$/.test(valor) },
  { campo: "rg", rotulo: /^RG$/, aceita: (valor) => /^(?:[A-Z]{1,2}-?)?\d[\d.\-xX]{4,14}$/i.test(valor) },
  { campo: "documento", rotulo: /^CPF$/, aceita: (valor) => cpfValido(valor) },
  { campo: "telefone", rotulo: /^TELEFONE$/, aceita: (valor) => TELEFONE.test(valor) },
  { campo: "profissao", rotulo: /^PROFISS[ÃA]O$/, aceita: (valor) => /^[A-ZÀ-Ý][A-ZÀ-Ý .'-]{2,49}$/.test(valor) },
];
/** How far left of its label a column's value may start, in points. */
const FOLGA_COLUNA = 8;
/** Words of one label start closer than this, in points; the next column starts farther. */
const ESPACO_ENTRE_COLUNAS = 40;

/** The value under each label of a header line: the words of the next line that start in the label's column. */
function lerColunas(header: Line, valores: Line | undefined) {
  if (!valores || valores.page !== header.page) return [];
  // A column ends where the next one starts, not at the next word of its own label ("RG OU Nº PASSAPORTE").
  const proximaColuna = (index: number) => header.items.find((item, at) => at > index && item.x - header.items[at - 1].x > ESPACO_ENTRE_COLUNAS);
  const rotulos = header.items.map((item, index) => ({ item, next: proximaColuna(index), regra: COLUNAS.find(({ rotulo }) => rotulo.test(item.text)) }));
  if (rotulos.filter(({ regra }) => regra).length < 2) return [];
  return rotulos.flatMap(({ item, next, regra }) => {
    if (!regra) return [];
    const valor = valores.items.filter(({ x }) => x >= item.x - FOLGA_COLUNA && (!next || x < next.x - FOLGA_COLUNA)).map(({ text }) => text).join(" ");
    return valor && regra.aceita(valor) ? [{ campo: regra.campo, valor }] : [];
  });
}

/** Everything the lines of one file say, with its origin. Exported apart from the reading so it can be tested. */
export function extrairDoTexto(lines: Line[], arquivo: string): Pick<LeituraArquivo, "tipo" | "candidatos" | "evidencias"> {
  const candidatos: Candidato[] = [];
  const add = (campo: CampoCcma, valor: string, line: Line | undefined) => {
    const limpo = valor.replace(PROXIMO_ROTULO, "").replace(/\s+/g, " ").trim();
    if (limpo && !candidatos.some((item) => item.campo === campo && item.valor === limpo)) {
      candidatos.push({ campo, valor: limpo, arquivo, pagina: line?.page ?? null, trecho: line ? trecho(line.text) : "" });
    }
  };

  const evidencias: Evidencia[] = [];
  lines.forEach((line, index) => {
    for (const { campo, regex, aceita } of REGRAS) {
      if (campo === "email" && EMAIL_DE_TERCEIRO.test(line.text)) continue;
      const valor = line.text.match(regex)?.[1];
      if (valor && (!aceita || aceita(valor))) add(campo, campo === "email" ? valor.toLowerCase() : valor, line);
    }
    // ID cards and driver's licenses print the label alone, with the name on the line below.
    if (/^NOME$/i.test(line.text.trim()) && /^[A-ZÀ-Ý][A-ZÀ-Ý .'-]{4,69}$/.test(lines[index + 1]?.text.trim() ?? "")) add("nome", lines[index + 1].text, lines[index + 1]);
    for (const { campo, valor } of lerColunas(line, lines[index + 1])) add(campo, valor, lines[index + 1]);
    // Santander: "Endereço, telefone e e-mail: AV. EXEMPLO, 10," with the phone wrapped to the line below.
    const anterior = lines[index - 1];
    const telefone = /telefone/i.test(line.text) || (anterior?.page === line.page && /telefone/i.test(anterior.text)) ? line.text.match(TELEFONE)?.[0] : undefined;
    if (telefone) add("telefone", telefone, line);
    for (const { tipo, regex } of EVIDENCIAS) {
      if (regex.test(line.text) && evidencias.filter((item) => item.tipo === tipo).length < MAX_EVIDENCIAS) {
        evidencias.push({ tipo, arquivo, pagina: line.page, trecho: trecho(line.text) });
      }
    }
  });

  // The banks' layouts the contract reader knows: client and creditor.
  const contrato = extrairContrato(lines);
  const { contratante, instituicao } = contrato.dados;
  if (contratante) add("nome", contratante, localizar(lines, contratante));
  if (contrato.cpf && cpfValido(contrato.cpf)) add("documento", contrato.cpf, localizar(lines, contrato.cpf));
  if (contrato.email) add("email", contrato.email, localizar(lines, contrato.email));
  if (instituicao) add("reclamadoNome", instituicao, localizar(lines, instituicao));
  if (contrato.cnpjInstituicao) add("reclamadoDocumento", contrato.cnpjInstituicao, localizar(lines, contrato.cnpjInstituicao));

  return { tipo: classificar(lines.map((line) => line.text).join("\n")), candidatos, evidencias };
}

export const tipoArquivoCcma = (bytes: Uint8Array): "pdf" | "imagem" | null => {
  const inicio = Buffer.from(bytes.subarray(0, 8));
  if (inicio.toString("latin1", 0, 5) === "%PDF-") return "pdf";
  if (inicio[0] === 0xff && inicio[1] === 0xd8 && inicio[2] === 0xff) return "imagem";
  if (inicio.toString("latin1", 1, 4) === "PNG") return "imagem";
  return null;
};

/** Reads one PDF or image. The file itself is not kept. */
export async function lerDocumentoCcma(bytes: Uint8Array, arquivo: string): Promise<LeituraArquivo> {
  if (tipoArquivoCcma(bytes) === "imagem") {
    const lines = await ocrImagem(Buffer.from(bytes));
    return { arquivo, paginas: 1, ilegiveis: lines.length ? [] : [1], ocr: true, aviso: "", ...extrairDoTexto(lines, arquivo) };
  }
  const { lines, scanned, paginas } = await readLines(bytes, true, MAX_PAGINAS, MAX_PAGINAS);
  const lidas = new Set(lines.map((line) => line.page));
  const total = Math.min(paginas, MAX_PAGINAS);
  return {
    arquivo, paginas, ocr: scanned,
    ilegiveis: Array.from({ length: total }, (_, index) => index + 1).filter((page) => !lidas.has(page)),
    aviso: paginas > MAX_PAGINAS ? `Só as ${MAX_PAGINAS} primeiras páginas de ${paginas} foram lidas.` : "",
    ...extrairDoTexto(lines, arquivo),
  };
}
