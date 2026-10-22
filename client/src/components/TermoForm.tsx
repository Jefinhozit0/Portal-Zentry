import { useState } from "react";
import { AlertTriangle, FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { GENERO_LABEL, type Genero, generoDoNome } from "@shared/genero";
import { BANCOS_CONHECIDOS, BANCOS_POR_NOME, MODALIDADES, type Modalidade, bancoConhecido } from "@shared/notificacao";
import { MAX_DOCUMENT_BYTES } from "@shared/processo";
import { formatCPF } from "@shared/procuracao";
import { type TermoDados, problemasTermo } from "@shared/termo";
import { Button } from "@/components/ui/button";
import { downloadPdf, pickPdf } from "@/lib/downloadPdf";
import { clienteDiferente } from "@/lib/nomes";
import { trpc } from "@/lib/trpc";
import type { ProcuracaoClient } from "./ProcuracaoForm";

type Key = "nome" | "cpf" | "email" | "endereco" | "banco";
const FIELDS: { key: Key; label: string; placeholder?: string; wide?: boolean }[] = [
  { key: "nome", label: "Nome do cliente", wide: true },
  { key: "cpf", label: "CPF", placeholder: "000.000.000-00" },
  { key: "email", label: "E-mail", placeholder: "cliente@email.com" },
  { key: "endereco", label: "Endereço completo, com CEP", placeholder: "Rua Nova, 591 - Tancredo Neves II - Paulo Afonso - BA - CEP: 48609-116", wide: true },
];
const blank = (): Record<Key, string> => ({ nome: "", cpf: "", email: "", endereco: "", banco: "" });

/** Termo de conhecimento de prestação de serviços: the client is told the company notified the bank asking for the contract. */
export function TermoForm({ clients, onDone }: { clients: ProcuracaoClient[]; onDone?: (result: { attached: boolean }) => void }) {
  const [form, setForm] = useState(blank);
  const [clientName, setClientName] = useState("");
  const [modalidade, setModalidade] = useState<Modalidade>("financiamento");
  const [generoEscolha, setGeneroEscolha] = useState<"auto" | Genero | "indefinido">("auto");
  const [anexar, setAnexar] = useState(false);
  const [source, setSource] = useState("");
  const lerContrato = trpc.portal.lerContrato.useMutation();
  const gerar = trpc.portal.gerarTermo.useMutation();
  const chosen = clients.find((option) => option.name.trim().toLowerCase() === clientName.trim().toLowerCase());

  function chooseClient(name: string) {
    setClientName(name);
    const match = clients.find((option) => option.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (match) setForm((current) => ({ ...current, nome: current.nome || match.name.toUpperCase(), cpf: current.cpf || (match.cpf ? formatCPF(match.cpf) : ""), email: current.email || (match.email ?? "") }));
  }

  async function readContract() {
    const file = await pickPdf(MAX_DOCUMENT_BYTES, (name) => toast.error(`${name} passa de 10 MB.`));
    if (!file) return;
    setSource(`Lendo ${file.name}...`);
    try {
      const { dados, cpf, cnpjInstituicao, modalidade: lida, email, endereco, encontrados } = await lerContrato.mutateAsync({ conteudo: file.base64 });
      if (encontrados.length === 0) {
        setSource(`Não encontrei texto em ${file.name} (pode ser um contrato escaneado). Preencha os dados à mão.`);
        return;
      }
      if (lida) setModalidade(lida);
      setForm((current) => ({
        ...current,
        nome: dados.contratante || current.nome,
        cpf: cpf ? formatCPF(cpf) : current.cpf,
        email: email || current.email,
        endereco: endereco || current.endereco,
        banco: bancoConhecido(dados.instituicao, cnpjInstituicao)?.nome ?? (dados.instituicao || current.banco),
      }));
      const faltando = [!email && "e-mail", !endereco && "endereço", endereco && !/\d{5}-?\d{3}/.test(endereco) && "CEP"].filter(Boolean);
      setSource(`Dados lidos de ${file.name}. ${faltando.length ? `Complete: ${faltando.join(", ")}.` : "Confira antes de gerar."}`);
    } catch (error) {
      setSource("");
      toast.error(error instanceof Error ? error.message : "Não foi possível ler o contrato.");
    }
  }

  function reset() {
    setForm(blank());
    setClientName("");
    setModalidade("financiamento");
    setGeneroEscolha("auto");
    setAnexar(false);
    setSource("");
  }

  const generoDetectado = generoDoNome(form.nome);
  const genero = generoEscolha === "auto" ? generoDetectado : generoEscolha === "indefinido" ? null : generoEscolha;
  const dados: TermoDados = { nome: form.nome.trim(), genero, cpf: form.cpf.trim(), email: form.email.trim(), endereco: form.endereco.trim(), banco: form.banco.trim(), modalidade };
  const problems = problemasTermo(dados);
  const attach = anexar && chosen !== undefined;
  const busy = lerContrato.isPending || gerar.isPending;
  const knownBank = BANCOS_CONHECIDOS.find((bank) => bank.nome === form.banco);

  async function generate(event: React.FormEvent) {
    event.preventDefault();
    if (problems.length) { toast.error(problems[0]); return; }
    try {
      const pdf = await gerar.mutateAsync({ clientId: chosen?.id, anexar: attach, dados });
      downloadPdf(pdf.nome, pdf.conteudo);
      toast.success(attach ? `Termo gerado e anexado aos documentos de ${chosen!.name}.` : "Termo gerado.");
      onDone?.({ attached: attach });
      reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível gerar o termo.");
    }
  }

  const set = (key: Key) => (event: React.ChangeEvent<HTMLInputElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));

  return <form onSubmit={generate} className="laudo-form laudo-form-page" autoComplete="off">
    <div className="laudo-source">
      <Button type="button" variant="outline" size="sm" onClick={readContract} disabled={busy}>
        {lerContrato.isPending ? <Loader2 size={15} className="animate-spin" /> : <FileUp size={15} />} Ler contrato (PDF)
      </Button>
      <small>{source || "Envie o contrato para preencher cliente, CPF e banco, ou escolha o cliente e digite o resto."}</small>
    </div>

    <div className="new-sale-grid">
      <label className="full-field">Cliente (opcional)
        <input list="termo-clientes" value={clientName} onChange={(event) => chooseClient(event.target.value)} placeholder="Escolha da lista para preencher nome, CPF e e-mail" disabled={busy} />
        <datalist id="termo-clientes">{clients.map((option) => <option key={option.id} value={option.name} />)}</datalist>
      </label>
      {FIELDS.map((field) => <label key={field.key} className={field.wide ? "full-field" : undefined}>{field.label}
        <input name={`termo-${field.key}`} autoComplete="off" type={field.key === "email" ? "email" : "text"} value={form[field.key]} onChange={set(field.key)} placeholder={field.placeholder} disabled={busy} />
      </label>)}
      <label>Gênero do cliente
        <select value={generoEscolha} onChange={(event) => setGeneroEscolha(event.target.value as typeof generoEscolha)} disabled={busy}>
          <option value="auto">Pelo nome: {generoDetectado ? GENERO_LABEL[generoDetectado].toLowerCase() : form.nome.trim() ? "não identificado" : "—"}</option>
          <option value="M">Masculino ("brasileiro, inscrito")</option>
          <option value="F">Feminino ("brasileira, inscrita")</option>
          <option value="indefinido">Não definir ("brasileiro(a)")</option>
        </select>
      </label>
      <label>Tipo de contrato
        <select value={modalidade} onChange={(event) => setModalidade(event.target.value as Modalidade)} disabled={busy}>
          {MODALIDADES.map((option) => <option key={option} value={option}>Contrato de {option}</option>)}
        </select>
      </label>
      <label>Banco
        <select value={knownBank?.nome ?? ""} onChange={(event) => setForm((current) => ({ ...current, banco: event.target.value }))} disabled={busy}>
          {BANCOS_POR_NOME.map((bank) => <option key={bank.id} value={bank.nome}>{bank.nome}</option>)}
          <option value="">Outro (digitar ao lado)</option>
        </select>
      </label>
      <label>Instituição financeira (credora)
        <input name="termo-banco" autoComplete="off" value={form.banco} onChange={set("banco")} placeholder="Banco C6 S.A." disabled={busy} />
      </label>
    </div>

    <div className="laudo-preview procuracao-preview" aria-live="polite">
      {problems.length
        ? <p>{problems[0]}</p>
        : <p>Termo para <strong>{dados.nome.toUpperCase()}</strong> sobre a notificação enviada a <strong>{dados.banco}</strong> (contrato de {modalidade}).</p>}
    </div>

    {clienteDiferente(chosen?.name, form.nome) && <p className="laudo-warning"><AlertTriangle size={14} /> O cliente escolhido ({chosen!.name}) não é o nome do documento ({form.nome.toUpperCase()}). Confira antes de anexar.</p>}
    {chosen
      ? <label className="laudo-attach">
          <input type="checkbox" checked={anexar} onChange={(event) => setAnexar(event.target.checked)} />
          Anexar também aos documentos de {chosen.name} (o cliente vê no portal)
        </label>
      : clientName.trim() && <p className="laudo-hint">Cliente não encontrado na lista: o termo é gerado, mas não fica anexado a nenhum cadastro.</p>}

    <div className="laudo-actions">
      <Button type="button" variant="outline" onClick={reset} disabled={busy}>Limpar</Button>
      <Button type="submit" disabled={busy || problems.length > 0}>{gerar.isPending ? "Gerando..." : "Gerar termo (PDF)"}</Button>
    </div>
  </form>;
}
