import type { CampoCcma, Candidato, Evidencia, EvidenciaTipo, LeituraArquivo, TipoDocumento } from "@shared/ccma";
import { cpfValido } from "./contratoConta";
import { extractImages, getDocumentProxy } from "unpdf";
import { lerCamposFixos, ocrImagem } from "./contratoOcr";
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
  // The service contract names the bank under review: "Banco responsável: BCO EXEMPLO S.A. Valor da parcela: R$ 100,00".
  { campo: "reclamadoNome", regex: /\bBanco respons[áa]vel\s*:\s*(.+?)(?:\s+Valor da parcela\b.*)?$/i },
];
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

/** OCR reads the @ of a capitals e-mail as another letter: "NOMEOGMAIL.COM", right before a known provider. */
const EMAIL_SEM_ARROBA = /\b([A-Z0-9][A-Z0-9._-]{2,})[O0Q©](GMAIL|HOTMAIL|OUTLOOK|YAHOO|ICLOUD|LIVE|UOL|BOL|TERRA)((?:\.COM)(?:\.BR)?|\.COM\.BR)\b/;

/** The card of a digital CNH (CNH-e), the same drawing on all of them; the same proportions at any size. */
const CNH_PROPORCAO = 963 / 680;
export const CNH_CAMPOS = {
  nome: { x0: 160 / 963, y0: 183 / 680, x1: 902 / 963, y1: 209 / 680 },
  rg: { x0: 482 / 963, y0: 246 / 680, x1: 902 / 963, y1: 274 / 680 },
  cpf: { x0: 486 / 963, y0: 314 / 680, x1: 712 / 963, y1: 338 / 680, caracteres: "0123456789.-" },
};

/** The fields of a CNH-e, as labeled lines for the same rules as any other document. Its PDF only has text in the instructions beside the card. */
async function lerCnhDigital(bytes: Uint8Array): Promise<Line[]> {
  const pdf = await getDocumentProxy(bytes);
  const cartoes = (await extractImages(pdf, 1)).filter(({ width, height }) => width >= 600 && Math.abs(width / height - CNH_PROPORCAO) < 0.05);
  for (const cartao of cartoes) {
    const { nome, rg, cpf } = await lerCamposFixos(cartao, CNH_CAMPOS);
    if (!cpfValido(cpf)) continue; // The back of the card, or a field that came out wrong.
    const linha = (text: string): Line => ({ page: 1, y: 0, items: [{ x: 0, y: 0, text }], text });
    return ["CARTEIRA NACIONAL DE HABILITAÇÃO", `Nome: ${nome}`, `CPF: ${cpf}`, `Doc. identidade: ${rg}`].map(linha);
  }
  return [];
}

const TELEFONE = /\(\d{2}\)\s?9?\d{4}[-\s]?\d{4}\b/;
/** Tables with the label above the value, read by column ("NOME  RG OU Nº PASSAPORTE  UF", "Nome Completo  CPF  Data de nascimento"). */
const COLUNAS: { campo: CampoCcma; rotulo: RegExp; aceita: (valor: string) => boolean }[] = [
  { campo: "nome", rotulo: /^(?:nome(?: completo)?|contratante)$/i, aceita: (valor) => /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]+(?: [A-Za-zÀ-ÿ.'-]+)+$/.test(valor) && valor.length <= 70 },
  { campo: "rg", rotulo: /^RG$/i, aceita: (valor) => /^(?:[A-Z]{1,2}-?)?\d[\d.\-xX]{4,14}$/i.test(valor) },
  { campo: "documento", rotulo: /^CPF(?:\/.*)?$/i, aceita: (valor) => /^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/.test(valor) && cpfValido(valor) },
  { campo: "telefone", rotulo: /^telefone\b/i, aceita: (valor) => /^\(\d{2}\)\s?9?\d{4}[-\s]?\d{4}$/.test(valor) },
  { campo: "email", rotulo: /^e-?mail$/i, aceita: (valor) => /^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/.test(valor) },
  { campo: "profissao", rotulo: /^profiss[ãa]o$/i, aceita: (valor) => /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .'/-]{2,49}$/.test(valor) },
  { campo: "estadoCivil", rotulo: /^estado(?: civil)?$/i, aceita: (valor) => /^(?:solteir|casad|divorciad|vi[úu]v|separad|uni[ãa]o est)/i.test(valor) && valor.length <= 25 },
];
/** Any column title: two of them on a line make it a header, and the cells of the one above end there. */
const TITULO_COLUNA = /^(?:nome|contratante|cpf|rg|telefone|e-?mail|profiss[ãa]o|estado|endere[çc]o|bairro|cidade|uf|cep|data|complemento|pa[íi]s)\b/i;
/** A cell can wrap ("COORDENADOR DE" / "MANUTENÇÃO"), its row's other cells between the two lines. */
const LINHAS_DA_CELULA = 3;
const ehCabecalho = (line: Line) => line.items.filter(({ text }) => TITULO_COLUNA.test(text)).length >= 2;
/** How far left of its label a column's value may start, in points. */
const FOLGA_COLUNA = 8;
/** Words of one label start closer than this, in points; the next column starts farther. */
const ESPACO_ENTRE_COLUNAS = 40;

/**
 * The value under each label of a header line: the words below that start in the label's column, down to the next header.
 * "1. Nome Completo  CPF" is a guarantor's row, not the client's.
 */
function lerColunas(header: Line, abaixo: Line[]) {
  if (/^\d+\.\s/.test(header.text) || !ehCabecalho(header)) return [];
  const fim = abaixo.findIndex((line) => line.page !== header.page || ehCabecalho(line));
  const ateCabecalho = fim < 0 ? abaixo : abaixo.slice(0, fim);
  // The first line with values in several columns is the whole row; only a row with a wrapped cell starts with one column alone.
  const inicios = header.items.filter((item, at) => at === 0 || item.x - header.items[at - 1].x > ESPACO_ENTRE_COLUNAS).map(({ x }) => x - FOLGA_COLUNA);
  const colunasDe = (line: Line) => new Set(line.items.map(({ x }) => inicios.filter((inicio) => inicio <= x).length)).size;
  const linhas = ateCabecalho.length && colunasDe(ateCabecalho[0]) >= 2 ? ateCabecalho.slice(0, 1) : ateCabecalho;
  // A column ends where the next one starts, not at the next word of its own label ("RG OU Nº PASSAPORTE").
  const proximaColuna = (index: number) => header.items.find((item, at) => at > index && item.x - header.items[at - 1].x > ESPACO_ENTRE_COLUNAS);
  const rotulos = header.items.map((item, index) => ({ item, next: proximaColuna(index), regra: COLUNAS.find(({ rotulo }) => rotulo.test(item.text)) }));
  return rotulos.flatMap(({ item, next, regra }) => {
    if (!regra) return [];
    const celulas = linhas
      .map((line) => ({ line, valor: line.items.filter(({ x }) => x >= item.x - FOLGA_COLUNA && (!next || x < next.x - FOLGA_COLUNA)).map(({ text }) => text).join(" ") }))
      .filter(({ valor }) => valor);
    const inteiro = celulas.map(({ valor }) => valor).join(" ");
    // The whole cell, or else its first line: the lines below may be another row's.
    if (celulas.length && regra.aceita(inteiro)) return [{ campo: regra.campo, valor: inteiro, line: celulas[0].line }];
    return celulas.length && regra.aceita(celulas[0].valor) ? [{ campo: regra.campo, valor: celulas[0].valor, line: celulas[0].line }] : [];
  });
}

/** The bank's name without the label and the text glued to it: "Banco responsável: BCO C6 S.A. Valor da parcela: …". */
export const limparInstituicao = (texto: string) => texto.match(/([^:|]*?\bS\.?\s?\/?A\b\.?)/i)?.[1].trim() ?? texto.trim();
/** Lines with someone else's contacts: the bank's, the insurer's, and the company that signs the service contract. */
const CONTATO_DE_TERCEIRO = /ouvidoria|\bsac\b|atendimento|privacidade|\bdpo\b|estipulante|seguradora|L[íi]bero Badar[óo]|solucoes@/i;

/** Everything the lines of one file say, with its origin. Exported apart from the reading so it can be tested. */
export function extrairDoTexto(lines: Line[], arquivo: string): Pick<LeituraArquivo, "tipo" | "candidatos" | "evidencias"> {
  const candidatos: Candidato[] = [];
  const add = (campo: CampoCcma, valor: string, line: Line | undefined) => {
    const texto = valor.replace(PROXIMO_ROTULO, "").replace(/\s+/g, " ").trim();
    const limpo = campo === "email" ? texto.toLowerCase() : texto;
    // "EMITENTE: ______" is a place to sign, not a name.
    if (campo === "nome" && !/[A-Za-zÀ-ÿ]{3}/.test(limpo)) return;
    if (limpo && !candidatos.some((item) => item.campo === campo && item.valor === limpo)) {
      candidatos.push({ campo, valor: limpo, arquivo, pagina: line?.page ?? null, trecho: line ? trecho(line.text) : "" });
    }
  };

  const evidencias: Evidencia[] = [];
  lines.forEach((line, index) => {
    const anterior = lines[index - 1];
    // A third party's block can wrap, its phone on the line after its name.
    const deTerceiro = CONTATO_DE_TERCEIRO.test(line.text) || (anterior?.page === line.page && CONTATO_DE_TERCEIRO.test(anterior.text));
    for (const { campo, regex, aceita } of REGRAS) {
      if (deTerceiro && (campo === "email" || campo === "telefone")) continue;
      const valor = line.text.match(regex)?.[1];
      if (valor && (!aceita || aceita(valor))) add(campo, valor, line);
    }
    // Banco PAN: "Nome do SIDNEI DA SILVA" with "cliente" wrapped to the line below.
    const nomeDoCliente = line.text.match(/^Nome do (?:cliente )?([A-ZÀ-Ý][A-ZÀ-Ý .'-]{4,69})$/)?.[1];
    if (nomeDoCliente) add("nome", nomeDoCliente, line);
    // ID cards and driver's licenses print the label alone, with the name on the line below.
    if (/^NOME$/i.test(line.text.trim()) && /^[A-ZÀ-Ý][A-ZÀ-Ý .'-]{4,69}$/.test(lines[index + 1]?.text.trim() ?? "")) add("nome", lines[index + 1].text, lines[index + 1]);
    for (const { campo, valor, line: origem } of lerColunas(line, lines.slice(index + 1, index + 1 + LINHAS_DA_CELULA))) add(campo, valor, origem);
    // Santander: "Endereço, telefone e e-mail: AV. EXEMPLO, 10," with the phone wrapped to the line below.
    const telefone = !deTerceiro && (/telefone/i.test(line.text) || (anterior?.page === line.page && /telefone/i.test(anterior.text))) ? line.text.match(TELEFONE)?.[0] : undefined;
    if (telefone) add("telefone", telefone, line);
    if (!deTerceiro && (/e-?mail/i.test(line.text) || (anterior?.page === line.page && /e-?mail/i.test(anterior.text)))) {
      const email = line.text.match(EMAIL_SEM_ARROBA);
      if (email) add("email", `${email[1]}@${email[2]}${email[3]}`, line);
    }
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
  if (contrato.email && !CONTATO_DE_TERCEIRO.test(contrato.email)) add("email", contrato.email, localizar(lines, contrato.email));
  if (instituicao) add("reclamadoNome", limparInstituicao(instituicao), localizar(lines, instituicao));
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
  // pdf.js may take over the buffer it is given.
  const { lines: lidasDoPdf, scanned, paginas } = await readLines(bytes.slice(), true, MAX_PAGINAS, MAX_PAGINAS);
  const cnh = !scanned && lidasDoPdf.some((line) => /\b(?:SENATRAN|DENATRAN)\b/.test(line.text)) ? await lerCnhDigital(bytes.slice()) : [];
  const lines = [...cnh, ...lidasDoPdf];
  const lidas = new Set(lines.map((line) => line.page));
  const total = Math.min(paginas, MAX_PAGINAS);
  return {
    arquivo, paginas, ocr: scanned || cnh.length > 0,
    ilegiveis: Array.from({ length: total }, (_, index) => index + 1).filter((page) => !lidas.has(page)),
    aviso: paginas > MAX_PAGINAS ? `Só as ${MAX_PAGINAS} primeiras páginas de ${paginas} foram lidas.` : "",
    ...extrairDoTexto(lines, arquivo),
  };
}
