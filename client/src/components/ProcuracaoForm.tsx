import { useState } from "react";
import { toast } from "sonner";
import { EMPRESA } from "@shared/empresa";
import { PROCURACAO_CAMPOS, type ProcuracaoDados, emptyProcuracao, formatCPF, localEData, nomeProprio, problemasProcuracao } from "@shared/procuracao";
import { Button } from "@/components/ui/button";
import { downloadPdf } from "@/lib/downloadPdf";
import { trpc } from "@/lib/trpc";

export type ProcuracaoClient = { id: number; name: string; cpf?: string | null; email?: string | null };

/** Procuração extrajudicial: choosing a client fills name, CPF and e-mail; address, CEP and place are typed. */
export function ProcuracaoForm({ clients, onDone }: { clients: ProcuracaoClient[]; onDone?: (result: { attached: boolean }) => void }) {
  const [dados, setDados] = useState<ProcuracaoDados>(emptyProcuracao);
  const [clientName, setClientName] = useState("");
  const [anexar, setAnexar] = useState(false);
  const gerar = trpc.portal.gerarProcuracao.useMutation();
  const chosen = clients.find((option) => option.name.trim().toLowerCase() === clientName.trim().toLowerCase());

  function chooseClient(name: string) {
    setClientName(name);
    const match = clients.find((option) => option.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (match) setDados((current) => ({ ...current, nome: nomeProprio(match.name), cpf: match.cpf ? formatCPF(match.cpf) : current.cpf, email: match.email ?? current.email }));
  }

  function reset() {
    setDados(emptyProcuracao());
    setClientName("");
    setAnexar(false);
  }

  const problems = problemasProcuracao(dados);
  const attach = anexar && chosen !== undefined;

  async function generate(event: React.FormEvent) {
    event.preventDefault();
    if (problems.length) { toast.error(problems[0]); return; }
    try {
      const pdf = await gerar.mutateAsync({ clientId: chosen?.id, anexar: attach, dados });
      downloadPdf(pdf.nome, pdf.conteudo);
      toast.success(attach ? `Procuração gerada e anexada aos documentos de ${chosen!.name}.` : "Procuração gerada.");
      onDone?.({ attached: attach });
      reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível gerar a procuração.");
    }
  }

  const set = (key: keyof ProcuracaoDados) => (event: React.ChangeEvent<HTMLInputElement>) => setDados((current) => ({ ...current, [key]: event.target.value }));

  // autoComplete off: these are the client's data, and the browser would offer the employee's own (or an IBGE code for the city).
  return <form onSubmit={generate} className="laudo-form laudo-form-page" autoComplete="off">
    <div className="new-sale-grid">
      <label className="full-field">Cliente (opcional)
        <input list="procuracao-clientes" value={clientName} onChange={(event) => chooseClient(event.target.value)} placeholder="Escolha da lista para preencher nome, CPF e e-mail" disabled={gerar.isPending} />
        <datalist id="procuracao-clientes">{clients.map((option) => <option key={option.id} value={option.name} />)}</datalist>
      </label>
      {PROCURACAO_CAMPOS.map((field) => <label key={field.key} className={field.wide ? "full-field" : undefined}>{field.label}
        <input
          type={field.key === "data" ? "date" : field.key === "email" ? "email" : "text"}
          inputMode={field.key === "cpf" || field.key === "cep" ? "numeric" : undefined}
          name={`procuracao-${field.key}`}
          autoComplete="off"
          value={dados[field.key]}
          onChange={set(field.key)}
          placeholder={field.placeholder}
          disabled={gerar.isPending}
        />
      </label>)}
    </div>

    <div className="laudo-preview procuracao-preview" aria-live="polite">
      {problems.length
        ? <p>{problems[0]}</p>
        : <p>Outorgante <strong>{nomeProprio(dados.nome)}</strong> · outorgado {EMPRESA.nome || EMPRESA.nomeCurto} · {localEData(dados)}</p>}
    </div>

    {chosen
      ? <label className="laudo-attach">
          <input type="checkbox" checked={anexar} onChange={(event) => setAnexar(event.target.checked)} />
          Anexar também aos documentos de {chosen.name} (o cliente vê no portal)
        </label>
      : clientName.trim() && <p className="laudo-hint">Cliente não encontrado na lista: a procuração é gerada, mas não fica anexada a nenhum cadastro.</p>}

    <div className="laudo-actions">
      <Button type="button" variant="outline" onClick={reset} disabled={gerar.isPending}>Limpar</Button>
      <Button type="submit" disabled={gerar.isPending || problems.length > 0}>{gerar.isPending ? "Gerando..." : "Gerar procuração (PDF)"}</Button>
    </div>
  </form>;
}
