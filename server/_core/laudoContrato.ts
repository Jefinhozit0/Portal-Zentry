import { getDocumentProxy } from "unpdf";
import { type Encargos, type LaudoDados, emptyLaudo, mesNumero, parseBRL } from "@shared/laudo";
import { type Modalidade, modalidadeDoTitulo } from "@shared/notificacao";

/**
 * Reads a bank contract (CCB) PDF and fills what it can of the laudo. Works on the text of the PDF,
 * line by line, looking for the labels banks use; a scanned contract (image only) has no text and
 * comes back empty. Whatever is not found stays blank for the team to type in.
 */

type Item = { x: number; y: number; text: string };
export type Line = { page: number; y: number; items: Item[]; text: string };

async function readLines(bytes: Uint8Array, maxPages = 3): Promise<Line[]> {
  const pdf = await getDocumentProxy(bytes);
  const lines: Line[] = [];
  for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, maxPages); pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const items = (content.items as { str?: string; transform?: number[] }[])
      .filter((item) => item.str?.trim() && item.transform)
      .map((item) => ({ x: item.transform![4], y: item.transform![5], text: item.str!.trim() }))
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
    lines.push(...pageLines);
  }
  return lines;
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

const zeroIsAbsent = (value: number | null) => (value && value > 0 ? value : null);

function contractDate(lines: Line[]) {
  const issued = find(lines, /data\s+(?:de\s+)?(?:emiss[ãa]o|contrata[çc][ãa]o|libera[çc][ãa]o)/i);
  const written = issued?.text.match(/(\d{2}\/\d{2}\/\d{4})/);
  if (written) return written[1];
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

/** The client's e-mail on page 1: the one on a line that says "e-mail"/"email" first, else any (SIM writes it after the phone, on the next line). */
function clientEmail(lines: Line[]) {
  const page1 = lines.filter((line) => line.page === 1);
  const labeled = page1.find((line) => /e-?mail/i.test(line.text) && EMAIL.test(line.text));
  return (labeled ?? page1.find((line) => EMAIL.test(line.text)))?.text.match(EMAIL)?.[0].toLowerCase() ?? "";
}

/**
 * The client's address, from the "Endereço…:" line, without the phone or e-mail that follow it.
 * SIM: "Endereço, fone de contato e e-mail: R FREDERICO GIACHETO FILHO, 68 - cohab II - 15495-000 - SP (17)".
 * Santander: "Endereço e telefone de contato: TANAZEIRO 39 CASA JARDIM MATARAZZO SAO PAULO SP - (11)999164161".
 */
function clientAddress(lines: Line[]) {
  // The line may start with the item code ("A.1 Endereço e telefone de contato: …").
  const label = /^(?:[A-Z]\.\d+\s+)?Endere[çc]o[^:]{0,40}:\s*/i;
  const line = lines.find((candidate) => candidate.page === 1 && label.test(candidate.text));
  if (!line) return "";
  return line.text.replace(label, "")
    .replace(/\s*-?\s*\(\d{2}\)[\s\d-]*.*$/, "")
    .replace(EMAIL, "")
    .replace(/[\s,-]+$/, "")
    .trim();
}

export async function lerContrato(bytes: Uint8Array): Promise<LeituraContrato> {
  return extrairContrato(await readLines(bytes));
}

export function extrairContrato(lines: Line[]): LeituraContrato {
  const dados = emptyLaudo();
  if (lines.length === 0) return { dados, cpf: "", cnpjInstituicao: "", modalidade: null, email: "", endereco: "", encontrados: [] };

  dados.contrato = lines.map((line) => line.text.match(/(?:OPERA[ÇC][AÃ]O|CONTRATO|C[ÉE]DULA|PROPOSTA)\s*(?:N[º°o.]*|n[úu]mero)\s*:?\s*(\d[\d./-]{3,})/i)?.[1]).find(Boolean) ?? "";
  dados.instituicao = (find(lines, /(BANCO|CR[ÉE]DITO|FINANCEIRA|FINANCIAMENTO)[^]*\bS\.?\s?\/?A\b/i)?.text ?? "")
    .replace(/\s*-?\s*CNPJ.*$/i, "").replace(/\s+/g, " ").trim();
  // The colon matters: "Cliente" alone shows up in clauses ("Direitos e Deveres do Cliente").
  dados.contratante = textAfter(lines, /^(?:Nome(?:\s*\/\s*Raz[ãa]o Social)?\s+do\s+(?:Cliente|Emitente|Consumidor|Devedor)|Emitente|Cliente|Contratante)\s*:/i, /^(CPF|RG)\b/i);

  // SIM: "Veículo (Marca): TOYOTA … Ano-modelo: 2017/2018 … Modelo: COROLLA". Santander: "Veículo: Marca: BAJAJ … Modelo: DOMINAR 250", "Ano/Modelo: 2025".
  const marca = textAfter(lines, /^(?:Ve[íi]culo\s*(?:\(Marca\)|:\s*Marca)|Marca)\s*:?/i, /^(Ano|Modelo)/i);
  const modelo = textAfter(lines, /^Modelo\s*:?/i);
  const ano = textAfter(lines, /^Ano\s*[-/]?\s*modelo\s*:?/i, /^(Modelo|Cor)\b/i);
  dados.garantia = [marca, modelo, ano].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

  dados.valorSolicitado = amountFor(lines, [/Valor Solicitado/i, /Valor L[íi]quido Liberado/i, /Valor (?:l[íi]quido )?(?:do )?(?:cr[ée]dito|empr[ée]stimo) liberado/i, /Valor liberado/i, /Valor (?:l[íi]quido )?do cr[ée]dito/i]) ?? 0;
  dados.valorFinanciado = amountFor(lines, [/VALOR TOTAL CONTRATADO/i, /Valor total (?:do )?financiad/i, /Total financiado/i, /Valor (?:do )?financiamento/i], /sem impostos/i) ?? 0;
  dados.valorParcela = (() => {
    const line = find(lines, /Valor (?:de cada|da|das) (?:parcela|presta[çc][ãa]o)/i);
    const values = line ? money(line.text) : [];
    return values.length ? values[values.length - 1] : 0;
  })();
  dados.parcelas = (() => {
    const line = find(lines, /(?:N[úu]mero|Quantidade|Qtde\.?)\s+de\s+(?:parcelas|presta[çc][õo]es)|Prazo\s*\(meses\)/i);
    const numbers = line?.text.replace(/^.*?(?:parcelas|presta[çc][õo]es|meses\))[^\d]*/i, "").match(/\b(\d{1,3})\b/);
    return numbers ? Number(numbers[1]) : 0;
  })();
  dados.primeiroVencimento = find(lines, /(?:1[º°ª]?\s*|primeiro\s+)vencimento/i)?.text.match(/(\d{2}\/\d{2}\/\d{4})/)?.[1] ?? "";
  dados.dataContrato = contractDate(lines);

  const rateIndex = lines.findIndex((line) => /taxa\s+de\s+juros/i.test(line.text) && !/mora/i.test(line.text));
  if (rateIndex >= 0) {
    const window = lines.slice(rateIndex, rateIndex + 3);
    // Labeled ("diária: % a.d.: 0,07% mensal: % a.m.: 2,00% anual: % a.a.: 26,82%") wins over position, so the daily rate is never taken for the monthly one.
    const joined = window.map((line) => line.text).join(" ");
    const labeled = (unit: string) => joined.match(new RegExp(`a\\.?\\s?${unit}\\.?\\s*:?\\s*(\\d{1,3},\\d{1,4})`, "i"))?.[1];
    const mensal = labeled("m"), anual = labeled("a");
    if (mensal && anual) [dados.taxaMensal, dados.taxaAnual] = [parseBRL(mensal)!, parseBRL(anual)!];
    else {
      // SIM puts the two numbers alone on the line below the label, monthly first.
      const rates = window.map((line) => percents(line.text.replace(/^.*taxa\s+de\s+juros[^\d]*/i, ""))).find((values) => values.length >= 2);
      if (rates) [dados.taxaMensal, dados.taxaAnual] = rates;
    }
  }
  const mora = lines.map((line) => line.text.match(/juros\s+(?:de\s+)?mora[^\d]{0,40}(\d+(?:,\d+)?)\s*%/i)?.[1]).find(Boolean);
  if (mora) dados.jurosMora = `${mora}% A.M.`;

  dados.iof = amountFor(lines, [/Total de impostos/i, /IOF\s*(?:total|financiado)/i]) ?? 0;

  // Several lines can carry each charge (B.3 cartório + B.4 trânsito); they add up.
  const sumLines = (pattern: RegExp, skip: RegExp) => lines
    .filter((line) => pattern.test(line.text) && !skip.test(line.text))
    .reduce((total, line) => total + (money(line.text)[0] ?? 0), 0);
  const encargos: Encargos = {
    seguros: zeroIsAbsent(sumLines(/seguro|prestamista|protegido/i, /total|subtotal|seguradora\s*:/i)),
    avaliacao: zeroIsAbsent(amountFor(lines, [/Tarifa de Avalia[çc][ãa]o|Avalia[çc][ãa]o (?:do|de) bem/i])),
    cadastro: zeroIsAbsent(amountFor(lines, [/Tarifa de Cadastro/i])),
    registro: zeroIsAbsent(sumLines(/registro/i, /total|subtotal|t[íi]tulos e documentos sob/i)),
  };
  dados.encargos = encargos;

  const encontrados = Object.entries({ ...dados, ...encargos })
    .filter(([key, value]) => key !== "encargos" && key !== "objeto" && key !== "jurosMora" && value !== "" && value !== 0 && value !== null)
    .map(([key]) => key);
  const cpf = lines.map((line) => line.text.match(/CPF(?:\/CNPJ)?\s*:?\s*(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b/i)?.[1]).find(Boolean) ?? "";
  const cnpjInstituicao = find(lines, /(BANCO|CR[ÉE]DITO|FINANCEIRA|FINANCIAMENTO)[^]*\bS\.?\s?\/?A\b/i)?.text.match(/CNPJ:?\s*(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})/i)?.[1] ?? "";
  // The title sits in the first lines of page 1 ("CÉDULA DE CRÉDITO BANCÁRIO - CRÉDITO PESSOAL…", "…CRÉDITO DIRETO AO CONSUMIDOR (CDC) – VEÍCULOS").
  const modalidade = modalidadeDoTitulo(lines.filter((line) => line.page === 1).slice(0, 8).map((line) => line.text).join(" "));
  return { dados, cpf, cnpjInstituicao, modalidade, email: clientEmail(lines), endereco: clientAddress(lines), encontrados };
}
