/** Status the team can set on a client's process, with the color shown next to it. */
export const PROCESS_STATUSES = [
  { label: "Em análise", tone: "yellow" },
  { label: "Pendente documentação", tone: "yellow" },
  { label: "Pendente contato", tone: "yellow" },
  { label: "Em andamento", tone: "green" },
  { label: "Em negociação", tone: "green" },
  { label: "Em andamento judicial", tone: "green" },
  { label: "Atenção necessária", tone: "red" },
  { label: "Concluído", tone: "green" },
  { label: "Suspenso", tone: "red" },
] as const;

/** Services the client can sign up for in the cadastro. */
export const CLIENT_SERVICES = ["Financiamento Imobiliário", "Financiamento Veicular", "Empréstimo Pessoal", "Empréstimo Consignado", "Cartão de Crédito", "Outros"];

/** Status of a client who was just registered. */
export const INITIAL_STATUS = PROCESS_STATUSES[0];

export type ProcessTone = "green" | "yellow" | "red";

export function toneForStatus(status: string, fallback: ProcessTone = "yellow"): ProcessTone {
  return PROCESS_STATUSES.find((option) => option.label === status)?.tone ?? fallback;
}

/** Biggest file the team can attach (the browser sends it to the server inside the request). */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** enviado_por of what the client attaches in the portal (the team's documents have the member's e-mail). */
export const CLIENT_DOCUMENT_AUTHOR = "cliente";
/** Enough for a document photographed page by page; it keeps a stolen login from filling the Storage. */
export const MAX_CLIENT_DOCUMENTS_PER_DAY = 30;
/** Listing JPEG and not "image/*" makes the iPhone convert its HEIC photos, which Windows often cannot open. */
export const CLIENT_DOCUMENT_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";

/** The real type of a file, from its first bytes (the name and the type the browser reports can be anything). Null: not accepted from clients. */
export function tipoDoDocumentoCliente(bytes: Uint8Array): string | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...Array.from(bytes.subarray(start, end)));
  if (ascii(0, 5) === "%PDF-") return "application/pdf";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

export type ProcessEventType = "cadastro" | "status" | "progresso" | "documento";

const summaryDate = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

/**
 * Short text about the case, built from its data. The team sees it in the third person and the
 * client in the second. Documents and events come newest first, as the server lists them.
 */
export function caseSummary(
  data: { name: string; type?: string | null; status?: string | null; progress: number; documents: { created_at: string }[]; events: { titulo: string; created_at: string }[] },
  audience: "equipe" | "cliente",
) {
  const type = data.type || "tipo ainda não definido";
  const status = data.status || "sem status";
  const lastEvent = data.events[0];
  const docs = data.documents.length;
  return [
    audience === "equipe"
      ? `${data.name.split(" ")[0]} tem um processo de ${type}, com status "${status}" e ${data.progress}% de progresso.`
      : `Seu processo de ${type} está com status "${status}" e ${data.progress}% de progresso.`,
    docs === 0
      ? (audience === "equipe" ? "Nenhum documento anexado até agora." : "A equipe ainda não anexou documentos.")
      : `${docs} ${docs === 1 ? "documento anexado" : "documentos anexados"}, o mais recente em ${summaryDate(data.documents[0].created_at)}.`,
    lastEvent ? `Última movimentação: ${lastEvent.titulo.toLowerCase()} em ${summaryDate(lastEvent.created_at)}.` : "",
  ].filter(Boolean).join(" ");
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/** Tag that pauses the automatic notices about changes (status, documents), for edits the client doesn't need to hear about. Chat replies still go out. */
export const NO_NOTICES_TAG = "Sem avisos";

/** Tag on clients brought in from the old system (scripts/importar-clientes.ts): their access message invites them to switch. */
export const OLD_SYSTEM_TAG = "Sistema antigo";
