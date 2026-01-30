# Banco de usuários no Vercel (Neon Postgres)

O dashboard usa **Neon** (Postgres serverless) para armazenar usuários em produção. O plano gratuito do Neon é suficiente para este projeto.

---

## 1. Criar o banco no Neon (pelo Vercel)

1. Acesse o [Dashboard da Vercel](https://vercel.com/dashboard) e abra o seu projeto (multi-dashboard).

2. Vá em **Storage** (menu lateral) e clique em **Create Database**.

3. Escolha **Postgres** e depois **Neon** (ou **Continue with Neon**).

4. Se for a primeira vez, faça login/autorize o Neon com sua conta (GitHub ou e-mail).

5. Crie o banco:
   - **Database name**: pode deixar o padrão (ex.: `neondb`) ou usar `dashboard-users`.
   - **Region**: escolha a mais próxima do seu público (ex.: `São Paulo` ou `East US`).
   - Clique em **Create**.

6. O Vercel vai:
   - Criar o projeto no Neon
   - Injetar as variáveis de ambiente no seu projeto (ex.: `POSTGRES_URL` ou `DATABASE_URL`)

7. **Redeploy**: após criar o banco, faça um novo deploy do projeto (Deployments → ⋮ no último deploy → Redeploy) para que as novas variáveis sejam usadas.

---

## 2. Variáveis de ambiente

O app usa **uma** destas variáveis (a que estiver definida):

- `POSTGRES_URL` – normalmente injetada pela integração Vercel + Neon  
- `DATABASE_URL` – alternativa; você pode copiar do Neon e colar no Vercel

### Conferir no Vercel

1. No projeto, vá em **Settings** → **Environment Variables**.
2. Deve aparecer algo como `POSTGRES_URL` ou `DATABASE_URL` (conexão com o Neon).
3. Se não aparecer, crie manualmente:
   - No [Neon Console](https://console.neon.tech) → seu projeto → **Connection Details**.
   - Copie a **Connection string** (começa com `postgresql://...`).
   - No Vercel: **Add New** → nome `DATABASE_URL`, valor = a connection string, ambiente **Production** (e Preview se quiser).

---

## 3. Criar o banco direto no Neon (sem usar Storage do Vercel)

Se preferir configurar tudo no Neon:

1. Acesse [console.neon.tech](https://console.neon.tech) e crie uma conta (ou use GitHub).

2. **New Project**:
   - Nome do projeto: ex. `dashboard-nerd`
   - Region: a mais próxima
   - Clique em **Create Project**.

3. Na tela do projeto, em **Connection Details**, copie a **Connection string** (URI completa).

4. No Vercel, no seu projeto:
   - **Settings** → **Environment Variables**
   - **Add New**:
     - Name: `DATABASE_URL` (ou `POSTGRES_URL`)
     - Value: a connection string copiada (ex.: `postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require`)
     - Environment: Production (e Preview se quiser)

5. Faça **Redeploy** do projeto para carregar a variável.

---

## 4. Tabela de usuários

A tabela é criada **automaticamente** na primeira vez que o app usar o banco (login ou painel admin):

- **Tabela**: `dashboard_users`
- **Colunas**: `id`, `username`, `password_hash`, `role`, `permissions` (JSONB)

Não é necessário rodar SQL manualmente no Neon.

---

## 5. Usuários iniciais (seed)

Na primeira vez que alguém fizer **login** (ou um admin abrir o **Painel Admin**) com o banco Neon ativo, o sistema cria estes usuários se a tabela estiver vazia:

| Usuário       | Senha        | Função    |
|---------------|--------------|-----------|
| andre.sabetta | asabetta     | Admin     |
| logistica     | logistica123 | Logística |

Depois disso, use o Painel Admin (usuário admin) para criar/editar/remover usuários.

---

## 6. Comportamento local vs produção

| Ambiente   | Onde roda        | Banco de usuários                          |
|-----------|-------------------|--------------------------------------------|
| Local     | `npm run dev`     | Arquivo `data/users.json` (se não tiver `DATABASE_URL`/`POSTGRES_URL`) |
| Local     | Com `DATABASE_URL` no `.env.local` | Neon (mesmo banco ou outro projeto)        |
| Vercel    | Deploy            | Neon (variável injetada ou `DATABASE_URL`) |

Para testar com Neon na sua máquina:

1. Crie um projeto no Neon (ou use o mesmo do Vercel).
2. Crie `.env.local` na raiz do projeto com:
   ```env
   DATABASE_URL=postgresql://usuario:senha@host.neon.tech/neondb?sslmode=require
   ```
3. Rode `npm run dev` e faça login; a tabela e o seed serão criados no Neon.

---

## 7. Resumo rápido (Vercel)

1. No projeto Vercel → **Storage** → **Create Database** → **Postgres** → **Neon**.
2. Criar o banco e autorizar o Neon.
3. Conferir em **Settings** → **Environment Variables** se existe `POSTGRES_URL` ou `DATABASE_URL`.
4. **Redeploy** do projeto.
5. Acessar o app, fazer login (ou abrir o Painel Admin com um admin); usuários iniciais são criados automaticamente.

Pronto: em produção os usuários ficam no Postgres (Neon) e não em arquivo.
