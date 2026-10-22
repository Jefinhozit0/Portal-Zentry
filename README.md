# Portal Zentry

Portal da **Zentry Soluções** com duas áreas:

- **Área interna (equipe Zentry):** painel de indicadores, cadastro e acompanhamento de clientes, chargebacks, atendimento por chat e o Sales HUB comercial.
- **Área do cliente:** o cliente cria a senha pelo link de primeiro acesso, aceita os termos de uso e acompanha o próprio processo e as mensagens.

## Stack

| Camada | Tecnologia |
| --- | --- |
| Frontend | React 19, Vite, Tailwind CSS 4, shadcn/ui (Radix), wouter |
| API | Express + tRPC (`/api/trpc`), superjson |
| Banco e autenticação | Supabase (Postgres + Auth) |
| E-mail | Gmail SMTP (nodemailer) ou Resend |
| WhatsApp | Baileys (conexão não oficial pelo QR code) ou Meta WhatsApp Cloud API |
| Testes | Vitest |

## O que já está pronto

### Área interna (`/`)
- **Login, cadastro e recuperação de senha** com código de verificação por e-mail. Só os e-mails de `STAFF_EMAILS` abrem a área da equipe.
- **Dashboard** com indicadores (clientes ativos, solicitações pendentes, processos, taxa de reversão de chargebacks), gráfico de processos e listas filtráveis que abrem exatamente os registros de cada número. Atualiza a cada 60 s.
- **Clientes:** busca, filtros por status, cadastro com serviços contratados, edição, tags salvas e página de detalhe com status, progresso, documentos e linha do tempo. No cadastro, o cliente recebe o link curto de primeiro acesso por e-mail e WhatsApp, com opção de reenviar.
- **Chargebacks:** lista com detalhe de cada caso.
- **Atendimento:** conversas com os clientes (mensagens e chamados). A equipe recebe e-mail quando um cliente escreve.
- **Sales HUB:** vendas por setor (Comercial e Jurídico) e por mês, ranking de consultores, evolução de 12 meses, horários das vendas, Zentry Control consolidado, cadastro e edição de vendas, consultores salvos e exportação em CSV e PDF. Todos os números vêm das vendas registradas.
- **Administração** (só administradores): WhatsApp da empresa com QR code na tela, backup diário, avisos automáticos, endereço público e registro de ações da equipe.
- **Administradores e funcionários:** só quem está em `ADMIN_EMAILS` apaga clientes, conversas, documentos, vendas e consultores.
- **Tema claro e escuro.**

### Área do cliente
- **Primeiro acesso:** link curto (`/a/<código>`) válido por 7 dias e de uso único para criar a senha. Quem não cria a senha em 2 dias recebe um lembrete automático, uma vez.
- **Termos de uso** versionados. O processo e o chat só abrem depois do aceite, e o servidor também verifica isso.
- **Meu processo** com status, progresso, documentos para baixar e histórico, e **chat** com a equipe, incluindo um assistente para dúvidas frequentes. A conversa fica salva.
- **Avisos automáticos** por WhatsApp e e-mail quando a equipe responde, muda o status ou anexa um documento.
- **Aplicativo com notificações:** os termos incluem instalar o portal como app. Ao aceitar, o Android e o computador oferecem a instalação na hora; no iPhone aparece o passo a passo (Compartilhar → Adicionar à Tela de Início). Depois o cliente ativa as notificações com um toque e passa a ser avisado no aparelho dos mesmos três eventos, mesmo com o app fechado. No iPhone as notificações só funcionam com o app instalado (iOS 16.4 ou mais novo). A tela Termos mostra quem está com elas ativas. A equipe também pode ativar, pela faixa no topo da área interna, um aviso no celular a cada mensagem de cliente (abre o Atendimento). Precisa da migração `20261016_notificacoes_app.sql`.

### Design (revisão de 08/10/2026)
- Ponte entre os tokens da marca e os componentes shadcn/ui, que antes apareciam com fundo transparente.
- Modo escuro dos componentes ligado ao botão de tema.
- Melhorias de contraste (WCAG AA), contorno de foco, zoom liberado no celular e respeito a "reduzir movimento".
- Ajustes de layout para celular (até 375 px), títulos em fonte serifada, escala única de cantos e sombras, animações de carregamento e página 404 com a marca.

## Estrutura

```
client/          Frontend React (Vite)
  src/pages/     Home (área interna), ClientPortal, ClientDetail, FirstAccess, NotFound
  src/index.css  Tokens de tema e estilos do portal
server/          API Express + tRPC
  routers.ts     Rotas: auth, account, portal (equipe) e cliente
  _core/         Servidor, e-mail, WhatsApp, dashboard, acesso do cliente, Supabase
shared/          Tipos e regras compartilhadas (dashboard, chamados)
supabase/        Migrações SQL
supabase-schema.sql  Esquema completo: clientes, chargebacks, vendas, mensagens
```

## Como rodar

### Pré-requisitos
- Node.js 20 ou superior
- pnpm 10 (`npm install -g pnpm` ou `corepack enable`)
- Um projeto no [Supabase](https://supabase.com)

### 1. Instalar as dependências
```bash
pnpm install
```

### 2. Configurar as variáveis de ambiente
```bash
cp .env.example .env
```
Preencha o `.env`:

| Variável | Para quê |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | Acesso do servidor ao Supabase (service role) |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Acesso do navegador ao Supabase (login) |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | Envio de e-mails pelo Gmail (senha de app) |
| `RESEND_API_KEY`, `EMAIL_FROM` | Alternativa ao Gmail para e-mails |
| `APP_URL` | Endereço público usado nos links. `auto` acompanha o túnel do Cloudflare quando ele muda |
| `WHATSAPP_PROVIDER` | `web` (não oficial, gratuito), `cloud` (API oficial da Meta) ou `off` |
| `WHATSAPP_*` | Configuração da API oficial, usada só quando `WHATSAPP_PROVIDER=cloud` |
| `STAFF_EMAILS` | E-mails da equipe, separados por vírgula. Só essas contas abrem a área interna |
| `ADMIN_EMAILS` | Administradores: podem apagar e veem a página Administração |
| `TEAM_NOTIFY_EMAILS`, `TEAM_NOTIFY_WHATSAPP` | Quem recebe o aviso quando um cliente escreve (padrão: todos de `STAFF_EMAILS`, por e-mail) |
| `NOTIFY_CLIENTS` | `off` desliga os avisos aos clientes |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Chaves das notificações do app. Vazio: criadas sozinhas em `.push-keys.json`. Não perca nem troque: todo aparelho teria que ativar de novo |
| `BACKUP_DIR` | Pasta do backup diário (padrão `backups`). Uma pasta do Google Drive guarda cópia fora do notebook |
| `BACKGROUND_JOBS` | `off` desliga backup e lembretes automáticos |
| `PORT` | Porta do servidor (padrão 3000) |

### 3. Criar as tabelas no Supabase
No Supabase, abra **SQL Editor** e rode o conteúdo de `supabase-schema.sql`. Depois rode os arquivos de `supabase/migrations/` em ordem.

As tabelas ficam com RLS ligado e sem políticas. Só o servidor, com a service role key, lê e grava os dados. Nunca crie políticas que liberem as tabelas para `anon`, porque essa chave vai junto no site.

Para testar com dados fictícios (opcional, não use no banco do cliente):
```bash
npx tsx seed-supabase.ts
```

### 4. Rodar em desenvolvimento
```bash
pnpm dev
```
Abra http://localhost:3000. O mesmo servidor entrega a API e o frontend. Se a porta estiver ocupada, ele usa a próxima livre e mostra qual no terminal.

> Se a tela mostrar "Failed to fetch", o servidor não está rodando. Inicie o `pnpm dev` de novo.
> Se aparecer "JWT issued at future", sincronize o relógio do computador.

### 5. Produção
```bash
pnpm build
pnpm start
```

### WhatsApp (conexão não oficial)
Com `WHATSAPP_PROVIDER=web`, o servidor mostra um QR code no terminal ao iniciar. No celular da empresa, abra **WhatsApp > Configurações > Dispositivos conectados > Conectar um dispositivo** e escaneie. A sessão fica salva na pasta `.whatsapp-auth/`, então o QR só volta a aparecer se o aparelho for desconectado no celular.

- Essa conexão não é oficial. O WhatsApp pode bloquear o número se as mensagens parecerem spam.
- Para reduzir o risco, o portal envia uma mensagem por vez, com 8 a 15 segundos de intervalo. Os avisos têm intervalo mínimo por cliente (15 min para respostas, 10 min para documentos).
- O QR code também aparece na página Administração, para quando o portal roda escondido.
- Rode apenas um servidor por vez com a mesma pasta `.whatsapp-auth/`. Dois servidores com a mesma sessão derrubam um ao outro.
- Trate a pasta `.whatsapp-auth/` como uma senha: quem a tiver consegue enviar mensagens pelo número.

### Rodar no notebook sem precisar abrir nada
```powershell
powershell -ExecutionPolicy Bypass -File scripts\instalar-inicio-automatico.ps1
```
Cria a tarefa "Portal Zentry" no Windows: a cada logon, o portal e o túnel do Cloudflare ligam escondidos e voltam sozinhos se caírem. Também tira a suspensão na tomada. Os registros ficam em `logs\`. Para desfazer, rode `scripts\remover-inicio-automatico.ps1`. Com `APP_URL=auto`, os links novos seguem o endereço atual do túnel.

### Backup e restauração
O servidor faz um backup por dia na pasta `backups\` (últimos 30 dias, mais uma cópia de cada documento). A página Administração mostra o último backup e tem o botão "Fazer backup agora". Para trazer registros de volta:
```bash
npx tsx scripts/restaurar-backup.ts backups/2026-10-09 clientes 7,8,9
```

### Dados de exemplo
O esquema inicial criava clientes, vendas e chargebacks fictícios. O arquivo `supabase/limpar-dados-de-exemplo.sql` mostra e apaga esses registros. Para clientes, prefira o botão "Apagar cliente", que também remove o login.

### Outros comandos
```bash
pnpm test     # testes (Vitest)
pnpm check    # checagem de tipos (TypeScript)
pnpm format   # formatação (Prettier)
```

## Pendências conhecidas
- No Supabase, desligue **Authentication > Sign In / Providers > Allow new users to sign up**. O portal cria as contas pelo servidor e não depende disso.
- Os avisos em texto livre pelo WhatsApp só funcionam com a conexão não oficial (`WHATSAPP_PROVIDER=web`).
