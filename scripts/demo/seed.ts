/**
 * Made-up data for the demo copy of the portal: every name, CPF, phone and e-mail is invented.
 * Dates are relative to now, so the dashboard always looks current.
 */
import { TERMS_VERSION } from "../../shared/termos";

const DAY = 86_400_000;
const now = Date.now();
const ago = (days: number, hours = 0) => new Date(now - days * DAY - hours * 3_600_000).toISOString();
const ahead = (days: number) => new Date(now + days * DAY);
const br = (date: Date) => date.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

type Cliente = [name: string, service: string, status: string, tone: string, progresso: number, createdDaysAgo: number, updatedDaysAgo: number, tags: string[], cidade: string, uf: string];
const CLIENTES: Cliente[] = [
  ["Mariana Costa Ribeiro", "Financiamento Veicular", "Em negociação", "green", 65, 40, 0, ["Financiamento Veicular"], "Campinas", "SP"],
  ["Rafael Mendes Araújo", "Financiamento Veicular", "Em andamento", "green", 45, 32, 1, [], "São Paulo", "SP"],
  ["Juliana Pereira Lima", "Empréstimo Pessoal", "Pendente documentação", "yellow", 20, 12, 3, ["Documentação pendente"], "Curitiba", "PR"],
  ["Carlos Eduardo Nunes", "Financiamento Imobiliário", "Em andamento judicial", "green", 80, 120, 2, ["VIP"], "Belo Horizonte", "MG"],
  ["Patrícia Gomes Silva", "Cartão de Crédito", "Em análise", "yellow", 10, 2, 2, [], "Santos", "SP"],
  ["Thiago Alves Ferreira", "Financiamento Veicular", "Atenção necessária", "red", 35, 60, 18, ["Aguardando cliente"], "Ribeirão Preto", "SP"],
  ["Fernanda Rocha Martins", "Empréstimo Consignado", "Concluído", "green", 100, 150, 9, [], "Goiânia", "GO"],
  ["Lucas Oliveira Santos", "Financiamento Veicular", "Em negociação", "green", 70, 55, 4, [], "Sorocaba", "SP"],
  ["Camila Duarte Moreira", "Empréstimo Pessoal", "Pendente contato", "yellow", 15, 6, 6, [], "Florianópolis", "SC"],
  ["Bruno Cardoso Teixeira", "Financiamento Veicular", "Em andamento", "green", 50, 28, 1, ["Financiamento Veicular"], "Uberlândia", "MG"],
  ["Aline Souza Barbosa", "Financiamento Imobiliário", "Em análise", "yellow", 5, 1, 1, [], "Salvador", "BA"],
  ["Ricardo Lopes Freitas", "Cartão de Crédito", "Suspenso", "red", 30, 90, 25, [], "Recife", "PE"],
  ["Beatriz Campos Vieira", "Financiamento Veicular", "Em andamento", "green", 40, 20, 0, [], "Jundiaí", "SP"],
  ["Gustavo Henrique Prado", "Empréstimo Consignado", "Em negociação", "green", 60, 45, 5, [], "Porto Alegre", "RS"],
];

const ruas = ["Rua das Acácias", "Avenida Brasil", "Rua Sete de Setembro", "Rua dos Ipês", "Avenida Paulista", "Rua Tiradentes", "Rua XV de Novembro"];

const clientes = CLIENTES.map(([name, service, status, tone, progresso, created, updated, tags, cidade, uf], index) => {
  const id = index + 1;
  const first = name.split(" ")[0].toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return {
    id, name, cpf: `000.${String(100 + id).padStart(3, "0")}.${String(200 + id * 7).padStart(3, "0")}-00`,
    type: service, services: [service], status, tone, progresso, tags,
    email: `${first}.cliente@exemplo.com.br`, phone: `(11) 90000-${String(1000 + id * 37).slice(-4)}`,
    created_at: ago(created), atualizado_em: ago(updated, 3), updated: "",
    cep: `01${String(310 + id).padStart(3, "0")}-100`, endereco: `${ruas[index % ruas.length]}, ${120 + id * 13}`, bairro: "Centro", cidade, uf,
    conversa_respondida_em: null,
  };
});

const documentos = [
  { id: 1, client_id: 1, nome: "Contrato de financiamento.pdf", descricao: "Cópia enviada pela cliente", tamanho: 412_000, tipo: "application/pdf", caminho: "cliente-1/contrato.pdf", enviado_por: "equipe@demo.portal", created_at: ago(38) },
  { id: 2, client_id: 1, nome: "Procuração extrajudicial - MARIANA COSTA RIBEIRO.pdf", descricao: "Procuração extrajudicial (consumidor.gov.br)", tamanho: 21_000, tipo: "application/pdf", caminho: "cliente-1/procuracao.pdf", enviado_por: "equipe@demo.portal", created_at: ago(30) },
  { id: 3, client_id: 1, nome: "Notificação extrajudicial com contrato - MARIANA COSTA RIBEIRO.pdf", descricao: "Notificação ao banco sobre os juros do contrato", tamanho: 180_000, tipo: "application/pdf", caminho: "cliente-1/notificacao.pdf", enviado_por: "equipe@demo.portal", created_at: ago(9) },
  { id: 4, client_id: 1, nome: "Comprovante de residência.pdf", descricao: null, tamanho: 96_000, tipo: "application/pdf", caminho: "cliente-1/comprovante.pdf", enviado_por: "equipe@demo.portal", created_at: ago(39) },
  { id: 5, client_id: 2, nome: "Contrato CDC veículo.pdf", descricao: null, tamanho: 380_000, tipo: "application/pdf", caminho: "cliente-2/contrato.pdf", enviado_por: "equipe@demo.portal", created_at: ago(30) },
  { id: 6, client_id: 4, nome: "Petição inicial.pdf", descricao: "Protocolada", tamanho: 250_000, tipo: "application/pdf", caminho: "cliente-4/peticao.pdf", enviado_por: "equipe@demo.portal", created_at: ago(20) },
];

const eventos = [
  { id: 1, client_id: 1, tipo: "cadastro", titulo: "Cadastro realizado", descricao: "Início do processo: Financiamento Veicular", autor: "equipe@demo.portal", created_at: ago(40) },
  { id: 2, client_id: 1, tipo: "documento", titulo: "Novo documento", descricao: "Contrato de financiamento.pdf", autor: "equipe@demo.portal", created_at: ago(38) },
  { id: 3, client_id: 1, tipo: "status", titulo: "Status atualizado", descricao: "Em análise → Em andamento", autor: "equipe@demo.portal", created_at: ago(31) },
  { id: 4, client_id: 1, tipo: "documento", titulo: "Novo documento", descricao: "Procuração extrajudicial - MARIANA COSTA RIBEIRO.pdf", autor: "equipe@demo.portal", created_at: ago(30) },
  { id: 5, client_id: 1, tipo: "progresso", titulo: "Progresso atualizado", descricao: "Progresso do caso atualizado para 40%", autor: "equipe@demo.portal", created_at: ago(22) },
  { id: 6, client_id: 1, tipo: "documento", titulo: "Novo documento", descricao: "Notificação extrajudicial com contrato - MARIANA COSTA RIBEIRO.pdf", autor: "equipe@demo.portal", created_at: ago(9) },
  { id: 7, client_id: 1, tipo: "status", titulo: "Status atualizado", descricao: "Em andamento → Em negociação", autor: "equipe@demo.portal", created_at: ago(2) },
  { id: 8, client_id: 1, tipo: "progresso", titulo: "Progresso atualizado", descricao: "Progresso do caso atualizado para 65%", autor: "equipe@demo.portal", created_at: ago(2) },
];

let messageId = 0;
const msg = (client_id: number, sender: string, text: string, created_at: string) => ({ id: ++messageId, client_id, client_name: clientes[client_id - 1].name, sender, text, time: hhmm(created_at), created_at });
const mensagens = [
  msg(1, "client", "Boa tarde! O banco já respondeu a notificação?", ago(2, 5)),
  msg(1, "team", "Oi, Mariana! Respondeu sim: abriram negociação. Atualizamos o status no portal.", ago(2, 3)),
  msg(1, "client", "Que ótimo, obrigada!", ago(2, 2)),
  msg(2, "client", "Mandei o contrato pelo portal, chegou certinho?", ago(0, 3)),
  msg(3, "client", "Qual documento ainda falta enviar?", ago(0, 5)),
  msg(6, "client", "Preciso falar com alguém sobre o meu caso.", ago(1, 2)),
  msg(10, "client", "Bom dia, tudo bem? Alguma novidade?", ago(0, 1)),
  msg(10, "team", "Bom dia, Bruno! Estamos aguardando o retorno do banco, prazo até sexta.", ago(0, 0.5)),
];

const chargebacks = [
  { id: 1, client: "Ricardo Lopes Freitas", cliente_id: 12, bank: "Banco Pan S.A.", amount: "R$ 4.380,00", valor: 4380, deadline: br(ahead(3)), status: "Em análise", tone: "yellow", created_at: ago(15), atualizado_em: ago(2), historico: [] },
  { id: 2, client: "Thiago Alves Ferreira", cliente_id: 6, bank: "Banco Votorantim S.A.", amount: "R$ 2.150,00", valor: 2150, deadline: br(ahead(-2)), status: "Aguardando banco", tone: "red", created_at: ago(30), atualizado_em: ago(10), historico: [] },
  { id: 3, client: "Fernanda Rocha Martins", cliente_id: 7, bank: "Banco C6 S.A.", amount: "R$ 1.790,00", valor: 1790, deadline: br(ahead(-20)), status: "Revertido", tone: "green", created_at: ago(60), atualizado_em: ago(20), historico: [] },
];

const consultores = [
  { id: 1, nome: "Ana Paula", ativo: true, created_at: ago(200) },
  { id: 2, nome: "Diego", ativo: true, created_at: ago(200) },
  { id: 3, nome: "Larissa", ativo: true, created_at: ago(120) },
];

const vendas = Array.from({ length: 36 }, (_, index) => {
  const daysAgo = Math.floor(index * 9.5);
  const date = new Date(now - daysAgo * DAY);
  const gross = [2400, 3200, 1800, 4500, 2900, 3600][index % 6];
  return {
    id: index + 1, date: br(date), client: clientes[index % clientes.length].name, phone: clientes[index % clientes.length].phone,
    consultants: [consultores[index % 3].nome], product: clientes[index % clientes.length].type, status: index % 7 === 3 ? "Pendente" : "OK",
    cbk: index === 5, gross, net: Math.round(gross * 0.88), note: "", setor: index % 4 === 0 ? "juridico" : "comercial", created_at: date.toISOString(),
  };
});

/** Logins: the team member who records the video, and clients who received access (most accepted the terms). */
const users = [
  { id: "demo-equipe", token: "demo-staff", email: "equipe@demo.portal", created_at: ago(300), last_sign_in_at: ago(0), app_metadata: { role: "admin" }, user_metadata: { full_name: "Equipe" } },
  ...clientes.slice(0, 11).map((cliente, index) => ({
    id: `demo-cliente-${cliente.id}`, token: cliente.id === 1 ? "demo-client" : `demo-client-${cliente.id}`, email: cliente.email,
    created_at: cliente.created_at, last_sign_in_at: index % 3 === 2 ? null : ago(index),
    app_metadata: {
      role: "client", cliente_id: cliente.id,
      ...(index % 4 === 3 ? { first_access: { expires_at: ago(-3), sent_at: ago(1), reminded: false } } : { terms: { version: TERMS_VERSION, accepted_at: ago(Math.max(0, Math.floor(index * 2.3)), 5), ip: "200.100.10.1", user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile Safari/604.1" } }),
    },
    user_metadata: { full_name: cliente.name },
  })),
];

export const seed = {
  tables: { clientes, documentos, cliente_eventos: eventos, mensagens, chargebacks, consultores, vendas, auditoria: [], push_inscricoes: [] } as Record<string, Record<string, any>[]>,
  users: users as Record<string, any>[],
  files: {} as Record<string, Buffer>,
};
