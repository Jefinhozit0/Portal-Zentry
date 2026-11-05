import { readFileSync } from "node:fs";
import path from "node:path";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import { type CcmaDados, ITENS_CCMA, partesData } from "@shared/ccma";
import { renderPdf } from "./pdf";

/**
 * The PDF of the approved form, laid out like the CCMA's model: gold band, logo and contacts from its Word file,
 * fixed texts as they are written there (their spelling is the Câmara's). The font is the portal's Roboto.
 */

const imagem = (nome: string) => `data:image/png;base64,${readFileSync(path.resolve(process.cwd(), "server/assets/ccma", nome)).toString("base64")}`;
const OURO = "#A27C37", CINZA = "#D9D9D9";
const FAIXA = [{ x: 0, y: 0 }, { x: 595.28, y: 0 }, { x: 595.28, y: 79 }, { x: 426.7, y: 40.6 }, { x: 0, y: 40.6 }];

/** Tight rows and thin borders, like the Word tables. */
const GRADE = { hLineWidth: () => 0.6, vLineWidth: () => 0.6, paddingTop: () => 0, paddingBottom: () => 0, paddingLeft: () => 5, paddingRight: () => 5 };

const tituloSecao = (text: string, margemTopo: number): Content => ({
  table: { widths: ["*"], body: [[{ text, bold: true, alignment: "center", fillColor: CINZA, fontSize: 9.5 }]] },
  layout: GRADE,
  margin: [0, margemTopo, 0, 0],
});
const linhas = (rows: Content[]): Content => ({
  table: { widths: ["*"], body: rows.map((row) => [row]) },
  layout: GRADE,
  margin: [7, 0, 5, 0], fontSize: 9.5, bold: true,
});

export function ccmaDefinition(dados: CcmaDados): TDocumentDefinitions {
  const { reclamante: r, reclamado } = dados;
  const data = partesData(dados.data);
  if (!data) throw new Error("Data inválida.");
  return {
    pageSize: "A4",
    pageMargins: [51.5, 70, 54, 70],
    info: { title: `Formulário de solicitação CCMA – ${r.nome.trim().toUpperCase()}`, author: "CCMA - CÂMARA DE CONCILIAÇÃO" },
    defaultStyle: { font: "Roboto", fontSize: 11, color: "#111111" },
    background: () => [
      { canvas: [{ type: "polyline", closePath: true, color: OURO, lineColor: OURO, points: FAIXA }] },
      { image: imagem("logo.png"), width: 130, absolutePosition: { x: 0, y: 33 } },
      { image: imagem("contatos.png"), width: 115, absolutePosition: { x: 20, y: 755 } },
    ] as Content,
    content: [
      { text: "CCMA - CÂMARA DE CONCILIAÇÃO", bold: true, alignment: "center" },
      { text: "São Caetano do Sul – SP - CEP 09520-070", alignment: "center" },
      { text: "Horário de atendimento: das 08: 00 horas às 12:00 horas", alignment: "center" },
      { text: "e das 13:00hrs às 17:00 horas", alignment: "center" },
      tituloSecao("FORMULÁRIO PARA SOLIÇITAÇÃO DE AGENDAMENTO DE AUDIÊNCIA EXTRAJUDICIAL DE CONCILIAÇÃO", 14),
      {
        table: { widths: ["*"], body: [[{ stack: [{ text: "1) DESCREVA SEU PEDIDO", bold: true }, { text: dados.pedido.trim(), bold: true, alignment: "center" }] }]] },
        layout: GRADE, fontSize: 9.5,
      },
      tituloSecao("2) RECLAMANTE: (é quem está pedindo a abertura da reclamação, mesmo que seja menor de idade)", 22),
      linhas([
        { text: `NOME COMPLETO: ${r.nome.trim()}` },
        { text: `RG: ${r.rg.trim()}` },
        { text: `CPF/ CNPJ: ${r.documento.trim()}` },
        { text: `PROFISSÃO: ${r.profissao.trim() || "(opcional)"}` },
        { text: `ESTADO CIVIL: ${r.estadoCivil.trim()}` },
        { text: `TELEFONE: ${r.telefone.trim()}\nWHATSAPP: ${r.whatsapp}` },
        { text: `E-MAIL: ${r.email.trim() || "(opcional)"}` },
      ]),
      tituloSecao("3) RECLAMADO: (é a pessoa ou empresa que você está fazendo a reclamação).", 22),
      linhas([
        { text: `NOME COMPLETO: ${reclamado.nome.trim()}` },
        { text: `CPF/ CNPJ: ${reclamado.documento.trim()}` },
      ]),
      tituloSecao("4) DESCREVA SEU PEDIDO: (O que você deseja da parte reclamada para que o conflito seja encerrado)", 22),
      {
        margin: [61, 18, 0, 6], fontSize: 10.5,
        stack: dados.itens.map((item) => {
          const { rotulo } = ITENS_CCMA.find(({ id }) => id === item.id)!;
          return {
            margin: [0, 0, 0, 14],
            text: item.id === "observacoes"
              ? [{ text: rotulo.replace(/:$/, ""), bold: true, fontSize: 9.5 }, { text: `: ${item.texto.trim()}`, background: "yellow" }]
              : [{ text: `${rotulo} `, bold: true, fontSize: 9.5 }, { text: item.texto.trim(), background: "yellow" }],
          } as Content;
        }),
      },
      tituloSecao("5) REMUNERAÇÃO DO CONCILIADOR – HONORARIOS DA CAMARA DE CONCILIAÇÃO", 0),
      {
        text: "A PARTE ESTÁ CIENTE E CONCORDA COM A REMUNERAÇÃO DO CONCILIADOR, QUE SERÁ CUSTEADA PELA PARTE SOLICITANTE. A PARTE ESTA CIENTES E CONCORDA COM OS HONORÁRIOS DA CÂMARA DE CONCILIAÇÃO, QUE SERÁ CUSTEADA PELA PARTE SOLICITANTE.",
        alignment: "justify", fontSize: 10.5, margin: [0, 2, 0, 0],
      },
      { text: `São Caetano do sul, ${data.diaMes} de ${data.ano}`, bold: true, alignment: "center", margin: [0, 26, 0, 0] },
    ],
  };
}

export const buildCcmaPdf = (dados: CcmaDados) => renderPdf(ccmaDefinition(dados));
