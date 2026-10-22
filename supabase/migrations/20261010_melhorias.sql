-- Sales HUB com dados reais, consultores salvos, tags dos clientes e registro de ações.
-- Rode uma vez no SQL Editor do Supabase. Pode rodar de novo sem problema.

-- ── Vendas: setor (Comercial ou Jurídico) e valor perdido com chargeback ─────────────
ALTER TABLE public.vendas ADD COLUMN IF NOT EXISTS setor TEXT NOT NULL DEFAULT 'comercial';
ALTER TABLE public.vendas DROP CONSTRAINT IF EXISTS vendas_setor_check;
ALTER TABLE public.vendas ADD CONSTRAINT vendas_setor_check CHECK (setor IN ('comercial', 'juridico'));

-- ── Consultores: a lista que antes ficava fixa no código ───────────────────────────
CREATE TABLE IF NOT EXISTS public.consultores (
  id          BIGSERIAL PRIMARY KEY,
  nome        TEXT NOT NULL,
  ativo       BOOLEAN NOT NULL DEFAULT TRUE,   -- removido = inativo, para as vendas antigas manterem o nome
  created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS consultores_nome_unico ON public.consultores (LOWER(nome));
ALTER TABLE public.consultores ENABLE ROW LEVEL SECURITY;

-- Todo consultor que já tem venda entra como ativo; os novos são cadastrados pelo Sales HUB.
INSERT INTO public.consultores (nome)
SELECT nome FROM (
  SELECT DISTINCT UNNEST(consultants) AS nome FROM public.vendas
) nomes
WHERE nome IS NOT NULL AND BTRIM(nome) NOT IN ('', '—')
ON CONFLICT DO NOTHING;

-- ── Tags dos clientes ──────────────────────────────────────────────────────────────
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

-- ── Registro de ações da equipe (quem fez o quê e quando) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.auditoria (
  id          BIGSERIAL PRIMARY KEY,
  autor       TEXT NOT NULL,
  acao        TEXT NOT NULL,
  detalhes    TEXT,
  client_id   BIGINT,                          -- sem chave estrangeira: o registro fica mesmo se o cliente for apagado
  created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS auditoria_created_at_idx ON public.auditoria (created_at DESC);
ALTER TABLE public.auditoria ENABLE ROW LEVEL SECURITY;

-- Nenhuma política: só o servidor (service role key) lê e grava essas tabelas.
