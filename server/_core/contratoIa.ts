import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { emptyLaudo } from "@shared/laudo";
import { MODALIDADES } from "@shared/notificacao";
import { conferirContrato } from "./contratoConta";
import { ENV } from "./env";
import { type LeituraContrato, camposEncontrados } from "./laudoContrato";

/**
 * Reads a contract with Claude (Anthropic API) when the free reader can't: a bank layout it has no
 * rules for, or a scan. Any bank, any layout, without new code. Needs ANTHROPIC_API_KEY in .env; the
 * model is CONTRATO_IA_MODEL (Claude Haiku 5.5 by default, a fraction of a cent per contract).
 * The contract carries the client's personal data to Anthropic.
 */

const valor = (texto: string) => z.number().describe(`${texto} Em reais, como número (1234.56). 0 se não constar.`);
const texto = (descricao: string) => z.string().describe(`${descricao} Vazio se não constar.`);

const Leitura = z.object({
  contrato: texto("Número do contrato/cédula/operação, só o número."),
  contratante: texto("Nome completo do cliente (emitente/contratante/devedor), em maiúsculas."),
  cpf: texto("CPF do cliente, no formato 000.000.000-00."),
  email: texto("E-mail do cliente (não o do banco, ouvidoria ou loja)."),
  endereco: texto("Endereço residencial do cliente: rua, número, complemento, bairro, cidade/UF e CEP, numa linha."),
  instituicao: texto("Razão social do banco credor, como escrita (ex.: Banco Bradesco Financiamentos S.A.)."),
  cnpjInstituicao: texto("CNPJ do banco credor, no formato 00.000.000/0000-00."),
  modalidade: z.enum([...MODALIDADES, ""]).describe("\"financiamento\" (veículo/bem, CDC) ou \"empréstimo\" (crédito pessoal, consignado); vazio se não der para saber."),
  garantia: texto("Bem financiado ou dado em garantia: marca, modelo, versão e ano (fabricação/modelo)."),
  valorSolicitado: valor("Valor solicitado/liberado do crédito ou do bem, sem tarifas, seguros e IOF."),
  valorFinanciado: valor("Valor total financiado/devido na contratação: crédito + tarifas + seguros + registro + IOF, antes dos juros."),
  parcelas: z.number().int().describe("Quantidade de parcelas. 0 se não constar."),
  valorParcela: valor("Valor de cada parcela."),
  dataContrato: texto("Data de emissão/contratação, dd/mm/aaaa."),
  primeiroVencimento: texto("Data de vencimento da 1ª parcela, dd/mm/aaaa. Só se estiver escrita: não calcule pela carência."),
  taxaMensal: z.number().describe("Taxa de juros remuneratórios mensal, em %, como escrita (2.06 para 2,06% a.m.). Não use o CET nem juros de mora. 0 se não constar."),
  taxaAnual: z.number().describe("Taxa de juros remuneratórios anual, em % (27.73 para 27,73% a.a.). Não use o CET. 0 se não constar."),
  jurosMora: texto("Juros de mora, no formato \"1% A.M.\"."),
  iof: valor("IOF total financiado (somando IOF do bem, adicional e dos produtos)."),
  seguros: valor("Soma dos seguros financiados (prestamista, proteção etc.)."),
  avaliacao: valor("Tarifa de avaliação do bem."),
  cadastro: valor("Tarifa de cadastro."),
  registro: valor("Despesas de registro do contrato (cartório e órgão de trânsito somados)."),
});

const PROMPT = [
  "Este PDF é um contrato de crédito bancário (CCB, CDC, financiamento ou empréstimo) de um cliente brasileiro.",
  "Extraia os campos pedidos exatamente como estão no contrato. Não invente nem calcule valores que não estão escritos:",
  "deixe vazio (ou 0) o que não constar ou não der para ler com segurança. O PDF pode ser escaneado, com páginas fora de ordem.",
].join(" ");

export const isContratoIaConfigured = () => Boolean(ENV.anthropicApiKey);

let client: Anthropic | null = null;

/** The reading, or null when the API is not set up, refuses or fails (the caller keeps the free reader's result). */
export async function lerContratoComIa(bytes: Uint8Array): Promise<LeituraContrato | null> {
  if (!isContratoIaConfigured()) return null;
  client ??= new Anthropic({ apiKey: ENV.anthropicApiKey, timeout: 120_000, maxRetries: 1 });
  try {
    const response = await client.messages.parse({
      model: ENV.contratoIaModel,
      max_tokens: 4000,
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(bytes).toString("base64") } },
          { type: "text", text: PROMPT },
        ],
      }],
      output_config: { format: zodOutputFormat(Leitura) },
    });
    const { input_tokens, output_tokens } = response.usage;
    console.info(`[contratoIa] ${ENV.contratoIaModel}: ${input_tokens} tokens de entrada, ${output_tokens} de saída, parada: ${response.stop_reason}`);
    const lido = response.stop_reason === "refusal" ? null : response.parsed_output;
    if (!lido) return null;

    const dados = emptyLaudo();
    Object.assign(dados, {
      contrato: lido.contrato, contratante: lido.contratante.toUpperCase(), instituicao: lido.instituicao, garantia: lido.garantia,
      valorSolicitado: lido.valorSolicitado, valorFinanciado: lido.valorFinanciado, parcelas: lido.parcelas, valorParcela: lido.valorParcela,
      dataContrato: lido.dataContrato, primeiroVencimento: lido.primeiroVencimento, taxaMensal: lido.taxaMensal, taxaAnual: lido.taxaAnual,
      jurosMora: lido.jurosMora || dados.jurosMora, iof: lido.iof,
    });
    const positivo = (value: number) => (value > 0 ? value : null);
    dados.encargos = { seguros: positivo(lido.seguros), avaliacao: positivo(lido.avaliacao), cadastro: positivo(lido.cadastro), registro: positivo(lido.registro) };
    return {
      dados, cpf: lido.cpf, cnpjInstituicao: lido.cnpjInstituicao, modalidade: lido.modalidade || null,
      email: lido.email.toLowerCase(), endereco: lido.endereco, encontrados: camposEncontrados(dados),
      conferencia: conferirContrato(dados, []),
    };
  } catch (error) {
    console.warn("[contratoIa] Leitura por IA falhou:", error instanceof Error ? error.message : error);
    return null;
  }
}
