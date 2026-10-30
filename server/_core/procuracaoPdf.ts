import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import { EMPRESA } from "@shared/empresa";
import { PODERES, type ProcuracaoDados, formatCEP, formatDocumento, localEData, tipoDocumento, nomeProprio } from "@shared/procuracao";
import { renderPdf, safePdfName } from "./pdf";

/** Procuração extrajudicial, laid out like the team's Word model: gray title band, two boxes, powers, place/date and signature line. */

const BAND = "#595959";
const TEXT = "#3a3a3a";
const PAGE_WIDTH = 595.28;
const GAVEL = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${TEXT}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m14.5 12.5-8 8a2.119 2.119 0 1 1-3-3l8-8"/><path d="m16 16 6-6"/><path d="m8 8 6-6"/><path d="m9 7 8 8"/><path d="m21 11-8-8"/></svg>`;

const box = (title: string, rows: string[][]): Content => ({
  table: {
    widths: ["*"],
    body: [[{
      stack: [
        { text: title, bold: true, fontSize: 11.5, margin: [0, 0, 0, 3] },
        ...rows.map(([label, value]) => ({ text: [`${label}: `, value], fontSize: 10, lineHeight: 1.45 })),
      ],
      margin: [2, 1, 2, 12],
    }]],
  },
  layout: { hLineWidth: () => 1.3, vLineWidth: () => 1.3, hLineColor: () => "#333", vLineColor: () => "#333", paddingLeft: () => 3, paddingRight: () => 3, paddingTop: () => 1, paddingBottom: () => 1 },
  margin: [0, 0, 0, 4],
});

export function procuracaoDefinition(dados: ProcuracaoDados): TDocumentDefinitions {
  return {
    pageSize: "A4",
    pageMargins: [100, 30, 78, 40],
    info: { title: `Procuração extrajudicial – ${nomeProprio(dados.nome)}`, author: EMPRESA.nome },
    defaultStyle: { font: "Roboto", color: TEXT },
    background: () => ({
      canvas: [
        { type: "rect", x: 0, y: 0, w: PAGE_WIDTH, h: 66, color: BAND },
        { type: "line", x1: 64, y1: 50, x2: PAGE_WIDTH - 50, y2: 50, lineWidth: 1.2, lineColor: "#ffffff" },
      ],
    }),
    content: [
      { text: "PROCURAÇÃO EXTRAJUDICIAL", color: "#ffffff", bold: true, fontSize: 24, alignment: "center", margin: [-60, -14, -30, 46] },
      box("OUTORGANTE", [
        ["Nome", nomeProprio(dados.nome)],
        [tipoDocumento(dados.cpf), formatDocumento(dados.cpf)],
        ["Endereço", dados.endereco.trim()],
        ["CEP", formatCEP(dados.cep)],
        ["E-mail", dados.email.trim()],
      ]),
      box("OUTORGADO", [
        ["Nome", EMPRESA.nome],
        ["CNPJ nº", EMPRESA.cnpj],
        ["Endereço", EMPRESA.sede],
        ["E-mail", EMPRESA.email],
      ]),
      { svg: GAVEL, width: 40, margin: [70, -12, 0, 0] },
      { text: "PODERES", bold: true, fontSize: 11, margin: [0, 2, 0, 22] },
      {
        columns: [
          { width: 14, canvas: [{ type: "ellipse", x: 3.5, y: 8, r1: 3.2, r2: 3.2, color: TEXT }] },
          { text: PODERES, fontSize: 12.5, lineHeight: 1.3, alignment: "justify" },
        ],
        margin: [-12, 0, 0, 22],
      },
      { text: localEData(dados), fontSize: 10.5, alignment: "center", margin: [0, 0, 0, 30] },
      { text: "x", bold: true, fontSize: 11, margin: [8, 0, 0, 14] },
      { canvas: [{ type: "line", x1: 72, y1: 0, x2: 390, y2: 0, lineWidth: 1, lineColor: "#444" }] },
    ],
  };
}

export const buildProcuracaoPdf = (dados: ProcuracaoDados) => renderPdf(procuracaoDefinition(dados));

/** "Procuração extrajudicial - MARIA DA SILVA.pdf" */
export const procuracaoFileName = (dados: ProcuracaoDados) => safePdfName(`Procuração extrajudicial - ${nomeProprio(dados.nome)}`);
