import { getDocumentProxy } from "unpdf";
import { isContratoIaConfigured, lerContratoComIa } from "./contratoIa";
import { ocrPages } from "./contratoOcr";
import { type Encargos, type LaudoDados, emptyLaudo, mesNumero, parseBRL } from "@shared/laudo";
import { type Modalidade, modalidadeDoTitulo } from "@shared/notificacao";

/**
 * Reads a bank contract (CCB) PDF and fills what it can of the laudo. Works on the text of the PDF,
 * line by line, looking for the labels banks use; a scanned contract (image only) has no text, so its
 * pages go through OCR first (see contratoOcr.ts). Whatever is not found stays blank for the team to type in.
 */

type Item = { x: number; y: number; text: string };
export type Line = { page: number; y: number; items: Item[]; text: string };

/** The title of the standard table banks must fill (Res. CMN 4.881), in capitals: clauses mention it in lowercase. */
const QUADRO_PADRAO = /OR[ÇC]AMENTO DE OPERA[ÇC][ÃA]O DE CR[ÉE]DITO|CONDI[ÇC][ÕO]ES ESPEC[ÍI]FICAS DE OPERA[ÇC][ÃA]O DE CR[ÉE]DITO/;

/** Bradesco Financiamentos: the data is in a "Quadro Resumo" after six pages of clauses, and runs over the next pages up to Anexo I. */
const QUADRO_RESUMO = /^Quadro Resumo$/i;
const QUADRO_RESUMO_PAGES = 4;

/**
 * The first 3 pages, plus the page of the standard table wherever it is (Digimais puts it on page 11,
 * after the cadastro and the CCB), which then comes first. The other pages are clauses and the
 * insurance proposal, whose amounts ("Valor cálculo Seguro") would be taken for the contract's.
 * A Quadro Resumo past the first pages comes first with the pages that continue it.
 * A scan has no text: with useOcr its pages are read by OCR, and all of them are kept, because scanned
 * pages often come out of order or with some missing; without it, no lines and scanned: true.
 */
async function readLines(bytes: Uint8Array, useOcr: boolean, firstPages = 3, maxPages = 20): Promise<{ lines: Line[]; scanned: boolean }> {
  const pdf = await getDocumentProxy(bytes);
  const pages: Line[][] = [];
  for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, maxPages); pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const items = (content.items as { str?: string; transform?: number[] }[])
      .filter((item) => item.str?.trim() && item.transform)
      .map((item) => ({ x: item.transform![4], y: item.transform![5], text: item.str!.normalize("NFC").trim() }))
      .sort((a, b) => b.y - a.y || a.x - b.x);
    const pageLines: Line[] = [];
    for (const item of items) {
      const line = pageLines.find((candidate) => Math.abs(candidate.y - item.y) < 3);
      if (line) line.items.push(item);
      else pageLines.push({ page: pageNumber, y: item.y, items: [item], text: "" });
    }
    for (const line of pageLines) {
      line.items.sort((a, b) => a.x - b.x);
      line.text = line.items.map((item) => item.text).join(" ").replace(/\s+/g, " ");
    }
    pages.push(pageLines);
  }
  if (pages.every((page) => page.length === 0)) {
    if (!useOcr) return { lines: [], scanned: true };
    const scanned = await ocrPages(pdf, maxPages);
    const quadro = scanned.find((page) => page.slice(0, 12).some((line) => QUADRO_PADRAO.test(line.text) || QUADRO_RESUMO.test(line.text)));
    return { lines: (quadro ? [quadro, ...scanned.filter((page) => page !== quadro)] : scanned).flat(), scanned: true };
  }
  const padrao = pages.findIndex((page) => page.slice(0, 12).some((line) => QUADRO_PADRAO.test(line.text)));
  const resumo = pages.findIndex((page, index) => index >= firstPages && page.slice(0, 12).some((line) => QUADRO_RESUMO.test(line.text)));
  const quadro = padrao >= 0 ? pages.slice(padrao, padrao + 1) : resumo >= 0 ? pages.slice(resumo, resumo + QUADRO_RESUMO_PAGES) : [];
  return { lines: [...quadro, ...pages.filter((page, index) => index < firstPages && !quadro.includes(page))].flat(), scanned: false };
}

/** Amounts written with R$ on the line, in order; without R$, plain numbers that are not percentages. */
function money(text: string): number[] {
  const withSymbol = Array.from(text.matchAll(/R\$\s*(-?[\d.]+,\d{2})/g)).map((match) => parseBRL(match[1])!);
  if (withSymbol.length) return withSymbol;
  return Array.from(text.matchAll(/(?<![\d,.%])(\d{1,3}(?:\.\d{3})*,\d{2})(?!\s*%)/g)).map((match) => parseBRL(match[1])!);
}

const percents = (text: string) => Array.from(text.matchAll(/(\d{1,3},\d{1,4})\s*%?/g)).map((match) => parseBRL(match[1])!);

const find = (lines: Line[], pattern: RegExp, skip?: RegExp) => lines.find((line) => pattern.test(line.text) && !(skip && skip.test(line.text)));

/** First amount on the line of the first label that has one. */
function amountFor(lines: Line[], patterns: RegExp[], skip?: RegExp) {
  for (const pattern of patterns) {
    for (const line of lines) {
      if (!pattern.test(line.text) || (skip && skip.test(line.text))) continue;
      const values = money(line.text.slice(line.text.search(pattern)));
      if (values.length) return values[0];
      // Stellantis prints the amount cell a few points off its label ("Tarifa de cadastro" at 305,
      // "D.1 R$1.199,00" at 299): the closest line around it that is only that amount, maybe after the item code.
      const beside = lines
        .filter((other) => other !== line && other.page === line.page && Math.abs(other.y - line.y) < 8 && /^(?:[A-Z]\.\d+(?:\.\d+)?\s+)?R\$/.test(other.text))
        .sort((a, b) => Math.abs(a.y - line.y) - Math.abs(b.y - line.y))
        .map((other) => money(other.text)[0])
        .find((value) => value !== undefined);
      if (beside !== undefined) return beside;
    }
  }
  return null;
}

/** Text written after a label ("Nome do Cliente: FULANO") plus the lines that continue it right below. */
function textAfter(lines: Line[], label: RegExp, stop?: RegExp) {
  for (const line of lines) {
    const index = line.items.findIndex((item) => label.test(item.text));
    if (index < 0) continue;
    const labelItem = line.items[index];
    const sameItem = labelItem.text.replace(label, "").replace(/^[\s:]+/, "");
    const rest = line.items.slice(index + 1);
    const stopAt = stop ? rest.findIndex((item) => stop.test(item.text)) : -1;
    const own = stopAt >= 0 ? rest.slice(0, stopAt) : rest;
    const stopX = stopAt >= 0 ? rest[stopAt].x : Infinity;
    const parts = [sameItem, ...own.map((item) => item.text)].filter(Boolean);
    if (parts.length) return parts.join(" ").trim();
    // With nothing beside the label, the value wraps (e.g. "COROLLA GLI 1.8 FLEX 16V" / "AUT.") a few points above and below, in the same column.
    const wrapped = lines
      .filter((other) => other !== line && other.page === line.page && Math.abs(other.y - line.y) < 8)
      .flatMap((other) => other.items.filter((item) => item.x > labelItem.x + 10 && item.x < stopX).map((item) => ({ ...item, y: other.y })))
      .sort((a, b) => b.y - a.y);
    const above = wrapped.filter((item) => item.y > line.y).map((item) => item.text);
    const below = wrapped.filter((item) => item.y < line.y).map((item) => item.text);
    const value = [...above, ...below].join(" ").trim();
    if (value) return value;
  }
  return "";
}

/**
 * A numbered cell label of the Quadro Resumo: "3 - Valor das Parcelas", "2.6 – Função", "5- Valor Total…".
 * OCR may read the cell border before it ("|3- Valor das Parcelas"), a comma for the dot ("4,5 - Valor…")
 * or lose the number, leaving the dash before the label's capital ("- Combustível/Motor").
 */
const CELL_LABEL = /^[|[(/!]?(?:\d{1,2}(?:[.,]\d{1,2})?\s*[-–]|[-–]\s*[A-ZÀ-Ú])/;

/**
 * The value of a Quadro Resumo cell (Bradesco Financiamentos): the label on top, the value on the line
 * right below, in the same column, which ends where the next label of the row starts.
 * "1 - Taxa de Juros Efetiva" over "2,87 % a.m. 41,17 % a.a." gives "2,87 % a.m. 41,17 % a.a.".
 * A text PDF gives the label as one item, OCR as one item per word: the label may start at any item
 * and run over the next ones.
 */
function cellBelow(lines: Line[], label: RegExp, accept: (value: string) => boolean = () => true) {
  const joinedFrom = (items: Item[], index: number) => items.slice(index).map((item) => item.text).join(" ");
  for (const line of lines) {
    for (let index = 0; index < line.items.length; index++) {
      const match = joinedFrom(line.items, index).match(label);
      if (!match) continue;
      // The items the label covers, then the next label of the row.
      let covered = 0;
      for (let length = -1; index + covered < line.items.length && length < match[0].trimEnd().length; covered++) length += 1 + line.items[index + covered].text.length;
      const after = line.items.slice(index + covered);
      const next = after.findIndex((_, at) => CELL_LABEL.test(joinedFrom(after, at)));
      // A label whose number OCR garbled ("o - Número" for "2.8 - Número") starts at that garbled bit.
      const start = /^[-–]/.test(line.items[index].text) && index > 0 && line.items[index - 1].text.length <= 4 ? index - 1 : index;
      const left = line.items[start].x - 4;
      // Same for the next label: "E - Cidade" ends the "Bairro" cell at the "E".
      const end = next > 0 && /^[-–]/.test(after[next].text) && after[next - 1].text.length <= 4 ? next - 1 : next;
      const right = (end >= 0 ? after[end].x : Infinity) - 4;
      // The next row of labels is ~30 points below; the value, ~14.
      const value = lines
        .filter((other) => other.page === line.page && other.y < line.y && line.y - other.y < 22)
        .sort((a, b) => b.y - a.y)
        .map((other) => other.items.filter((item) => item.x >= left && item.x < right && !CELL_LABEL.test(item.text)).map((item) => item.text).join(" "))
        .find(Boolean);
      // OCR can match a label inside a clause ("…Quadro Resumo - IV - 4.5 - Valor Total de IOF do Bem e…"): accept says when the value is the cell's.
      if (value && accept(value)) return value.replace(/\s+/g, " ").trim();
    }
  }
  return "";
}

/** "12/11/2024" + 30 → "12/12/2024"; "" if the date can't be read. */
function somarDias(data: string, dias: number) {
  const [dia, mes, ano] = data.split("/").map(Number);
  if (!dia || !mes || !ano) return "";
  const date = new Date(Date.UTC(ano, mes - 1, dia + dias));
  return `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`;
}

/** "469,188.988-41" (OCR) or "058.956.688-10" → "469.188.988-41"; anything that is not 11 digits stays as it came. */
function cpfFormat(text: string) {
  const digits = text.replace(/\D/g, "");
  return digits.length === 11 ? `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}` : text;
}

/**
 * The vehicle as Bradesco's Anexo I lists it, under "Item(ns) Financiado(s)", in that column, on up to
 * four lines ("NISSAN" / "MARCH FLEX COM" / "SV 1.6 16V FLEXSTART A/G"), before the insurance ("*seg Prot")
 * or the "D. Data de Emissão" row. For a scan whose Quadro Resumo lost the Marca/Modelo labels.
 */
function anexoVeiculo(lines: Line[]) {
  const header = lines.find((line) => /Item\(?ns\)?\s*Financiad/i.test(line.text));
  if (!header) return "";
  const at = header.items.findIndex((item) => /Financiad/i.test(item.text));
  const left = header.items[0].x, right = (header.items[at + 1]?.x ?? Infinity) - 4;
  const parts: string[] = [];
  for (const line of lines.filter((other) => other.page === header.page && other.y < header.y && header.y - other.y < 90).sort((a, b) => b.y - a.y)) {
    // Header lines of the other columns ("Financiamento do(s) Bem(ns)") start far to the right.
    const column = line.items[0].x < left + 60 ? line.items.filter((item) => item.x < right).map((item) => item.text).join(" ") : "";
    if (/^\*|Data de Emiss|Assinatura|^\(\d\)/i.test(column)) break;
    if (column) parts.push(column);
    if (parts.length === 4) break;
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * The date printed in every page's footer of a Bradesco contract: "12/11/2024 17:36:34 (Horário de Brasília)".
 * OCR garbles it on most pages ("/3///2024"), so the valid date read most often wins, when read at least twice
 * or by the only page that got it.
 */
function dataDoRodape(lines: Line[]) {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const match = line.text.match(/(\d{2})\/(\d{2})\/(\d{4})\s*\d{1,2}[:/.]?\d{2}[:/.]?\d{2}\s*\(?Hor[áa]rio/i);
    if (!match || Number(match[1]) < 1 || Number(match[1]) > 31 || Number(match[2]) < 1 || Number(match[2]) > 12) continue;
    const date = `${match[1]}/${match[2]}/${match[3]}`;
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  const ranked = Array.from(counts).sort((a, b) => b[1] - a[1]);
  return ranked.length && (ranked[0][1] >= 2 || ranked.length === 1) ? ranked[0][0] : "";
}

/** What the Quadro Resumo says; only the cells that are there. Its values win over the ones read by label. */
function quadroResumo(lines: Line[]) {
  // A label ends at a word boundary, not at the end of its item: with OCR the next label follows on the same text.
  // The cell's number goes as "any short bit before the dash", since OCR misreads it ("S- Valor Total Devido",
  // "41.6 - Valor Total de IOF dos Produtos"); the words of the label tell the cells apart. The space after
  // the dash keeps other banks' "Ano-modelo:" from passing for the "- Modelo" cell.
  const cell = (label: string, numbered = String.raw`\S{0,5}`, accept?: (value: string) => boolean) =>
    cellBelow(lines, new RegExp(`^[|[(/!]?${numbered}\\s*[-–]\\s+${label}\\b`, "i"), accept);
  const amount = (label: string) => money(cell(label, undefined, (value) => money(value).length > 0))[0] ?? null;
  // Rates never have a thousands dot: OCR's "2.06 % a.m." is 2,06.
  const [taxaMensal, taxaAnual] = percents(cell("Taxa de Juros Efetiva", undefined, (value) => /\d\s*%/.test(value)).replace(/(\d)\.(\d{1,4})(?=\s*%)/g, "$1,$2"));
  const iofBem = amount("Valor Total de IOF do Bem"), iofProdutos = amount("Valor Total de IOF dos Produtos");
  const veiculo = [cell("Marca"), cell("Modelo"), cell("Vers[ãa]o")].filter(Boolean);
  // Only the year: with OCR the cell can run into the next one ("2019 FLEX-GASOLINA").
  const ano = [cell("Ano de Fabrica[çc][ãa]o"), cell("Ano do Modelo")].map((value) => value.match(/\b(?:19|20)\d{2}\b/)?.[0]).filter(Boolean).join("/");
  const [rua, numero, complemento, bairro, cidade, uf, cep] = ["Endere[çc]o Residencial", "N[úu]mero", "Complemento", "Bairro", "Cidade", "UF", "CEP"].map((name) => cell(name));
  // "Nome" and "CPF" also head the agent's and the supplier's cells: these keep their number.
  const cpf = cell(String.raw`CPF(?:\/MF)?`, String.raw`2[.,]2`);
  return {
    contratante: cell("Nome", String.raw`2[.,]1`),
    cpf: cpf && cpfFormat(cpf),
    email: cell("E-?mail").match(EMAIL)?.[0].toLowerCase() ?? "",
    endereco: [[rua, numero].filter(Boolean).join(", "), complemento, bairro, [cidade, uf].filter(Boolean).join("/"), cep && `CEP ${cep}`].filter(Boolean).join(" - "),
    // Only the year is not the vehicle: then Anexo I's list of financed items, or blank.
    garantia: veiculo.length ? [...veiculo, ano].filter(Boolean).join(" ") : (() => {
      const anexo = anexoVeiculo(lines);
      return anexo && !/\b(?:19|20)\d{2}\b/.test(anexo) ? [anexo, ano].filter(Boolean).join(" ") : anexo;
    })(),
    valorSolicitado: amount("Valor Solicitado"),
    valorFinanciado: amount("Valor Total Devido"),
    parcelas: Number(cell("Quantidade de Parcelas", undefined, (value) => /^\d{1,3}\b/.test(value)).match(/^\d{1,3}\b/)?.[0] ?? 0),
    // "1 - Carência para 1º Vencimento" over "30": days from the issue date to the first payment.
    carencia: Number(cell("Car[êe]ncia para 1[º°o]? ?Vencimento", undefined, (value) => /^\d{1,3}\b/.test(value)).match(/^\d{1,3}\b/)?.[0] ?? 0),
    valorParcela: amount("Valor das Parcelas"),
    // Anexo I has it too: "D. Data de Emissão" over "12/11/2024 17:36:34".
    dataContrato: (cell(String.raw`Data de Emiss[ãa]o`) || cellBelow(lines, /^[A-Z]\.\s*Data de Emiss[ãa]o/i)).match(/\d{2}\/\d{2}\/\d{4}/)?.[0] ?? dataDoRodape(lines),
    taxaMensal: taxaMensal ?? 0,
    taxaAnual: taxaAnual ?? 0,
    iof: iofBem !== null || iofProdutos !== null ? Math.round(((iofBem ?? 0) + (iofProdutos ?? 0)) * 100) / 100 : null,
    seguros: amount("Valor de Seguros"),
    registro: amount("Valor de Registro"),
    cadastro: amount("Valor Tarifa de Cadastro"),
    avaliacao: amount("Valor Tarifa Avalia[çc][ãa]o"),
  };
}

const zeroIsAbsent = (value: number | null) => (value && value > 0 ? value : null);

function contractDate(lines: Line[]) {
  const issued = find(lines, /data\s+(?:de\s+)?(?:emiss[ãa]o|contrata[çc][ãa]o|libera[çc][ãa]o)/i);
  const written = issued?.text.match(/(\d{2}\/\d{2}\/\d{4})/);
  if (written) return written[1];
  // Stellantis: "Local: RECIFE Data: 23/06/2026", next to the signature.
  const dated = lines.map((line) => line.text.match(/\bData\s*:\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1]).find(Boolean);
  if (dated) return dated;
  for (const line of lines) {
    const match = line.text.match(/(\d{1,2}) de ([A-Za-zçÇ]+) de (\d{4})/);
    const month = match ? mesNumero(match[2]) : 0;
    if (match && month) return `${match[1].padStart(2, "0")}/${String(month).padStart(2, "0")}/${match[3]}`;
  }
  return "";
}

/** cpf, cnpjInstituicao and modalidade are not in the laudo, but other documents (notificação) use them. */
export type LeituraContrato = { dados: LaudoDados; cpf: string; cnpjInstituicao: string; modalidade: Modalidade | null; email: string; endereco: string; encontrados: string[] };

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/**
 * The client's e-mail: the first one on a line that says "e-mail"/"email", else any (SIM writes it after
 * the phone, on the next line). Itaú has it on page 2, Digimais on the cadastro page.
 */
function clientEmail(lines: Line[]) {
  // The bank's own addresses ("Ouvidoria: 0800… E-mail: ouvidoria@bancodigimais.com.br") do not count.
  const candidates = lines.filter((line) => EMAIL.test(line.text) && !/ouvidoria|\bSAC\b|atendimento/i.test(line.text));
  const labeled = candidates.find((line) => /e-?mail/i.test(line.text));
  return (labeled ?? candidates[0])?.text.match(EMAIL)?.[0].toLowerCase() ?? "";
}

/**
 * The client's address, from the "Endereço…:" line, without the phone or e-mail that follow it.
 * SIM: "Endereço, fone de contato e e-mail: R FREDERICO GIACHETO FILHO, 68 - cohab II - 15495-000 - SP (17)".
 * Santander: "Endereço e telefone de contato: TANAZEIRO 39 CASA JARDIM MATARAZZO SAO PAULO SP - (11)999164161".
 */
function clientAddress(lines: Line[], contratante: string) {
  // The line may start with the item code ("A.1 Endereço e telefone de contato: …").
  const label = /^(?:[A-Z]\.\d+\s+)?Endere[çc]o[^:]{0,40}:\s*/i;
  // The main page only, and after the client's name: the Santander consignado gives the bank's address first.
  const main = lines.filter((candidate) => candidate.page === lines[0].page);
  const nameAt = contratante ? main.findIndex((candidate) => candidate.text.includes(contratante)) : -1;
  const line = main.slice(Math.max(nameAt, 0)).find((candidate) => label.test(candidate.text)) ?? main.find((candidate) => label.test(candidate.text));
  if (!line) return "";
  return line.text.replace(label, "")
    .replace(/\s*-?\s*\(\d{2}\)[\s\d-]*.*$/, "")
    // Stellantis: "RUA DIONISIO CERQUEIRA/ Nº: 185/ CEP: 52291150/ TEL: 8199847-7274".
    .replace(/[\s/,-]*\b(?:TEL|FONE|TELEFONE)\b.*$/i, "")
    // Itaú: "… - CEP: 13497142 - 19 996454827" (area code and number, no parentheses).
    .replace(/\s*-\s*\d{2}\s+9?\d{4}-?\d{4}\s*$/, "")
    .replace(EMAIL, "")
    .replace(/[\s,-]+$/, "")
    .trim();
}

const BANK = /(BANCO|CR[ÉE]DITO|FINANCEIRA|FINANCIAMENTO)/i;
const SA = /\bS\.?\s?\/?A\b/i;

/**
 * The line with the bank's legal name ("… S.A."). A long name can wrap in the title (Stellantis:
 * "STELLANTIS FINANCIAMENTOS SOCIEDADE DE CRÉDITO, FINANCIAMENTO E" / "INVESTIMENTO S.A."): then
 * the two lines are joined, and index points at the second one.
 */
function bankLine(lines: Line[]): { text: string; index: number } {
  for (let index = 0; index < lines.length; index++) {
    const text = lines[index].text;
    if (!BANK.test(text)) continue;
    if (SA.test(text)) return { text, index };
    const next = lines[index + 1];
    // Only a title in capitals wraps like that, not a sentence ("IMPORTANTE: estas são as principais condições do seu financiamento").
    if (next && next.page === lines[index].page && /^[A-ZÀ-Ú0-9 ,.&-]+$/.test(text) && /^[^:]{0,40}\bS\.?\s?\/?A\.?$/i.test(next.text.replace(/\s*-?\s*CNPJ.*$/i, "").trim())) {
      return { text: `${text} ${next.text}`, index: index + 1 };
    }
  }
  return { text: "", index: -1 };
}

/** The laudo fields that were found (the ones the team doesn't have to type). */
export function camposEncontrados(dados: LaudoDados) {
  return Object.entries({ ...dados, ...dados.encargos })
    .filter(([key, value]) => key !== "encargos" && key !== "objeto" && key !== "jurosMora" && value !== "" && value !== 0 && value !== null)
    .map(([key]) => key);
}

/** Without these the free reader didn't understand the contract, and the AI reads it instead. */
const CAMPOS_PRINCIPAIS = ["contrato", "contratante", "valorFinanciado", "parcelas", "valorParcela", "taxaMensal"];

/** The AI's reading, with the blanks it left filled from the free reader's. */
function juntar(ia: LeituraContrato, regras: LeituraContrato): LeituraContrato {
  const dados = { ...regras.dados, ...Object.fromEntries(Object.entries(ia.dados).filter(([, value]) => value !== "" && value !== 0)) } as LaudoDados;
  dados.encargos = Object.fromEntries(Object.entries(ia.dados.encargos).map(([key, value]) => [key, value ?? regras.dados.encargos[key as keyof Encargos]])) as Encargos;
  return {
    dados, cpf: ia.cpf || regras.cpf, cnpjInstituicao: ia.cnpjInstituicao || regras.cnpjInstituicao, modalidade: ia.modalidade ?? regras.modalidade,
    email: ia.email || regras.email, endereco: ia.endereco || regras.endereco, encontrados: camposEncontrados(dados),
  };
}

/**
 * The free reader first: a contract with text whose layout it knows is done in a moment, at no cost.
 * When it misses the main fields, or the PDF is a scan, Claude reads it (contratoIa.ts) if the API is
 * set up; without the API (or if it fails) a scan goes through OCR, which is slower and less precise.
 * ocr / ia say how it was read, so the team knows how much to check.
 */
export async function lerContrato(bytes: Uint8Array): Promise<LeituraContrato & { ocr: boolean; ia: boolean }> {
  const iaLigada = isContratoIaConfigured();
  // pdf.js may take over the buffer it is given, and the bytes may still go to the AI or the OCR.
  const { lines, scanned } = await readLines(bytes.slice(), !iaLigada);
  const regras = extrairContrato(lines);
  const completa = CAMPOS_PRINCIPAIS.every((campo) => regras.encontrados.includes(campo));
  if (iaLigada && (scanned || !completa)) {
    const ia = await lerContratoComIa(bytes);
    if (ia) return { ...(scanned ? ia : juntar(ia, regras)), ocr: false, ia: true };
    if (scanned) return { ...extrairContrato((await readLines(bytes.slice(), true)).lines), ocr: true, ia: false };
  }
  return { ...regras, ocr: scanned, ia: false };
}

export function extrairContrato(lines: Line[]): LeituraContrato {
  const dados = emptyLaudo();
  if (lines.length === 0) return { dados, cpf: "", cnpjInstituicao: "", modalidade: null, email: "", endereco: "", encontrados: [] };

  dados.contrato = lines.map((line) => line.text.match(/(?:OPERA[ÇC][AÃ]O|CONTRATO|C[ÉE]DULA|PROPOSTA|OR[ÇC]AMENTO|CONSIGNADO)\s*(?:N[º°o.]*|n[úu]mero)\s*:?\s*(\d[\d./-]{3,})/i)?.[1]).find(Boolean)
    // Bradesco Financiamentos: "Cédula de Crédito Bancário – CCB – Pessoa Física Nº 4247432349", on top of every page.
    ?? lines.map((line) => line.text.match(/^C[ée]dula de Cr[ée]dito Banc[áa]rio\b.{0,40}?\bN[º°o]\.?\s*(\d[\d./-]{3,})/i)?.[1]).find(Boolean)
    ?? "";
  // Itaú: "-ITAU UNIBANCO HOLDING S.A. - CNPJ: …". Consignado: "Instituição Financeira: BANCO SANTANDER (BRASIL) S.A.".
  // Digimais: "Banco Digimais S.A., instituição financeira de direito privado, com sede na …".
  dados.instituicao = bankLine(lines).text
    .replace(/\s*-?\s*CNPJ.*$/i, "")
    // Bradesco's Quadro Resumo: "Banco Bradesco Financiamentos S.A. 07.207.996/0001-50", the CNPJ in its own column.
    .replace(/\s+\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}.*$/, "")
    .replace(/^.*?(?:Institui[çc][ãa]o Financeira|Credora?)\s*:\s*/i, "")
    .replace(/(\bS\.?\s?\/?A\.?)\s*,.*$/i, "$1")
    .replace(/^[\s-]+/, "")
    .replace(/\s+/g, " ").trim();
  // The colon matters: "Cliente" alone shows up in clauses ("Direitos e Deveres do Cliente").
  // Stellantis: "A.1 Nome do(a) consumidor(a): FLAVIO FERREIRA".
  // Consignado: "Nome Cliente: …". Itaú splits "Nome do(a) " / "Cliente" / ": JOAO …" into three pieces, so then the line is read whole.
  const NOME = String.raw`(?:[A-Z]\.\d+\s+)?(?:Nome(?:\s*\/\s*Raz[ãa]o Social)?\s+(?:do(?:\(a\))?\s+)?(?:Cliente|Emitente|Consumidor|Devedor)(?:\(a\))?|Emitente|Cliente|Contratante)\s*:`;
  dados.contratante = textAfter(lines, new RegExp(`^${NOME}`, "i"), /^(CPF|RG)\b/i)
    || (lines.map((line) => line.text.match(new RegExp(`^${NOME}\\s*(.+?)(?:\\s+(?:CPF|RG)\\b.*)?$`, "i"))?.[1]).find(Boolean) ?? "").trim();

  // SIM: "Veículo (Marca): TOYOTA … Ano-modelo: 2017/2018 … Modelo: COROLLA". Santander: "Veículo: Marca: BAJAJ … Modelo: DOMINAR 250", "Ano/Modelo: 2025".
  // Digimais: "Veículo - Marca: GM - CHEVROLET Modelo: CORSA …" in one piece.
  const marca = textAfter(lines, /^(?:Ve[íi]culo\s*(?:\(Marca\)|[-:]\s*Marca)|Marca)\s*:?/i, /^(Ano|Modelo|Combust[íi]vel)/i);
  // Stellantis puts "Cor: PRATA" beside the model and "Combustível: …" beside the year.
  const modelo = textAfter(lines, /^Modelo\s*:?/i, /^(Cor|Combust[íi]vel)\b/i);
  const ano = textAfter(lines, /^Ano(?:\s*fab)?\s*[-/]?\s*modelo\s*:?/i, /^(Modelo|Cor|Combust[íi]vel)\b/i);
  dados.garantia = [marca, modelo, ano].filter(Boolean).join(" ")
    .replace(/\s*\bModelo\s*:\s*/i, " ").replace(/\s+/g, " ").trim();

  dados.valorSolicitado = amountFor(lines, [/Valor Solicitado/i, /Valor L[íi]quido Liberado/i, /Valor (?:l[íi]quido )?(?:do )?(?:cr[ée]dito|empr[ée]stimo) liberado/i, /Valor liberado/i, /Valor (?:l[íi]quido )?do cr[ée]dito/i]) ?? 0;
  dados.valorFinanciado = amountFor(lines, [/VALOR TOTAL CONTRATADO/i, /Valor total (?:do )?financiad/i, /Total financiado/i, /Valor (?:do )?financiamento/i, /Valor do Empr[ée]stimo\s*\(financiado\)/i, /Valor Total do Financiamento/i], /sem impostos/i) ?? 0;
  dados.valorParcela = (() => {
    // The first such line with an amount: Bradesco's Quadro Resumo has the label alone, its Anexo I "8. Valor da Parcela R$ 1.307,09".
    const values = lines.filter((line) => /Valor (?:de cada|da|das) (?:parcela|presta[çc][ãa]o)/i.test(line.text)).map((line) => money(line.text)).find((found) => found.length) ?? [];
    return values.length ? values[values.length - 1] : 0;
  })();
  dados.parcelas = (() => {
    const line = find(lines, /(?:N[úu]mero|Quantidade|Qtde\.?)\s+de\s+(?:parcelas|presta[çc][õo]es)|Prazo\s*\(meses\)/i);
    const numbers = line?.text.replace(/^.*?(?:parcelas|presta[çc][õo]es|meses\))[^\d]*/i, "").match(/\b(\d{1,3})\b/);
    return numbers ? Number(numbers[1]) : 0;
  })();
  dados.primeiroVencimento = find(lines, /(?:1[º°ª]?\s*|primeiro\s+)vencimento|vencimento\s+da\s+(?:1[º°ª]?|primeira)\s+parcela/i)?.text.match(/(\d{2}\/\d{2}\/\d{4})/)?.[1] ?? "";
  dados.dataContrato = contractDate(lines);

  const rateIndex = lines.findIndex((line) => /taxa\s+de\s+juros/i.test(line.text) && !/mora/i.test(line.text));
  if (rateIndex >= 0) {
    // The label's line and the next two, plus any line a few points around it (Stellantis prints the
    // "% a.m.: 1,62%" cells of a table row slightly above the label). IOF lines never count: their 0,38% is a tax.
    const rateLine = lines[rateIndex];
    const window = lines
      .filter((line, index) => (index >= rateIndex && index < rateIndex + 3) || (line.page === rateLine.page && Math.abs(line.y - rateLine.y) < 10))
      .filter((line) => !/\bIOF\b/i.test(line.text));
    // Labeled ("diária: % a.d.: 0,07% mensal: % a.m.: 2,00% anual: % a.a.: 26,82%") wins over position, so the daily rate is never taken for the monthly one.
    const joined = window.map((line) => line.text).join(" ");
    const labeled = (unit: string) => joined.match(new RegExp(`a\\.?\\s?${unit}\\.?\\s*:?\\s*(\\d{1,3},\\d{1,4})`, "i"))?.[1];
    const mensal = labeled("m"), anual = labeled("a");
    // Itaú: a header "% a.d: % a.m: % a.a:" and the numbers "0,0686 2,08 28,02" on the line below, column by column.
    const units = Array.from(joined.matchAll(/%\s*a\.\s?([dma])\b/gi)).map((match) => match[1].toLowerCase());
    const row = window.map((line) => percents(line.text)).find((values) => values.length === units.length);
    if (mensal && anual) [dados.taxaMensal, dados.taxaAnual] = [parseBRL(mensal)!, parseBRL(anual)!];
    else if (units.includes("m") && units.includes("a") && row) [dados.taxaMensal, dados.taxaAnual] = [row[units.indexOf("m")], row[units.indexOf("a")]];
    else {
      // SIM puts the two numbers alone on the line below the label, monthly first.
      const rates = window.map((line) => percents(line.text.replace(/^.*taxa\s+de\s+juros[^\d]*/i, ""))).find((values) => values.length >= 2);
      if (rates) [dados.taxaMensal, dados.taxaAnual] = rates;
    }
  }
  // Consignado: "Juros Remuneratórios Pré-Fixado: 3,63% ao mês / 53,45% ao ano", with no "taxa de juros" label.
  if (!dados.taxaMensal) {
    const written = lines.map((line) => (/CET|custo efetivo|atraso|mora/i.test(line.text) ? null : line.text.match(/juros[^\d]*?(\d{1,3},\d{1,4})\s*%\s*ao\s*m[êe]s\s*\/\s*(\d{1,3},\d{1,4})\s*%\s*ao\s*ano/i))).find(Boolean);
    if (written) [dados.taxaMensal, dados.taxaAnual] = [parseBRL(written[1])!, parseBRL(written[2])!];
  }
  const mora = lines.map((line) => line.text.match(/juros\s+(?:de\s+)?mora[^\d]{0,40}(\d+(?:,\d+)?)\s*%/i)?.[1]).find(Boolean);
  if (mora) dados.jurosMora = `${mora}% A.M.`;

  dados.iof = amountFor(lines, [/Total de impostos/i, /IOF\s*(?:total|financiado)/i, /(?:^|\s)IOF\s*:/i]) ?? 0;

  // Several lines can carry each charge (B.3 cartório + B.4 trânsito); they add up.
  const sumLines = (pattern: RegExp, skip: RegExp) => lines
    .filter((line) => pattern.test(line.text) && !skip.test(line.text))
    .reduce((total, line) => total + (money(line.text)[0] ?? 0), 0);
  const encargos: Encargos = {
    seguros: zeroIsAbsent(sumLines(/seguro|prestamista|protegido/i, /total|subtotal|seguradora\s*:/i)),
    avaliacao: zeroIsAbsent(amountFor(lines, [/Tarifa de Avalia[çc][ãa]o|Avalia[çc][ãa]o (?:do|de) bem/i])),
    // Digimais: "D.1 Confecção de cadastro para início de relacionamento".
    cadastro: zeroIsAbsent(amountFor(lines, [/Tarifa de Cadastro/i, /Confec[çc][ãa]o de cadastro|Despesa de Cadastro/i])),
    registro: zeroIsAbsent(sumLines(/registro/i, /total|subtotal|t[íi]tulos e documentos sob/i)),
  };
  dados.encargos = encargos;

  const quadro = quadroResumo(lines);
  for (const key of ["contratante", "garantia", "dataContrato"] as const) if (quadro[key]) dados[key] = quadro[key];
  for (const key of ["valorSolicitado", "valorFinanciado", "parcelas", "valorParcela", "taxaMensal", "taxaAnual", "iof"] as const) if (quadro[key]) dados[key] = quadro[key];
  for (const key of ["seguros", "registro", "cadastro", "avaliacao"] as const) if (quadro[key] !== null) encargos[key] = zeroIsAbsent(quadro[key]);
  // Bradesco gives the grace period instead of the date: the accountant counts it from the issue date (12/11/2024 + 30 = 12/12/2024).
  if (!dados.primeiroVencimento && dados.dataContrato && quadro.carencia > 0) dados.primeiroVencimento = somarDias(dados.dataContrato, quadro.carencia);

  const encontrados = camposEncontrados(dados);
  // Stellantis: "CPF/CNPJ do(a) solicitante: 859.107.164-68".
  const cpf = quadro.cpf || (lines.map((line) => line.text.match(/CPF(?:\/CNPJ)?(?:\s+do\s*(?:\(a\))?\s+[a-z()]+)?\s*:?\s*(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b/i)?.[1]).find(Boolean) ?? "");
  // The bank's CNPJ is on its line, or alone on the line right below it (Stellantis).
  const bank = bankLine(lines);
  const cnpjOf = (text?: string) => text?.match(/CNPJ(?:\s+sob)?(?:\s*n[º°o]\.?)?\s*:?\s*(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})/i)?.[1];
  const cnpjInstituicao = cnpjOf(bank.text) ?? (bank.index >= 0 ? cnpjOf(lines[bank.index + 1]?.text) : undefined)
    ?? bank.text.match(/\b(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\b/)?.[1] ?? "";
  // The title sits in the first lines of the main page ("CÉDULA DE CRÉDITO BANCÁRIO - CRÉDITO PESSOAL…", "…CRÉDITO DIRETO AO CONSUMIDOR (CDC) – VEÍCULOS").
  // Bradesco's title says only "Pessoa Física": page 1 says what it is ("corresponde ao financiamento para aquisição de bem(ns)").
  const titulo = (page: number) => lines.filter((line) => line.page === page).slice(0, 8).map((line) => line.text).join(" ");
  const modalidade = modalidadeDoTitulo(titulo(lines[0].page)) ?? (lines[0].page !== 1 ? modalidadeDoTitulo(titulo(1)) : null);
  return { dados, cpf, cnpjInstituicao, modalidade, email: quadro.email || clientEmail(lines), endereco: quadro.endereco || clientAddress(lines, dados.contratante), encontrados };
}
