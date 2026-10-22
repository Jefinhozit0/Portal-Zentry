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

/** The title of the standard table banks must fill (Res. CMN 4.881), in capitals: clauses mention it in lowercase. */
const QUADRO_PADRAO = /OR[ÇC]AMENTO DE OPERA[ÇC][ÃA]O DE CR[ÉE]DITO|CONDI[ÇC][ÕO]ES ESPEC[ÍI]FICAS DE OPERA[ÇC][ÃA]O DE CR[ÉE]DITO/;

/**
 * The first 3 pages, plus the page of the standard table wherever it is (Digimais puts it on page 11,
 * after the cadastro and the CCB), which then comes first. The other pages are clauses and the
 * insurance proposal, whose amounts ("Valor cálculo Seguro") would be taken for the contract's.
 */
async function readLines(bytes: Uint8Array, firstPages = 3, maxPages = 20): Promise<Line[]> {
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
  const quadro = pages.findIndex((page) => page.slice(0, 12).some((line) => QUADRO_PADRAO.test(line.text)));
  const kept = pages.filter((_, index) => index < firstPages || index === quadro);
  if (quadro > 0) kept.sort((a, b) => (a === pages[quadro] ? -1 : b === pages[quadro] ? 1 : 0));
  return kept.flat();
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

export async function lerContrato(bytes: Uint8Array): Promise<LeituraContrato> {
  return extrairContrato(await readLines(bytes));
}

export function extrairContrato(lines: Line[]): LeituraContrato {
  const dados = emptyLaudo();
  if (lines.length === 0) return { dados, cpf: "", cnpjInstituicao: "", modalidade: null, email: "", endereco: "", encontrados: [] };

  dados.contrato = lines.map((line) => line.text.match(/(?:OPERA[ÇC][AÃ]O|CONTRATO|C[ÉE]DULA|PROPOSTA|OR[ÇC]AMENTO|CONSIGNADO)\s*(?:N[º°o.]*|n[úu]mero)\s*:?\s*(\d[\d./-]{3,})/i)?.[1]).find(Boolean) ?? "";
  // Itaú: "-ITAU UNIBANCO HOLDING S.A. - CNPJ: …". Consignado: "Instituição Financeira: BANCO SANTANDER (BRASIL) S.A.".
  // Digimais: "Banco Digimais S.A., instituição financeira de direito privado, com sede na …".
  dados.instituicao = bankLine(lines).text
    .replace(/\s*-?\s*CNPJ.*$/i, "")
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
  dados.valorFinanciado = amountFor(lines, [/VALOR TOTAL CONTRATADO/i, /Valor total (?:do )?financiad/i, /Total financiado/i, /Valor (?:do )?financiamento/i, /Valor do Empr[ée]stimo\s*\(financiado\)/i], /sem impostos/i) ?? 0;
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

  const encontrados = Object.entries({ ...dados, ...encargos })
    .filter(([key, value]) => key !== "encargos" && key !== "objeto" && key !== "jurosMora" && value !== "" && value !== 0 && value !== null)
    .map(([key]) => key);
  // Stellantis: "CPF/CNPJ do(a) solicitante: 859.107.164-68".
  const cpf = lines.map((line) => line.text.match(/CPF(?:\/CNPJ)?(?:\s+do\s*(?:\(a\))?\s+[a-z()]+)?\s*:?\s*(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b/i)?.[1]).find(Boolean) ?? "";
  // The bank's CNPJ is on its line, or alone on the line right below it (Stellantis).
  const bank = bankLine(lines);
  const cnpjOf = (text?: string) => text?.match(/CNPJ(?:\s+sob)?(?:\s*n[º°o]\.?)?\s*:?\s*(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})/i)?.[1];
  const cnpjInstituicao = cnpjOf(bank.text) ?? (bank.index >= 0 ? cnpjOf(lines[bank.index + 1]?.text) : undefined) ?? "";
  // The title sits in the first lines of the main page ("CÉDULA DE CRÉDITO BANCÁRIO - CRÉDITO PESSOAL…", "…CRÉDITO DIRETO AO CONSUMIDOR (CDC) – VEÍCULOS").
  const modalidade = modalidadeDoTitulo(lines.filter((line) => line.page === lines[0].page).slice(0, 8).map((line) => line.text).join(" "));
  return { dados, cpf, cnpjInstituicao, modalidade, email: clientEmail(lines), endereco: clientAddress(lines, dados.contratante), encontrados };
}
