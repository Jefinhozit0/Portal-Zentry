/**
 * Notificação extrajudicial asking the bank for a copy of the client's contract. The client, the
 * contract figures and the bank change; the company's contacts (shared/empresa.ts) and the 7-day term are fixed.
 */

import { PROBLEMA_DOCUMENTO, documentoValido } from "./procuracao";
import type { Genero } from "./genero";

export type NotificacaoDados = {
  nome: string;
  /** "inscrito" / "inscrita"; null keeps "inscrito(a)". */
  genero: Genero | null;
  cpf: string;
  modalidade: Modalidade;
  /** Amount of the contract (crédito liberado). */
  valor: number;
  parcelas: number;
  valorParcela: number;
  bancoNome: string;
  bancoCnpj: string;
  bancoEndereco: string;
  cidade: string;
  /** aaaa-mm-dd */
  data: string;
};

/** The banks the documents are addressed to (razão social, CNPJ, sede): see shared/bancos.ts. */
export { BANCOS as BANCOS_CONHECIDOS, BANCOS_POR_NOME, bancoConhecido } from "./bancos";

/**
 * Notificação com contrato: the client already has the contract, and the company contests the interest rate
 * (the one actually charged is higher than the one written) and asks for the difference back.
 */
export type NotificacaoContratoDados = {
  nome: string;
  /** "inscrito" / "inscrita"; null keeps "inscrito(a)". */
  genero: Genero | null;
  cpf: string;
  contrato: string;
  /** Monthly rate written in the contract, in percent (1.96 = 1,96% a.m.). */
  taxaMensal: number;
  /** "contrato de financiamento" (CDC, vehicle) or "contrato de empréstimo" (crédito pessoal). */
  modalidade: Modalidade;
  bancoNome: string;
  bancoCnpj: string;
  bancoEndereco: string;
  cidade: string;
  /** aaaa-mm-dd */
  data: string;
};

export const MODALIDADES = ["financiamento", "empréstimo"] as const;
export type Modalidade = (typeof MODALIDADES)[number];

/** From the contract's title: crédito pessoal / empréstimo / CCB of a loan → empréstimo; CDC, veículos, financiamento → financiamento. */
export function modalidadeDoTitulo(titulo: string): Modalidade | null {
  if (/cr[ée]dito pessoal|empr[ée]stimo|consignado/i.test(titulo)) return "empréstimo";
  if (/financiamento|cdc|cr[ée]dito direto ao consumidor|ve[íi]culo/i.test(titulo)) return "financiamento";
  return null;
}

export function problemasNotificacaoContrato(dados: NotificacaoContratoDados): string[] {
  const problems: string[] = [];
  if (!dados.nome.trim()) problems.push("Falta o nome do cliente.");
  if (!documentoValido(dados.cpf)) problems.push(PROBLEMA_DOCUMENTO);
  if (!dados.contrato.trim()) problems.push("Falta o número do contrato.");
  if (!(dados.taxaMensal > 0)) problems.push("Falta a taxa de juros mensal do contrato.");
  problems.push(...problemasBancoELocal(dados));
  return problems;
}

/** Checks the notificação's claim: the rate the payments imply must be above the one written in the contract. */
export function avisoTaxa(taxaMensal: number, taxaEfetiva: number | null) {
  if (taxaEfetiva === null || !(taxaMensal > 0)) return null;
  const efetiva = taxaEfetiva * 100;
  const texto = efetiva.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return efetiva - taxaMensal > 0.005
    ? { ok: true, texto: `As parcelas correspondem a ${texto}% a.m., acima dos ${taxaMensal.toLocaleString("pt-BR")}% do contrato.` }
    : { ok: false, texto: `As parcelas correspondem a ${texto}% a.m., que não é maior que os ${taxaMensal.toLocaleString("pt-BR")}% do contrato: o argumento da notificação não se aplica a este contrato.` };
}

function problemasBancoELocal(dados: { bancoNome: string; bancoCnpj: string; bancoEndereco: string; cidade: string; data: string }) {
  const problems: string[] = [];
  if (!dados.bancoNome.trim()) problems.push("Falta a instituição financeira.");
  if (!dados.bancoCnpj.trim()) problems.push("Falta o CNPJ da instituição.");
  if (!dados.bancoEndereco.trim()) problems.push("Falta o endereço da sede da instituição.");
  if (!dados.cidade.trim()) problems.push("Falta a cidade.");
  else if (/\d/.test(dados.cidade)) problems.push(`Escreva a cidade por extenso: "${dados.cidade.trim()}" parece um código, não o nome da cidade.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dados.data)) problems.push("Falta a data.");
  return problems;
}


const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** "São Paulo, 14 de novembro de 2025." */
export function dataPorExtenso(cidade: string, data: string) {
  const [year, month, day] = data.split("-").map(Number);
  return `${cidade.trim()}, ${day} de ${MESES[month - 1]} de ${year}.`;
}

const UNIDADES = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CENTENAS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

/** 0–999 in words ("cento e vinte e três"). */
function ate999(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "cem";
  const c = Math.floor(n / 100), rest = n % 100;
  const parts: string[] = [];
  if (c) parts.push(CENTENAS[c]);
  if (rest < 20) { if (rest) parts.push(UNIDADES[rest]); }
  else { parts.push(DEZENAS[Math.floor(rest / 10)] + (rest % 10 ? ` e ${UNIDADES[rest % 10]}` : "")); }
  return parts.join(" e ");
}

/** Whole number in words, up to the billions ("um mil oitocentos e quarenta e cinco"). */
export function numeroPorExtenso(n: number): string {
  if (n === 0) return "zero";
  const scales: [number, string, string][] = [[1e9, "bilhão", "bilhões"], [1e6, "milhão", "milhões"], [1e3, "mil", "mil"]];
  const groups: { value: number; text: string }[] = [];
  let rest = n;
  for (const [size, singular, plural] of scales) {
    const count = Math.floor(rest / size);
    rest %= size;
    // The team's model writes "um mil" (R$1.845,54 → "um mil oitocentos..."), common in legal texts.
    if (count) groups.push({ value: count * size, text: `${ate999(count)} ${count === 1 ? singular : plural}` });
  }
  if (rest) groups.push({ value: rest, text: ate999(rest) });
  // "e" before the last group when it is under 100 or a round hundred ("mil e cem", "mil e vinte"); otherwise just a space.
  return groups.map((group, index) => {
    if (index === 0) return group.text;
    const last = index === groups.length - 1;
    return last && (group.value < 100 || group.value % 100 === 0) ? `e ${group.text}` : group.text;
  }).join(" ");
}

/** "cinquenta mil reais", "um mil oitocentos e quarenta e cinco reais e cinquenta e quatro centavos". */
export function reaisPorExtenso(value: number): string {
  const cents = Math.round(value * 100);
  const reais = Math.floor(cents / 100), centavos = cents % 100;
  const parts: string[] = [];
  if (reais) {
    const millions = reais >= 1e6 && reais % 1e6 === 0;
    parts.push(`${numeroPorExtenso(reais)}${millions ? " de" : ""} ${reais === 1 ? "real" : "reais"}`);
  }
  if (centavos) parts.push(`${numeroPorExtenso(centavos)} ${centavos === 1 ? "centavo" : "centavos"}`);
  return parts.length ? parts.join(" e ") : "zero reais";
}

/** "R$50.000,00", written without a space, as in the model. */
export const moeda = (value: number) => `R$${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function problemasNotificacao(dados: NotificacaoDados): string[] {
  const problems: string[] = [];
  if (!dados.nome.trim()) problems.push("Falta o nome do cliente.");
  if (!documentoValido(dados.cpf)) problems.push(PROBLEMA_DOCUMENTO);
  if (!(dados.valor > 0)) problems.push("Falta o valor do contrato.");
  if (!(dados.parcelas > 0 && Number.isInteger(dados.parcelas))) problems.push("Falta a quantidade de parcelas.");
  if (!(dados.valorParcela > 0)) problems.push("Falta o valor da parcela.");
  problems.push(...problemasBancoELocal(dados));
  return problems;
}
