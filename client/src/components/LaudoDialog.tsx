import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ENCARGO_LABELS, type Encargos, type LaudoDados, avisosLaudo, calcularLaudo, emptyLaudo, formatBRL, parseBRL, problemasLaudo } from "@shared/laudo";
import { MAX_DOCUMENT_BYTES } from "@shared/processo";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { downloadPdf, pickPdf } from "@/lib/downloadPdf";
import { clienteDiferente } from "@/lib/nomes";
import { trpc } from "@/lib/trpc";

type TextKey = "contrato" | "contratante" | "instituicao" | "garantia" | "dataContrato" | "primeiroVencimento" | "jurosMora";
type NumberKey = "valorSolicitado" | "valorFinanciado" | "valorParcela" | "iof" | "parcelas" | "taxaMensal" | "taxaAnual";
/** Every field as typed; numbers are converted only for the preview and the PDF. */
type Form = Record<TextKey | NumberKey | keyof Encargos, string>;

const TEXT_FIELDS: { key: TextKey; label: string; placeholder?: string; wide?: boolean }[] = [
  { key: "contratante", label: "Contratante", wide: true },
  { key: "contrato", label: "Contrato nº" },
  { key: "instituicao", label: "Instituição financeira", placeholder: "Ex.: BANCO PAN S.A." },
  { key: "garantia", label: "Veículo / garantia", placeholder: "Marca, modelo e ano", wide: true },
  { key: "dataContrato", label: "Data do contrato", placeholder: "dd/mm/aaaa" },
  { key: "primeiroVencimento", label: "1º vencimento", placeholder: "dd/mm/aaaa" },
];
const NUMBER_FIELDS: { key: NumberKey; label: string; placeholder: string }[] = [
  { key: "valorSolicitado", label: "Valor solicitado (crédito liberado)", placeholder: "50.000,00" },
  { key: "valorFinanciado", label: "Valor financiado (total contratado)", placeholder: "55.885,04" },
  { key: "parcelas", label: "Quantidade de parcelas", placeholder: "60" },
  { key: "valorParcela", label: "Valor da parcela", placeholder: "1.845,54" },
  { key: "taxaMensal", label: "Taxa de juros mensal (%)", placeholder: "2,59" },
  { key: "taxaAnual", label: "Taxa de juros anual (%)", placeholder: "35,91" },
  { key: "iof", label: "IOF financiado", placeholder: "1.811,15" },
];
const ENCARGO_KEYS = Object.keys(ENCARGO_LABELS) as (keyof Encargos)[];

const toText = (value: number, decimals = 2) => (value > 0 ? value.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : "");

function toForm(dados: LaudoDados): Form {
  return {
    contrato: dados.contrato, contratante: dados.contratante, instituicao: dados.instituicao, garantia: dados.garantia,
    dataContrato: dados.dataContrato, primeiroVencimento: dados.primeiroVencimento, jurosMora: dados.jurosMora,
    valorSolicitado: toText(dados.valorSolicitado), valorFinanciado: toText(dados.valorFinanciado), valorParcela: toText(dados.valorParcela), iof: toText(dados.iof),
    parcelas: dados.parcelas > 0 ? String(dados.parcelas) : "", taxaMensal: toText(dados.taxaMensal), taxaAnual: toText(dados.taxaAnual),
    seguros: toText(dados.encargos.seguros ?? 0), avaliacao: toText(dados.encargos.avaliacao ?? 0), cadastro: toText(dados.encargos.cadastro ?? 0), registro: toText(dados.encargos.registro ?? 0),
  };
}

function toDados(form: Form): LaudoDados {
  const number = (text: string) => parseBRL(text) ?? 0;
  // An empty charge is "NÃO CONSTA" in the laudo; zero too.
  const charge = (text: string) => { const value = parseBRL(text); return value && value > 0 ? value : null; };
  return {
    ...emptyLaudo(),
    contrato: form.contrato.trim(), contratante: form.contratante.trim().toUpperCase(), instituicao: form.instituicao.trim().toUpperCase(), garantia: form.garantia.trim().toUpperCase(),
    dataContrato: form.dataContrato.trim(), primeiroVencimento: form.primeiroVencimento.trim(), jurosMora: form.jurosMora.trim(),
    valorSolicitado: number(form.valorSolicitado), valorFinanciado: number(form.valorFinanciado), valorParcela: number(form.valorParcela), iof: number(form.iof),
    parcelas: Math.trunc(number(form.parcelas)), taxaMensal: number(form.taxaMensal), taxaAnual: number(form.taxaAnual),
    encargos: { seguros: charge(form.seguros), avaliacao: charge(form.avaliacao), cadastro: charge(form.cadastro), registro: charge(form.registro) },
  };
}

type ClientOption = { id: number; name: string };

type LaudoFormProps = {
  /** "dialog" inside the client's page; "page" on the Laudos screen, where the client is optional and chosen in the form. */
  variant: "dialog" | "page";
  /** The client the laudo is for, when it is already known (client's page). */
  client?: ClientOption;
  /** Clients to pick from on the Laudos screen. */
  clients?: ClientOption[];
  /** A contract already attached to the client: it is read as soon as the form appears. */
  documento?: { id: number; nome: string } | null;
  onDone?: (result: { attached: boolean }) => void;
  onCancel?: () => void;
};

/**
 * Parecer técnico from a contract: the PDF fills the form (or the team types it), the numbers can be
 * changed, and the preview shows the result before the PDF is made.
 */
export function LaudoForm({ variant, client, clients = [], documento, onDone, onCancel }: LaudoFormProps) {
  const blank = () => toForm({ ...emptyLaudo(), contratante: (client?.name ?? "").toUpperCase() });
  const [form, setForm] = useState<Form>(blank);
  const [source, setSource] = useState("");
  const [anexar, setAnexar] = useState(false);
  const [retirarRegistro, setRetirarRegistro] = useState(false);
  const [clientName, setClientName] = useState(client?.name ?? "");
  const chosenClient = client ?? clients.find((option) => option.name.trim().toLowerCase() === clientName.trim().toLowerCase());

  const lerContrato = trpc.portal.lerContrato.useMutation();
  const gerarLaudo = trpc.portal.gerarLaudo.useMutation();

  async function read(input: { documentoId: number } | { conteudo: string }, name: string) {
    setSource(`Lendo ${name}... Se for um contrato escaneado, leva cerca de 1 minuto.`);
    try {
      const { dados, encontrados, ocr, ia } = await lerContrato.mutateAsync(input);
      if (encontrados.length === 0) {
        setSource(`Não encontrei texto em ${name} nem lendo as imagens das páginas. Preencha os dados à mão.`);
        return;
      }
      setForm(toForm({ ...dados, contratante: dados.contratante || (chosenClient?.name ?? "").toUpperCase() }));
      setSource(ia
        ? `Dados lidos de ${name} pela IA (modelo de contrato novo ou escaneado): confira cada valor com o contrato antes de gerar.`
        : ocr
          ? `Dados lidos de ${name}, um contrato escaneado: confira cada valor com o contrato antes de gerar, a leitura de imagem pode trocar algum número.`
          : `Dados lidos de ${name}. Confira os valores antes de gerar.`);
    } catch (error) {
      setSource("");
      toast.error(error instanceof Error ? error.message : "Não foi possível ler o contrato.");
    }
  }

  function reset() {
    setForm(blank());
    setSource("");
    setAnexar(false);
    setRetirarRegistro(false);
    if (!client) setClientName("");
  }

  useEffect(() => {
    reset();
    if (documento) read({ documentoId: documento.id }, documento.nome);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documento?.id]);

  async function pickContract() {
    const file = await pickPdf(MAX_DOCUMENT_BYTES, (name) => toast.error(`${name} passa de 10 MB.`));
    if (file) read({ conteudo: file.base64 }, file.name);
  }

  function chooseClient(name: string) {
    setClientName(name);
    const match = clients.find((option) => option.name.trim().toLowerCase() === name.trim().toLowerCase());
    // The contract's own name wins; the client's only fills an empty field.
    if (match && !form.contratante.trim()) setForm((current) => ({ ...current, contratante: match.name.toUpperCase() }));
  }

  const dados = useMemo(() => ({ ...toDados(form), retirarRegistro }), [form, retirarRegistro]);
  const problems = problemasLaudo(dados);
  const warnings = problems.length ? [] : avisosLaudo(dados);
  const result = problems.length ? null : calcularLaudo(dados);
  const attach = anexar && chosenClient !== undefined;

  async function generate(event: React.FormEvent) {
    event.preventDefault();
    if (problems.length) { toast.error(problems[0]); return; }
    try {
      const pdf = await gerarLaudo.mutateAsync({ clientId: chosenClient?.id, anexar: attach, dados });
      downloadPdf(pdf.nome, pdf.conteudo);
      toast.success(attach ? `Laudo gerado e anexado aos documentos de ${chosenClient!.name}.` : "Laudo gerado.");
      onDone?.({ attached: attach });
      if (variant === "page") reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível gerar o laudo.");
    }
  }

  const set = (key: keyof Form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const busy = lerContrato.isPending || gerarLaudo.isPending;
  const title = "Gerar laudo";
  const description = "Parecer técnico com o recálculo das parcelas sem os encargos financiados (seguros e tarifas).";
  const actions = <>
    {onCancel && <Button type="button" variant="outline" onClick={onCancel} disabled={gerarLaudo.isPending}>Cancelar</Button>}
    {variant === "page" && <Button type="button" variant="outline" onClick={reset} disabled={busy}>Limpar</Button>}
    <Button type="submit" disabled={busy || problems.length > 0}>{gerarLaudo.isPending ? "Gerando..." : "Gerar laudo (PDF)"}</Button>
  </>;

  return <form onSubmit={generate} className={variant === "page" ? "laudo-form laudo-form-page" : "laudo-form"}>
    {variant === "dialog" && <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>}

    <div className="laudo-source">
      <Button type="button" variant="outline" size="sm" onClick={pickContract} disabled={busy}>
        {lerContrato.isPending ? <Loader2 size={15} className="animate-spin" /> : <FileUp size={15} />} Ler contrato (PDF)
      </Button>
      <small>{source || "Envie o contrato para preencher sozinho, ou digite só os dados abaixo."}</small>
    </div>

    <div className="new-sale-grid">
      {variant === "page" && <label className="full-field">Cliente (opcional)
        <input list="laudo-clientes" value={clientName} onChange={(event) => chooseClient(event.target.value)} placeholder="Escolha da lista para poder anexar o laudo ao cadastro" disabled={busy} />
        <datalist id="laudo-clientes">{clients.map((option) => <option key={option.id} value={option.name} />)}</datalist>
      </label>}
      {TEXT_FIELDS.map((field) => <label key={field.key} className={field.wide ? "full-field" : undefined}>{field.label}
        <input value={form[field.key]} onChange={set(field.key)} placeholder={field.placeholder} disabled={lerContrato.isPending} />
      </label>)}
      {NUMBER_FIELDS.map((field) => <label key={field.key}>{field.label}
        <input inputMode="decimal" value={form[field.key]} onChange={set(field.key)} placeholder={field.placeholder} disabled={lerContrato.isPending} />
      </label>)}
      <label>Juros moratórios<input value={form.jurosMora} onChange={set("jurosMora")} placeholder="Não consta" disabled={lerContrato.isPending} /></label>
    </div>

    <fieldset className="laudo-encargos">
      <legend>Encargos a retirar <small>(vazio = não consta no contrato)</small></legend>
      <div className="new-sale-grid">
        {ENCARGO_KEYS.map((key) => <label key={key}>{ENCARGO_LABELS[key]}
          <input inputMode="decimal" value={form[key]} onChange={set(key)} placeholder="Não consta" disabled={lerContrato.isPending} />
        </label>)}
      </div>
      <label className="laudo-attach">
        <input type="checkbox" checked={retirarRegistro} onChange={(event) => setRetirarRegistro(event.target.checked)} disabled={lerContrato.isPending} />
        Retirar também o registro do contrato (só quando passar da tabela do Detran; sem marcar, o laudo explica que ele foi mantido)
      </label>
    </fieldset>

    <div className="laudo-preview" aria-live="polite">
      {result ? <>
        <div><span>Parcela</span><strong>{formatBRL(result.original.prestacao)} → {formatBRL(Math.round(result.recalculado.prestacao * 100) / 100)}</strong></div>
        {result.pactuada && <div><span>Parcela pela taxa do contrato</span><strong>{formatBRL(result.pactuada.prestacao)}</strong></div>}
        <div><span>Encargos retirados</span><strong>{formatBRL(result.encargos)}</strong></div>
        <div><span>Diferença por parcela</span><strong>{formatBRL(result.diferencaParcela)}</strong></div>
        <div><span>Proveito econômico{result.alternativo ? " pretendido" : ""}</span><strong className="laudo-total">{formatBRL(result.diferencaTotal)}</strong></div>
        {result.alternativo && <div><span>Proveito alternativo</span><strong>{formatBRL(result.alternativo.total)}</strong></div>}
      </> : <p>{problems[0]}</p>}
    </div>
    {warnings.map((warning) => <p key={warning} className="laudo-warning"><AlertTriangle size={14} /> {warning}</p>)}
    {clienteDiferente(chosenClient?.name, form.contratante) && <p className="laudo-warning"><AlertTriangle size={14} /> O cliente escolhido ({chosenClient!.name}) não é o contratante do contrato ({form.contratante.toUpperCase()}). Confira antes de anexar.</p>}

    {chosenClient
      ? <label className="laudo-attach">
          <input type="checkbox" checked={anexar} onChange={(event) => setAnexar(event.target.checked)} />
          Anexar também aos documentos de {chosenClient.name} (o cliente vê no portal e recebe um aviso)
        </label>
      : variant === "page" && clientName.trim() && <p className="laudo-hint">Cliente não encontrado na lista: o laudo é gerado, mas não fica anexado a nenhum cadastro.</p>}

    {variant === "dialog" ? <DialogFooter>{actions}</DialogFooter> : <div className="laudo-actions">{actions}</div>}
  </form>;
}

type LaudoDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: ClientOption;
  documento?: { id: number; nome: string } | null;
  onAttached?: () => void;
};

/** The same form, on the client's page. */
export default function LaudoDialog({ open, onOpenChange, client, documento, onAttached }: LaudoDialogProps) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="hub-dialog laudo-dialog">
      {open && <LaudoForm
        variant="dialog"
        client={client}
        documento={documento}
        onCancel={() => onOpenChange(false)}
        onDone={({ attached }) => { if (attached) onAttached?.(); onOpenChange(false); }}
      />}
    </DialogContent>
  </Dialog>;
}
