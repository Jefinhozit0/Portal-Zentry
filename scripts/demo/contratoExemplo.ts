/**
 * A made-up vehicle financing contract (CDC), for demos of "Ler contrato (PDF)": the portal's reader
 * finds every field in it. The written rate (1,79% a.m.) is below the one the payments imply, as in
 * the contracts the notificação com contrato contests. Usage: npx tsx scripts/demo/contratoExemplo.ts out.pdf
 */
import { writeFileSync } from "node:fs";
import type { Content } from "pdfmake/interfaces";
import { pmt } from "../../shared/laudo";
import { renderPdf } from "../../server/_core/pdf";

const brl = (value: number) => `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const liberado = 62000, seguro = 2480, cadastro = 1190, avaliacao = 450, registro = 305.97, iof = 1402.5;
const financiado = Math.round((liberado + seguro + cadastro + avaliacao + registro + iof) * 100) / 100;
const parcelas = 48;
const taxaReal = 0.0205;
const parcela = Math.round(pmt(financiado, taxaReal, parcelas) * 100) / 100;

const line = (text: string, options: Record<string, unknown> = {}): Content => ({ text, margin: [0, 0, 0, 7], ...options } as Content);
const row = (label: string, value: string): Content => ({ columns: [{ text: label, width: "*" }, { text: value, width: 120, alignment: "right" }], margin: [0, 0, 0, 7] });

const content: Content[] = [
  line("BANCO VOTORANTIM S.A. CNPJ: 59.588.111/0001-03", { bold: true }),
  line("CÉDULA DE CRÉDITO BANCÁRIO - FINANCIAMENTO DE VEÍCULO (CDC)", { bold: true }),
  line("CONTRATO Nº 2025-0047813"),
  line("DOCUMENTO DE DEMONSTRAÇÃO - DADOS FICTÍCIOS", { color: "#b00", margin: [0, 0, 0, 14] }),
  line("Nome do Cliente: MARIANA COSTA RIBEIRO"),
  line("CPF: 000.101.207-00"),
  line("Endereço, fone de contato e e-mail: RUA DAS ACÁCIAS, 133 - CENTRO - 13010-100 - CAMPINAS SP (19)"),
  line("90000-1037 - MARIANA.CLIENTE@EXEMPLO.COM.BR", { margin: [0, 0, 0, 14] }),
  line("Marca: VOLKSWAGEN"),
  line("Modelo: POLO TRACK 1.0"),
  line("Ano/Modelo: 2023", { margin: [0, 0, 0, 14] }),
  row("Valor Líquido Liberado", brl(liberado)),
  row("Seguro Prestamista: PROTEÇÃO FINANCEIRA", brl(seguro)),
  row("Tarifa de Cadastro", brl(cadastro)),
  row("Tarifa de Avaliação de bem", brl(avaliacao)),
  row("Registro contrato - órgão de trânsito - financiado:", brl(registro)),
  row("Total de impostos a serem financiados", brl(iof)),
  row("VALOR TOTAL FINANCIADO (COM IMPOSTOS)", brl(financiado)),
  line(`Número de Parcelas mensais: ${parcelas}`, { margin: [0, 7, 0, 7] }),
  line("Data do 1º Vencimento: 15/03/2025"),
  line("Taxa de juros remuneratórios mensal: % a.m.: 1,79% anual: % a.a.: 23,73%"),
  row("Valor de cada parcela mensal", brl(parcela)),
  line("Assinado eletronicamente por MARIANA COSTA RIBEIRO em sexta-feira, 14 de fevereiro de 2025", { margin: [0, 24, 0, 0], fontSize: 9 }),
];

const out = process.argv[2] ?? "contrato-exemplo.pdf";
writeFileSync(out, await renderPdf({ pageSize: "A4", pageMargins: [56, 56, 56, 56], defaultStyle: { font: "Roboto", fontSize: 10.5 }, content }));
console.log(`${out}: financiado ${brl(financiado)}, ${parcelas} × ${brl(parcela)}`);
