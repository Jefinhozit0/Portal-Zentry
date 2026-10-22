import type { Genero } from "./genero";
import type { Modalidade } from "./notificacao";

/**
 * Termo de conhecimento de prestação de serviços: tells the client that the company sent the bank the
 * notificação extrajudicial asking for the contract. The client and the bank change; the company (shared/empresa.ts) is fixed.
 */
export type TermoDados = {
  nome: string;
  /** brasileiro/brasileira, inscrito/inscrita, denominado/denominada; null keeps "(a)". */
  genero: Genero | null;
  cpf: string;
  email: string;
  /** Full address, CEP included ("Rua Nova, 591 - Tancredo Neves II - Paulo Afonso - BA - CEP: 48609-116"). */
  endereco: string;
  /** The creditor bank ("Banco C6 S.A."). */
  banco: string;
  modalidade: Modalidade;
};

export function problemasTermo(dados: TermoDados): string[] {
  const problems: string[] = [];
  if (!dados.nome.trim()) problems.push("Falta o nome do cliente.");
  if (dados.cpf.replace(/\D/g, "").length !== 11) problems.push("O CPF precisa ter 11 números.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dados.email.trim())) problems.push("Falta um e-mail válido.");
  if (!dados.endereco.trim()) problems.push("Falta o endereço do cliente.");
  if (!dados.banco.trim()) problems.push("Falta a instituição financeira.");
  return problems;
}
