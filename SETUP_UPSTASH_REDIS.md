# 🚀 Guia de Configuração - Upstash Redis para Metas

Este guia explica como configurar o Upstash Redis (via Vercel Marketplace) para salvar as metas da dashboard em produção.

## 📋 Passo a Passo

### 1. Instalar Upstash Redis via Marketplace

1. Acesse o [Dashboard do Vercel](https://vercel.com/dashboard)
2. Selecione seu projeto (`multi-dashboard`)
3. Vá em **Storage** (no menu lateral)
4. Clique em **Create Database**
5. Role até **Marketplace Database Providers**
6. Clique em **Upstash** → **Serverless DB (Redis, Vector, Queue, Search)**
7. Clique em **Add Integration** ou **Install**
8. Se necessário, faça login na sua conta Upstash (ou crie uma gratuita)

### 2. Criar o Banco Redis

1. No painel do Upstash, você verá opções para criar um banco
2. Escolha **Redis** (não Vector, Queue ou Search)
3. Dê um nome (ex: `dashboard-goals-redis`)
4. Escolha a região (recomendado: `São Paulo` ou região próxima ao Brasil)
5. Selecione o plano **Free** (10.000 comandos/dia, 256 MB)
6. Clique em **Create**

### 3. Conectar ao Projeto Vercel

1. No painel do Upstash, vá na aba **Settings** ou **Integrations**
2. Procure por **Vercel Integration** ou **Connect to Vercel**
3. Selecione seu projeto `multi-dashboard`
4. Clique em **Connect**

### 4. Variáveis de Ambiente (Automático)

O Vercel **automaticamente** adiciona as seguintes variáveis de ambiente ao seu projeto:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

**Não é necessário fazer nada manualmente!** O Vercel já configura isso para você após conectar.

### 5. Fazer Deploy

1. Faça commit das alterações:
   ```bash
   git add .
   git commit -m "feat: adicionar suporte a Upstash Redis para metas"
   git push
   ```

2. O Vercel fará o deploy automaticamente

3. Após o deploy, as metas serão salvas no Redis automaticamente!

## ✅ Como Funciona

- **Em Produção (Vercel)**: As metas são salvas no Upstash Redis (persistente)
- **Em Desenvolvimento Local**: As metas continuam sendo salvas no arquivo `data/goals.json` (fallback automático)

## 🔍 Verificar se Está Funcionando

1. Acesse sua dashboard em produção
2. Abra o modal de metas e defina algumas metas
3. Salve as metas
4. Recarregue a página - as metas devem estar lá!
5. Faça um novo deploy - as metas devem continuar salvas!

## 🐛 Troubleshooting

### Erro: "UPSTASH_REDIS_REST_URL is not defined"

- Verifique se o Redis foi conectado ao projeto no Vercel
- Verifique se as variáveis de ambiente estão configuradas (devem estar automáticas)
- Faça um novo deploy após conectar o Redis
- No painel do Upstash, verifique se o banco está ativo

### Metas não estão sendo salvas

- Verifique os logs do Vercel (Dashboard > Deployments > [seu deploy] > Functions)
- Certifique-se de que o Redis está ativo e conectado
- Verifique se não há erros no console do navegador
- No painel do Upstash, verifique se não excedeu o limite de comandos (10.000/dia no plano free)

## 💰 Custos

O plano gratuito do Upstash Redis inclui:
- **256 MB de armazenamento**
- **10.000 comandos/dia** (leitura + escrita)

Para metas de dashboard, isso é mais que suficiente! 🎉

**Nota**: Cada operação de leitura/escrita conta como 1 comando. Com uso normal (algumas leituras ao carregar a página + 1 escrita ao salvar), você não deve chegar perto do limite.

## 📝 Notas

- As metas antigas do arquivo `data/goals.json` **não serão migradas automaticamente**
- Se quiser migrar as metas antigas, você pode:
  1. Abrir o modal de metas em produção
  2. Reinserir as metas manualmente
  OU
  3. Criar um script de migração (se necessário, posso ajudar)
