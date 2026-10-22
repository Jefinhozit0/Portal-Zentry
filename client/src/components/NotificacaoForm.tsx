import { useState } from "react";
import { AlertTriangle, CheckCircle2, FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { impliedRate, parseBRL } from "@shared/laudo";
import { BANCOS_CONHECIDOS, BANCOS_POR_NOME, MODALIDADES, type Modalidade, type NotificacaoContratoDados, type NotificacaoDados, avisoTaxa, bancoConhecido, dataPorExtenso, moeda, problemasNotificacao, problemasNotificacaoContrato } from "@shared/notificacao";
import { GENERO_LABEL, type Genero, generoDoNome } from "@shared/genero";
import { MAX_DOCUMENT_BYTES } from "@shared/processo";
import { formatCPF, hojeISO } from "@shared/procuracao";
import { Button } from "@/components/ui/button";
import { downloadPdf, pickPdf } from "@/lib/downloadPdf";
import { clienteDiferente } from "@/lib/nomes";
import { trpc } from "@/lib/trpc";
import type { ProcuracaoClient } from "./ProcuracaoForm";

/**
 * Both notificações: "manual" asks the bank for the contract; "contrato" contests the interest rate
 * of a contract the client has. The contract PDF fills the client, the figures and the bank.
 */
export type TipoNotificacao = "manual" | "contrato";

type Key = "nome" | "cpf" | "valor" | "parcelas" | "valorParcela" | "contrato" | "taxaMensal" | "valorFinanciado" | "bancoNome" | "bancoCnpj" | "bancoEndereco" | "cidade" | "data";
/** Every field as typed; the amounts are converted for the preview and the PDF. */
type Form = Record<Key, string>;
type Field = { key: Key; label: string; placeholder?: string; wide?: boolean; numeric?: boolean };

const CLIENT_FIELDS: Field[] = [
  { key: "nome", label: "Nome do cliente", wide: true },
  { key: "cpf", label: "CPF", placeholder: "000.000.000-00" },
];
const FIELDS: Record<TipoNotificacao, Field[]> = {
  manual: [
    { key: "valor", label: "Valor do contrato (crédito liberado)", placeholder: "50.000,00", numeric: true },
    { key: "parcelas", label: "Quantidade de parcelas", placeholder: "60", numeric: true },
    { key: "valorParcela", label: "Valor da parcela", placeholder: "1.845,54", numeric: true },
  ],
  contrato: [
    { key: "contrato", label: "Contrato nº", placeholder: "147126013" },
    { key: "taxaMensal", label: "Taxa de juros mensal do contrato (%)", placeholder: "1,96", numeric: true },
  ],
};
/** Only to check the notificação's claim (the payments imply a higher rate); not printed. */
const CHECK_FIELDS: Field[] = [
  { key: "valorFinanciado", label: "Valor financiado", placeholder: "26.041,53", numeric: true },
  { key: "parcelas", label: "Quantidade de parcelas", placeholder: "48", numeric: true },
  { key: "valorParcela", label: "Valor da parcela", placeholder: "848,37", numeric: true },
];
const BANK_FIELDS: Field[] = [
  { key: "bancoNome", label: "Instituição financeira (notificada)", placeholder: "Banco Santander (Brasil) S.A", wide: true },
  { key: "bancoCnpj", label: "CNPJ da instituição", placeholder: "00.000.000/0000-00" },
  { key: "bancoEndereco", label: "Endereço da sede", placeholder: "Rua, número, bairro, cidade - UF, CEP", wide: true },
];

const toText = (value: number) => (value > 0 ? value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");
const blank = (): Form => ({ nome: "", cpf: "", valor: "", parcelas: "", valorParcela: "", contrato: "", taxaMensal: "", valorFinanciado: "", bancoNome: "", bancoCnpj: "", bancoEndereco: "", cidade: "São Paulo", data: hojeISO() });
const number = (text: string) => parseBRL(text) ?? 0;

const common = (form: Form) => ({
  nome: form.nome.trim(), cpf: form.cpf.trim(), bancoNome: form.bancoNome.trim(), bancoCnpj: form.bancoCnpj.trim(), bancoEndereco: form.bancoEndereco.trim(), cidade: form.cidade.trim(), data: form.data,
});
const toManual = (form: Form, genero: Genero | null): NotificacaoDados => ({ ...common(form), genero, valor: number(form.valor), valorParcela: number(form.valorParcela), parcelas: Math.trunc(number(form.parcelas)) });
const toContrato = (form: Form, modalidade: Modalidade, genero: Genero | null): NotificacaoContratoDados => ({ ...common(form), genero, contrato: form.contrato.trim(), taxaMensal: number(form.taxaMensal), modalidade });

export function NotificacaoForm({ tipo, clients, onDone }: { tipo: TipoNotificacao; clients: ProcuracaoClient[]; onDone?: (result: { attached: boolean }) => void }) {
  const [form, setForm] = useState<Form>(blank);
  const [clientName, setClientName] = useState("");
  const [anexar, setAnexar] = useState(false);
  const [source, setSource] = useState("");
  const [modalidade, setModalidade] = useState<Modalidade>("financiamento");
  /** "auto" follows the client's first name; the others are the team's choice. */
  const [generoEscolha, setGeneroEscolha] = useState<"auto" | Genero | "indefinido">("auto");
  const lerContrato = trpc.portal.lerContrato.useMutation();
  const gerarManual = trpc.portal.gerarNotificacao.useMutation();
  const gerarContrato = trpc.portal.gerarNotificacaoContrato.useMutation();
  const generating = gerarManual.isPending || gerarContrato.isPending;
  const chosen = clients.find((option) => option.name.trim().toLowerCase() === clientName.trim().toLowerCase());

  function chooseClient(name: string) {
    setClientName(name);
    const match = clients.find((option) => option.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (match) setForm((current) => ({ ...current, nome: current.nome || match.name.toUpperCase(), cpf: current.cpf || (match.cpf ? formatCPF(match.cpf) : "") }));
  }

  function chooseBank(id: string) {
    const bank = BANCOS_CONHECIDOS.find((option) => option.id === id);
    setForm((current) => bank
      ? { ...current, bancoNome: bank.nome, bancoCnpj: bank.cnpj, bancoEndereco: bank.endereco }
      : { ...current, bancoNome: "", bancoCnpj: "", bancoEndereco: "" });
  }

  async function readContract() {
    const file = await pickPdf(MAX_DOCUMENT_BYTES, (name) => toast.error(`${name} passa de 10 MB.`));
    if (!file) return;
    setSource(`Lendo ${file.name}...`);
    try {
      const { dados, cpf, cnpjInstituicao, modalidade: lida, encontrados } = await lerContrato.mutateAsync({ conteudo: file.base64 });
      if (encontrados.length === 0) {
        setSource(`Não encontrei texto em ${file.name} (pode ser um contrato escaneado). Preencha os dados à mão.`);
        return;
      }
      const bank = bancoConhecido(dados.instituicao, cnpjInstituicao);
      if (lida) setModalidade(lida);
      setForm((current) => ({
        ...current,
        nome: dados.contratante || current.nome,
        cpf: cpf ? formatCPF(cpf) : current.cpf,
        valor: toText(dados.valorSolicitado || dados.valorFinanciado),
        valorFinanciado: toText(dados.valorFinanciado),
        parcelas: dados.parcelas ? String(dados.parcelas) : "",
        valorParcela: toText(dados.valorParcela),
        contrato: dados.contrato,
        taxaMensal: toText(dados.taxaMensal),
        ...(bank
          ? { bancoNome: bank.nome, bancoCnpj: bank.cnpj, bancoEndereco: bank.endereco }
          : { bancoNome: dados.instituicao, bancoCnpj: cnpjInstituicao, bancoEndereco: "" }),
      }));
      setSource(bank || !dados.instituicao
        ? `Dados lidos de ${file.name}. Confira os valores antes de gerar.`
        : `Dados lidos de ${file.name}. Falta o endereço da sede de ${dados.instituicao}: confira no site do banco.`);
    } catch (error) {
      setSource("");
      toast.error(error instanceof Error ? error.message : "Não foi possível ler o contrato.");
    }
  }

  function reset() {
    setForm(blank());
    setClientName("");
    setAnexar(false);
    setSource("");
    setModalidade("financiamento");
    setGeneroEscolha("auto");
  }

  const generoDetectado = generoDoNome(form.nome);
  const genero = generoEscolha === "auto" ? generoDetectado : generoEscolha === "indefinido" ? null : generoEscolha;
  const manual = toManual(form, genero), contrato = toContrato(form, modalidade, genero);
  const problems = tipo === "manual" ? problemasNotificacao(manual) : problemasNotificacaoContrato(contrato);
  const taxaCheck = tipo === "contrato" ? avisoTaxa(contrato.taxaMensal, impliedRate(number(form.valorFinanciado), number(form.valorParcela), Math.trunc(number(form.parcelas)))) : null;
  const attach = anexar && chosen !== undefined;
  const busy = lerContrato.isPending || generating;
  const knownBank = BANCOS_CONHECIDOS.find((bank) => bank.nome === form.bancoNome && bank.cnpj === form.bancoCnpj);

  async function generate(event: React.FormEvent) {
    event.preventDefault();
    if (problems.length) { toast.error(problems[0]); return; }
    try {
      const pdf = tipo === "manual"
        ? await gerarManual.mutateAsync({ clientId: chosen?.id, anexar: attach, dados: manual })
        : await gerarContrato.mutateAsync({ clientId: chosen?.id, anexar: attach, dados: contrato });
      downloadPdf(pdf.nome, pdf.conteudo);
      toast.success(attach ? `Notificação gerada e anexada aos documentos de ${chosen!.name}.` : "Notificação gerada.");
      onDone?.({ attached: attach });
      reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível gerar a notificação.");
    }
  }

  const set = (key: Key) => (event: React.ChangeEvent<HTMLInputElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const input = (field: Field) =>
    <label key={field.key} className={field.wide ? "full-field" : undefined}>{field.label}
      <input name={`notificacao-${field.key}`} autoComplete="off" inputMode={field.numeric ? "decimal" : undefined} value={form[field.key]} onChange={set(field.key)} placeholder={field.placeholder} disabled={busy} />
    </label>;

  const preview = tipo === "manual"
    ? <p>Pede a <strong>{manual.bancoNome}</strong> o contrato de <strong>{manual.nome.toUpperCase()}</strong>: {moeda(manual.valor)} em {manual.parcelas} parcelas de {moeda(manual.valorParcela)} · {dataPorExtenso(manual.cidade, manual.data)}</p>
    : <p>Contesta junto a <strong>{contrato.bancoNome}</strong> a taxa de {form.taxaMensal}% a.m. do contrato de {modalidade} <strong>nº {contrato.contrato}</strong> de <strong>{contrato.nome.toUpperCase()}</strong> · {dataPorExtenso(contrato.cidade, contrato.data)}</p>;

  return <form onSubmit={generate} className="laudo-form laudo-form-page" autoComplete="off">
    <div className="laudo-source">
      <Button type="button" variant="outline" size="sm" onClick={readContract} disabled={busy}>
        {lerContrato.isPending ? <Loader2 size={15} className="animate-spin" /> : <FileUp size={15} />} Ler contrato (PDF)
      </Button>
      <small>{source || "Envie o contrato para preencher cliente, dados do contrato e banco, ou digite abaixo."}</small>
    </div>

    <div className="new-sale-grid">
      <label className="full-field">Cliente (opcional)
        <input list={`notificacao-${tipo}-clientes`} value={clientName} onChange={(event) => chooseClient(event.target.value)} placeholder="Escolha da lista para poder anexar a notificação ao cadastro" disabled={busy} />
        <datalist id={`notificacao-${tipo}-clientes`}>{clients.map((option) => <option key={option.id} value={option.name} />)}</datalist>
      </label>
      {[...CLIENT_FIELDS, ...FIELDS[tipo]].map(input)}
      <label>Gênero do cliente
        <select value={generoEscolha} onChange={(event) => setGeneroEscolha(event.target.value as typeof generoEscolha)} disabled={busy}>
          <option value="auto">Pelo nome: {generoDetectado ? GENERO_LABEL[generoDetectado].toLowerCase() : form.nome.trim() ? "não identificado" : "—"}</option>
          <option value="M">Masculino ("inscrito")</option>
          <option value="F">Feminino ("inscrita")</option>
          <option value="indefinido">Não definir ("inscrito(a)")</option>
        </select>
      </label>
      {tipo === "contrato" && <label>Tipo de contrato
        <select value={modalidade} onChange={(event) => setModalidade(event.target.value as Modalidade)} disabled={busy}>
          {MODALIDADES.map((option) => <option key={option} value={option}>Contrato de {option}</option>)}
        </select>
      </label>}
    </div>

    {tipo === "contrato" && <fieldset className="laudo-encargos">
      <legend>Conferência da taxa <small>(opcional, não vai no documento)</small></legend>
      <div className="new-sale-grid">{CHECK_FIELDS.map(input)}</div>
      {taxaCheck && <p className={taxaCheck.ok ? "laudo-ok" : "laudo-warning"}>{taxaCheck.ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />} {taxaCheck.texto}</p>}
    </fieldset>}

    <fieldset className="laudo-encargos">
      <legend>Instituição notificada</legend>
      <div className="new-sale-grid">
        <label className="full-field">Banco
          <select value={knownBank?.id ?? ""} onChange={(event) => chooseBank(event.target.value)} disabled={busy}>
            {BANCOS_POR_NOME.map((bank) => <option key={bank.id} value={bank.id}>{bank.nome}</option>)}
            <option value="">Outro (digitar abaixo)</option>
          </select>
        </label>
        {BANK_FIELDS.map(input)}
      </div>
    </fieldset>

    <div className="new-sale-grid laudo-place">
      <label>Cidade<input name="notificacao-cidade" autoComplete="off" value={form.cidade} onChange={set("cidade")} disabled={busy} /></label>
      <label>Data<input type="date" value={form.data} onChange={set("data")} disabled={busy} /></label>
    </div>

    <div className="laudo-preview procuracao-preview" aria-live="polite">
      {problems.length ? <p>{problems[0]}</p> : preview}
    </div>

    {clienteDiferente(chosen?.name, form.nome) && <p className="laudo-warning"><AlertTriangle size={14} /> O cliente escolhido ({chosen!.name}) não é o nome do documento ({form.nome.toUpperCase()}). Confira antes de anexar.</p>}
    {chosen
      ? <label className="laudo-attach">
          <input type="checkbox" checked={anexar} onChange={(event) => setAnexar(event.target.checked)} />
          Anexar também aos documentos de {chosen.name} (o cliente vê no portal)
        </label>
      : clientName.trim() && <p className="laudo-hint">Cliente não encontrado na lista: a notificação é gerada, mas não fica anexada a nenhum cadastro.</p>}

    <div className="laudo-actions">
      <Button type="button" variant="outline" onClick={reset} disabled={busy}>Limpar</Button>
      <Button type="submit" disabled={busy || problems.length > 0}>{generating ? "Gerando..." : "Gerar notificação (PDF)"}</Button>
    </div>
  </form>;
}
