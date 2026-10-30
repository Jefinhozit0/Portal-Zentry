import { type LaudoDados, impliedRate, parseBRL, pmt, taxaAnualDe } from "@shared/laudo";

/**
 * Checks the contract's main numbers against each other, whatever the layout: valor financiado, parcela,
 * prazo and taxa must close the Price table. The rate the payment implies may sit a little above the
 * written one (that difference is what the laudo is about), never below it and never far above:
 * in the real contracts it ran from 0,004 below to 0,56 above. A random set of numbers from the page
 * almost never closes that account, so a set that does is the contract's.
 *
 * When the labels gave a set that closes, it is confirmed. When they missed a value, or gave one that
 * does not close, every amount, count and percentage of the whole document is tried, and the set that
 * closes and agrees most with the labels wins; if two sets tie, nothing is guessed. What could not be
 * confirmed is said, field by field, so the team checks exactly that.
 */

const ABAIXO = 0.01;
const ACIMA = 1.5;
/** The two closest fits differ by less than this (in rate points): the account alone cannot tell them apart. */
const EMPATE = 0.02;
/** A fit within this (rate points) is exact to the precision of a rate printed with two decimals. */
const EXATA = 0.01;
/**
 * A blank is filled by the account only when the set fits within this: a little over the precision of a
 * printed rate, for contracts whose payment carries a small divergence (Bradesco: 2,06% written, 2,09% charged).
 */
const PREENCHER = 0.05;
/** A number that brings the fit this much closer (rate points) than the one read casts doubt on it. */
const MELHOR = 0.3;

type Principais = Pick<LaudoDados, "valorFinanciado" | "valorParcela" | "parcelas" | "taxaMensal">;
type Campo = keyof Principais;

export const NOMES_CAMPOS: Record<Campo, string> = {
  valorFinanciado: "valor financiado",
  valorParcela: "valor da parcela",
  parcelas: "quantidade de parcelas",
  taxaMensal: "taxa de juros mensal",
};

export type Conferencia = {
  /** The four main numbers close the account (read by label or found by it). */
  conferido: boolean;
  /** Fields the account filled or replaced: right by the account, but worth a look. */
  corrigidos: Campo[];
  /** What the team must check, in words. */
  avisos: string[];
};

/** The rate implied by the payment, in % a.m., or null when the numbers can't be a loan. */
export function taxaDaParcela(valorFinanciado: number, valorParcela: number, parcelas: number) {
  const rate = impliedRate(valorFinanciado, valorParcela, parcelas);
  return rate === null ? null : rate * 100;
}

/** valor, parcela and prazo close the Price table at the written monthly rate (within the margin above). */
export function fechaConta({ valorFinanciado, valorParcela, parcelas, taxaMensal }: Principais) {
  if (!(valorFinanciado > 0 && valorParcela > 0 && Number.isInteger(parcelas) && parcelas > 0 && taxaMensal > 0)) return false;
  const implicita = taxaDaParcela(valorFinanciado, valorParcela, parcelas);
  return implicita !== null && implicita >= taxaMensal - ABAIXO && implicita <= taxaMensal + ACIMA;
}

type Candidato = { valor: number; dica: boolean };

/** Every amount in the text ("R$ 1.299,75", "36.913,65"), not percentages. */
const AMOUNT = /(?<![\d,.])(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})(?![\d%]|\s*%)/g;
const PERCENT = /(?<![\d,.])(\d{1,2},\d{1,4})\s*%/g;
const AMOUNT_LABEL = /financiad|parcela|presta[çc]|total|cr[ée]dito|empr[ée]stimo/i;
/** Labels of the amounts that sit next to the financed one and must not pass for it. */
const NOT_THE_AMOUNT = /sem impostos|total de (?:impostos|tarifas)|tarifa|seguro|\bIOF\b|registro|cadastro|avalia|despesa|liberad|solicitad/i;
const NOT_THE_RATE =/CET|custo efetivo|mora|multa|atraso|inadimpl|IOF|imposto|tributo|tarifa|seguro|comiss|perman[êe]ncia|di[áa]ri|a\.?\s?d\b/i;

/** A decimal dot before "%" (the OCR's "2.06 %") is a comma; item numbers ("2.9 - Complemento") are left alone. */
const normalizar = (text: string) => text.replace(/(\d)\.(\d{1,4})(?=\s*%)/g, "$1,$2");

function candidatos(documento: string[]) {
  const texts = documento.map(normalizar);
  const valores = new Map<number, boolean>(), parcelas = new Map<number, boolean>(), taxas = new Map<number, boolean>();
  const add = (map: Map<number, boolean>, value: number, dica: boolean) => map.set(value, (map.get(value) ?? false) || dica);
  texts.forEach((text, index) => {
    // A label can sit on the line above its value, so the hints look at the line before too.
    const near = `${texts[index - 1] ?? ""} ${text}`;
    // An amount, like a percentage below, is judged by its own label (the words since the previous number);
    // alone on its line, by the lines around it (Stellantis prints "Valor Total Financiado" just below it).
    let since = 0;
    for (const match of Array.from(text.matchAll(AMOUNT))) {
      const segment = text.slice(since, match.index);
      since = (match.index ?? 0) + match[0].length;
      const labels = /[A-Za-zÀ-ú]{3}/.test(segment) ? [segment] : [texts[index - 1] ?? "", texts[index + 1] ?? ""];
      const value = parseBRL(match[1]);
      if (value && value >= 50) add(valores, value, labels.some((label) => AMOUNT_LABEL.test(label) && !NOT_THE_AMOUNT.test(label)));
    }
    if (/parcela|presta[çc]|prazo|meses|vezes|\d+\s*x\b/i.test(near)) {
      for (const match of Array.from(text.matchAll(/(?<![\d,.\/])(\d{1,3})(?![\d,.\/%])/g))) {
        const value = Number(match[1]);
        if (value >= 2 && value <= 120) add(parcelas, value, /parcelas|presta[çc][õo]es|prazo/i.test(near));
      }
    }
    // Each percentage is judged by its own label, the words since the previous one ("diária: % a.d.: 0,07%
    // mensal: % a.m.: 2,00%" keeps the 2,00); a number alone on its line, by the line above.
    let from = 0;
    for (const match of Array.from(text.matchAll(PERCENT))) {
      const segment = text.slice(from, match.index);
      from = (match.index ?? 0) + match[0].length;
      const label = /[A-Za-zÀ-ú]{3}/.test(segment) ? segment : `${texts[index - 1] ?? ""} ${segment}`;
      const value = parseBRL(match[1]);
      // A header can name the interest rate and the CET together ("1- Taxa de Juros Efetiva 2 - CET"): it still counts.
      const juros = /taxa\s+de\s+juros(?!\s+(?:de\s+)?mora)/i.test(label);
      if ((juros || !NOT_THE_RATE.test(label)) && value && value >= 0.3 && value <= 15) add(taxas, value, juros || /a\.?\s?m\b|ao m[êe]s|mensal/i.test(label));
    }
  });
  const list = (map: Map<number, boolean>): Candidato[] => Array.from(map, ([valor, dica]) => ({ valor, dica }));
  return { valores: list(valores), parcelas: list(parcelas), taxas: list(taxas) };
}

type Conjunto = Principais & { pontos: number; ajuste: number; dicas: Record<Campo, boolean> };

/**
 * The sets of the document that close the account, best first: most values equal to what the labels
 * read, then most values next to a label of their kind, then the closest fit.
 */
function conjuntos(lidos: Principais, texts: string[]): Conjunto[] {
  const { valores, parcelas, taxas } = candidatos(texts);
  const comLido = (list: Candidato[], lido: number) => (lido > 0 && !list.some((item) => item.valor === lido) ? [...list, { valor: lido, dica: true }] : list);
  const vs = comLido(valores, lidos.valorFinanciado), ps = comLido(valores, lidos.valorParcela);
  const ns = comLido(parcelas, lidos.parcelas), ts = comLido(taxas, lidos.taxaMensal);
  const found: Conjunto[] = [];
  for (const t of ts) {
    for (const n of ns) {
      // The payment that the written rate gives, and the most the margin allows, for each valor.
      for (const v of vs) {
        const minimo = pmt(v.valor, (t.valor - ABAIXO) / 100, n.valor);
        const maximo = pmt(v.valor, (t.valor + ACIMA) / 100, n.valor);
        for (const p of ps) {
          if (p.valor < minimo - 0.01 || p.valor > maximo || p.valor >= v.valor) continue;
          const implicita = taxaDaParcela(v.valor, p.valor, n.valor);
          if (implicita === null) continue;
          const iguais = Number(v.valor === lidos.valorFinanciado) + Number(p.valor === lidos.valorParcela) + Number(n.valor === lidos.parcelas) + Number(t.valor === lidos.taxaMensal);
          const dicas = Number(v.dica) + Number(p.dica) + Number(n.dica) + Number(t.dica);
          const ajuste = Math.abs(implicita - t.valor);
          found.push({
            valorFinanciado: v.valor, valorParcela: p.valor, parcelas: n.valor, taxaMensal: t.valor,
            pontos: iguais * 10 + dicas * 2 + (ajuste < 0.05 ? 3 : ajuste < 0.3 ? 1 : 0), ajuste,
            dicas: { valorFinanciado: v.dica, valorParcela: p.dica, parcelas: n.dica, taxaMensal: t.dica },
          });
        }
      }
    }
  }
  return found.sort((a, b) => b.pontos - a.pontos || a.ajuste - b.ajuste);
}

const mesmo = (a: Principais, b: Principais) => (Object.keys(NOMES_CAMPOS) as Campo[]).every((campo) => a[campo] === b[campo]);

/**
 * Confirms (or completes) the main numbers of `dados` against the whole document's text, in place,
 * and says what was confirmed. `documento` is every line of every page read.
 */
export function conferirContrato(dados: LaudoDados, documento: string[]): Conferencia {
  const conferencia = conferirPrincipais(dados, documento);
  if (dados.taxaMensal > 0 && dados.taxaAnual > 0) {
    // The yearly rate follows from the monthly one. Banks round, and Bradesco prints the yearly of the rate
    // really charged (2,87% a.m. with 41,17% a.a., which is 2,92% a.m.): within a tenth of a point. Further
    // apart, one of the two rates was misread: not confirmed.
    const mensalDaAnual = (Math.pow(1 + dados.taxaAnual / 100, 1 / 12) - 1) * 100;
    if (Math.abs(mensalDaAnual - dados.taxaMensal) > 0.1) {
      conferencia.avisos.push(`A taxa anual lida (${dados.taxaAnual.toLocaleString("pt-BR")}%) não corresponde à mensal (${dados.taxaMensal.toLocaleString("pt-BR")}%): confira as duas.`);
      conferencia.conferido = false;
    }
  }
  return conferencia;
}

/**
 * The number is written somewhere in the contract ("1.121,02" or "1121,02"; "2,06" or "2,0600"; "48").
 * A value read from the text always is; one that isn't came from a misread and is not kept.
 */
function escrito(campo: Campo, valor: number, texto: string) {
  const numero = campo === "parcelas" ? String(valor) : campo === "taxaMensal" ? String(valor).replace(".", ",") : valor.toFixed(2).replace(".", ",");
  // A whole rate ("2") must look like one ("2,00" or "2%"): bare small numbers are everywhere (item numbers).
  const pattern = campo === "taxaMensal" && !numero.includes(",") ? `${numero}(?:,0+|\\s*%)` : campo === "taxaMensal" ? `${numero}0*` : numero;
  return new RegExp(`(?<![\\d,])${pattern}(?![\\d,])`).test(texto);
}

function conferirPrincipais(dados: LaudoDados, documento: string[]): Conferencia {
  const lidos: Principais = { valorFinanciado: dados.valorFinanciado, valorParcela: dados.valorParcela, parcelas: dados.parcelas, taxaMensal: dados.taxaMensal };
  const avisos: string[] = [];
  // A count of payments is a whole number: anything else was a misread.
  if (!Number.isInteger(lidos.parcelas)) lidos.parcelas = 0;
  if (documento.length) {
    // Thousands dots out, so "36.913,65" and "36913,65" read the same.
    const texto = documento.map(normalizar).join("\n").replace(/(\d)\.(?=\d{3}\b)/g, "$1");
    for (const campo of Object.keys(NOMES_CAMPOS) as Campo[]) {
      if (!(lidos[campo] > 0) || escrito(campo, lidos[campo], texto)) continue;
      avisos.push(`O ${NOMES_CAMPOS[campo]} lido (${textoDe(campo, lidos[campo])}) não aparece escrito no contrato: confira.`);
      lidos[campo] = 0;
    }
  }
  if (fechaConta(lidos)) {
    // A loose fit can be a real divergence, or a neighbour taken for the value (valor solicitado for the
    // financiado: 50.000,00 instead of 55.885,04 still fits the margin). If one other labeled number of the
    // document, in place of one value, closes the account clearly better, the reading is not trusted: both are shown.
    const ajusteLido = Math.abs((taxaDaParcela(lidos.valorFinanciado, lidos.valorParcela, lidos.parcelas) ?? 0) - lidos.taxaMensal);
    // Even a close fit is checked: 2,60% read for a printed 2,59% fits within a hundredth too.
    const exata = conjuntos(lidos, documento)
      .filter((opcao) => {
        const trocados = (Object.keys(NOMES_CAMPOS) as Campo[]).filter((campo) => opcao[campo] !== lidos[campo]);
        const melhor = opcao.ajuste < ajusteLido / 2 || opcao.ajuste < ajusteLido - MELHOR;
        return trocados.length === 1 && opcao.dicas[trocados[0]] && melhor;
      })
      .sort((a, b) => a.ajuste - b.ajuste)[0];
    if (!exata) return { conferido: true, corrigidos: [], avisos };
    const campo = (Object.keys(NOMES_CAMPOS) as Campo[]).find((key) => exata[key] !== lidos[key])!;
    avisos.unshift(`Confira o ${NOMES_CAMPOS[campo]}: li ${textoDe(campo, lidos[campo])}, mas com ${textoDe(campo, exata[campo])}, que também está no contrato, a conta da tabela Price fecha melhor.`);
    return { conferido: false, corrigidos: [], avisos };
  }

  // A set is acceptable when it keeps at least two of the values the labels read (or, with nothing read,
  // fits almost exactly with every value next to its label), each value it brings in sits next to a label
  // of its kind, and bringing in more than one needs a close fit.
  const campos = Object.keys(NOMES_CAMPOS) as Campo[];
  const trazidosDe = (opcao: Conjunto) => campos.filter((campo) => opcao[campo] !== lidos[campo]);
  const aceitaveis = conjuntos(lidos, documento).filter((opcao) => {
    const trazidos = trazidosDe(opcao);
    return (campos.length - trazidos.length >= 2 || (opcao.ajuste < EXATA && opcao.pontos >= 8 + 3))
      && trazidos.every((campo) => opcao.dicas[campo])
      && (trazidos.length < 2 || opcao.ajuste < 0.3);
  });
  // Then it must be the only answer among those that change the fewest values. Two different answers (the
  // rate misread, or the parcela?) are not guessed, even if one fits exactly: with dozens of amounts on a
  // contract, a chance exact fit exists, while the real one may be a divergence that only fits loosely.
  const distintos = aceitaveis.filter((opcao, index) => aceitaveis.findIndex((other) => mesmo(other, opcao)) === index);
  const menos = Math.min(...distintos.map((opcao) => trazidosDe(opcao).length));
  const minimos = distintos.filter((opcao) => trazidosDe(opcao).length === menos);
  const melhor = minimos.length === 1 ? minimos[0] : undefined;
  const trazidos = melhor ? trazidosDe(melhor) : [];
  if (!melhor) {
    const duvida = Array.from(new Set(distintos.flatMap(trazidosDe))).map((campo) => NOMES_CAMPOS[campo]);
    if (duvida.length) {
      avisos.unshift(`A conta da tabela Price não fecha com o que li, e o contrato permite mais de uma correção (${duvida.join(", ")}). Confira esses campos com o contrato.`);
      return { conferido: false, corrigidos: [], avisos };
    }
    const faltam = (Object.keys(NOMES_CAMPOS) as Campo[]).filter((campo) => !(lidos[campo] > 0)).map((campo) => NOMES_CAMPOS[campo]);
    avisos.unshift(faltam.length
      ? `Não encontrei com segurança: ${faltam.join(", ")}. Digite com o contrato em mãos.`
      : "Valor financiado, parcela, prazo e taxa não fecham a conta da tabela Price: algum foi mal lido. Confira os quatro com o contrato.");
    return { conferido: false, corrigidos: [], avisos };
  }
  // A value that was read is never overwritten: the account only points at the doubt.
  const trocados = trazidos.filter((campo) => lidos[campo] > 0);
  if (trocados.length) {
    avisos.unshift(`Confira ${trocados.map((campo) => `o ${NOMES_CAMPOS[campo]}: li ${textoDe(campo, lidos[campo])}, mas a conta da tabela Price fecha com ${textoDe(campo, melhor[campo])}, que também está no contrato`).join("; ")}.`);
    return { conferido: false, corrigidos: [], avisos };
  }
  // A blank is filled only when the account closes almost exactly; a loose fit is just suggested.
  if (melhor.ajuste >= PREENCHER) {
    avisos.unshift(`Não encontrei com segurança: ${trazidos.map((campo) => `${NOMES_CAMPOS[campo]} (pode ser ${textoDe(campo, melhor[campo])})`).join(", ")}. Confira com o contrato e digite.`);
    return { conferido: false, corrigidos: [], avisos };
  }
  for (const campo of trazidos) dados[campo] = melhor[campo];
  if (trazidos.length) avisos.unshift(`Achei pela conta da tabela Price: ${trazidos.map((campo) => `${NOMES_CAMPOS[campo]} ${textoDe(campo, melhor[campo])}`).join(", ")}. A conta fecha, mas confira.`);
  return { conferido: true, corrigidos: trazidos, avisos };
}

/** "R$ 1.121,02", "48", "2,87%". */
function textoDe(campo: Campo, value: number) {
  if (campo === "parcelas") return String(value);
  if (campo === "taxaMensal") return `${value.toLocaleString("pt-BR")}%`;
  return `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** CPF check digits: a misread digit (OCR) almost always breaks them. */
export function cpfValido(cpf: string) {
  const digits = cpf.replace(/\D/g, "");
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;
  const check = (length: number) => {
    const sum = digits.slice(0, length).split("").reduce((total, digit, index) => total + Number(digit) * (length + 1 - index), 0);
    return ((sum * 10) % 11) % 10;
  };
  return check(9) === Number(digits[9]) && check(10) === Number(digits[10]);
}

/** CNPJ check digits. */
export function cnpjValido(cnpj: string) {
  const digits = cnpj.replace(/\D/g, "");
  if (digits.length !== 14 || /^(\d)\1{13}$/.test(digits)) return false;
  const check = (length: number) => {
    const weights = length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const rest = digits.slice(0, length).split("").reduce((total, digit, index) => total + Number(digit) * weights[index], 0) % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return check(12) === Number(digits[12]) && check(13) === Number(digits[13]);
}
