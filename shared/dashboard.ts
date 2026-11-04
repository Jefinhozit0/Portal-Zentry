/**
 * Rules behind the dashboard numbers. Status names are compared ignoring case and accents.
 * Adjust these lists when the team starts using new status names.
 */
export const DASHBOARD_RULES = {
  /** Client is done: leaves "ativos" and counts in "Concluídos". */
  concludedStatuses: ["Concluído", "Finalizado", "Encerrado"],
  /** Client is left out of the metrics (also any client whose sale had a chargeback). */
  disregardedStatuses: ["Suspenso", "Cancelado", "Desistência", "Desistente"],
  /** No activity at all (status change or message) for this many days. */
  idleDays: 10,
  /** Team has not updated the process status for this many days. */
  staleDays: 15,
  /** Client logged into the portal within this many days. */
  recentLoginDays: 30,
  /** Chargeback won: counts as reverted and its amount as recovered. */
  chargebackSuccessStatuses: ["Revertido", "Recuperado", "Aprovado", "Concluído", "Pago"],
  /** Chargeback lost or dropped: closed, but not reverted. */
  chargebackFailedStatuses: ["Negado", "Indeferido", "Perdido", "Cancelado", "Recusado"],
} as const;

const normalizeStatus = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Where a chargeback stands according to the rules above: won, lost or still open. */
export function chargebackOutcome(status: unknown): "won" | "lost" | "open" {
  const value = normalizeStatus(status);
  if (DASHBOARD_RULES.chargebackSuccessStatuses.some((item) => normalizeStatus(item) === value)) return "won";
  if (DASHBOARD_RULES.chargebackFailedStatuses.some((item) => normalizeStatus(item) === value)) return "lost";
  return "open";
}

/** Lists the dashboard can open already filtered. The ids come from the server, so the list always matches the number. */
export const CLIENT_LIST_FILTERS = {
  ativos: "Clientes ativos",
  ociosos: `Ociosos há ${DASHBOARD_RULES.idleDays}+ dias`,
  semAtualizacao: `Sem atualização há ${DASHBOARD_RULES.staleDays}+ dias`,
  atencao: "Atenção necessária",
  concluidos: "Concluídos",
  desconsiderados: "Desconsiderados (suspensos ou com chargeback)",
} as const;
export const CHARGEBACK_LIST_FILTERS = {
  abertos: "Chargebacks em aberto",
  vencidos: "Prazos de chargeback vencidos",
} as const;
export type ClientListFilter = keyof typeof CLIENT_LIST_FILTERS;
export type ChargebackListFilter = keyof typeof CHARGEBACK_LIST_FILTERS;
export type ListFilter = ClientListFilter | ChargebackListFilter;

/** What each dashboard number means, shown when hovering the card. */
export const METRIC_HELP: Record<string, string> = {
  ativos: "Clientes que não estão concluídos nem desconsiderados.",
  desconsiderados: "Clientes suspensos/cancelados ou cuja venda teve chargeback. Ficam fora das demais métricas.",
  andamento: "Clientes ativos que não estão marcados como \"atenção necessária\".",
  concluidos: "Clientes com status de concluído.",
  ociosos: `Clientes ativos sem nenhuma movimentação (atualização de status ou mensagem) há ${DASHBOARD_RULES.idleDays} dias ou mais.`,
  semAtualizacao: `Clientes ativos cujo status não é atualizado pela equipe há ${DASHBOARD_RULES.staleDays} dias ou mais.`,
  pendentes: "Conversas em que a última mensagem é do cliente (aguardando resposta da equipe) e que não foram marcadas como respondidas.",
  ativos30d: `Clientes que entraram no portal nos últimos ${DASHBOARD_RULES.recentLoginDays} dias.`,
  aceite: "Clientes com login no portal que aceitaram a versão atual dos termos.",
  conversao: "Conversas iniciadas por clientes que já foram respondidas pela equipe.",
  cbkAbertos: "Chargebacks que ainda não foram revertidos nem negados.",
  reversao: "Chargebacks revertidos dentre os já encerrados (revertidos + negados).",
  ticketCbk: "Valor médio dos chargebacks registrados.",
};
