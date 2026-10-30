import { AlertTriangle, CheckCircle2 } from "lucide-react";

export type Conferencia = { conferido: boolean; corrigidos: string[]; avisos: string[] };

/**
 * What the reader could vouch for after reading a contract: the main numbers close the Price account
 * (a check, not a guess), and what the team must look at, field by field. `soAvisos` shows only the
 * warnings that match (the termo has no amounts, so only its CPF/CNPJ warnings matter).
 */
export function ConferenciaLeitura({ conferencia, comConta = true, soAvisos }: { conferencia: Conferencia | null; comConta?: boolean; soAvisos?: RegExp }) {
  if (!conferencia) return null;
  const avisos = soAvisos ? conferencia.avisos.filter((aviso) => soAvisos.test(aviso)) : conferencia.avisos;
  return <>
    {comConta && conferencia.conferido && avisos.length === 0 && (
      <p className="laudo-confirmed"><CheckCircle2 size={14} /> Valor financiado, parcela, prazo e taxa conferidos pela conta da tabela Price.</p>
    )}
    {avisos.map((aviso) => <p key={aviso} className="laudo-warning"><AlertTriangle size={14} /> {aviso}</p>)}
  </>;
}
