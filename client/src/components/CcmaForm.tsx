import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileUp, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import {
  CAMPOS_CCMA, type CampoCcma, type CcmaDados, ITENS_CCMA, type ItemCcma, type LeituraArquivo, PEDIDO_PADRAO, type StatusCcma,
  consolidarCampo, partesData, problemasCcma, recomendarItens, textoItem,
} from "@shared/ccma";
import { MAX_DOCUMENT_BYTES } from "@shared/processo";
import { Button } from "@/components/ui/button";
import { downloadFile, pickFiles } from "@/lib/downloadPdf";
import { trpc } from "@/lib/trpc";

/**
 * The review of the CCMA form: the documents only propose values. An administrator confirms, edits or leaves each
 * field pending and decides each item of part 4; the files exist only after approving that exact version.
 * What the administrator typed is never overwritten by a later reading.
 */

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const ACCEPT = "application/pdf,.pdf,image/jpeg,.jpg,.jpeg,image/png,.png";

type DecisaoCampo = "aguardando" | "confirmado" | "pendente";
type EstadoCampo = { valor: string; decisao: DecisaoCampo; editado: boolean };
type DecisaoItem = "aguardando" | "manter" | "excluir" | "pendente";
type EstadoItem = { texto: string; decisao: DecisaoItem; sugerido: boolean; editado: boolean };
type Gerado = { docx: { nome: string; conteudo: string }; pdf: { nome: string; conteudo: string } };

const campoVazio = (): EstadoCampo => ({ valor: "", decisao: "aguardando", editado: false });
const camposIniciais = () => Object.fromEntries(CAMPOS_CCMA.map(({ id }) => [id, id === "pedido" ? { ...campoVazio(), valor: PEDIDO_PADRAO } : campoVazio()])) as Record<CampoCcma, EstadoCampo>;
const itensIniciais = () => Object.fromEntries(ITENS_CCMA.map(({ id, padrao }) => [id, { texto: padrao, decisao: "aguardando", sugerido: false, editado: false }])) as Record<ItemCcma, EstadoItem>;

const PARTES = [
  { parte: 1, titulo: "Parte 1 · Pedido" },
  { parte: 2, titulo: "Parte 2 · Reclamante" },
  { parte: 3, titulo: "Parte 3 · Reclamado" },
];
const CLASSE_STATUS: Record<StatusCcma, string> = {
  "CONFIRMADO NO DOCUMENTO": "ccma-tag-ok",
  "DIVERGENTE ENTRE DOCUMENTOS": "ccma-tag-alerta",
  "ILEGÍVEL": "ccma-tag-alerta",
  "AUSENTE": "ccma-tag-neutra",
  "AGUARDANDO CONFIRMAÇÃO DO USUÁRIO": "ccma-tag-neutra",
};

const origem = (fonte: { arquivo: string; pagina: number | null; trecho?: string }) =>
  `${fonte.arquivo}, ${fonte.pagina ? `pág. ${fonte.pagina}` : "página não identificada"}${fonte.trecho ? `: “${fonte.trecho}”` : ""}`;

export function CcmaForm() {
  const [arquivos, setArquivos] = useState<LeituraArquivo[]>([]);
  const [campos, setCampos] = useState(camposIniciais);
  const [itens, setItens] = useState(itensIniciais);
  const [data, setData] = useState("");
  const [lendo, setLendo] = useState("");
  const [aprovada, setAprovada] = useState<string | null>(null);
  const [gerado, setGerado] = useState<Gerado | null>(null);
  const ler = trpc.portal.lerDocumentoCcma.useMutation();
  const gerar = trpc.portal.gerarFormularioCcma.useMutation();
  const ocupado = Boolean(lendo) || gerar.isPending;

  const consolidados = useMemo(() => Object.fromEntries(CAMPOS_CCMA.map(({ id }) => [id, consolidarCampo(id, arquivos)])) as Record<CampoCcma, ReturnType<typeof consolidarCampo>>, [arquivos]);
  const recomendacoes = useMemo(() => recomendarItens(arquivos), [arquivos]);

  // A new reading updates what the administrator did not type. A value that changed needs confirming again.
  useEffect(() => {
    setCampos((atuais) => {
      const novos = { ...atuais };
      for (const { id } of CAMPOS_CCMA) {
        const atual = atuais[id];
        if (atual.editado || (id === "pedido" && consolidados[id].valores.length === 0)) continue;
        const { valores } = consolidados[id];
        const valor = valores.length === 1 ? valores[0].valor : valores.some((item) => item.valor === atual.valor) ? atual.valor : "";
        if (valor !== atual.valor) novos[id] = { ...atual, valor, decisao: "aguardando" };
      }
      return novos;
    });
  }, [consolidados]);

  const statusDe = (id: CampoCcma): StatusCcma => (id === "pedido" && consolidados.pedido.valores.length === 0) ? "AGUARDANDO CONFIRMAÇÃO DO USUÁRIO" : consolidados[id].status;
  const impresso = (id: CampoCcma) => (campos[id].decisao === "confirmado" ? campos[id].valor.trim() : "");
  const dados: CcmaDados = {
    pedido: impresso("pedido"),
    reclamante: { nome: impresso("nome"), rg: impresso("rg"), documento: impresso("documento"), profissao: impresso("profissao"), estadoCivil: impresso("estadoCivil"), telefone: impresso("telefone"), whatsapp: impresso("whatsapp"), email: impresso("email") },
    reclamado: { nome: impresso("reclamadoNome"), documento: impresso("reclamadoDocumento") },
    itens: ITENS_CCMA.filter(({ id }) => itens[id].decisao === "manter").map(({ id }) => ({ id, texto: itens[id].texto.trim() })),
    data,
  };
  const versao = JSON.stringify(dados);
  const problemas = problemasCcma(dados);
  const itensAbertos = ITENS_CCMA.filter(({ id }) => itens[id].decisao === "aguardando" || itens[id].decisao === "pendente");
  const camposAbertos = CAMPOS_CCMA.filter(({ id }) => campos[id].decisao !== "confirmado");
  const podeGerar = problemas.length === 0 && itensAbertos.length === 0;
  const aprovado = aprovada === versao;

  // The files belong to the version they were approved in.
  useEffect(() => { setGerado(null); }, [versao]);

  async function adicionarArquivos() {
    const escolhidos = await pickFiles(ACCEPT, MAX_DOCUMENT_BYTES, (nome) => toast.error(`${nome} passa de 10 MB.`));
    for (let indice = 0; indice < escolhidos.length; indice++) {
      const escolhido = escolhidos[indice];
      setLendo(`Lendo ${escolhido.name} (${indice + 1} de ${escolhidos.length}). Um documento escaneado ou uma foto pode levar de 1 a 2 minutos.`);
      try {
        const leitura = await ler.mutateAsync({ nome: escolhido.name, conteudo: escolhido.base64 });
        setArquivos((atuais) => [...atuais.filter((item) => item.arquivo !== escolhido.name), leitura]);
      } catch (error) {
        const aviso = error instanceof Error ? error.message : "Não foi possível ler esse arquivo.";
        setArquivos((atuais) => [...atuais.filter((item) => item.arquivo !== escolhido.name), { arquivo: escolhido.name, tipo: "Não lido", paginas: 0, ilegiveis: [], ocr: false, aviso, candidatos: [], evidencias: [] }]);
      }
    }
    setLendo("");
  }

  const mudarCampo = (id: CampoCcma, mudanca: Partial<EstadoCampo>) => setCampos((atuais) => ({ ...atuais, [id]: { ...atuais[id], ...mudanca } }));
  const mudarItem = (id: ItemCcma, mudanca: Partial<EstadoItem>) => setItens((atuais) => ({ ...atuais, [id]: { ...atuais[id], ...mudanca } }));
  const digitarCampo = (id: CampoCcma, valor: string) => mudarCampo(id, { valor, editado: true, decisao: valor.trim() ? "confirmado" : "aguardando" });

  function limpar() {
    setArquivos([]); setCampos(camposIniciais()); setItens(itensIniciais()); setData(""); setAprovada(null); setGerado(null);
  }

  async function gerarArquivos() {
    if (!aprovado || !podeGerar) return;
    try {
      setGerado(await gerar.mutateAsync({ aprovado: true, dados }));
      toast.success("Formulário gerado. Baixe o Word ou o PDF abaixo.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível gerar o formulário.");
    }
  }

  const sugeridos = ITENS_CCMA.filter(({ id }) => (recomendacoes[id].acao === "SUGERIR EXCLUSÃO" || itens[id].sugerido) && itens[id].decisao !== "manter" && itens[id].decisao !== "excluir");
  const alterados = [
    ...CAMPOS_CCMA.filter(({ id }) => campos[id].editado).map(({ id, parte, rotulo }) => `Parte ${parte} · ${rotulo}: ${campos[id].valor || "(apagado)"}`),
    ...ITENS_CCMA.filter(({ id }) => itens[id].editado).map(({ id }) => `Parte 4 · ${textoItem(id, itens[id].texto)}`),
  ];

  return <div className="laudo-form laudo-form-page ccma">
    <p className="ccma-regra">Os documentos só sugerem os dados. Nada entra no formulário sem a sua confirmação, e os arquivos só são gerados depois da aprovação desta versão. O portal não envia nada à CCMA nem ao banco.</p>

    <section className="ccma-secao">
      <h4>1. Atendimento e arquivos recebidos</h4>
      <div className="laudo-source">
        <Button type="button" variant="outline" size="sm" onClick={adicionarArquivos} disabled={ocupado}>
          {lendo ? <Loader2 size={15} className="animate-spin" /> : <FileUp size={15} />} Adicionar documentos
        </Button>
        <small aria-live="polite">{lendo || "PDF, JPG ou PNG, até 10 MB cada. A leitura acontece no próprio servidor do portal, sem serviço externo, e os arquivos não ficam guardados."}</small>
      </div>
      {arquivos.length === 0 && <p className="detail-empty">Nenhum arquivo recebido. Você também pode preencher tudo à mão.</p>}
    </section>

    {arquivos.length > 0 && <section className="ccma-secao">
      <h4>2. Resumo dos documentos lidos</h4>
      <ul className="ccma-lista">
        {arquivos.map((arquivo) => <li key={arquivo.arquivo} className="ccma-arquivo">
          <div>
            <strong>{arquivo.arquivo}</strong>
            <small>{arquivo.tipo}{arquivo.paginas ? ` · ${arquivo.paginas} página(s)` : ""}{arquivo.ocr ? " · lido por imagem: confira cada dado" : ""}{arquivo.candidatos.length ? ` · ${arquivo.candidatos.length} dado(s) encontrado(s)` : " · nenhum dado encontrado"}</small>
            {arquivo.ilegiveis.length > 0 && <p className="laudo-warning"><AlertTriangle size={14} /> Página(s) sem leitura: {arquivo.ilegiveis.join(", ")}.</p>}
            {arquivo.aviso && <p className="laudo-warning"><AlertTriangle size={14} /> {arquivo.aviso}</p>}
          </div>
          <button type="button" className="icon-button" onClick={() => setArquivos((atuais) => atuais.filter((item) => item !== arquivo))} disabled={ocupado} aria-label={`Tirar ${arquivo.arquivo}`} title="Tirar da conferência"><X size={15} /></button>
        </li>)}
      </ul>
    </section>}

    <section className="ccma-secao">
      <h4>3. Prévia das partes 1, 2 e 3</h4>
      {PARTES.map(({ parte, titulo }) => <fieldset key={parte} className="laudo-encargos">
        <legend>{titulo}</legend>
        {CAMPOS_CCMA.filter((campo) => campo.parte === parte).map(({ id, rotulo }) => {
          const campo = campos[id], { valores } = consolidados[id], status = statusDe(id);
          return <div key={id} className="ccma-campo">
            <div className="ccma-campo-linha">
              <label>{rotulo}
                {id === "whatsapp"
                  ? <select value={campo.valor} onChange={(event) => digitarCampo(id, event.target.value)} disabled={ocupado}><option value="">Não informado</option><option value="SIM">SIM</option><option value="NÃO">NÃO</option></select>
                  : <input name={`ccma-${id}`} autoComplete="off" value={campo.valor} onChange={(event) => digitarCampo(id, event.target.value)} disabled={ocupado} />}
              </label>
              <div className="ccma-botoes" role="group" aria-label={`Decisão sobre ${rotulo}`}>
                <button type="button" className={campo.decisao === "confirmado" ? "ccma-botao ccma-botao-ativo" : "ccma-botao"} aria-pressed={campo.decisao === "confirmado"} disabled={ocupado || !campo.valor.trim()} onClick={() => mudarCampo(id, { decisao: "confirmado" })}>Confirmar</button>
                <button type="button" className={campo.decisao === "pendente" ? "ccma-botao ccma-botao-ativo" : "ccma-botao"} aria-pressed={campo.decisao === "pendente"} disabled={ocupado} onClick={() => mudarCampo(id, { decisao: "pendente" })}>Deixar pendente</button>
              </div>
            </div>
            <p className="ccma-origem">
              <span className={`ccma-tag ${campo.editado ? "ccma-tag-usuario" : CLASSE_STATUS[status]}`}>{campo.editado ? "ALTERADO PELO USUÁRIO" : status}</span>
              {!campo.editado && valores.length === 1 && <span> {origem(valores[0].fontes[0])}{valores[0].fontes.length > 1 ? ` (e mais ${valores[0].fontes.length - 1} fonte(s))` : ""}</span>}
            </p>
            {valores.length > 1 && <ul className="ccma-divergencia">
              {valores.map((item) => <li key={item.valor}>
                <button type="button" className={campo.valor === item.valor ? "ccma-botao ccma-botao-ativo" : "ccma-botao"} disabled={ocupado} onClick={() => mudarCampo(id, { valor: item.valor, decisao: "aguardando", editado: false })}>Usar {item.valor}</button>
                <small>{item.fontes.map((fonte) => origem(fonte)).join(" · ")}</small>
              </li>)}
            </ul>}
          </div>;
        })}
      </fieldset>)}
      <div className="new-sale-grid laudo-place">
        <label>Data do formulário <input type="date" value={data} onChange={(event) => setData(event.target.value)} disabled={ocupado} /></label>
      </div>
    </section>

    <section className="ccma-secao">
      <h4>4. Análise item a item da parte 4</h4>
      {ITENS_CCMA.map(({ id, rotulo, dica, opcoes }) => {
        const item = itens[id], recomendacao = recomendacoes[id];
        const sugerido = recomendacao.acao === "SUGERIR EXCLUSÃO" || item.sugerido;
        const botao = (decisao: DecisaoItem, texto: string, habilitado = true) =>
          <button type="button" className={item.decisao === decisao ? "ccma-botao ccma-botao-ativo" : "ccma-botao"} aria-pressed={item.decisao === decisao} disabled={ocupado || !habilitado} onClick={() => mudarItem(id, { decisao })}>{texto}</button>;
        return <fieldset key={id} className="laudo-encargos ccma-item">
          <legend>{rotulo.replace(/:$/, "")}</legend>
          <p className="ccma-origem"><span className={`ccma-tag ${recomendacao.acao === "MANTER" ? "ccma-tag-ok" : recomendacao.acao === "SUGERIR EXCLUSÃO" ? "ccma-tag-alerta" : "ccma-tag-neutra"}`}>{item.sugerido && recomendacao.acao !== "SUGERIR EXCLUSÃO" ? "SUGERIR EXCLUSÃO" : recomendacao.acao}</span> <span>{recomendacao.motivo}</span></p>
          {recomendacao.evidencias.map((evidencia) => <p key={`${evidencia.arquivo}-${evidencia.pagina}-${evidencia.trecho}`} className="ccma-evidencia">{origem(evidencia)}</p>)}
          <label>Texto no formulário
            <input name={`ccma-item-${id}`} autoComplete="off" placeholder={dica} value={item.texto} onChange={(event) => mudarItem(id, { texto: event.target.value, editado: true })} disabled={ocupado} />
          </label>
          {opcoes.length > 0 && <div className="ccma-botoes">
            {opcoes.map((opcao) => <button key={opcao} type="button" className={item.texto === opcao ? "ccma-botao ccma-botao-ativo" : "ccma-botao"} disabled={ocupado} onClick={() => mudarItem(id, { texto: opcao })}>{opcao}</button>)}
          </div>}
          <div className="ccma-botoes" role="group" aria-label={`Decisão sobre ${rotulo}`}>
            {botao("manter", "Manter", item.texto.trim().length > 0)}
            {!sugerido && <button type="button" className="ccma-botao" disabled={ocupado} onClick={() => mudarItem(id, { sugerido: true, decisao: "aguardando" })}>Sugerir exclusão</button>}
            {sugerido && botao("excluir", "Aprovar exclusão")}
            {botao("pendente", "Deixar pendente")}
          </div>
        </fieldset>;
      })}
    </section>

    <section className="ccma-secao">
      <h4>5. PENDÊNCIAS PARA CONFIRMAÇÃO</h4>
      {camposAbertos.length + itensAbertos.length === 0 && partesData(data)
        ? <p className="laudo-ok"><CheckCircle2 size={14} /> Nenhuma pendência.</p>
        : <ul className="ccma-pendencias">
          {problemas.map((problema) => <li key={problema} className="ccma-impede"><strong>Impede gerar:</strong> {problema}</li>)}
          {itensAbertos.map(({ id, rotulo }) => <li key={id} className="ccma-impede"><strong>Impede gerar:</strong> decida o item “{rotulo.replace(/:$/, "")}” da parte 4 (manter ou aprovar a exclusão).</li>)}
          {camposAbertos.filter(({ id }) => !["pedido", "nome", "reclamadoNome"].includes(id)).map(({ id, parte, rotulo }) => <li key={id}><strong>Fica em branco se gerar agora:</strong> Parte {parte} · {rotulo} ({campos[id].valor ? "valor ainda não confirmado" : statusDe(id).toLowerCase()}).</li>)}
        </ul>}
    </section>

    <section className="ccma-secao">
      <h4>6. SUGESTÕES DE EXCLUSÃO — AGUARDANDO APROVAÇÃO</h4>
      {sugeridos.length === 0 && <p className="detail-empty">Nenhuma sugestão aguardando aprovação.</p>}
      <ul className="ccma-lista">
        {sugeridos.map(({ id, rotulo, dica, padrao }) => <li key={id} className="ccma-arquivo">
          <div>
            <strong>{rotulo} {itens[id].texto || padrao || dica}</strong>
            <small>Motivo: {recomendacoes[id].acao === "SUGERIR EXCLUSÃO" ? recomendacoes[id].motivo : "sugerida por você."}</small>
            <small>Consequência: se aprovar, esta linha sai do formulário. Se mantiver, ela é impressa com o texto preenchido.</small>
          </div>
          <div className="ccma-botoes">
            <button type="button" className="ccma-botao" disabled={ocupado || !itens[id].texto.trim()} title={itens[id].texto.trim() ? undefined : "Preencha o texto do item na seção 4"} onClick={() => mudarItem(id, { decisao: "manter" })}>Manter</button>
            <button type="button" className="ccma-botao" disabled={ocupado} onClick={() => mudarItem(id, { decisao: "excluir" })}>Aprovar exclusão</button>
          </div>
        </li>)}
      </ul>
      {ITENS_CCMA.some(({ id }) => itens[id].decisao === "excluir") && <p className="ccma-origem">Exclusões aprovadas: {ITENS_CCMA.filter(({ id }) => itens[id].decisao === "excluir").map(({ rotulo }) => rotulo.replace(/:$/, "")).join("; ")}.</p>}
    </section>

    <section className="ccma-secao">
      <h4>7. Alterações manuais</h4>
      {alterados.length === 0 ? <p className="detail-empty">Nenhum campo alterado à mão.</p> : <ul className="ccma-pendencias">{alterados.map((texto) => <li key={texto}>{texto}</li>)}</ul>}
    </section>

    <section className="ccma-secao">
      <h4>8. Autorização para gerar a cópia preenchida</h4>
      <div className="laudo-preview ccma-previa" aria-live="polite">
        <p><strong>1)</strong> {dados.pedido || "—"}</p>
        <p><strong>2) Reclamante:</strong> {dados.reclamante.nome || "—"} · RG: {dados.reclamante.rg || "—"} · CPF/CNPJ: {dados.reclamante.documento || "—"} · Profissão: {dados.reclamante.profissao || "—"} · Estado civil: {dados.reclamante.estadoCivil || "—"} · Telefone: {dados.reclamante.telefone || "—"} · WhatsApp: {dados.reclamante.whatsapp || "—"} · E-mail: {dados.reclamante.email || "—"}</p>
        <p><strong>3) Reclamado:</strong> {dados.reclamado.nome || "—"} · CPF/CNPJ: {dados.reclamado.documento || "—"}</p>
        <p><strong>4)</strong> {dados.itens.length ? dados.itens.map((item) => textoItem(item.id, item.texto)).join(" · ") : "—"}</p>
        <p><strong>Data:</strong> {partesData(data) ? `São Caetano do sul, ${partesData(data)!.diaMes} de ${partesData(data)!.ano}` : "—"}</p>
      </div>
      {aprovada !== null && !aprovado && <p className="laudo-warning"><AlertTriangle size={14} /> A prévia mudou depois da aprovação. Revise e aprove esta nova versão.</p>}
      <label className="laudo-attach">
        <input type="checkbox" checked={aprovado} disabled={ocupado || !podeGerar} onChange={(event) => setAprovada(event.target.checked ? versao : null)} />
        Autorizo gerar a cópia preenchida do formulário com exatamente os dados desta prévia.
      </label>
      {!podeGerar && <p className="laudo-hint">Resolva os itens marcados com “Impede gerar” para poder autorizar.</p>}
      <div className="laudo-actions">
        <Button type="button" variant="outline" onClick={limpar} disabled={ocupado}>Limpar</Button>
        <Button type="button" onClick={gerarArquivos} disabled={ocupado || !aprovado || !podeGerar}>{gerar.isPending ? "Gerando..." : "Gerar formulário"}</Button>
      </div>
      {gerado && <div className="laudo-actions">
        <Button type="button" variant="outline" onClick={() => downloadFile(gerado.docx.nome, gerado.docx.conteudo, DOCX_MIME)}><Download size={15} /> Baixar Word</Button>
        <Button type="button" variant="outline" onClick={() => downloadFile(gerado.pdf.nome, gerado.pdf.conteudo, "application/pdf")}><Download size={15} /> Baixar PDF</Button>
      </div>}
    </section>
  </div>;
}
