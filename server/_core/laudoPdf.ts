import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Content, ContentTable, TDocumentDefinitions, TableCell } from "pdfmake/interfaces";
import { ENCARGO_LABELS, type Encargos, type LaudoDados, type TabelaPrice, calcularLaudo, formatBRL, formatPercent, mesPorExtenso, taxaAnualDe } from "@shared/laudo";
import { PERITO } from "@shared/empresa";
import { renderPdf, safePdfName } from "./pdf";

const FINALIDADE = "Finalidade: instruir ação revisional de contratos bancários.";

const ASSETS = path.resolve(process.cwd(), "server/assets/laudo");
const asset = (file: string) => `data:image/png;base64,${readFileSync(path.join(ASSETS, file)).toString("base64")}`;
/** The accountant's signature is optional: without the image, a blank line to sign by hand. */
const ASSINATURA = existsSync(path.join(ASSETS, "assinatura.png")) ? asset("assinatura.png") : null;

const SECOES = [
  "OBJETIVO",
  "NATUREZA DA PERÍCIA",
  "ELEMENTOS ANALISADOS NA PERÍCIA (CONDIÇÕES GERAIS DO CONTRATO)",
  "CDC – CRÉDITO DIRETO AO CONSUMIDOR",
  "METODOLOGIA DO FINANCIAMENTO COM PRESTAÇÕES FIXAS",
  "DIRETRIZES UTILIZADAS PARA CÁLCULO DAS PARCELAS PELAS INSTITUIÇÕES FINANCEIRAS",
  "DIRETRIZES UTILIZADAS PARA RECÁLCULO DAS PARCELAS EXCLUINDO ENCARGOS FINANCEIROS",
  "COMPARATIVO ENTRE OS CÁLCULOS",
  "CONCLUSÃO",
];
const ROMANOS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"];

const GRAY = "#e7e7e7";
const thin = { hLineWidth: () => 0.6, vLineWidth: () => 0.6, hLineColor: () => "#444", vLineColor: () => "#444", paddingTop: () => 3, paddingBottom: () => 3 };

/** A section title kept on the same page as what comes right after it. */
const secao = (index: number, pageBreak: boolean, ...junto: Content[]): Content => ({
  unbreakable: true,
  pageBreak: pageBreak ? "before" : undefined,
  stack: [{ text: `${ROMANOS[index]}.   ${SECOES[index]}:`, style: "h2" }, ...junto],
});
const paragrafo = (text: string | Content[]): Content => ({ text, style: "body" } as Content);
/** "▷ CÁLCULO CONSIDERANDO…": the font has no ▷, so the triangle is drawn. */
const subtitulo = (text: string): Content => ({
  columns: [
    { width: 13, canvas: [{ type: "polyline", closePath: true, lineWidth: 1, points: [{ x: 1, y: 2 }, { x: 9, y: 6.5 }, { x: 1, y: 11 }] }] },
    { width: "*", text, bold: true, fontSize: 11.5 },
  ],
  margin: [0, 10, 0, 10],
});
/** Blocks kept on one page: a box's title never ends a page with its values on the next. */
const junto = (...blocos: Content[]): Content => ({ unbreakable: true, stack: blocos });
const nota = (text: string): Content => ({ text: [{ text: "NOTAS: ", bold: true }, text], style: "body" });
const encargo = (value: number | null) => (value === null ? "NÃO CONSTA" : formatBRL(value));
const taxas = (dados: LaudoDados) => `${formatPercent(dados.taxaMensal)} A.M. e ${formatPercent(dados.taxaAnual)} A.A.`;
/** The rate the payment implies, monthly to 6 places and yearly to 4, as the accountant writes it ("2,087859% A.M. e 28,1413% A.A."). */
const taxasReais = (mensal: number) => `${formatPercent(mensal * 100, 6)} A.M. e ${formatPercent(taxaAnualDe(mensal * 100), 4)} A.A.`;

/** A gray header row over a white value row, as in the bank's own summary boxes. */
function quadro(headers: string[], values: string[], options: { title?: string; bold?: boolean; widths?: (string | number)[] } = {}): Content {
  const body: TableCell[][] = [];
  if (options.title) body.push([{ text: options.title, colSpan: headers.length, style: "th" }, ...headers.slice(1).map(() => ({ text: "" }))]);
  body.push(headers.map((header) => ({ text: header, style: "th", margin: options.title ? [0, 6, 0, 6] : [0, 0, 0, 0] })));
  body.push(values.map((value) => ({ text: value, alignment: "center", bold: options.bold })));
  return junto({ table: { widths: options.widths ?? headers.map(() => "*"), body }, layout: { ...thin, fillColor: (row: number) => (row < body.length - 1 ? GRAY : null) }, margin: [0, 0, 0, 14], fontSize: 9.5 });
}

function tabelaAmortizacao(tabela: TabelaPrice): ContentTable {
  const money = (value: number) => formatBRL(Math.abs(value) < 0.005 ? 0 : value);
  return {
    table: {
      headerRows: 1,
      widths: [34, 82, 82, 76, 82],
      body: [
        ["MÊS", "PRESTAÇÃO", "AMORTIZAÇÃO", "JUROS", "SALDO DEVEDOR"].map((text) => ({ text, alignment: "center", fillColor: GRAY })),
        ["0", "-", "-", "-", money(tabela.valorFinanciado)].map((text) => ({ text, alignment: "center" })),
        ...tabela.linhas.map((row) => [String(row.mes), money(row.prestacao), money(row.amortizacao), money(row.juros), money(row.saldo)].map((text) => ({ text, alignment: "center" }))),
        [{ text: "TOTAL", alignment: "center", bold: true }, ...[tabela.totalPago, tabela.totalAmortizado, tabela.totalJuros].map((value) => ({ text: formatBRL(value), alignment: "center", bold: true })), { text: "" }],
      ],
    },
    layout: { ...thin, paddingTop: () => 1.2, paddingBottom: () => 1.2 },
    fontSize: 8.5,
    alignment: "center",
    margin: [52, 4, 0, 10],
  };
}

const considerando = (): Content => ({
  stack: [
    { text: "Considerando:", style: "body" },
    { ul: ["Prestação: amortização + juros", "Saldo devedor: saldo anterior – amortização", "Juros: saldo devedor x taxa de juros"], style: "body", margin: [14, 0, 0, 12] },
  ],
});

// pdfmake writes layout data into the objects it lays out, so every block is built fresh where it is used.
const ENCARGO_KEYS = Object.keys(ENCARGO_LABELS) as (keyof Encargos)[];
const encargoHeaders = (keys = ENCARGO_KEYS) => keys.map((key) => ENCARGO_LABELS[key].toUpperCase());
const encargoValues = (encargos: Encargos, keys = ENCARGO_KEYS) => keys.map((key) => encargo(encargos[key]));

/** A comparison table: a gray header over the columns, labels on the left, optionally a DIFERENÇA row across. */
function comparativo(colunas: string[], linhas: [string, ...string[]][], diferenca?: string): Content {
  const body: TableCell[][] = [
    [{ text: "" }, ...colunas.map((text) => ({ text, style: "th", fillColor: GRAY }))],
    ...linhas.map(([label, ...values]) => [{ text: label }, ...values.map((text) => ({ text, bold: true, alignment: "center" as const }))]),
  ];
  if (diferenca) body.push([{ text: "DIFERENÇA:" }, { text: diferenca, colSpan: colunas.length, bold: true, alignment: "center" }, ...colunas.slice(1).map(() => ({ text: "" }))]);
  return junto({ table: { widths: [colunas.length > 2 ? "25%" : "32%", ...colunas.map(() => "*")], body }, layout: thin, fontSize: 9.5, margin: [0, 4, 0, 14] });
}

/** A gray-titled box with one value, as the accountant closes the proveito econômico. */
const caixaTotal = (title: string, value: string): ContentTable => ({
  table: { widths: ["*"], body: [[{ text: title, style: "th", fillColor: GRAY }], [{ text: value, alignment: "center" }]] },
  layout: thin, fontSize: 9.5, margin: [40, 4, 40, 16],
});

export function laudoDefinition(dados: LaudoDados, now = new Date()): TDocumentDefinitions {
  const laudo = calcularLaudo(dados);
  const { original, pactuada, recalculado, alternativo } = laudo;
  const n = String(dados.parcelas);
  // Only the charges that came out of the financed amount head the recalculation's box.
  const chavesRetiradas = ENCARGO_KEYS.filter((key) => key !== "registro" || dados.retirarRegistro);
  const elementos: [string, string][] = [
    ["CONTRATO Nº:", dados.contrato],
    ["CONTRATANTE:", dados.contratante],
    ["INSTITUIÇÃO FINANCEIRA:", dados.instituicao],
    ["OBJETO DO CONTRATO:", dados.objeto || "FINANCIAMENTO"],
    ["VEÍCULO / GARANTIA:", dados.garantia || "NÃO CONSTA"],
    ["VALOR SOLICITADO:", dados.valorSolicitado > 0 ? formatBRL(dados.valorSolicitado) : "NÃO CONSTA"],
    ["VALOR FINANCIADO:", formatBRL(dados.valorFinanciado)],
    ["VALOR DOS JUROS:", formatBRL(original.totalJuros)],
    ["VALOR TOTAL FINANCIADO COM JUROS:", formatBRL(original.totalPago)],
    ["QUANTIDADE DE PARCELAS:", String(dados.parcelas)],
    ["VALOR DA PARCELA:", formatBRL(original.prestacao)],
    ["DATA DE INÍCIO DO CONTRATO:", dados.dataContrato || "NÃO CONSTA"],
    ["DATA DE VENCIMENTO DA 1ª PARCELA:", dados.primeiroVencimento || "NÃO CONSTA"],
    ["TAXA DE JUROS REMUNERATÓRIOS PACTUADA:", taxas(dados)],
    ["TAXA DE JUROS MORATÓRIOS:", dados.jurosMora || "NÃO CONSTA"],
    ["TARIFA DE CADASTRO:", encargo(dados.encargos.cadastro)],
    ["REGISTRO DE CONTRATO:", encargo(dados.encargos.registro)],
    ["TARIFA DE AVALIAÇÃO DE BEM:", encargo(dados.encargos.avaliacao)],
    ["SEGUROS:", encargo(dados.encargos.seguros)],
  ];
  const resumo = (financiado: number, tabela: TabelaPrice) =>
    quadro(["VALOR DO CRÉDITO FINANCIADO", "VALOR DAS PARCELAS", "VALOR TOTAL FINANCIADO"], [formatBRL(financiado), formatBRL(tabela.prestacao), formatBRL(tabela.totalPago)], { bold: true });
  const liberado = (rotulo = "TAXA DE JUROS CONTRATUAL", taxa = taxas(dados)) =>
    quadro(["VALOR DO CRÉDITO LIBERADO", "IOF", rotulo], [dados.valorSolicitado > 0 ? formatBRL(dados.valorSolicitado) : "NÃO CONSTA", formatBRL(dados.iof), taxa], { widths: ["*", 90, "*"] });
  const inclusos = () => quadro(encargoHeaders(), encargoValues(dados.encargos), { title: "ENCARGOS FINANCEIROS INCLUSOS NO VALOR DO CRÉDITO FINANCIADO" });
  const diferenca = (parcela: number, total: number) => `${formatBRL(parcela)} por parcela e ${formatBRL(total)} no financiamento`;

  // VI: one table when the payment matches the written rate; when it does not, the contract at its written
  // rate and then at the rate the payment implies, each with the note the accountant writes under it.
  const calculoBanco: Content[] = pactuada
    ? [
        paragrafo("Observação: Abaixo serão apresentadas 2 planilhas de cálculos considerando todos os valores que compõem o saldo devedor do financiamento, objetivando demonstrar a existência de divergências nas informações contratuais apresentadas."),
        junto(subtitulo("CÁLCULO CONSIDERANDO AS EXATAS CONDIÇÕES APRESENTADAS PELO CONTRATO"), liberado("TAXA EXATA PACTUADA")),
        inclusos(), resumo(dados.valorFinanciado, pactuada), tabelaAmortizacao(pactuada),
        nota(`Considerando o valor financiado (valor do crédito + encargos financeiros + IOF), a quantidade de parcelas (${n}) e a taxa de juros pactuada (${taxas(dados)}), utilizando o sistema de amortização PRICE, encontra-se o valor de parcela de ${formatBRL(pactuada.prestacao)} ao invés de ${formatBRL(original.prestacao)} como informado no contrato.`),
        junto(subtitulo("CÁLCULO CONSIDERANDO A REAL TAXA DE JUROS APLICADA NO CONTRATO"), liberado("TAXA DE JUROS REAL APLICADA", taxasReais(laudo.taxaReal))),
        inclusos(), resumo(dados.valorFinanciado, original), tabelaAmortizacao(original),
        nota(`Considerando o valor financiado (valor do crédito + encargos financeiros + IOF) e a quantidade de parcelas (${n}), para que a parcela fosse de ${formatBRL(original.prestacao)} como indicado no contrato, utilizando sistema price de amortização, seria necessário a aplicação de uma taxa de juros de ${taxasReais(laudo.taxaReal)}`),
      ]
    : [liberado(), inclusos(), resumo(dados.valorFinanciado, original), tabelaAmortizacao(original)];

  // VIII and IX name the columns after what each one is; with a divergence there are three of them.
  const comparacao = pactuada
    ? comparativo(["CONTRATO COM AS CONDIÇÕES ORIGINAIS", "CONTRATO COM AS CONDIÇÕES REALMENTE APLICADAS", "RECÁLCULO COM AS CONDIÇÕES ORIGINAIS"], [
        ["VALOR DO CRÉDITO FINANCIADO:", formatBRL(dados.valorFinanciado), formatBRL(dados.valorFinanciado), formatBRL(recalculado.valorFinanciado)],
        ["TAXA DE JUROS:", taxas(dados), taxasReais(laudo.taxaReal), taxas(dados)],
        ["PARCELA:", formatBRL(pactuada.prestacao), formatBRL(original.prestacao), formatBRL(recalculado.prestacao)],
        ["QTDE PARCELAS:", n, n, n],
      ])
    : comparativo(["CONTRATO ORIGINAL", "CONTRATO RECALCULADO"], [
        ["VALOR DO CRÉDITO FINANCIADO:", formatBRL(dados.valorFinanciado), formatBRL(recalculado.valorFinanciado)],
        ["TAXA DE JUROS:", taxas(dados), taxas(dados)],
        ["PARCELA:", formatBRL(original.prestacao), formatBRL(recalculado.prestacao)],
        ["QTDE PARCELAS:", n, n],
      ], diferenca(laudo.diferencaParcela, laudo.diferencaTotal));
  const taxaAplicada = pactuada ? taxasReais(laudo.taxaReal) : taxas(dados);
  const proveitos: Content[] = [
    junto(subtitulo("PROVEITO ECONÔMICO PRETENDIDO:"),
    comparativo([pactuada ? "CONTRATO COM AS CONDIÇÕES REALMENTE APLICADAS" : "CONTRATO ORIGINAL", pactuada ? "RECÁLCULO COM AS CONDIÇÕES ORIGINAIS" : "CONTRATO RECALCULADO"], [
      ["VALOR DO CRÉDITO FINANCIADO:", formatBRL(dados.valorFinanciado), formatBRL(recalculado.valorFinanciado)],
      ["TAXA DE JUROS:", taxaAplicada, taxas(dados)],
      ["PARCELA:", formatBRL(original.prestacao), formatBRL(recalculado.prestacao)],
      ["QTDE PARCELAS:", n, n],
    ], diferenca(laudo.diferencaParcela, laudo.diferencaTotal))),
    caixaTotal("TOTAL DO PROVEITO ECONÔMICO", formatBRL(laudo.diferencaTotal)),
    ...(pactuada && alternativo
      ? [
          junto(subtitulo("PROVEITO ECONÔMICO ALTERNATIVO:"),
          comparativo(["CONTRATO COM AS CONDIÇÕES REALMENTE APLICADAS", "CONTRATO COM AS CONDIÇÕES ORIGINAIS"], [
            ["VALOR DO CRÉDITO FINANCIADO:", formatBRL(dados.valorFinanciado), formatBRL(dados.valorFinanciado)],
            ["TAXA DE JUROS:", taxasReais(laudo.taxaReal), taxas(dados)],
            ["PARCELA:", formatBRL(original.prestacao), formatBRL(pactuada.prestacao)],
            ["QTDE PARCELAS:", n, n],
          ], diferenca(alternativo.diferencaParcela, alternativo.diferencaTotalParcelas))),
          quadro(["ENCARGOS A SEREM RESTITUÍDOS", "DIFERENÇA ENTRE AS PARCELAS"], [formatBRL(alternativo.encargosRestituidos), formatBRL(alternativo.diferencaTotalParcelas)]),
          caixaTotal("TOTAL DO PROVEITO ECONÔMICO", formatBRL(alternativo.total)),
        ]
      : []),
  ];

  return {
    pageSize: "A4",
    pageMargins: [56, 50, 56, 56],
    info: { title: `Parecer técnico – ${dados.contratante} – contrato ${dados.contrato}`, author: PERITO.nome },
    defaultStyle: { font: "Roboto", fontSize: 10.5, lineHeight: 1.25, color: "#111" },
    styles: {
      h1: { fontSize: 26, bold: true, alignment: "center" },
      h2: { fontSize: 14, bold: true, margin: [0, 18, 0, 10] },
      body: { fontSize: 10.5, lineHeight: 1.6, alignment: "justify", margin: [0, 0, 0, 8] },
      th: { bold: true, alignment: "center", fontSize: 9 },
    },
    footer: (page) => ({
      margin: [56, page === 1 ? 0 : 18, 56, 0],
      columns: [
        { width: 40, text: "" },
        { width: "*", text: page === 1 ? [FINALIDADE, "\n", mesPorExtenso(now)] : "", alignment: "center", fontSize: 9 },
        { width: 40, text: `p. ${page}`, alignment: "right", fontSize: 10, margin: [0, page === 1 ? 18 : 0, 0, 0] },
      ],
    }),
    content: [
      // Capa
      { image: asset("logo.png"), width: 230, alignment: "center", margin: [0, 10, 0, 0] },
      {
        table: { widths: ["auto"], body: [[{ text: "PARECER TÉCNICO", style: "h1", margin: [28, 10, 28, 6] }]] },
        layout: { hLineWidth: () => 1.6, vLineWidth: () => 1.6 },
        alignment: "center", margin: [98, 140, 0, 0],
      },

      // Sumário
      { text: "SUMÁRIO", fontSize: 18, bold: true, alignment: "center", pageBreak: "before", margin: [0, 0, 0, 22] },
      {
        table: { widths: [44, "*"], body: SECOES.map((title, index) => [`${ROMANOS[index]}.`, title]) },
        layout: "noBorders", fontSize: 9.5, lineHeight: 1.3,
      },

      secao(0, true, paragrafo(`O presente cálculo tem por objetivo realizar uma análise das condições gerais do financiamento nº ${dados.contrato} firmado entre ${dados.contratante} e ${dados.instituicao}, para aplicabilidade da taxa de juros remuneratórios pactuada, sob o sistema PRICE, considerando o saldo devedor final sem acréscimos de encargos financeiros específicos que serão detalhados no item VII.`)),
      secao(1, false, paragrafo("O trabalho apresentado busca verificar as condições da operação financeira mencionada acima e a taxa de juros pactuada sob um novo saldo devedor em consonância com o ordenamento jurídico pátrio.")),
      secao(2, false, {
        table: { widths: ["48%", "*"], body: elementos.map(([label, value]) => [{ text: label, bold: true }, value]) },
        layout: { ...thin, paddingTop: () => 1.5, paddingBottom: () => 1.5 }, fontSize: 9, margin: [0, 4, 0, 0],
      }),

      secao(3, true, paragrafo("O CRÉDITO DIRETO AO CONSUMIDOR (CDC) é uma modalidade de crédito que visa facilitar o processo de compra. A quantia liberada varia caso a caso após a análise de alguns fatores, como por exemplo:")),
      { ol: ["Renda e tempo de trabalho;", "Finalidade do crédito;", "Histórico, capacidade e situação financeira;", "Quantidade e valor de bens em nome próprio."], style: "body", margin: [14, 0, 0, 10] },
      paragrafo("Esse acesso desburocratizado, dentro de um limite pré-aprovado, condiciona o indivíduo à devolução, de forma parcelada, dos valores obtidos, pagando para tanto, juros pré-fixados no momento do acordo."),
      secao(4, false, paragrafo("O financiamento com prestações fixas, ou seja, aqueles realizados por meio do sistema price de amortização, são utilizados para a aquisição de bens duráveis e possuem as seguintes características:")),
      { ol: ["Prestações constantes;", "Amortização crescente;", "Juros sobre o saldo devedor;"], style: "body", margin: [14, 0, 0, 10] },
      paragrafo("Utilizamos a seguinte metodologia para cálculo das parcelas considerando os juros compostos e capitalização mensal:"),
      {
        table: {
          widths: ["auto", "auto"],
          body: [[
            { text: "PMT = PV ×", bold: true, fontSize: 13, margin: [10, 13, 4, 0] },
            {
              stack: [
                { text: ["(1+i)", { text: "n", sup: true }, " . i"], bold: true, fontSize: 13, alignment: "center" },
                { canvas: [{ type: "line", x1: 0, y1: 2, x2: 92, y2: 2, lineWidth: 1 }] },
                { text: ["(1+i)", { text: "n", sup: true }, " - 1"], bold: true, fontSize: 13, alignment: "center", margin: [0, 2, 0, 0] },
              ],
              margin: [0, 4, 10, 4],
            },
          ]],
        },
        layout: { hLineWidth: () => 1, vLineWidth: (index: number) => (index === 1 ? 0 : 1) },
        margin: [150, 6, 0, 14],
      },
      paragrafo("Onde:"),
      paragrafo("PMT = Valor da prestação."),
      paragrafo("PV = Valor financiado."),
      paragrafo("i = Taxa de juros mensal."),
      paragrafo("N = Número de prestações"),

      secao(5, false,
        { text: "Base de cálculo:", bold: true, margin: [0, 0, 0, 4] },
        paragrafo("Valor líquido do crédito liberado + encargos financeiros (tarifas e produtos e serviços) + IOF + taxa de juros contratual + sistema de amortização price.")),
      considerando(),
      ...calculoBanco,

      secao(6, false,
        { text: "Base de cálculo:", bold: true, margin: [0, 0, 0, 4] },
        paragrafo("Valor líquido do crédito liberado + IOF + taxa de juros contratual + sistema de amortização price - encargos financeiros (tarifas e produtos e serviços).")),
      considerando(),
      liberado(),
      quadro(encargoHeaders(chavesRetiradas), encargoValues(dados.encargos, chavesRetiradas), { title: "ENCARGOS FINANCEIROS RETIRADOS DO VALOR DO CRÉDITO FINANCIADO" }),
      resumo(recalculado.valorFinanciado, recalculado),
      ...(laudo.registroMantido
        ? [nota(`O valor do registro de contrato (${formatBRL(dados.encargos.registro ?? 0)}) não foi retirado do recálculo por não ultrapassar o valor na tabela do Detran.`)]
        : []),
      tabelaAmortizacao(recalculado),
      paragrafo("O recálculo das prestações foi efetuado com base na exclusão das cobranças de encargos financeiros, reduzindo assim o valor financiado e consequentemente o valor das prestações sem alteração das condições contratuais."),

      secao(7, false, comparacao),

      secao(8, false, paragrafo("Considerando os encargos previstos e a diferença entre as parcelas, a perícia conclui o trabalho com os seguintes apontamentos.")),
      ...proveitos,
      {
        unbreakable: true,
        stack: [
          ASSINATURA
            ? { image: ASSINATURA, width: 190, alignment: "center", margin: [0, 18, 0, 0] }
            : { canvas: [{ type: "line", x1: 120, y1: 0, x2: 340, y2: 0, lineWidth: 0.8, lineColor: "#333" }], margin: [0, 60, 0, 4] },
          { text: PERITO.nome, bold: true, alignment: "center", fontSize: 12 },
          { text: PERITO.cargo, alignment: "center", fontSize: 8.5, margin: [0, 4, 0, 0] },
          { text: PERITO.registro, alignment: "center", fontSize: 8.5, margin: [0, 4, 0, 0] },
        ],
      },
    ],
  };
}

export const buildLaudoPdf = (dados: LaudoDados, now = new Date()) => renderPdf(laudoDefinition(dados, now));

/** "Laudo - MARIA ODETE - 663795516.pdf" */
export const laudoFileName = (dados: LaudoDados) => safePdfName(`Laudo - ${dados.contratante.split(" ").slice(0, 2).join(" ")} - ${dados.contrato}`);
