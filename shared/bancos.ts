/**
 * Banks and financial companies the team works with, as notified in the documents: legal name (razão
 * social), CNPJ and head-office address, all checked against the Receita Federal register in
 * Oct/2026. "apelidos" are the names they go by in contracts and in the team's list, to find them.
 */
export type Banco = { id: string; nome: string; cnpj: string; endereco: string; apelidos: string[] };

export const BANCOS: Banco[] = [
  { id: "santander", nome: "Banco Santander (Brasil) S.A.", cnpj: "90.400.888/0001-42", endereco: "Avenida Presidente Juscelino Kubitschek, nº 2041, conj. 281, Bloco A, Cond. WTorre JK, Vila Nova Conceição, São Paulo - SP, CEP: 04543-011", apelidos: ["santander"] },
  { id: "bb", nome: "Banco do Brasil S.A.", cnpj: "00.000.000/0001-91", endereco: "SAUN, Quadra 5, Bloco B, Torres I, II e III, Asa Norte, Brasília - DF, CEP: 70040-912", apelidos: ["banco do brasil"] },
  // Aymoré was renamed; it is the creditor of Santander's vehicle loans (SIM, CDC Veículos).
  { id: "aymore", nome: "Santander Sociedade de Crédito, Financiamento e Investimento S.A.", cnpj: "07.707.650/0001-10", endereco: "Avenida Presidente Juscelino Kubitschek, nº 2041, conj. 231, Bloco A, Cond. WTorre JK, Vila Nova Conceição, São Paulo - SP, CEP: 04543-011", apelidos: ["aymore", "santander sociedade de credito", "santander financiamentos"] },
  { id: "agibank", nome: "Banco Agibank S.A.", cnpj: "10.664.513/0001-50", endereco: "Rua Sérgio Fernandes Borges Soares, nº 1000, Prédio 12 E-1, Distrito Industrial, Campinas - SP, CEP: 13054-709", apelidos: ["agibank", "agiplan"] },
  { id: "banestes", nome: "Banestes S.A. Banco do Estado do Espírito Santo", cnpj: "28.127.603/0001-78", endereco: "Avenida Princesa Isabel, nº 574, Ed. Palas Center, Bloco B, 9º andar, Centro, Vitória - ES, CEP: 29010-930", apelidos: ["banestes"] },
  { id: "bmg", nome: "Banco BMG S.A.", cnpj: "61.186.680/0001-74", endereco: "Avenida Presidente Juscelino Kubitschek, nº 1830, 9º, 10º e 14º andares, Vila Nova Conceição, São Paulo - SP, CEP: 04543-900", apelidos: ["bmg"] },
  { id: "bmp", nome: "BMP Sociedade de Crédito Direto S.A.", cnpj: "34.337.707/0001-00", endereco: "Avenida Paulista, nº 1294, 6º andar, conj. 6A, Bela Vista, São Paulo - SP, CEP: 01310-915", apelidos: ["bmp", "money plus"] },
  { id: "bradesco", nome: "Banco Bradesco Financiamentos S.A.", cnpj: "07.207.996/0001-50", endereco: "Núcleo Cidade de Deus, s/n, 4º andar, Prédio Prata, Vila Yara, Osasco - SP, CEP: 06029-900", apelidos: ["bradesco"] },
  { id: "c6", nome: "Banco C6 S.A.", cnpj: "31.872.495/0001-72", endereco: "Avenida Nove de Julho, nº 3186, Jardim Paulista, São Paulo - SP, CEP: 01406-000", apelidos: ["c6"] },
  { id: "caixa", nome: "Caixa Econômica Federal", cnpj: "00.360.305/0001-04", endereco: "Setor Bancário Sul, Quadra 4, Bloco A, Asa Sul, Brasília - DF, CEP: 70092-900", apelidos: ["caixa economica", "caixa"] },
  { id: "creditas", nome: "Creditas Sociedade de Crédito Direto S.A.", cnpj: "32.997.490/0001-39", endereco: "Avenida das Nações Unidas, nº 14261, Anexo 02, 30º andar, Ala B, Cond. WT Morumbi, Vila Gertrudes, São Paulo - SP, CEP: 04794-000", apelidos: ["creditas"] },
  { id: "cresol", nome: "Confederação Nacional das Cooperativas Centrais de Crédito e Economia Familiar e Solidária – Cresol Confederação", cnpj: "10.398.952/0001-69", endereco: "Rua José Guidi Duarte, nº 170, Industrial, Francisco Beltrão - PR, CEP: 85601-659", apelidos: ["cresol"] },
  { id: "daycoval", nome: "Banco Daycoval S.A.", cnpj: "62.232.889/0001-90", endereco: "Avenida Paulista, nº 1793, Bela Vista, São Paulo - SP, CEP: 01311-200", apelidos: ["daycoval"] },
  { id: "digimais", nome: "Banco Digimais S.A.", cnpj: "92.874.270/0001-40", endereco: "Rua Arizona, nº 1426, 9º andar, conj. 91 e 92, Cidade Monções, São Paulo - SP, CEP: 04567-003", apelidos: ["digimais"] },
  { id: "first", nome: "First Sociedade de Crédito Direto S.A.", cnpj: "62.198.637/0001-91", endereco: "Avenida Brasil, nº 20384, Coelho Neto, Rio de Janeiro - RJ, CEP: 21515-000", apelidos: ["first sociedade de credito", "first scd"] },
  // Eagle Sociedade de Crédito Direto, renamed.
  { id: "futuro", nome: "Futuro Sociedade de Crédito Direto S.A.", cnpj: "45.745.537/0001-19", endereco: "Rua Furriel Luiz Antônio de Vargas, nº 250, 14º andar, sala A, Bela Vista, Porto Alegre - RS, CEP: 90470-130", apelidos: ["eagle", "futuro sociedade de credito"] },
  // Chevrolet's bank.
  { id: "gm", nome: "Banco GM S.A.", cnpj: "59.274.605/0001-13", endereco: "Avenida das Nações Unidas, nº 12495, Torre A, 6º, 10º e 11º andares, Brooklin Paulista, São Paulo - SP, CEP: 04578-000", apelidos: ["banco gm", "chevrolet", "gm"] },
  { id: "honda", nome: "Banco Honda S.A.", cnpj: "03.634.220/0001-65", endereco: "Rua Doutor José Áureo Bustamante, nº 377, 3º andar, Santo Amaro, São Paulo - SP, CEP: 04710-090", apelidos: ["banco honda", "honda"] },
  { id: "honda-leasing", nome: "Honda Leasing S.A. Arrendamento Mercantil", cnpj: "03.634.239/0001-01", endereco: "Avenida Senador Roberto Simonsen, nº 304, Santo Antônio, São Caetano do Sul - SP, CEP: 09530-401", apelidos: ["honda leasing"] },
  { id: "hyundai", nome: "Banco Hyundai Capital Brasil S.A.", cnpj: "30.172.491/0001-19", endereco: "Avenida das Nações Unidas, nº 14171, 24º andar, Torre Crystal, Vila Gertrudes, São Paulo - SP, CEP: 04794-000", apelidos: ["hyundai"] },
  { id: "itaucard", nome: "Banco Itaucard S.A.", cnpj: "17.192.451/0001-70", endereco: "Praça Alfredo Egydio de Souza Aranha, nº 100, Torre Olavo Setubal, 7º andar, Parque Jabaquara, São Paulo - SP, CEP: 04344-902", apelidos: ["itaucard", "itau"] },
  { id: "itau-unibanco", nome: "Itaú Unibanco S.A.", cnpj: "60.701.190/0001-04", endereco: "Praça Alfredo Egydio de Souza Aranha, nº 100, Torre Olavo Setubal, Parque Jabaquara, São Paulo - SP, CEP: 04344-902", apelidos: ["itau unibanco"] },
  { id: "mercado-pago", nome: "Mercado Pago Instituição de Pagamento Ltda.", cnpj: "10.573.521/0001-91", endereco: "Avenida das Nações Unidas, nº 3003, Letra Parte E, Bonfim, Osasco - SP, CEP: 06233-903", apelidos: ["mercado pago"] },
  // Parati Crédito, Financiamento e Investimento, renamed.
  { id: "meutudo", nome: "MeuTudo S.A. – Sociedade de Crédito, Financiamento e Investimento", cnpj: "03.311.443/0001-91", endereco: "Avenida Chedid Jafet, nº 222, Bloco B, conj. 12B, sala 3, Vila Olímpia, São Paulo - SP, CEP: 04551-065", apelidos: ["parati", "meutudo", "meu tudo"] },
  { id: "nubank", nome: "Nu Pagamentos S.A. – Instituição de Pagamento", cnpj: "18.236.120/0001-58", endereco: "Rua Capote Valente, nº 120, Pinheiros, São Paulo - SP, CEP: 05409-000", apelidos: ["nubank", "nu pagamentos"] },
  { id: "omni", nome: "Omni S.A. – Sociedade de Crédito, Financiamento e Investimento", cnpj: "92.228.410/0001-02", endereco: "Rua Doutor João Borges Filho, s/n, 5º andar, conj. 503, Vila Nova Conceição, São Paulo - SP, CEP: 04507-120", apelidos: ["omni"] },
  { id: "pan", nome: "Banco Pan S.A.", cnpj: "59.285.411/0001-13", endereco: "Avenida Paulista, nº 1374, Bela Vista, São Paulo - SP, CEP: 01310-916", apelidos: ["banco pan", "pan"] },
  { id: "picpay", nome: "PicPay Instituição de Pagamento S.A.", cnpj: "22.896.431/0001-10", endereco: "Avenida Manuel Bandeira, nº 291, Cond. Atlas Office Park, Vila Leopoldina, São Paulo - SP, CEP: 05317-020", apelidos: ["picpay"] },
  { id: "portoseg", nome: "Portoseg S.A. – Crédito, Financiamento e Investimento", cnpj: "04.862.600/0001-10", endereco: "Alameda Barão de Piracicaba, nº 740, 4º andar, Bloco Lado B, Cond. Torre B, Campos Elíseos, São Paulo - SP, CEP: 01216-012", apelidos: ["portoseg", "porto seguro"] },
  // Renault's and Nissan's bank.
  { id: "rci", nome: "Banco RCI Brasil S.A.", cnpj: "62.307.848/0001-15", endereco: "Rua Pasteur, nº 463, 1º andar, conj. 101, Água Verde, Curitiba - PR, CEP: 80250-104", apelidos: ["rci", "renault", "nissan"] },
  { id: "safra", nome: "Banco J. Safra S.A.", cnpj: "03.017.677/0001-20", endereco: "Avenida Paulista, nº 2150, Bela Vista, São Paulo - SP, CEP: 01310-300", apelidos: ["j. safra", "j safra", "safra"] },
  { id: "safra-credito", nome: "Safra Sociedade de Crédito, Financiamento e Investimento S.A.", cnpj: "45.437.547/0001-97", endereco: "Avenida Paulista, nº 2150, Bela Vista, São Paulo - SP, CEP: 01310-300", apelidos: ["safra sociedade de credito", "safra credito"] },
  { id: "sicoob", nome: "Banco Cooperativo Sicoob S.A.", cnpj: "02.038.232/0001-64", endereco: "Setor de Indústrias Gráficas, Quadra 06, nº 2080, Plano Piloto, Brasília - DF, CEP: 70610-460", apelidos: ["sicoob"] },
  { id: "sicredi", nome: "Banco Cooperativo Sicredi S.A.", cnpj: "01.181.521/0001-55", endereco: "Avenida Assis Brasil, nº 3940, 12º andar, São Sebastião, Porto Alegre - RS, CEP: 91060-900", apelidos: ["sicredi"] },
  { id: "stellantis", nome: "Banco Stellantis S.A.", cnpj: "62.237.425/0001-76", endereco: "Avenida Contorno, nº 3455, Galpão 9, sala 10, Paulo Camilo, Betim - MG, CEP: 32669-900", apelidos: ["banco stellantis", "stellantis"] },
  { id: "stellantis-financiamentos", nome: "Stellantis Financiamentos Sociedade de Crédito, Financiamento e Investimento S.A.", cnpj: "03.502.961/0001-92", endereco: "Avenida das Nações Unidas, nº 14261, 15º andar, Ala B, Vila Gertrudes, São Paulo - SP, CEP: 04794-000", apelidos: ["stellantis financiamentos"] },
  { id: "toyota", nome: "Banco Toyota do Brasil S.A.", cnpj: "03.215.790/0001-10", endereco: "Avenida Jornalista Roberto Marinho, nº 85, 3º andar, Cidade Monções, São Paulo - SP, CEP: 04576-010", apelidos: ["toyota"] },
  { id: "viacredi", nome: "Cooperativa de Crédito Vale do Itajaí – Viacredi", cnpj: "82.639.451/0001-38", endereco: "Rua Hermann Hering, nº 1125, Bom Retiro, Blumenau - SC, CEP: 89010-971", apelidos: ["viacredi"] },
  { id: "volkswagen", nome: "Banco Volkswagen S.A.", cnpj: "59.109.165/0001-49", endereco: "Rua Volkswagen, nº 291, Jabaquara, São Paulo - SP, CEP: 04344-020", apelidos: ["volkswagen", "vw"] },
  { id: "votorantim", nome: "Banco Votorantim S.A.", cnpj: "59.588.111/0001-03", endereco: "Avenida das Nações Unidas, nº 14171, Torre A, 18º andar, Vila Gertrudes, São Paulo - SP, CEP: 04794-000", apelidos: ["votorantim", "banco bv", "bv financeira"] },
  { id: "yamaha", nome: "Banco Yamaha Motor do Brasil S.A.", cnpj: "10.371.492/0001-85", endereco: "Avenida Magalhães de Castro, nº 4800, conj. 71 e 72, Torre 3, Edifício Continental Tower, Cidade Jardim, São Paulo - SP, CEP: 05676-120", apelidos: ["yamaha"] },
];

/** Alphabetical, for the lists in the forms. */
export const BANCOS_POR_NOME = [...BANCOS].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

const normalize = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const digits = (text: string) => text.replace(/\D/g, "");

/**
 * The bank of a contract: by its CNPJ when the contract has one, otherwise by name. When several
 * names match ("Itaú Unibanco" has "itau" in it), the longest one wins.
 */
export function bancoConhecido(instituicao: string, cnpj = ""): Banco | undefined {
  if (digits(cnpj).length === 14) {
    const byCnpj = BANCOS.find((banco) => digits(banco.cnpj) === digits(cnpj));
    if (byCnpj) return byCnpj;
  }
  const text = ` ${normalize(instituicao).replace(/[^a-z0-9.]+/g, " ")} `;
  let best: { banco: Banco; length: number } | undefined;
  for (const banco of BANCOS) {
    for (const apelido of banco.apelidos) {
      if (text.includes(` ${apelido} `) && (!best || apelido.length > best.length)) best = { banco, length: apelido.length };
    }
  }
  return best?.banco;
}
