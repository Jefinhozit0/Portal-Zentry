/**
 * Parecer técnico for a revisional action: redoes the contract's Price table without the charges
 * that were financed with the loan (seguros, tarifas, registro) and shows how much the client
 * overpays. Pure math, shared by the form (preview) and the server (PDF).
 */

/** A charge financed with the loan; null means the contract does not have it ("NÃO CONSTA"). */
export type Encargos = { seguros: number | null; avaliacao: number | null; cadastro: number | null; registro: number | null };

export type LaudoDados = {
  contrato: string;
  contratante: string;
  instituicao: string;
  objeto: string;
  garantia: string;
  valorSolicitado: number;
  /** Total the client owes at the start (crédito + encargos + IOF), before interest. */
  valorFinanciado: number;
  parcelas: number;
  valorParcela: number;
  /** dd/mm/aaaa */
  dataContrato: string;
  primeiroVencimento: string;
  /** Percent, as written in the contract (2.59 = 2,59% a.m.). */
  taxaMensal: number;
  taxaAnual: number;
  jurosMora: string;
  iof: number;
  encargos: Encargos;
};

export const ENCARGO_LABELS: Record<keyof Encargos, string> = {
  seguros: "Seguros",
  avaliacao: "Avaliação de bem",
  cadastro: "Tarifa de cadastro",
  registro: "Registro de contrato",
};

export const emptyLaudo = (): LaudoDados => ({
  contrato: "", contratante: "", instituicao: "", objeto: "FINANCIAMENTO", garantia: "",
  valorSolicitado: 0, valorFinanciado: 0, parcelas: 0, valorParcela: 0,
  dataContrato: "", primeiroVencimento: "", taxaMensal: 0, taxaAnual: 0, jurosMora: "1% A.M.", iof: 0,
  encargos: { seguros: null, avaliacao: null, cadastro: null, registro: null },
});

export type LinhaPrice = { mes: number; prestacao: number; amortizacao: number; juros: number; saldo: number };
export type TabelaPrice = { valorFinanciado: number; prestacao: number; linhas: LinhaPrice[]; totalPago: number; totalAmortizado: number; totalJuros: number };

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export const pmt = (pv: number, rate: number, n: number) => (rate === 0 ? pv / n : (pv * rate) / (1 - Math.pow(1 + rate, -n)));

/** Monthly rate that makes `n` payments of `payment` pay off `pv` (what a spreadsheet's RATE returns). */
export function impliedRate(pv: number, payment: number, n: number) {
  if (!(pv > 0 && payment > 0 && n > 0) || payment * n <= pv) return null;
  let low = 0, high = 1;
  for (let step = 0; step < 200; step++) {
    const mid = (low + high) / 2;
    if (pmt(pv, mid, n) > payment) high = mid; else low = mid;
  }
  return (low + high) / 2;
}

/** Price table at full precision; the last row absorbs the rounding left by the 2-decimal payment. */
export function tabelaPrice(valorFinanciado: number, prestacao: number, rate: number, n: number): TabelaPrice {
  const linhas: LinhaPrice[] = [];
  let saldo = valorFinanciado;
  for (let mes = 1; mes <= n; mes++) {
    const juros = saldo * rate;
    const amortizacao = mes === n ? saldo : prestacao - juros;
    saldo = mes === n ? 0 : saldo - amortizacao;
    linhas.push({ mes, prestacao: mes === n ? amortizacao + juros : prestacao, amortizacao, juros, saldo });
  }
  const sum = (key: "prestacao" | "amortizacao" | "juros") => round2(linhas.reduce((total, row) => total + row[key], 0));
  return { valorFinanciado, prestacao, linhas, totalPago: sum("prestacao"), totalAmortizado: sum("amortizacao"), totalJuros: sum("juros") };
}

export const totalEncargos = (encargos: Encargos) => round2(Object.values(encargos).reduce<number>((total, value) => total + (value ?? 0), 0));

/**
 * Both tables and the difference. The rate comes from the contract's own payment (the effective
 * rate the bank charged, e.g. 2,5905% for a contract that says 2,59%); without a payment, from the
 * written monthly rate. The recalculation keeps the rate, the term and the IOF, and only takes the
 * charges out of the financed amount.
 */
export function calcularLaudo(dados: LaudoDados) {
  const n = dados.parcelas;
  const taxaEfetiva = impliedRate(dados.valorFinanciado, dados.valorParcela, n) ?? dados.taxaMensal / 100;
  const prestacaoOriginal = dados.valorParcela > 0 ? dados.valorParcela : round2(pmt(dados.valorFinanciado, taxaEfetiva, n));
  const original = tabelaPrice(dados.valorFinanciado, prestacaoOriginal, taxaEfetiva, n);
  const encargos = totalEncargos(dados.encargos);
  const financiadoRecalculado = round2(dados.valorFinanciado - encargos);
  // Full precision, shown rounded: rounding first would push the leftover cents into the last row.
  const recalculado = tabelaPrice(financiadoRecalculado, pmt(financiadoRecalculado, taxaEfetiva, n), taxaEfetiva, n);
  const diferencaParcela = round2(original.prestacao - round2(recalculado.prestacao));
  return { taxaEfetiva, encargos, original, recalculado, diferencaParcela, diferencaTotal: round2(diferencaParcela * n) };
}

/** Problems that make the laudo wrong or impossible; empty when it can be generated. */
export function problemasLaudo(dados: LaudoDados): string[] {
  const problems: string[] = [];
  if (!dados.contratante.trim()) problems.push("Falta o nome do contratante.");
  if (!dados.contrato.trim()) problems.push("Falta o número do contrato.");
  if (!(dados.valorFinanciado > 0)) problems.push("Falta o valor financiado.");
  if (!(dados.parcelas > 0 && Number.isInteger(dados.parcelas))) problems.push("Falta a quantidade de parcelas.");
  if (!(dados.valorParcela > 0) && !(dados.taxaMensal > 0)) problems.push("Informe o valor da parcela ou a taxa mensal.");
  if (dados.valorParcela > 0 && dados.parcelas > 0 && dados.valorParcela * dados.parcelas <= dados.valorFinanciado) problems.push("As parcelas somam menos que o valor financiado.");
  if (totalEncargos(dados.encargos) <= 0) problems.push("Nenhum encargo para retirar: o recálculo daria o mesmo contrato.");
  if (totalEncargos(dados.encargos) >= dados.valorFinanciado) problems.push("Os encargos passam do valor financiado.");
  return problems;
}

/** Warnings that do not block the laudo but are worth a second look (e.g. the sum does not close). */
export function avisosLaudo(dados: LaudoDados): string[] {
  const warnings: string[] = [];
  const soma = round2(dados.valorSolicitado + totalEncargos(dados.encargos) + dados.iof);
  if (dados.valorSolicitado > 0 && Math.abs(soma - dados.valorFinanciado) > 0.05) {
    warnings.push(`Crédito + encargos + IOF dá ${formatBRL(soma)}, mas o valor financiado é ${formatBRL(dados.valorFinanciado)}. Confira se falta algum encargo.`);
  }
  if (dados.valorParcela > 0 && dados.taxaMensal > 0) {
    const efetiva = impliedRate(dados.valorFinanciado, dados.valorParcela, dados.parcelas);
    if (efetiva !== null && Math.abs(efetiva * 100 - dados.taxaMensal) > 0.05) {
      warnings.push(`A parcela corresponde a ${formatPercent(efetiva * 100, 4)} a.m., e o contrato diz ${formatPercent(dados.taxaMensal)}. O cálculo usa a taxa da parcela.`);
    }
  }
  return warnings;
}

export const formatBRL = (value: number) => `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const formatPercent = (value: number, digits = 2) => `${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: digits })}%`;

/** "R$ 1.234,56", "1234,56" or "1234.56" → 1234.56; null when there is no number. */
export function parseBRL(text: string): number | null {
  const token = text.replace(/\s/g, "").match(/-?[\d.,]*\d/)?.[0];
  if (!token) return null;
  // A comma is always the decimal mark; without one, a dot followed by 1–2 digits is too (typed "1234.5").
  const normalized = token.includes(",") ? token.replace(/\./g, "").replace(",", ".") : /\.\d{1,2}$/.test(token) ? token.replace(/\.(?=.*\.)/g, "") : token.replace(/\./g, "");
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

/** "Outubro de 2026", in São Paulo time. */
export function mesPorExtenso(at = new Date()) {
  const [month, year] = at.toLocaleDateString("pt-BR", { month: "numeric", year: "numeric", timeZone: "America/Sao_Paulo" }).split("/").map(Number);
  return `${MESES[month - 1]} de ${year}`;
}

/** Month name → number (1–12), for dates written out ("7 de Janeiro de 2025"). */
export const mesNumero = (name: string) => MESES.findIndex((month) => month.toLowerCase() === name.normalize("NFC").toLowerCase()) + 1;
