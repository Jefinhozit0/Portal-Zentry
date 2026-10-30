import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import { flexiona } from "@shared/genero";
import { ehCnpj, formatDocumento } from "@shared/procuracao";
import { EMPRESA } from "@shared/empresa";
import { type TermoDados } from "@shared/termo";
import { renderPdf, safePdfName } from "./pdf";

/** Termo de conhecimento de prestação de serviços, laid out like the team's Word model. */

const MARGIN_LEFT = 88, MARGIN_RIGHT = 80;

export function termoDefinition(dados: TermoDados): TDocumentDefinitions {
  const nome = dados.nome.trim().toUpperCase();
  // A company (CNPJ) is "a empresa": feminine, and "pessoa jurídica" instead of "brasileiro(a)".
  const empresa = ehCnpj(dados.cpf);
  const g = (masculino: string, feminino: string) => flexiona(masculino, feminino, empresa ? "F" : dados.genero);
  const endereco = dados.endereco.trim().replace(/\.$/, "");
  const contrato = `contrato de ${dados.modalidade}`;

  const body: Content[] = [
    { text: "TERMO DE CONHECIMENTO DE PRESTAÇÃO DE SERVIÇOS.", bold: true, fontSize: 11.5, alignment: "center", margin: [0, 0, 0, 30] },
    {
      text: [
        { text: `${nome},`, bold: true },
        empresa ? " pessoa jurídica de direito privado, inscrita no CNPJ: " : ` ${g("brasileiro", "brasileira")}, ${g("inscrito", "inscrita")} no CPF: `,
        { text: `${formatDocumento(dados.cpf)},`, bold: true },
        ` e‑mail ${dados.email.trim()} com endereço na ${endereco}, doravante ${g("denominado", "denominada")} CONTRATANTE, neste ato ${g("representado", "representada")} pela empresa: `,
        { text: `${EMPRESA.nome},`, bold: true },
        " inscrita no CNPJ: ",
        { text: EMPRESA.cnpj, bold: true },
        " domiciliada em ",
        { text: `${EMPRESA.sede},`, bold: true },
        " doravante denominado ",
        { text: "CONTRATADO.", bold: true },
      ],
      style: "body",
    },
    { text: `vem por meio desta comunicar sobre as tratativas de solicitação do ${contrato}.`, fontSize: 10, lineHeight: 1.6, margin: [190, 18, 0, 46] },
    { text: "DO CONTRATO", bold: true, alignment: "center", fontSize: 10.5, margin: [0, 0, 0, 34] },
    { text: `Contrato de ${dados.modalidade} ${dados.banco.trim()}`, bold: true, fontSize: 10, margin: [0, 0, 0, 16] },
    { text: "Da notificação extrajudicial:", bold: true, fontSize: 11.5, margin: [0, 0, 0, 4] },
    { text: `A assessoria ${EMPRESA.nome.toUpperCase()} vem por meio desta comunicar as tratativas extrajudiciais, sendo o presente termo referente à notificação extrajudicial enviada à instituição financeira credora do ${contrato}.`, style: "body" },
    {
      unbreakable: true,
      margin: [0, 80, 0, 0],
      stack: [
        { canvas: [{ type: "line", x1: 31, y1: 0, x2: 424, y2: 0, lineWidth: 0.7, lineColor: "#555" }] },
        { text: nome, bold: true, alignment: "center", fontSize: 12, margin: [0, 2, 0, 14] },
        { text: [`${EMPRESA.nomeCurto.toUpperCase()} - CNPJ nº ${EMPRESA.cnpj} – sediada em\n`, `${EMPRESA.sede}.`], bold: true, alignment: "center", fontSize: 8 },
      ],
    },
  ];

  return {
    pageSize: "A4",
    pageMargins: [MARGIN_LEFT, 90, MARGIN_RIGHT, 60],
    info: { title: `Termo de prestação de serviços – ${nome}`, author: EMPRESA.nome },
    defaultStyle: { font: "Roboto", fontSize: 10.5, color: "#1a1a1a" },
    styles: { body: { lineHeight: 1.6, alignment: "justify" } },
    content: body,
  };
}

export const buildTermoPdf = (dados: TermoDados) => renderPdf(termoDefinition(dados));

/** "Termo de prestação de serviços - JOSÉ CLAUDIO DA SILVA.pdf" */
export const termoFileName = (dados: TermoDados) => safePdfName(`Termo de prestação de serviços - ${dados.nome.trim().toUpperCase()}`);
