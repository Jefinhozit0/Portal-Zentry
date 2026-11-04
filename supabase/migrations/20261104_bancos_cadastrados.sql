-- Bancos que a equipe cadastra pelo portal (termo e notificações), somados à lista fixa de shared/bancos.ts.
-- Rode uma vez no SQL Editor do Supabase. Pode rodar de novo sem problema.

CREATE TABLE IF NOT EXISTS public.bancos_cadastrados (
  id BIGSERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  -- Formatado (00.000.000/0000-00); um cadastro por CNPJ.
  cnpj TEXT NOT NULL UNIQUE,
  endereco TEXT NOT NULL,
  cadastrado_por TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Só o servidor (chave de serviço) lê e escreve; o navegador nunca acessa a tabela direto.
ALTER TABLE public.bancos_cadastrados ENABLE ROW LEVEL SECURITY;

-- Confere: deve mostrar quantos bancos já foram cadastrados (0 na primeira vez).
SELECT COUNT(*) AS bancos_cadastrados FROM public.bancos_cadastrados;
