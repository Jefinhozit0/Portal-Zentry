import { FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { type Banco, type BancoNovo, bancoDoCadastro, formatCnpj, listaDeBancos, problemasBanco } from "@shared/bancos";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";

/** The value of the "register" option in the bank lists. */
export const NOVO_BANCO = "__novo-banco";
export const NOVO_BANCO_LABEL = "+ Cadastrar novo banco";

/** The banks the forms offer: the fixed list plus the ones the team registered. */
export function useBancos() {
  const query = trpc.portal.bancos.useQuery(undefined, { retry: false });
  return useMemo(() => {
    const cadastrados = (query.data ?? []).map(bancoDoCadastro);
    return { cadastrados, todos: listaDeBancos(cadastrados) };
  }, [query.data]);
}

/** Open while `inicial` is set; it starts with what the form already has (a bank read from a contract). */
export function BancoCadastroDialog({ inicial, onClose, onSaved }: { inicial: BancoNovo | null; onClose: () => void; onSaved: (banco: Banco) => void }) {
  const [form, setForm] = useState<BancoNovo>({ nome: "", cnpj: "", endereco: "" });
  const utils = trpc.useUtils();
  const cadastrar = trpc.portal.cadastrarBanco.useMutation();

  useEffect(() => {
    if (inicial) setForm(inicial);
  }, [inicial]);

  async function save(event: FormEvent) {
    event.preventDefault();
    const problems = problemasBanco(form);
    if (problems.length) { toast.error(problems[0]); return; }
    try {
      const row = await cadastrar.mutateAsync(form);
      await utils.portal.bancos.invalidate();
      toast.success(`${row.nome} cadastrado.`);
      onSaved(bancoDoCadastro(row));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível cadastrar o banco.");
    }
  }

  const set = (key: keyof BancoNovo) => (event: React.ChangeEvent<HTMLInputElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));

  return <Dialog open={inicial !== null} onOpenChange={(open) => !open && !cadastrar.isPending && onClose()}>
    <DialogContent className="hub-dialog">
      <form onSubmit={save}>
        <DialogHeader>
          <DialogTitle>Cadastrar novo banco</DialogTitle>
          <DialogDescription>Fica disponível para toda a equipe no termo e nas notificações. Estes dados vão impressos nos documentos: confira no cartão CNPJ da Receita Federal.</DialogDescription>
        </DialogHeader>
        <div className="new-sale-grid">
          <label className="full-field">Razão social<input required autoFocus value={form.nome} maxLength={200} onChange={set("nome")} placeholder="Banco Exemplo S.A." /></label>
          <label className="full-field">CNPJ<input required inputMode="numeric" value={form.cnpj} onChange={set("cnpj")} onBlur={() => setForm((current) => ({ ...current, cnpj: current.cnpj.replace(/\D/g, "").length === 14 ? formatCnpj(current.cnpj) : current.cnpj }))} placeholder="00.000.000/0000-00" /></label>
          <label className="full-field">Endereço da sede, com CEP<input required value={form.endereco} maxLength={300} onChange={set("endereco")} placeholder="Rua, nº, bairro, cidade - UF, CEP: 00000-000" /></label>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={cadastrar.isPending}>Cancelar</Button>
          <Button type="submit" disabled={cadastrar.isPending}>{cadastrar.isPending ? "Cadastrando..." : "Cadastrar banco"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
