import type { TicketTopic } from "@shared/tickets";

/**
 * Scripted assistant shown in the client's chat. No AI: every answer below is fixed text,
 * filled in with the client's own process data where it says so.
 * To change what the assistant says, edit the `reply` texts and `options` of each step,
 * the status explanations in STATUS_MEANING, or the words in TOPIC_WORDS.
 */

export type ProcessInfo = {
  firstName: string;
  type: string;
  status: string;
  updated: string;
  progress: number;
  /** Newest first, as the server lists them. */
  documents: { nome: string; created_at: string }[];
  lastEvent: { titulo: string; created_at: string } | null;
};

export type BotStepId = "menu" | "andamento" | "documentos" | "prazos" | "pagamentos" | "novidades" | "atendente";

type BotStep = {
  /** Text on the quick-reply button that leads to this step. */
  label: string;
  reply: (process: ProcessInfo, topic: TicketTopic) => string;
  /** Buttons offered after the reply. */
  options: BotStepId[];
  /** Subject the ticket gets if the client asks for an attendant from here. */
  topic?: TicketTopic;
  /** After this reply, the next message the client types becomes a ticket for the team. */
  opensTicket?: boolean;
};

const MAIN_OPTIONS: BotStepId[] = ["andamento", "documentos", "prazos", "pagamentos", "novidades", "atendente"];

const day = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

/** What each status of shared/processo.ts means, told to the client. */
const STATUS_MEANING: Record<string, string> = {
  "Em análise": "A equipe está estudando o seu contrato e as informações do caso para definir o melhor caminho.",
  "Pendente documentação": "Estamos aguardando documentos para dar o próximo passo.",
  "Pendente contato": "A equipe precisa falar com você. Fique atento ao telefone e ao WhatsApp, ou deixe uma mensagem aqui.",
  "Em andamento": "Seu caso está sendo trabalhado pela equipe.",
  "Em negociação": "Estamos negociando o seu caso com a instituição.",
  "Em andamento judicial": "Seu caso está na Justiça, e cada etapa depende do andamento do tribunal.",
  "Atenção necessária": "Há um ponto do seu caso que precisa da sua atenção. Fale com um atendente para saber qual.",
  "Concluído": "Seu processo foi concluído.",
  "Suspenso": "Seu processo está parado no momento. Fale com um atendente para entender o motivo.",
};

function andamentoReply(p: ProcessInfo) {
  return [
    `Seu processo de ${p.type} está com a situação "${p.status}"${p.progress > 0 ? `, com ${p.progress}% de progresso` : ""}.`,
    STATUS_MEANING[p.status] ?? "",
    p.lastEvent ? `Última movimentação: ${p.lastEvent.titulo.toLowerCase()}, em ${day(p.lastEvent.created_at)}.` : `Última atualização: ${p.updated}.`,
    "Sempre que houver novidade, ela aparece aqui no portal, em Histórico.",
  ].filter(Boolean).join("\n\n");
}

function documentosReply(p: ProcessInfo) {
  const attached = p.documents.length === 0
    ? "A equipe ainda não anexou documentos ao seu processo."
    : `A equipe já anexou ${p.documents.length === 1 ? "1 documento" : `${p.documents.length} documentos`} ao seu processo (o mais recente: "${p.documents[0].nome}", em ${day(p.documents[0].created_at)}). Para baixar, abra a seção Documentos em Meu processo.`;
  const needed = p.status === "Pendente documentação"
    ? "Seu processo está aguardando documentos. Se você não sabe o que falta, fale com um atendente e ele explica o que enviar."
    : "Normalmente pedimos documento com foto (RG ou CNH), comprovante de residência e o contrato com o banco. Se faltar algo no seu caso, a equipe avisa por esta conversa.";
  return `${attached}\n\n${needed}`;
}

function prazosReply(p: ProcessInfo) {
  if (p.status === "Concluído") return "Seu processo já foi concluído. Se ainda ficou alguma dúvida, fale com um atendente.";
  const why = p.status === "Em andamento judicial"
    ? "Como seu caso está na Justiça, o prazo depende do tribunal, e não conseguimos garantir uma data exata."
    : "O prazo depende da análise de cada caso e do retorno do banco, por isso não conseguimos garantir uma data exata.";
  return `${why}\n\nA situação do seu processo é atualizada aqui a cada etapa${p.progress > 0 ? ` (hoje ele está em ${p.progress}%)` : ""}.`;
}

export const BOT_STEPS: Record<BotStepId, BotStep> = {
  menu: {
    label: "Ver outras opções",
    reply: () => "Como posso ajudar?",
    options: MAIN_OPTIONS,
  },
  andamento: {
    label: "Como está meu processo?",
    reply: andamentoReply,
    options: ["prazos", "atendente", "menu"],
    topic: "Andamento do processo",
  },
  documentos: {
    label: "Documentos",
    reply: documentosReply,
    options: ["atendente", "menu"],
    topic: "Documentos",
  },
  prazos: {
    label: "Quanto tempo demora?",
    reply: prazosReply,
    options: ["andamento", "atendente", "menu"],
    topic: "Prazos",
  },
  pagamentos: {
    label: "Pagamentos e valores",
    reply: () => "Dúvidas sobre valores, pagamentos ou contrato são tratadas direto com a equipe.\n\nEscreva sua pergunta no campo abaixo e um atendente responde por aqui.",
    options: ["menu"],
    topic: "Pagamentos e valores",
    opensTicket: true,
  },
  novidades: {
    label: "Como fico sabendo das novidades?",
    reply: () => "Toda mudança no seu processo aparece aqui no portal: a situação, o progresso, os documentos e o histórico.\n\nSe você instalar o app e ativar as notificações (no cartão do topo do portal), o celular avisa quando a equipe responder, quando a situação mudar e quando chegar documento novo.",
    options: ["andamento", "menu"],
  },
  atendente: {
    label: "Falar com um atendente",
    reply: (_p, topic) => `Certo! Escreva sua dúvida no campo abaixo e envie. Ela vai para a equipe da Zentry com o assunto "${topic}", e a resposta aparece aqui nesta conversa.`,
    options: ["menu"],
    opensTicket: true,
  },
};

/** Words that point to a topic in what the client types, checked in this order (accents and case ignored). */
const TOPIC_WORDS: [BotStepId, RegExp][] = [
  ["pagamentos", /\b(pag|valor|boleto|pix|parcela|cartao|cobra|reembols|devolu|dinheiro|preco|desconto|multa|juros)/],
  ["prazos", /\b(prazo|demora|quanto tempo|quando|previsao|data|ate quando|falta muito)/],
  ["documentos", /\b(document|rg\b|cnh|comprovante|anex|arquivo|certidao|laudo|foto|enviar|mandar)/],
  ["novidades", /\b(notifica|aviso|avisa|aplicativo|app\b|instal)/],
  ["andamento", /\b(andamento|status|situacao|como esta|como ta|novidade|atualiza|processo|caso|etapa|progresso)/],
  ["atendente", /\b(atendente|humano|pessoa|falar com|ligar|ligacao|telefone|whats|contato|advogad)/],
];

export type TypedIntent = { kind: "step"; step: BotStepId } | { kind: "saudacao" } | { kind: "agradecimento" } | { kind: "nenhum" };

const plain = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** What the assistant makes of a message the client typed instead of tapping a button. */
export function readTypedMessage(text: string): TypedIntent {
  const words = plain(text);
  const short = words.split(" ").length <= 4;
  if (short && /^(oi+|ola|opa|bom dia|boa tarde|boa noite|e ai|tudo bem|hello)\b/.test(words)) return { kind: "saudacao" };
  if (short && /\b(obrigad|valeu|agradec|brigad)/.test(words)) return { kind: "agradecimento" };
  const match = TOPIC_WORDS.find(([, pattern]) => pattern.test(words));
  return match ? { kind: "step", step: match[0] } : { kind: "nenhum" };
}

/** Questions longer than this are left to the team: the assistant only gives them a subject. */
export const LONG_QUESTION = 200;

export const GREETING_REPLY = (firstName: string) => `Olá${firstName ? `, ${firstName}` : ""}! Como posso ajudar? Escolha uma opção ou escreva sua dúvida.`;
export const THANKS_REPLY = "Por nada! Se precisar de mais alguma coisa, é só chamar.";
/** Opens the assistant's answer that follows the "sent to the team" notice. */
export const WHILE_WAITING = "Enquanto isso, o que já posso adiantar:";

export function greeting(process: ProcessInfo) {
  return `Olá, ${process.firstName}! Sou o assistente virtual da Zentry Soluções. Escolha uma opção abaixo ou escreva sua dúvida.`;
}

export const TICKET_SENT_REPLY = "Pronto, sua mensagem foi enviada para a equipe. A resposta aparece aqui nesta conversa, normalmente em horário comercial.";
