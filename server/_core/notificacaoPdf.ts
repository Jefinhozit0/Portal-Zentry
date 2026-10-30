import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import { flexiona } from "@shared/genero";
import { ehCnpj, formatDocumento, tipoDocumento } from "@shared/procuracao";
import { EMPRESA, correspondencia } from "@shared/empresa";
import { type NotificacaoContratoDados, type NotificacaoDados, dataPorExtenso, moeda, reaisPorExtenso } from "@shared/notificacao";
import { renderPdf, safePdfName } from "./pdf";

/**
 * Notificações extrajudiciais, laid out like the team's Word models: the "manual" one asks the bank
 * for the contract; the "com contrato" one contests the interest rate of a contract the client has.
 */

const PAGE_WIDTH = 595.28;
const MARGIN_LEFT = 92, MARGIN_RIGHT = 80;
/** "e-mail" with a non-breaking hyphen, so justified lines never split it into "e- mail". */
const EMAIL = "e‑mail";
const body = (text: Content): Content => ({ text, style: "body" } as Content);

/**
 * Gray rule on top, the title, then the content. rodape: the company's "Em prestação de serviços jurídicos"
 * line on every page (the manual model has it, the com-contrato one does not).
 */
function pagina(titulo: string, content: Content[], { rodape = true } = {}): TDocumentDefinitions {
  return {
    pageSize: "A4",
    // The manual one fits on one page, signature included, even with a long bank address; the com-contrato one may take two.
    pageMargins: [MARGIN_LEFT, 66, MARGIN_RIGHT, rodape ? 60 : 50],
    info: { title: titulo, author: EMPRESA.nome.toUpperCase() },
    defaultStyle: { font: "Roboto", fontSize: 10.5, color: "#1a1a1a" },
    styles: {
      body: { lineHeight: 1.5, alignment: "justify", margin: [0, 0, 0, 10] },
      recuo: { lineHeight: 1.5, alignment: "justify", margin: [0, 0, 0, 8], leadingIndent: 28 },
    },
    background: () => ({ canvas: [{ type: "line", x1: 72, y1: 42, x2: PAGE_WIDTH, y2: 42, lineWidth: 1.4, lineColor: "#b3b3b3" }] }),
    footer: rodape ? () => ({
      text: `Em prestação de serviços jurídicos para ${EMPRESA.nomeCurto.toUpperCase()} - CNPJ nº ${EMPRESA.cnpj} – sediada em ${EMPRESA.sede}.`,
      bold: true, fontSize: 8, lineHeight: 1.15, margin: [MARGIN_LEFT, 18, MARGIN_RIGHT, 0],
    }) : undefined,
    content: [{ text: "NOTIFICAÇÃO EXTRAJUDICIAL", bold: true, fontSize: 13, alignment: "center", margin: [0, 0, 0, 20] }, ...content],
  };
}

/**
 * The signature of the company's representative (server/assets/notificacao/assinatura.png) over the
 * line with name and CNPJ, which closes both notificações; the com-contrato one adds the CDC footnote
 * below. They stay together: when they do not fit after the text, they go to the next page whole.
 * Without the image, the line is left blank to sign by hand.
 */
const ASSINATURA_FILE = path.resolve(process.cwd(), "server/assets/notificacao/assinatura.png");
const ASSINATURA = existsSync(ASSINATURA_FILE) ? `data:image/png;base64,${readFileSync(ASSINATURA_FILE).toString("base64")}` : null;
const assinatura = (nota?: Content): Content => ({
  unbreakable: true,
  stack: [
    { text: "Cordialmente,", margin: [56, 6, 0, ASSINATURA ? 0 : 26] },
    ...(ASSINATURA ? [{ image: ASSINATURA, fit: [170, 88], alignment: "center", margin: [0, 0, 0, -4] } as Content] : []),
    { canvas: [{ type: "line", x1: 0, y1: 0, x2: PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT, y2: 0, lineWidth: 0.8, lineColor: "#333" }] },
    { text: EMPRESA.nome.toUpperCase(), bold: true, alignment: "center", margin: [0, 8, 0, 4] },
    { text: `CNPJ: ${EMPRESA.cnpj}`, bold: true, alignment: "center" },
    ...(nota ? [nota] : []),
  ],
});

/** "inscrito(a) no CPF", or for a company "pessoa jurídica de direito privado, inscrita no CNPJ". */
function qualificacaoCliente(dados: { cpf: string; genero: NotificacaoDados["genero"] }) {
  return ehCnpj(dados.cpf) ? "pessoa jurídica de direito privado, inscrita no CNPJ" : `${flexiona("inscrito", "inscrita", dados.genero)} no CPF`;
}

export function notificacaoDefinition(dados: NotificacaoDados): TDocumentDefinitions {
  const nome = dados.nome.trim().toUpperCase();
  const qualificacao = `${dados.bancoNome.trim()}, pessoa jurídica de direito privado, inscrita no CNPJ sob o n° ${dados.bancoCnpj.trim()}, com sede em ${dados.bancoEndereco.trim().replace(/\.$/, "")}.`;
  return pagina(`Notificação extrajudicial – ${nome}`, [
    body(dataPorExtenso(dados.cidade, dados.data)),
    body(`À Instituição financeira ${qualificacao}`),
    body([
      `A ${EMPRESA.nome}, vem, por meio de procurador qualificado na procuração em anexo, em nome de `,
      { text: nome, bold: true },
      `, ${qualificacaoCliente(dados)} nº `,
      { text: formatDocumento(dados.cpf), bold: true },
      ", apresentar a presente ",
      { text: "NOTIFICAÇÃO EXTRAJUDICIAL", bold: true },
      ` destinada a obter o contrato de ${dados.modalidade} no valor de ${moeda(dados.valor)} (${reaisPorExtenso(dados.valor)}), a serem pagos em ${dados.parcelas} parcelas de ${moeda(dados.valorParcela)} (${reaisPorExtenso(dados.valorParcela)}).`,
    ]),
    body([
      `O documento solicitado deverá ser encaminhado, preferencialmente de forma eletrônica, através do seguinte endereço de ${EMAIL} `,
      { text: `${EMPRESA.email},`, bold: true },
      ` ou por correspondência física na ${correspondencia()}.`,
    ]),
    body(`Por fim, caso a apresentação do contrato somente seja possível mediante pagamento de taxa administrativa, solicito que informe, através do ${EMAIL} acima:`),
    {
      table: { widths: [36, "*"], body: [["(i)", "valor a ser pago;"], ["(ii)", "forma de pagamento;"], ["(iii)", "cláusula contratual que permite a cobrança."]] },
      layout: "noBorders", margin: [62, -4, 0, 12], lineHeight: 1.35,
    },
    body("O não envio do documento, no prazo de 7 (sete) dias úteis, será tido como recusa tácita de seu fornecimento, permitindo o provimento judicial para sua obtenção neste sentido e, mais, eventualmente a reparação do dano ocasionado pelo não fornecimento de documento útil a discutir direitos do consumidor."),
    assinatura(),
  ]);
}

const CDC: Content[] = [
  { text: "¹ Preceitua o Código de Defesa do Consumidor:", margin: [0, 0, 0, 5] },
  { text: "“Art. 6º São direitos básicos do consumidor:" },
  { text: "VI - a efetiva prevenção e reparação de danos patrimoniais e morais, individuais, coletivos e difusos;”.", margin: [0, 0, 0, 5] },
  { text: "“Art. 42: Na cobrança de débitos, o consumidor inadimplente não será exposto a ridículo, nem será submetido a qualquer tipo de constrangimento ou ameaça." },
  { text: "P. único. “O consumidor cobrado em quantia indevida tem direito à repetição do indébito, por valor igual ao dobro do que pagou em excesso, acrescido de correção monetária e juros legais, salvo hipótese de engano justificável.”" },
];

export function notificacaoContratoDefinition(dados: NotificacaoContratoDados): TDocumentDefinitions {
  const nome = dados.nome.trim().toUpperCase();
  const taxa = `${dados.taxaMensal.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}% a.m.`;
  return pagina(`Notificação extrajudicial – ${nome} – contrato ${dados.contrato}`, [
    body(dataPorExtenso(dados.cidade, dados.data)),
    body(`À Instituição financeira ${dados.bancoNome.trim()}, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº ${dados.bancoCnpj.trim()}, com sede em ${dados.bancoEndereco.trim().replace(/\.$/, "")}.`),
    body([
      `A ${EMPRESA.nome} vem, por meio de procurador qualificado na procuração em anexo, em nome de `,
      { text: nome, bold: true },
      `, ${qualificacaoCliente(dados).replace(/ (CPF|CNPJ)$/, "")} `,
      { text: `${tipoDocumento(dados.cpf)} nº ${formatDocumento(dados.cpf)}`, bold: true },
      `, manifestar sua irresignação acerca do contrato de ${dados.modalidade} `,
      { text: `Nº ${dados.contrato.trim()}.`, bold: true },
    ]),
    { text: "01. DOS JUROS REMUNERATÓRIOS", bold: true, margin: [0, 8, 0, 8] },
    { text: "Há uma injustificável diferença entre a taxa de juros contratada e a taxa realmente aplicada.", style: "recuo" },
    { text: "A análise de eventual abusividade das taxas de juros contratadas é possível em mútuo quando o pagamento é realizado através de parcelas iguais e prefixadas.", style: "recuo" },
    { text: "O método utilizado para averiguação da legalidade do cálculo confrontou a taxa aplicada pela instituição financeira junto às taxas fixadas no respectivo instrumento.", style: "recuo" },
    { text: `Constando no respectivo instrumento a aplicação de uma taxa de ${taxa}, porém, a realmente pactuada foi maior do que consta em contrato, que em reais remonta uma diferença por parcela. Logo, pegando o valor residual do número de parcelas, resulta no valor pago a mais, o qual requer-se a devolução.`, style: "recuo" },
    body([
      "Assim, com o intuito de solucionarmos extrajudicialmente a questão e devido ao respaldo legal no Código de Defesa do Consumidor",
      { text: "1", sup: true },
      ", requer-se a devolução dos valores apontados acima em até 30 (trinta) dias úteis.",
    ]),
    body("O atendimento dessa notificação extrajudicial por V. Sª evitará o ajuizamento de ação judicial própria, bem como aborrecimentos e despesas indesejáveis."),
    body("Decorrido o prazo in albis, entender-se-á que a presente notificação foi desconsiderada, possibilitando, pois, a busca pelo amparo judicial."),
    body("Nos colocamos à disposição para discutir eventuais acordos."),
    // The footnote of the CDC reference goes below the signature, as in the model.
    assinatura({
      stack: [
        { canvas: [{ type: "line", x1: 0, y1: 0, x2: 150, y2: 0, lineWidth: 0.8, lineColor: "#333" }], margin: [0, 26, 0, 5] },
        { stack: CDC, fontSize: 8, lineHeight: 1.2, alignment: "justify" },
      ],
    }),
  ], { rodape: false });
}

export const buildNotificacaoPdf = (dados: NotificacaoDados) => renderPdf(notificacaoDefinition(dados));
export const buildNotificacaoContratoPdf = (dados: NotificacaoContratoDados) => renderPdf(notificacaoContratoDefinition(dados));

/** "Notificação extrajudicial - MARIA DA SILVA.pdf" */
export const notificacaoFileName = (dados: NotificacaoDados) => safePdfName(`Notificação extrajudicial - ${dados.nome.trim().toUpperCase()}`);
/** "Notificação extrajudicial com contrato - MARIA DA SILVA - 147126013.pdf" */
export const notificacaoContratoFileName = (dados: NotificacaoContratoDados) => safePdfName(`Notificação extrajudicial com contrato - ${dados.nome.trim().toUpperCase()} - ${dados.contrato.trim()}`);
