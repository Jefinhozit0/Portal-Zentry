/**
 * Formulário de solicitação da CCMA (Câmara de Conciliação). Everything read from the documents is only a
 * proposal: an administrator confirms each field and each item of part 4 and approves that exact version
 * before any file exists. What was not confirmed stays blank; nothing is deduced.
 */

import { PROBLEMA_DOCUMENTO, documentoValido } from "./procuracao";

export const CAMPOS_CCMA = [
  { id: "pedido", parte: 1, rotulo: "Descreva seu pedido", max: 90 },
  { id: "nome", parte: 2, rotulo: "Nome completo", max: 70 },
  { id: "rg", parte: 2, rotulo: "RG", max: 30 },
  { id: "documento", parte: 2, rotulo: "CPF/CNPJ", max: 20 },
  { id: "profissao", parte: 2, rotulo: "Profissão", max: 60 },
  { id: "estadoCivil", parte: 2, rotulo: "Estado civil", max: 30 },
  { id: "telefone", parte: 2, rotulo: "Telefone", max: 30 },
  { id: "whatsapp", parte: 2, rotulo: "WhatsApp", max: 3 },
  { id: "email", parte: 2, rotulo: "E-mail", max: 70 },
  { id: "reclamadoNome", parte: 3, rotulo: "Nome completo", max: 70 },
  { id: "reclamadoDocumento", parte: 3, rotulo: "CPF/CNPJ", max: 20 },
] as const;
export type CampoCcma = (typeof CAMPOS_CCMA)[number]["id"];

/** The text of part 1 in the form. It is printed only after being confirmed, like any other field. */
export const PEDIDO_PADRAO = "REVISIONAL DE FINANCIAMENTO DE VEÍCULO";

export const ITENS_CCMA = [
  { id: "quitacao", rotulo: "QUITAÇÃO:", padrao: "", dica: "Valor da proposta", opcoes: [] },
  { id: "busca", rotulo: "BUSCA E APREENSÃO:", padrao: "Negociação de retirada de busca e apreensão", dica: "", opcoes: [] },
  { id: "reducao", rotulo: "REDUÇÃO DA PARCELAS:", padrao: "Revisão do contrato", dica: "", opcoes: [] },
  { id: "observacoes", rotulo: "OBSERVAÇÕES:", padrao: "", dica: "Contrato do cliente está quitado? Sim ou Não", opcoes: ["Contrato do cliente está quitado? Sim", "Contrato do cliente está quitado? Não"] },
  { id: "exibicao", rotulo: "AUDIÊNCIA PARA EXIBIÇÃO DE CONTRATO?", padrao: "", dica: "Sim ou Não", opcoes: ["Sim", "Não"] },
  { id: "juros", rotulo: "AUDIÊNCIA PARA REVER JUROS ROTATIVOS DE CARTÃO?", padrao: "", dica: "Sim ou Não", opcoes: ["Sim", "Não"] },
] as const;
export type ItemCcma = (typeof ITENS_CCMA)[number]["id"];
const MAX_ITEM = 100;

export type CcmaDados = {
  pedido: string;
  reclamante: { nome: string; rg: string; documento: string; profissao: string; estadoCivil: string; telefone: string; whatsapp: string; email: string };
  reclamado: { nome: string; documento: string };
  /** The items kept, in the form's order. An item left out is removed from the form. */
  itens: { id: ItemCcma; texto: string }[];
  /** aaaa-mm-dd */
  data: string;
};

/** Where a value came from. pagina is null when the reader found the value but not its page. */
export type Candidato = { campo: CampoCcma; valor: string; arquivo: string; pagina: number | null; trecho: string };
export type EvidenciaTipo = "busca" | "rotativo" | "quitacao";
export type Evidencia = { tipo: EvidenciaTipo; arquivo: string; pagina: number; trecho: string };
export type TipoDocumento = "Contrato" | "Documento de identidade" | "Comprovante de endereço" | "Não classificado" | "Não lido";

export type LeituraArquivo = {
  arquivo: string;
  tipo: TipoDocumento;
  paginas: number;
  /** Pages without any readable text, after OCR. */
  ilegiveis: number[];
  ocr: boolean;
  /** Why the file could not be read at all; or what was left out of the reading. */
  aviso: string;
  candidatos: Candidato[];
  evidencias: Evidencia[];
};

export type StatusCcma = "CONFIRMADO NO DOCUMENTO" | "ILEGÍVEL" | "AUSENTE" | "DIVERGENTE ENTRE DOCUMENTOS" | "AGUARDANDO CONFIRMAÇÃO DO USUÁRIO";

const normalizar = (campo: CampoCcma, valor: string) =>
  ["rg", "documento", "telefone", "reclamadoDocumento"].includes(campo)
    ? valor.replace(/\D/g, "")
    : valor.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/** What the documents say about a field: one value, several (never chosen here), or none. */
export function consolidarCampo(campo: CampoCcma, arquivos: LeituraArquivo[]) {
  const fontes = arquivos.flatMap((arquivo) => arquivo.candidatos).filter((candidato) => candidato.campo === campo);
  const valores: { valor: string; fontes: Candidato[] }[] = [];
  for (const fonte of fontes) {
    const igual = valores.find((item) => normalizar(campo, item.valor) === normalizar(campo, fonte.valor));
    if (igual) igual.fontes.push(fonte);
    else valores.push({ valor: fonte.valor, fontes: [fonte] });
  }
  const status: StatusCcma = valores.length > 1 ? "DIVERGENTE ENTRE DOCUMENTOS"
    : valores.length === 1 ? "CONFIRMADO NO DOCUMENTO"
    : arquivos.some((arquivo) => arquivo.ilegiveis.length > 0 || arquivo.tipo === "Não lido") ? "ILEGÍVEL"
    : "AUSENTE";
  return { status, valores };
}

export type Recomendacao = { acao: "MANTER" | "SUGERIR EXCLUSÃO" | "PENDENTE DE CONFIRMAÇÃO"; motivo: string; evidencias: Evidencia[] };

/**
 * A recommendation for each item of part 4, never an answer: a clause mentioning busca e apreensão does not
 * prove there is one, so a mention only asks the administrator; only the lack of any mention suggests removing.
 */
export function recomendarItens(arquivos: LeituraArquivo[]): Record<ItemCcma, Recomendacao> {
  const lidos = arquivos.some((arquivo) => arquivo.tipo !== "Não lido");
  const temContrato = arquivos.some((arquivo) => arquivo.tipo === "Contrato");
  const evidencias = (tipo: EvidenciaTipo) => arquivos.flatMap((arquivo) => arquivo.evidencias).filter((evidencia) => evidencia.tipo === tipo);
  const porMencao = (tipo: EvidenciaTipo, assunto: string): Recomendacao => {
    const achadas = evidencias(tipo);
    if (achadas.length) return { acao: "PENDENTE DE CONFIRMAÇÃO", motivo: `Os documentos mencionam ${assunto}, mas a menção não comprova a situação. Confirme.`, evidencias: achadas };
    return lidos
      ? { acao: "SUGERIR EXCLUSÃO", motivo: `Nenhum documento lido menciona ${assunto}.`, evidencias: [] }
      : { acao: "PENDENTE DE CONFIRMAÇÃO", motivo: "Nenhum documento lido ainda.", evidencias: [] };
  };
  return {
    quitacao: { acao: "PENDENTE DE CONFIRMAÇÃO", motivo: "O valor da proposta não vem dos documentos: valor contratado, parcela e saldo não são proposta. Informe o valor ou exclua o item.", evidencias: [] },
    busca: porMencao("busca", "busca e apreensão"),
    reducao: temContrato
      ? { acao: "MANTER", motivo: "Há um contrato entre os documentos e o pedido é de revisão. Confirme.", evidencias: [] }
      : { acao: "PENDENTE DE CONFIRMAÇÃO", motivo: "Nenhum contrato identificado entre os documentos.", evidencias: [] },
    observacoes: { acao: "PENDENTE DE CONFIRMAÇÃO", motivo: "A situação de quitação precisa ser confirmada, mesmo que algum documento a mencione.", evidencias: evidencias("quitacao") },
    exibicao: { acao: "PENDENTE DE CONFIRMAÇÃO", motivo: temContrato ? "Há um contrato entre os documentos. Confirme se ainda é preciso pedir a exibição." : "Nenhum contrato identificado entre os documentos. Confirme se é preciso pedir a exibição.", evidencias: [] },
    juros: porMencao("rotativo", "juros rotativos"),
  };
}

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

/** "03 de Novembro" and "2026", the parts of the form's "xxxxxxxx de 2025"; null when the date is not a real one. */
export function partesData(iso: string): { diaMes: string; ano: string } | null {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
  if (date.getUTCMonth() !== +match[2] - 1) return null;
  return { diaMes: `${match[3]} de ${MESES[+match[2] - 1]}`, ano: match[1] };
}

export const textoItem = (id: ItemCcma, texto: string) => `${ITENS_CCMA.find((item) => item.id === id)!.rotulo} ${texto}`;

/**
 * The Word form is a text box of fixed height: what does not fit is cut off silently, the date first. Checked in
 * Word: the six items with one line each, plus three more lines, is the most that fits. Each item also has a blank line after it.
 */
const MAX_LINHAS_PARTE4 = 15;
const CARACTERES_POR_LINHA = 68;
const linhasParte4 = (itens: CcmaDados["itens"]) =>
  itens.reduce((total, item) => total + Math.ceil(textoItem(item.id, item.texto).length / CARACTERES_POR_LINHA) + 1, 0);

/** What stops the form from being generated: what it cannot go without, and what would not fit its space. */
export function problemasCcma(dados: CcmaDados): string[] {
  const problemas: string[] = [];
  if (!dados.pedido.trim()) problemas.push("Confirme o pedido da parte 1.");
  if (!dados.reclamante.nome.trim()) problemas.push("Confirme o nome do reclamante.");
  if (!dados.reclamado.nome.trim()) problemas.push("Confirme o nome do reclamado.");
  if (dados.reclamante.documento.trim() && !documentoValido(dados.reclamante.documento)) problemas.push(`Reclamante: ${PROBLEMA_DOCUMENTO}`);
  if (dados.reclamado.documento.trim() && !documentoValido(dados.reclamado.documento)) problemas.push(`Reclamado: ${PROBLEMA_DOCUMENTO}`);
  if (dados.reclamante.whatsapp && !["SIM", "NÃO"].includes(dados.reclamante.whatsapp)) problemas.push("WhatsApp deve ser SIM ou NÃO.");
  if (!dados.itens.length) problemas.push("Mantenha ao menos um item na parte 4.");
  if (dados.itens.some((item) => !item.texto.trim())) problemas.push("Preencha o texto de cada item mantido na parte 4.");
  if (!partesData(dados.data)) problemas.push("Informe a data do formulário.");
  const valores: Record<CampoCcma, string> = { pedido: dados.pedido, ...dados.reclamante, reclamadoNome: dados.reclamado.nome, reclamadoDocumento: dados.reclamado.documento };
  for (const campo of CAMPOS_CCMA) {
    if (valores[campo.id].length > campo.max) problemas.push(`${campo.rotulo} não cabe no formulário (até ${campo.max} caracteres).`);
  }
  if (dados.itens.some((item) => item.texto.length > MAX_ITEM)) problemas.push(`O texto de um item da parte 4 não cabe no formulário (até ${MAX_ITEM} caracteres).`);
  else if (linhasParte4(dados.itens) > MAX_LINHAS_PARTE4) problemas.push("Os textos da parte 4 não cabem no formulário e cortariam a data: encurte algum deles.");
  return problemas;
}

/** "FORMULARIO DE SOLICITACAO - CCMA - MARIA DA SILVA - versão aprovada", without the extension. */
export const nomeArquivoCcma = (dados: CcmaDados) =>
  `FORMULARIO DE SOLICITACAO - CCMA - ${dados.reclamante.nome.trim().toUpperCase()} - versão aprovada`.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ");
