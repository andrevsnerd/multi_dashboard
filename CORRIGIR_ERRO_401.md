# 🔧 Corrigir Erro 401 - Autenticação do Proxy

## ⚠️ Problema:

O erro **401 Unauthorized** indica que a autenticação do proxy está falhando.

## 🔍 Possíveis Causas:

1. **`PROXY_SECRET` não está configurado no Vercel**
2. **`PROXY_SECRET` está diferente do configurado no proxy server**
3. **`PROXY_URL` está incorreto ou mudou (ngrok reiniciou)**

---

## ✅ Solução:

### 1. Verificar o Token do Proxy Server

Quando você iniciar o proxy server, ele mostra o token:
```
🔑 Token de autenticação: proxy-nerd-2024-1591
```

**Anote este token!**

### 2. Verificar as Variáveis no Vercel

1. Acesse: https://vercel.com → seu projeto `multi_dashboard`
2. Vá em **Settings** → **Environment Variables**
3. Verifique se as seguintes variáveis estão configuradas:

**PROXY_SECRET:**
- Key: `PROXY_SECRET`
- Value: `proxy-nerd-2024-1591` (ou o valor que aparece quando você inicia o proxy)
- Marque: ✅ Production, ✅ Preview, ✅ Development

**PROXY_URL:**
- Key: `PROXY_URL`
- Value: `https://seu-url.ngrok-free.app` (URL atual do ngrok)
- Marque: ✅ Production, ✅ Preview, ✅ Development

**NODE_ENV:**
- Key: `NODE_ENV`
- Value: `production`
- Marque: ✅ Production, ✅ Preview, ✅ Development

### 3. Se as Variáveis Estão Corretas

1. **Delete as variáveis** no Vercel
2. **Adicione novamente** com os valores corretos
3. **Faça um novo deploy** no Vercel

### 4. Verificar se o Proxy Está Rodando

Certifique-se de que:
- ✅ O proxy server está rodando na porta 3001
- ✅ O ngrok está rodando e expondo a porta 3001
- ✅ A URL do ngrok está atualizada no Vercel

---

## 🔍 Como Testar:

### Teste 1: Verificar o Proxy Está Acessível

1. Abra o terminal onde o ngrok está rodando
2. Copie a URL (ex: `https://abc123.ngrok-free.app`)
3. Acesse no navegador: `https://abc123.ngrok-free.app/health`
4. Deve retornar: `{"status":"ok","database":"connected",...}`

### Teste 2: Verificar o Token

1. Acesse: `https://abc123.ngrok-free.app/`
2. Deve mostrar informações do proxy, incluindo o token esperado

---

## 📝 Checklist:

- [ ] Proxy server está rodando
- [ ] Ngrok está rodando e expondo a porta 3001
- [ ] Anotou o token do proxy server
- [ ] Configurou `PROXY_SECRET` no Vercel com o token correto
- [ ] Configurou `PROXY_URL` no Vercel com a URL do ngrok
- [ ] Configurou `NODE_ENV` no Vercel como `production`
- [ ] Fez um novo deploy no Vercel após configurar as variáveis
- [ ] Testou se o proxy está acessível via `/health`

---

**Após corrigir as variáveis, faça um novo deploy no Vercel e teste novamente!** 🚀

