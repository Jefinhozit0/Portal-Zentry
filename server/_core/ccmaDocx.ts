import { readFileSync } from "node:fs";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { type CcmaDados, type ItemCcma, ITENS_CCMA, partesData } from "@shared/ccma";

/**
 * Fills a copy of the CCMA's own Word file (server/assets/ccma/formulario-modelo.docx, never changed), keeping
 * its header, footer, tables and fixed texts. The form lives in a text box that Word stores twice (the box and
 * its fallback for older readers), so every change here runs on both copies.
 */

const MODELO = path.resolve(process.cwd(), "server/assets/ccma/formulario-modelo.docx");
/** A paragraph with no other paragraph inside (the first one of the document holds the whole text box). */
const PARAGRAFO = /<w:p[ >](?:(?!<w:p[ >])[\s\S])*?<\/w:p>/g;

const escapar = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const textoDe = (paragrafo: string) => Array.from(paragrafo.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g), (match) => match[1]).join("");
const novoT = (texto: string) => `<w:t xml:space="preserve">${escapar(texto)}</w:t>`;

/** Replaces the text of the run that holds exactly `antigo`. */
const trocar = (paragrafo: string, antigo: string, novo: string) =>
  paragrafo.replace(new RegExp(`<w:t(?: [^>]*)?>${antigo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</w:t>`), () => novoT(novo));

/** " valor" after the label, in the same formatting as the label's last run. */
function acrescentar(paragrafo: string, valor: string) {
  if (!valor) return paragrafo;
  const formato = Array.from(paragrafo.matchAll(/<w:rPr>(?:(?!<\/w:rPr>)[\s\S])*<\/w:rPr>(?=<w:t[ >])/g)).at(-1)?.[0] ?? "";
  return paragrafo.replace(/<\/w:p>$/, `<w:r>${formato}${novoT(` ${valor}`)}</w:r></w:p>`);
}

/** The yellow text of a part 4 item: the form's placeholder gives way to the approved text. */
const trocarDestaque = (paragrafo: string, texto: string) =>
  paragrafo.replace(/(<w:rPr>(?:(?!<\/w:rPr>)[\s\S])*w:highlight(?:(?!<\/w:rPr>)[\s\S])*<\/w:rPr>)<w:t(?: [^>]*)?>[^<]*<\/w:t>/, (_, formato: string) => `${formato}${novoT(texto)}`);

export function preencherDocumentoXml(xml: string, dados: CcmaDados): string {
  const data = partesData(dados.data);
  if (!data) throw new Error("Data inválida.");
  const mantidos = new Map(dados.itens.map((item) => [item.id, item.texto.trim()]));
  const { reclamante, reclamado } = dados;
  let secao: "reclamante" | "reclamado" = "reclamante";
  let apagarVazioSeguinte = false;

  return xml.replace(PARAGRAFO, (paragrafo) => {
    const texto = textoDe(paragrafo).trim();
    if (apagarVazioSeguinte) {
      apagarVazioSeguinte = false;
      if (!texto) return "";
    }
    if (texto.startsWith("2) RECLAMANTE")) secao = "reclamante";
    if (texto.startsWith("3) RECLAMADO")) secao = "reclamado";

    if (texto === "REVISIONAL DE FINANCIAMENTO DE VEÍCULO") return trocar(paragrafo, texto, dados.pedido.trim());
    if (texto === "NOME COMPLETO:") return acrescentar(paragrafo, (secao === "reclamante" ? reclamante.nome : reclamado.nome).trim());
    if (texto === "CPF/ CNPJ:") return acrescentar(paragrafo, (secao === "reclamante" ? reclamante.documento : reclamado.documento).trim());
    if (texto === "RG:") return acrescentar(paragrafo, reclamante.rg.trim());
    if (texto === "ESTADO CIVIL:") return acrescentar(paragrafo, reclamante.estadoCivil.trim());
    if (texto.startsWith("PROFISSÃO:")) return reclamante.profissao.trim() ? trocar(paragrafo, "(opcional)", reclamante.profissao.trim()) : paragrafo;
    if (texto.startsWith("E-MAIL:")) return reclamante.email.trim() ? trocar(paragrafo, "E-MAIL: (opcional)", `E-MAIL: ${reclamante.email.trim()}`) : paragrafo;
    if (texto.startsWith("TELEFONE:")) return trocar(trocar(paragrafo, ":", reclamante.telefone.trim() ? `: ${reclamante.telefone.trim()}` : ":"), "SIM ou NÃO", reclamante.whatsapp);

    const item = ITENS_CCMA.find(({ rotulo }) => texto.startsWith(rotulo.replace(/:$/, "")));
    if (item) {
      const mantido = mantidos.get(item.id as ItemCcma);
      if (mantido === undefined) {
        apagarVazioSeguinte = true;
        return "";
      }
      return trocarDestaque(paragrafo, item.id === "observacoes" ? `: ${mantido}` : mantido);
    }

    if (texto.startsWith("São Caetano do sul,")) return trocar(trocar(paragrafo, "xxxxxxxx", data.diaMes), " de 2025", ` de ${data.ano}`);
    return paragrafo;
  });
}

export function buildCcmaDocx(dados: CcmaDados): Buffer {
  const arquivos = unzipSync(new Uint8Array(readFileSync(MODELO)));
  arquivos["word/document.xml"] = strToU8(preencherDocumentoXml(strFromU8(arquivos["word/document.xml"]), dados));
  return Buffer.from(zipSync(arquivos));
}
