-- =============================================================================
-- Portal Zentry - Supabase Schema
-- Execute este SQL no Supabase SQL Editor (Supabase > SQL Editor do projeto da Zentry)
-- =============================================================================

-- ----------------------------------------
-- Clientes (casos jurídicos)
-- ----------------------------------------
CREATE TABLE IF NOT EXISTS public.clientes (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  cpf         TEXT,
  type        TEXT,                          -- Tipo do processo (ex: Revisão de juros)
  status      TEXT,                          -- Status atual do processo
  updated     TEXT,                          -- Data/hora da última atualização (texto livre)
  tone        TEXT CHECK (tone IN ('green', 'yellow', 'red')) DEFAULT 'green',
  email       TEXT,
  phone       TEXT,
  services    TEXT[],                        -- Array de serviços contratados
  created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  atualizado_em TIMESTAMPTZ DEFAULT NOW() NOT NULL -- Última atualização do processo (usada no dashboard)
);

-- ----------------------------------------
-- Chargebacks
-- ----------------------------------------
CREATE TABLE IF NOT EXISTS public.chargebacks (
  id          BIGSERIAL PRIMARY KEY,
  client      TEXT NOT NULL,
  bank        TEXT,
  amount      TEXT,                          -- Valor formatado (ex: R$ 8.420,55)
  deadline    TEXT,                          -- Prazo formatado
  status      TEXT,
  tone        TEXT DEFAULT 'blue',
  created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ----------------------------------------
-- Sales Hub (vendas)
-- ----------------------------------------
CREATE TABLE IF NOT EXISTS public.vendas (
  id           BIGSERIAL PRIMARY KEY,
  date         TEXT NOT NULL,               -- Data da venda (dd/mm/yyyy)
  client       TEXT NOT NULL,
  phone        TEXT,
  consultants  TEXT[],                      -- Array de consultores
  product      TEXT,
  status       TEXT CHECK (status IN ('Pendente', 'OK')) DEFAULT 'Pendente',
  cbk          BOOLEAN DEFAULT FALSE,
  gross        NUMERIC(12, 2) DEFAULT 0,
  net          NUMERIC(12, 2) DEFAULT 0,
  note         TEXT DEFAULT '',
  created_at   TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ----------------------------------------
-- Atendimento (mensagens de chat)
-- ----------------------------------------
CREATE TABLE IF NOT EXISTS public.mensagens (
  id          BIGSERIAL PRIMARY KEY,
  client_id   BIGINT REFERENCES public.clientes(id) ON DELETE CASCADE,
  client_name TEXT,                          -- Denormalized for convenience
  sender      TEXT CHECK (sender IN ('client', 'team', 'assistant', 'assistant_choice')) NOT NULL, -- assistant* = assistente virtual, visível só para o cliente
  text        TEXT NOT NULL,
  time        TEXT,                          -- Horário formatado (HH:mm)
  created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Sem dados de exemplo: o portal começa vazio. Para testar com dados fictícios, use seed-supabase.ts.

-- ----------------------------------------
-- Enable RLS (Row Level Security) with no policies: only the server (service role key) reads and writes.
-- ----------------------------------------
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chargebacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mensagens ENABLE ROW LEVEL SECURITY;

