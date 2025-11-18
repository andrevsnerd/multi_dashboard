# ⚙️ Configurar no Vercel - Passo a Passo

## ✅ Informações Coletadas:

- ✅ **URL do ngrok**: `https://gasometrical-itchingly-shiela.ngrok-free.dev`
- ✅ **PROXY_SECRET**: `proxy-nerd-2024-1591`
- ✅ **NODE_ENV**: `production`

---

## 🎯 Passo a Passo no Vercel:

### 1️⃣ Acessar o Vercel

1. Acesse: **https://vercel.com**
2. Faça login na sua conta
3. Selecione o projeto **`multi_dashboard`**

### 2️⃣ Ir para Environment Variables

1. Clique em **"Settings"** (Configurações) no menu superior
2. No menu lateral esquerdo, clique em **"Environment Variables"**

### 3️⃣ Adicionar Variável 1: PROXY_URL

1. Clique no botão **"Add"** ou **"Add New"**
2. Preencha:
   - **Key**: `PROXY_URL`
   - **Value**: `https://gasometrical-itchingly-shiela.ngrok-free.dev`
   - Marque os checkboxes:
     - ✅ **Production**
     - ✅ **Preview**
     - ✅ **Development**
3. Clique em **"Save"**

### 4️⃣ Adicionar Variável 2: PROXY_SECRET

1. Clique no botão **"Add"** novamente
2. Preencha:
   - **Key**: `PROXY_SECRET`
   - **Value**: `proxy-nerd-2024-1591`
   - Marque os checkboxes:
     - ✅ **Production**
     - ✅ **Preview**
     - ✅ **Development**
3. Clique em **"Save"**

### 5️⃣ Adicionar Variável 3: NODE_ENV

1. Clique no botão **"Add"** novamente
2. Preencha:
   - **Key**: `NODE_ENV`
   - **Value**: `production`
   - Marque os checkboxes:
     - ✅ **Production**
     - ✅ **Preview**
     - ✅ **Development**
3. Clique em **"Save"**

---

## 📋 Resumo das Variáveis a Adicionar:

| Key | Value | Environments |
|-----|-------|--------------|
| `PROXY_URL` | `https://gasometrical-itchingly-shiela.ngrok-free.dev` | ✅ Production, ✅ Preview, ✅ Development |
| `PROXY_SECRET` | `proxy-nerd-2024-1591` | ✅ Production, ✅ Preview, ✅ Development |
| `NODE_ENV` | `production` | ✅ Production, ✅ Preview, ✅ Development |

---

## ⚠️ IMPORTANTE:

**NÃO adicione estas variáveis quando usar proxy:**
- ❌ `DB_SERVER`
- ❌ `DB_DATABASE`
- ❌ `DB_USERNAME`
- ❌ `DB_PASSWORD`
- ❌ `DB_PORT`

**Apenas `PROXY_URL`, `PROXY_SECRET` e `NODE_ENV` são necessárias!**

---

## 🚀 Após Configurar:

### 1. Fazer Deploy

1. Vá para a aba **"Deployments"** no menu superior
2. Encontre o último deploy
3. Clique nos **3 pontos (...)** ao lado do deploy
4. Selecione **"Redeploy"**
5. Aguarde o deploy concluir (pode levar alguns minutos)

### 2. Testar

1. Após o deploy concluir, clique na URL do seu app
2. O app deve carregar normalmente
3. Teste se os dados aparecem corretamente

---

## ✅ Checklist:

- [ ] Acessou o Vercel
- [ ] Foi em Settings → Environment Variables
- [ ] Adicionou `PROXY_URL` = `https://gasometrical-itchingly-shiela.ngrok-free.dev`
- [ ] Adicionou `PROXY_SECRET` = `proxy-nerd-2024-1591`
- [ ] Adicionou `NODE_ENV` = `production`
- [ ] Marcou todas para Production, Preview e Development
- [ ] Fez redeploy no Vercel
- [ ] Testou o app

---

## 🔄 Manter Rodando:

**Para o app funcionar, mantenha rodando:**
- ✅ **Proxy** (Terminal 1) - Porta 3001
- ✅ **ngrok** (Terminal 2) - Tunnel ativo

**Se você fechar qualquer um deles, o app no Vercel parará de funcionar!**

---

## 🆘 Se tiver problemas:

### Erro de conexão no Vercel:
- ✅ Verifique se o proxy está rodando localmente
- ✅ Verifique se o ngrok está rodando
- ✅ Verifique se as variáveis estão corretas no Vercel
- ✅ Certifique-se de ter feito redeploy após adicionar as variáveis

### URL do ngrok mudou:
- Se você reiniciar o ngrok, a URL muda
- Atualize `PROXY_URL` no Vercel com a nova URL
- Faça redeploy novamente

---

**Pronto! Configure as variáveis no Vercel e faça o deploy!** 🚀

