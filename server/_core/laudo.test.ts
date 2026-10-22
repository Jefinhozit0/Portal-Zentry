import { describe, expect, it } from "vitest";
import { avisosLaudo, calcularLaudo, emptyLaudo, impliedRate, parseBRL, problemasLaudo } from "@shared/laudo";
import { type Line, extrairContrato } from "./laudoContrato";
import { buildLaudoPdf } from "./laudoPdf";

/** "[50]Label [489]R$ 1,00" → a line with its items at those x positions (as pdf.js gives them). */
const line = (y: number, spec: string): Line => {
  const items = [...spec.matchAll(/\[(\d+)\]([^[]*)/g)].map((match) => ({ x: Number(match[1]), y, text: match[2].trim() })).filter((item) => item.text);
  return { page: 1, y, items, text: items.map((item) => item.text).join(" ") };
};

// Page 1 of a SIM / Aymoré CCB (crédito pessoal com garantia de veículo), personal data replaced.
const SIM_CCB = [
  line(840, "[147]AYMORÉ CRÉDITO, FINANCIAMENTO E INVESTIMENTO S.A. CNPJ: 07.707.650/0001-10"),
  line(827, "[169]CÉDULA DE CRÉDITO BANCÁRIO - CRÉDITO PESSOAL COM GARANTIA DE VEÍCULO"),
  line(811, "[258]OPERAÇAO N° 663795516"),
  line(763, "[50]Nome do Cliente: [123]MARIA DA SILVA EXEMPLO"),
  line(750, "[50]CPF: [85]000.000.000-00 [320]RG: [340]00000000"),
  line(736, "[50]Endereço, fone de contato e e-mail: R DAS FLORES, 68 - cohab II - 15495-000 - SP (17)"),
  line(724, "[50]99999-0000 - MARIA.EXEMPLO@GMAIL.COM"),
  line(710, "[426]COROLLA GLI 1.8 FLEX 16V"),
  line(705, "[50]Veículo (Marca): [123]TOYOTA [221]Ano-modelo: [277]2017/2018 [391]Modelo:"),
  line(700, "[426]AUT."),
  line(662, "[51]Valor do veículo [144]R$ 83.440,00 [221]Cor: [246]CINZA"),
  line(636, "[27]B.1 [50]Valor Solicitado [489]R$ 50.000,00"),
  line(621, "[50]Seguro (s) - financiado (s):"),
  line(608, "[27]B.2 [50]Discriminação do(s) seguro(s) se houver: [214]SIM PROTEGIDO COM DESEMPREGO [468]R$ 3.767,92 [536]6,74%"),
  line(595, "[50]Seguradora: [115]ZURICH SANTANDER BRASIL SEG PREV S/A"),
  line(584, "[27]B.3 [50]Registro contrato - Cartório (cf. legislação estadual) - financiado: [501]R$ 0,00"),
  line(571, "[27]B.4 [50]Registro contrato - órgão de trânsito (Res. 320 CONTRAN) - financiado: [496]R$ 305,97"),
  line(558, "[27]B.5 [50]Subtotal (B.1+B.2+B.3+B.4): [489]R$ 54.073,89"),
  line(520, "[27]C.1 [50]Tarifa de Cadastro [194]Isenta: [246]sim [281]não [319]Financiada: [389]sim [429]não [480]R$ 0,00 [537]0,00%"),
  line(507, "[27]C.2 [50]Tarifa de Avaliação de bem [194]Isenta: [246]sim [281]não [319]Financiada: [389]sim [429]não [480]R$ 0,00 [537]0,00%"),
  line(493, "[27]C.3 [50]Total de tarifas a serem financiadas [480]R$ 0,00 [537]0,00%"),
  line(467, "[27]D.1 [50]Valor total a ser financiado sem impostos (B.5 + C.3) [489]R$ 54.073,89"),
  line(455, "[27]D.2 [49]IOF - financiado: [249]sim [289]não [352]alíquota: [418]3,00% [471]R$ 1.613,10 [537]2,89%"),
  line(442, "[27]D.3 [49]IOF - adicional (Decreto 6.339/08) - financiado: [249]sim [289]não [352]alíquota: [418]0,38% [475]R$ 198,05 [537]0,35%"),
  line(428, "[27]D.4 [49]Total de impostos a serem financiados [471]R$ 1.811,15 [537]3,24%"),
  line(402, "[27]E.1 [50]Data do 1° Vencimento [494]06/02/2025"),
  line(389, "[27]E.2 [50]Número de parcelas mensais: [512]60"),
  line(376, "[27]E.3 [50]Valor total das parcelas intermediárias (quando houver) [501]R$ 0,00"),
  line(362, "[398]mensal % am: [470]anual % a.a.:"),
  line(350, "[27]E.4 [50]Taxa de juros mensal e anual"),
  line(340, "[415]2,59% [480]35,91%"),
  line(327, "[27]E.5 [50]Valor de cada parcela mensal [465]null [489]0,03 [492]R$ 1.845,54"),
  line(309, "[27]E.6 [50]VALOR TOTAL CONTRATADO (COM IMPOSTOS) (D.1 + D.4) [468]R$ 55.885,04 [537]1,00%"),
  line(292, "[32]F [50]VALOR TOTAL PAGO AO FINAL (soma das parcelas) [466]R$ 110.732,40"),
  line(252, "[31]H [50]Prazo de validade do orçamento (²): 15 dias [312]Local: RIOLANDIA"),
  line(208, "[214]Assinado eletronicamente mediante login/senha por MARIA DA SILVA"),
  line(198, "[34]I [208]EXEMPLO, em Terça-feira, 7 de Janeiro de 2025 às 13:38:21 através de iPhone-OS iPhone -"),
];

// Page 1 of a Santander / Aymoré CDC Veículos contract, plus a clause from page 3; personal data replaced.
const SANTANDER_CDC = [
  line(788, "[142]AYMORÉ CRÉDITO, FINANCIAMENTO E INVESTIMENTO S.A. CNPJ: 07.707.650/0001-10"),
  line(767, "[394]OPERAÇÃO Nº 101601607/00693981806"),
  line(717, "[67]Nome/Razão Social do Cliente: JOÃO EXEMPLO DOS SANTOS"),
  line(707, "[67]CPF/CNPJ: 000.000.000-00 [434]RG: 000000000"),
  line(696, "[36]A.1 [67]Endereço e telefone de contato: RUA EXEMPLO 39 CASA JARDIM EXEMPLO SAO PAULO SP - (11)999999999"),
  line(687, "[67]Email: JOAO.EXEMPLO@GMAIL.COM"),
  line(676, "[67]Veículo: Marca: BAJAJ [298]Modelo: DOMINAR 250"),
  line(666, "[67]Ano/Modelo: 2025 [298]Cor: VERMELHA [408]Combustível: GASOLINA"),
  line(614, "[36]B.1 [67]Valor do veículo à vista [434]R$ [448]23.000,00"),
  line(561, "[67]Seguro Prestamista: CDC PROTEGIDO MOTO COM [308]Financiado: ■ sim □ não [434]R$ [447]1.488,00 [525]5,71%"),
  line(542, "[67]Seguro Acidente Pessoal: [308]Financiado: □ sim □ não [525]0,00%"),
  line(532, "[67]Seguradora: Zurich Santander [308]CNPJ:87.376.109/0001-06"),
  line(522, "[67]Seguro Auto: [308]Financiado: □ sim ■ não [434]R$ [447]0,00 [525]0,00%"),
  line(464, "[36]B.8 [67]Registro contrato – Cartório (cf. Legislação estadual) – financiado: [382]□ sim ■ não [434]R$ [447]0,00 [525]0,00%"),
  line(453, "[37]B.9 [67]Registro contrato-órgão de trânsito (Res. 689 CONTRAN) – financiado: [382]■ sim □ não [434]R$ [447]305,97 [525]1,17%"),
  line(443, "[67]SUBTOTAL: VEÍCULO + ACESSÓRIOS + SERV DE TERCEIROS FINANCIADOS A PEDIDO DO [434]R$ [447]24.793,97"),
  line(402, "[36]C.2 [67]Valor Líquido Liberado (B.1+B.2+B.3+B.4+B.5+B.7-C.1) [434]R$ [447]23.000,00 [523]88,32%"),
  line(371, "[36]D.1 [67]Tarifa de cadastro [245]Isenta: □ sim ■ não [335]Financiada: ■ sim □ não [434]R$ [447]1.149,00 [525]4,41%"),
  line(360, "[36]D.2 [67]Tarifa de avaliação de bem [245]Isenta: □ sim ■ não [335]Financiada: □ sim ■ não [434]R$ [447]0,00 [525]0,00%"),
  line(327, "[36]E.1 [67]Valor total a ser financiado sem impostos (B.10 - C.1 + D.3) [434]R$ [448]25.942,97"),
  line(285, "[36]E.4 [67]Total de impostos a serem financiados [434]R$ [448]98,56 [524]0,38%"),
  line(264, "[36]F.1 [67]Data do 1º Vencimento: 30/11/2025 [314]F.2 [335]Número de Parcelas mensais: 48"),
  line(242, "[67]Taxa de juros remuneratórios diária, mensal e [245]diária: % a.d.: 0,07% [342]mensal: % a.m.: 2,00% [450]anual: % a.a.: 26,82%"),
  line(224, "[36]F.5 [67]Valor de cada parcela mensal [434]R$ [447]848,37"),
  line(213, "[36]F.6 [67]VALOR TOTAL FINANCIADO (COM IMPOSTOS) (E.1 + E.4) [434]R$ [447]26.041,53 [521]100,00%"),
  line(182, "[67]Prazo de validade do orçamento (²): [195]Local: SAO PAULO [322]Hora: 16:49:57 [434]Data: 31/10/2025"),
  line(156, "[67]Assinado eletronicamente por JOÃO EXEMPLO DOS SANTOS em sexta-feira, 31 de outubro de 2025 de 16:48:55 através de"),
  { ...line(120, "[300]capitalizados (item F.4). N – Direitos e Deveres do"), page: 3 },
  { ...line(110, "[300]Cliente - Direitos: I. Escolher e receber livremente o"), page: 3 },
];

describe("extrairContrato (Santander CDC Veículos)", () => {
  const { dados } = extrairContrato(SANTANDER_CDC);

  it("takes the client's name from its label, not from a clause that mentions the client", () => {
    expect(dados.contratante).toBe("JOÃO EXEMPLO DOS SANTOS");
  });

  it("reads the client's e-mail and address, without the phone that follows (used by the termo)", () => {
    expect(extrairContrato(SANTANDER_CDC)).toMatchObject({ email: "joao.exemplo@gmail.com", endereco: "RUA EXEMPLO 39 CASA JARDIM EXEMPLO SAO PAULO SP" });
    expect(extrairContrato(SIM_CCB)).toMatchObject({ email: "maria.exemplo@gmail.com", endereco: "R DAS FLORES, 68 - cohab II - 15495-000 - SP" });
  });

  it("reads the client's CPF and the bank's CNPJ (used by the notificação)", () => {
    expect(extrairContrato(SANTANDER_CDC)).toMatchObject({ cpf: "000.000.000-00", cnpjInstituicao: "07.707.650/0001-10", modalidade: "financiamento" });
    expect(extrairContrato(SIM_CCB)).toMatchObject({ cpf: "000.000.000-00", cnpjInstituicao: "07.707.650/0001-10", modalidade: "empréstimo" });
  });

  it("reads the labeled monthly and yearly rates, not the daily one", () => {
    expect(dados).toMatchObject({ taxaMensal: 2, taxaAnual: 26.82 });
  });

  it("reads the rest of the contract", () => {
    expect(dados).toMatchObject({
      contrato: "101601607/00693981806", garantia: "BAJAJ DOMINAR 250 2025", valorSolicitado: 23000, valorFinanciado: 26041.53,
      parcelas: 48, valorParcela: 848.37, primeiroVencimento: "30/11/2025", dataContrato: "31/10/2025", iof: 98.56,
    });
    expect(dados.encargos).toEqual({ seguros: 1488, cadastro: 1149, registro: 305.97, avaliacao: null });
    expect(problemasLaudo(dados)).toEqual([]);
    expect(avisosLaudo(dados)).toEqual([]);
  });
});

// Page 1 of a Stellantis (Fiat) orçamento CDC Veículos, personal data replaced. The bank's name wraps,
// its CNPJ is alone below it, and the rate cells sit a little above their label.
const STELLANTIS_CDC = [
  line(820, "[110]STELLANTIS FINANCIAMENTOS SOCIEDADE DE CRÉDITO, FINANCIAMENTO E"),
  line(809, "[110]INVESTIMENTO S.A."),
  line(798, "[250]CNPJ 03.502.961/0001-92"),
  line(787, "[160]ORÇAMENTO DE OPERAÇÃO DE CRÉDITO DIRETO AO CONSUMIDOR (CDC) - VEÍCULOS"),
  line(776, "[430]ORÇAMENTO N° 210937397"),
  line(731, "[30]A.1 [62]Nome do(a) consumidor(a): JOSÉ EXEMPLO [330]CPF/CNPJ do(a) solicitante: 000.000.000-00"),
  line(720, "[62]Endereço e telefone de contato: RUA EXEMPLO/ Nº: 185/ CEP: 52291150/ TEL: 8199999-0000"),
  line(709, "[30]A.2 [62]Veículo: Marca: Fiat [226]Ano/Modelo: 2027 [340]Combustível: Flex Alcool + Gasolina"),
  line(698, "[62]Modelo: CRONOS - 0P - - DRIVE 1.3 8V Flex Aut. [340]Cor: PRATA"),
  line(668, "[30]B.1 [62]Valor do veículo à vista [470]R$124.000,00"),
  line(536, "[30]B.8 [62]Seguro(s) – financiados [330][ ]sim [ X ]não [470]R$0,00 [530]0,00%"),
  line(525, "[30]B.8.1 [62]Seguro: | Seguradora: CNPJ:"),
  line(492, "[30]B.11 [62]Registro contrato - Cartório (cf. legislação estadual) - financiadas: [330][ X ]sim [ ]não [470]R$324,79 [530]0,29%"),
  line(481, "[30]B.12 [62]Registro contrato - órgão de trânsito ( Res. 689 CONTRAN) - [330][ ]sim [ X ]não [470]R$0,00 [530]0,00%"),
  line(448, "[30]C.1 [62]Valor da entrada [470]R$15.000,00"),
  line(437, "[30]C.2 [62]Valor Líquido Liberado (B.1+B.2+B.3+B.4+B.5+B.6 +B.7+ B.9 + B.10-C.1) [470]R$109.000,00 [530]95,69%"),
  // The amount cells of D.1 and F.7 sit a few points off their labels, as in the real PDF.
  line(405, "[38]Opção pela contratação da Tarifa de cadastro(³):"),
  line(400, "[10]D.1 [491]R$1.199,00 1,05%"),
  line(393, "[38]Financiado[X]"),
  line(382, "[30]D.2 [62]Tarifa de avaliação do veículo usado(garantia da operação) Isenta: [X]sim []não À [470]R$0,00 [530]0,00%"),
  line(360, "[30]D.3 [62]Total de tarifas a serem financiadas [470]R$1.199,00 [530]1,05%"),
  line(338, "[30]E.1 [62]Valor total a ser financiado sem impostos (B.13 - C.1 + D.3) [470]R$110.523,79"),
  line(327, "[30]E.2 [62]IOF - financiado: [330][ X ]sim [ ]não [410]Alíquota: [470]R$3.384,92 [530]2,97%"),
  line(316, "[30]E.3 [62]IOF -aliquota adicional (Decreto 12.499/2025) - [330][ X ]sim [ ]não [410]0,38% (única)"),
  line(305, "[30]E.4 [62]Total de impostos a serem financiados [470]R$3.384,92 [530]2,97%"),
  line(283, "[30]F.1 [62]Data do 1° Vencimento [480]23/07/2026"),
  line(272, "[30]F.2 [62]Número de parcelas mensais comuns [500]60"),
  line(261, "[30]F.3 [62]Valor de cada parcela mensal comum [470]R$ 2.980,17"),
  line(250, "[30]F.4 [62]Número de parcelas mensais diferenciadas [500]0"),
  line(244, "[220]mensal % a.m.: 1,62% [380]anual % a.a.: 21,23%"),
  line(239, "[30]F.6 [62]Taxa de juros mensal e anual"),
  line(233, "[479]R$113.908,71 100,00"),
  line(228, "[10]F.7 [38]Valor Total Financiado (Com Impostos) (E.1 + E.4)"),
  line(150, "[62]Prazo de validade do orçamento (¹):3 [200]Local: RECIFE [400]Data: 23/06/2026"),
];

describe("extrairContrato (Stellantis CDC Veículos)", () => {
  const leitura = extrairContrato(STELLANTIS_CDC);
  const { dados } = leitura;

  it("reads the client, the bank on two lines and its CNPJ on the line below", () => {
    expect(leitura).toMatchObject({ cpf: "000.000.000-00", cnpjInstituicao: "03.502.961/0001-92", modalidade: "financiamento", endereco: "RUA EXEMPLO/ Nº: 185/ CEP: 52291150" });
    expect(dados).toMatchObject({
      contratante: "JOSÉ EXEMPLO",
      instituicao: "STELLANTIS FINANCIAMENTOS SOCIEDADE DE CRÉDITO, FINANCIAMENTO E INVESTIMENTO S.A.",
      contrato: "210937397",
      garantia: "Fiat CRONOS - 0P - - DRIVE 1.3 8V Flex Aut. 2027",
    });
  });

  it("takes the interest rate, not the 0,38% of the IOF", () => {
    expect(dados).toMatchObject({ taxaMensal: 1.62, taxaAnual: 21.23 });
  });

  it("reads the rest of the orçamento", () => {
    expect(dados).toMatchObject({
      valorSolicitado: 109000, valorFinanciado: 113908.71, parcelas: 60, valorParcela: 2980.17,
      primeiroVencimento: "23/07/2026", dataContrato: "23/06/2026", iof: 3384.92,
    });
    expect(dados.encargos).toEqual({ seguros: null, cadastro: 1199, registro: 324.79, avaliacao: null });
  });
});

describe("extrairContrato", () => {
  const { dados } = extrairContrato(SIM_CCB);

  it("reads the parties, the vehicle and the dates", () => {
    expect(dados).toMatchObject({
      contrato: "663795516",
      contratante: "MARIA DA SILVA EXEMPLO",
      instituicao: "AYMORÉ CRÉDITO, FINANCIAMENTO E INVESTIMENTO S.A.",
      garantia: "TOYOTA COROLLA GLI 1.8 FLEX 16V AUT. 2017/2018",
      dataContrato: "07/01/2025",
      primeiroVencimento: "06/02/2025",
    });
  });

  it("reads the amounts, the term and the rates", () => {
    expect(dados).toMatchObject({ valorSolicitado: 50000, valorFinanciado: 55885.04, valorParcela: 1845.54, parcelas: 60, taxaMensal: 2.59, taxaAnual: 35.91, iof: 1811.15 });
  });

  it("adds the charges and leaves the ones at zero as absent", () => {
    expect(dados.encargos).toEqual({ seguros: 3767.92, registro: 305.97, cadastro: null, avaliacao: null });
    expect(problemasLaudo(dados)).toEqual([]);
    expect(avisosLaudo(dados)).toEqual([]);
  });

  it("gives back an empty laudo for a PDF without text", () => {
    expect(extrairContrato([]).encontrados).toEqual([]);
  });
});

describe("calcularLaudo", () => {
  // Same numbers as the parecer the team made by hand for this contract.
  const laudo = calcularLaudo(extrairContrato(SIM_CCB).dados);

  it("uses the rate the payment implies, not the rounded one in the contract", () => {
    expect(laudo.taxaEfetiva).toBeCloseTo(0.0259053, 6);
    expect(laudo.original.linhas[0]).toMatchObject({ mes: 1 });
    expect(laudo.original.linhas[0].juros).toBeCloseTo(1447.72, 2);
    expect(laudo.original.linhas[1].juros).toBeCloseTo(1437.41, 2);
  });

  it("recalculates without the charges", () => {
    expect(laudo.encargos).toBe(4073.89);
    expect(laudo.recalculado.valorFinanciado).toBe(51811.15);
    expect(laudo.recalculado.prestacao).toBeCloseTo(1711, 2);
    expect(laudo.recalculado.linhas.at(-1)!.prestacao).toBeCloseTo(1711, 2);
    expect(laudo.recalculado.totalPago).toBeCloseTo(102660.26, 1);
    expect(laudo.diferencaParcela).toBe(134.54);
    expect(laudo.diferencaTotal).toBe(8072.4);
  });

  it("pays the debt off exactly, and the totals add up", () => {
    for (const tabela of [laudo.original, laudo.recalculado]) {
      expect(tabela.linhas).toHaveLength(60);
      expect(tabela.linhas.at(-1)!.saldo).toBe(0);
      expect(tabela.totalAmortizado).toBeCloseTo(tabela.valorFinanciado, 2);
      expect(tabela.totalPago).toBeCloseTo(tabela.totalAmortizado + tabela.totalJuros, 2);
    }
    expect(laudo.original.totalPago).toBeCloseTo(110732.4, 1);
  });

  it("falls back to the written rate when there is no payment", () => {
    const semParcela = calcularLaudo({ ...extrairContrato(SIM_CCB).dados, valorParcela: 0 });
    expect(semParcela.taxaEfetiva).toBe(0.0259);
    expect(semParcela.original.prestacao).toBe(1845.32);
  });

  it("reads amounts the way people type them", () => {
    expect(["R$ 50.000,00", "50000,00", "50000.00", "50000", "50.000"].map(parseBRL)).toEqual([50000, 50000, 50000, 50000, 50000]);
    expect(["1.845,54", "1845.54", "2,59%", "0,5"].map(parseBRL)).toEqual([1845.54, 1845.54, 2.59, 0.5]);
    expect(parseBRL("")).toBeNull();
  });

  it("refuses impossible data", () => {
    expect(impliedRate(1000, 10, 12)).toBeNull();
    expect(problemasLaudo(emptyLaudo())).toContain("Falta o valor financiado.");
  });
});

describe("buildLaudoPdf", () => {
  it("produces a PDF", async () => {
    const pdf = await buildLaudoPdf(extrairContrato(SIM_CCB).dados, new Date("2026-10-22T12:00:00Z"));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(10_000);
  });
});
