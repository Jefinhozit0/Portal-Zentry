import { readFileSync } from "node:fs";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { type CcmaDados, type LeituraArquivo, consolidarCampo, nomeArquivoCcma, partesData, problemasCcma, recomendarItens } from "@shared/ccma";
import { buildCcmaDocx, preencherDocumentoXml } from "./ccmaDocx";
import { buildCcmaPdf, ccmaDefinition } from "./ccmaPdf";
import { extrairDoTexto, tipoArquivoCcma } from "./ccmaLeitura";
import type { Line } from "./laudoContrato";

const dados: CcmaDados = {
  pedido: "REVISIONAL DE FINANCIAMENTO DE VEÍCULO",
  reclamante: { nome: "MARIA DA SILVA & FILHOS", rg: "", documento: "529.982.247-25", profissao: "Barista", estadoCivil: "Solteiro(a)", telefone: "(11) 99999-0000", whatsapp: "SIM", email: "maria@exemplo.com" },
  reclamado: { nome: "BANCO EXEMPLO S.A.", documento: "11.222.333/0001-81" },
  itens: [
    { id: "reducao", texto: "Revisão do contrato" },
    { id: "observacoes", texto: "Contrato do cliente está quitado? Não" },
    { id: "exibicao", texto: "Não" },
  ],
  data: "2026-11-03",
};

const modelo = () => strFromU8(unzipSync(new Uint8Array(readFileSync(path.resolve(process.cwd(), "server/assets/ccma/formulario-modelo.docx"))))["word/document.xml"]);
const texto = (xml: string) => Array.from(xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g), (match) => match[1]).join("");
const contar = (text: string, trecho: string) => text.split(trecho).length - 1;
const linha = (page: number, text: string): Line => ({ page, y: 0, items: [{ x: 0, y: 0, text }], text });

describe("Word do formulário CCMA", () => {
  const xml = preencherDocumentoXml(modelo(), dados);
  const lido = texto(xml);

  it("fills both copies of the text box, each party in its own section", () => {
    expect(contar(lido, "NOME COMPLETO: MARIA DA SILVA &amp; FILHOS")).toBe(2);
    expect(contar(lido, "NOME COMPLETO: BANCO EXEMPLO S.A.")).toBe(2);
    expect(contar(lido, "CPF/ CNPJ: 529.982.247-25")).toBe(2);
    expect(contar(lido, "CPF/ CNPJ: 11.222.333/0001-81")).toBe(2);
    expect(contar(lido, "PROFISSÃO: Barista")).toBe(2);
    expect(contar(lido, "E-MAIL: maria@exemplo.com")).toBe(2);
    expect(contar(lido, "TELEFONE: (11) 99999-0000WHATSAPP: SIM")).toBe(2);
    expect(lido).not.toContain("(opcional)");
    expect(lido).not.toContain("SIM ou NÃO");
  });

  it("removes only the items left out, and writes the ones kept like the model", () => {
    expect(lido).not.toContain("QUITAÇÃO");
    expect(lido).not.toContain("BUSCA E APREENSÃO");
    expect(lido).not.toContain("JUROS ROTATIVOS");
    expect(contar(lido, "REDUÇÃO DA PARCELAS: Revisão do contrato")).toBe(2);
    expect(contar(lido, "OBSERVAÇÕES: Contrato do cliente está quitado? Não")).toBe(2);
    expect(contar(lido, "AUDIÊNCIA PARA EXIBIÇÃO DE CONTRATO? Não")).toBe(2);
  });

  it("replaces the placeholder date and leaves part 5 and the fixed texts as they are", () => {
    expect(contar(lido, "São Caetano do sul, 03 de Novembro de 2026")).toBe(2);
    expect(lido).not.toContain("xxxxxxxx");
    expect(lido).not.toContain("2025");
    const parte5 = "A PARTE ESTÁ CIENTE E CONCORDA COM A REMUNERAÇÃO DO CONCILIADOR, QUE SERÁ CUSTEADA PELA PARTE SOLICITANTE. A PARTE ESTA CIENTES E CONCORDA COM OS HONORÁRIOS DA CÂMARA DE CONCILIAÇÃO, QUE SERÁ CUSTEADA PELA PARTE SOLICITANTE.";
    expect(contar(lido, parte5)).toBe(2);
    expect(contar(lido, "FORMULÁRIO PARA SOLIÇITAÇÃO DE AGENDAMENTO")).toBe(2);
  });

  it("leaves a field that was not confirmed blank, with its optional label", () => {
    const pendente = texto(preencherDocumentoXml(modelo(), { ...dados, reclamante: { ...dados.reclamante, rg: "", profissao: "", email: "", telefone: "", whatsapp: "" } }));
    expect(contar(pendente, "RG:CPF/ CNPJ: 529.982.247-25")).toBe(2);
    expect(contar(pendente, "PROFISSÃO: (opcional)")).toBe(2);
    expect(contar(pendente, "E-MAIL: (opcional)")).toBe(2);
    expect(pendente).not.toContain("SIM ou NÃO");
  });

  it("keeps the header, footer and images of the original file", () => {
    const original = unzipSync(new Uint8Array(readFileSync(path.resolve(process.cwd(), "server/assets/ccma/formulario-modelo.docx"))));
    const gerado = unzipSync(new Uint8Array(buildCcmaDocx(dados)));
    expect(Object.keys(gerado)).toEqual(Object.keys(original));
    for (const nome of ["word/header1.xml", "word/footer1.xml", "word/media/image2.png", "word/styles.xml"]) {
      expect(Buffer.from(gerado[nome]).equals(Buffer.from(original[nome]))).toBe(true);
    }
  });
});

describe("PDF do formulário CCMA", () => {
  it("prints the same data on one page", async () => {
    const pdf = await buildCcmaPdf(dados);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.toString("latin1").match(/\/Type\s*\/Page\b/g)).toHaveLength(1);
    const content = JSON.stringify(ccmaDefinition(dados).content);
    expect(content).toContain("NOME COMPLETO: BANCO EXEMPLO S.A.");
    expect(content).toContain("São Caetano do sul, 03 de Novembro de 2026");
    expect(content).not.toContain("BUSCA E APREENSÃO");
  });

  it("stays on one page with every item and long texts", async () => {
    const pdf = await buildCcmaPdf({
      ...dados,
      itens: (["quitacao", "busca", "reducao", "observacoes", "exibicao", "juros"] as const).map((id) => ({ id, texto: "Texto longo de teste com palavras comuns para quebrar a linha, ocupando o limite de cada item." })),
    });
    expect(pdf.toString("latin1").match(/\/Type\s*\/Page\b/g)).toHaveLength(1);
  });
});

describe("regras do formulário CCMA", () => {
  it("writes the date like the model and refuses an impossible one", () => {
    expect(partesData("2026-11-03")).toEqual({ diaMes: "03 de Novembro", ano: "2026" });
    expect(partesData("2026-02-31")).toBeNull();
    expect(partesData("")).toBeNull();
  });

  it("asks for what the form cannot go without", () => {
    expect(problemasCcma(dados)).toEqual([]);
    expect(problemasCcma({ ...dados, data: "" })).toContain("Informe a data do formulário.");
    expect(problemasCcma({ ...dados, itens: [] })).toContain("Mantenha ao menos um item na parte 4.");
    expect(problemasCcma({ ...dados, reclamante: { ...dados.reclamante, documento: "123" } })[0]).toMatch(/^Reclamante:/);
    expect(problemasCcma({ ...dados, reclamante: { ...dados.reclamante, nome: "x".repeat(71) } })[0]).toMatch(/não cabe/);
  });

  it("refuses part 4 texts that would push the date out of Word's fixed text box", () => {
    const curto = (["quitacao", "busca", "reducao", "observacoes", "exibicao", "juros"] as const).map((id) => ({ id, texto: "Não" }));
    expect(problemasCcma({ ...dados, itens: curto })).toEqual([]);
    const longo = curto.map((item) => ({ ...item, texto: "x".repeat(100) }));
    expect(problemasCcma({ ...dados, itens: longo })[0]).toMatch(/cortariam a data/);
    expect(problemasCcma({ ...dados, itens: longo.slice(0, 3).concat(curto.slice(3)) })).toEqual([]);
  });

  it("names the approved version", () => {
    expect(nomeArquivoCcma(dados)).toBe("FORMULARIO DE SOLICITACAO - CCMA - MARIA DA SILVA & FILHOS - versão aprovada");
  });

  const arquivo = (over: Partial<LeituraArquivo>): LeituraArquivo => ({ arquivo: "a.pdf", tipo: "Não classificado", paginas: 1, ilegiveis: [], ocr: false, aviso: "", candidatos: [], evidencias: [], ...over });

  it("shows differing values and never chooses one; the same value in another format is not a divergence", () => {
    const um = arquivo({ candidatos: [{ campo: "documento", valor: "529.982.247-25", arquivo: "a.pdf", pagina: 1, trecho: "" }] });
    const igual = arquivo({ arquivo: "b.pdf", candidatos: [{ campo: "documento", valor: "52998224725", arquivo: "b.pdf", pagina: 2, trecho: "" }] });
    const outro = arquivo({ arquivo: "c.pdf", candidatos: [{ campo: "documento", valor: "111.444.777-35", arquivo: "c.pdf", pagina: 1, trecho: "" }] });
    expect(consolidarCampo("documento", [um, igual]).status).toBe("CONFIRMADO NO DOCUMENTO");
    const divergente = consolidarCampo("documento", [um, outro]);
    expect(divergente.status).toBe("DIVERGENTE ENTRE DOCUMENTOS");
    expect(divergente.valores.map((item) => item.valor)).toEqual(["529.982.247-25", "111.444.777-35"]);
  });

  it("tells a field absent from one that may be on a page it could not read", () => {
    expect(consolidarCampo("rg", [arquivo({})]).status).toBe("AUSENTE");
    expect(consolidarCampo("rg", [arquivo({ ilegiveis: [2] })]).status).toBe("ILEGÍVEL");
  });

  it("suggests removing only what no document mentions, and a mention only asks", () => {
    const semMencao = recomendarItens([arquivo({ tipo: "Contrato" })]);
    expect(semMencao.busca.acao).toBe("SUGERIR EXCLUSÃO");
    expect(semMencao.juros.acao).toBe("SUGERIR EXCLUSÃO");
    expect(semMencao.reducao.acao).toBe("MANTER");
    expect(semMencao.quitacao.acao).toBe("PENDENTE DE CONFIRMAÇÃO");
    expect(semMencao.observacoes.acao).toBe("PENDENTE DE CONFIRMAÇÃO");
    const comMencao = recomendarItens([arquivo({ evidencias: [{ tipo: "busca", arquivo: "a.pdf", pagina: 3, trecho: "busca e apreensão" }] })]);
    expect(comMencao.busca.acao).toBe("PENDENTE DE CONFIRMAÇÃO");
    expect(comMencao.busca.evidencias[0].pagina).toBe(3);
    expect(recomendarItens([]).busca.acao).toBe("PENDENTE DE CONFIRMAÇÃO");
  });
});

describe("leitura de documentos para o formulário CCMA", () => {
  it("finds the labeled data with its page and excerpt", () => {
    const { candidatos, tipo } = extrairDoTexto([
      linha(2, "Cédula de Crédito Bancário"),
      linha(2, "Nome: MARIA DA SILVA"),
      linha(3, "CPF: 529.982.247-25 RG: 12.345.678-9"),
      linha(3, "Profissão: Barista Estado Civil: Solteira"),
      linha(4, "Celular: (11) 99999-0000"),
      linha(4, "E-mail: Maria@Exemplo.com"),
    ], "contrato.pdf");
    const valor = (campo: string) => candidatos.find((item) => item.campo === campo);
    expect(tipo).toBe("Contrato");
    expect(valor("nome")).toMatchObject({ valor: "MARIA DA SILVA", arquivo: "contrato.pdf", pagina: 2 });
    expect(valor("documento")).toMatchObject({ valor: "529.982.247-25", pagina: 3, trecho: "CPF: 529.982.247-25 RG: 12.345.678-9" });
    expect(valor("rg")?.valor).toBe("12.345.678-9");
    expect(valor("profissao")?.valor).toBe("Barista");
    expect(valor("estadoCivil")?.valor).toBe("Solteira");
    expect(valor("telefone")?.valor).toBe("(11) 99999-0000");
    expect(valor("email")?.valor).toBe("maria@exemplo.com");
    expect(valor("whatsapp")).toBeUndefined();
  });

  it("does not take a CPF with wrong digits, or the bank's e-mail for the client's", () => {
    const { candidatos } = extrairDoTexto([linha(1, "CPF: 111.111.111-11"), linha(1, "Ouvidoria e-mail: ouvidoria@banco.com")], "a.pdf");
    expect(candidatos).toEqual([]);
  });

  it("reads the name below its label on an ID card", () => {
    const { candidatos, tipo } = extrairDoTexto([linha(1, "CARTEIRA NACIONAL DE HABILITAÇÃO"), linha(1, "NOME"), linha(1, "MARIA DA SILVA")], "cnh.jpg");
    expect(tipo).toBe("Documento de identidade");
    expect(candidatos[0]).toMatchObject({ campo: "nome", valor: "MARIA DA SILVA", pagina: 1 });
  });

  it("keeps the excerpts that mention part 4's subjects", () => {
    const { evidencias } = extrairDoTexto([linha(5, "poderá requerer a busca e apreensão do bem"), linha(6, "juros do crédito rotativo")], "a.pdf");
    expect(evidencias.map(({ tipo, pagina }) => [tipo, pagina])).toEqual([["busca", 5], ["rotativo", 6]]);
  });

  it("accepts only PDF, JPEG and PNG, by their content", () => {
    expect(tipoArquivoCcma(new TextEncoder().encode("%PDF-1.7"))).toBe("pdf");
    expect(tipoArquivoCcma(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("imagem");
    expect(tipoArquivoCcma(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe("imagem");
    expect(tipoArquivoCcma(new TextEncoder().encode("MZ executável"))).toBeNull();
  });
});
