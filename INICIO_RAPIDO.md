# 🚀 Início Rápido - Proxy Local

## ✅ O que já foi feito automaticamente:

- ✅ Dependências do proxy instaladas
- ✅ `PROXY_SECRET` configurado no `.env.local`
- ✅ ngrok instalado globalmente
- ✅ Scripts de inicialização criados

---

## 🎯 Agora você só precisa fazer 3 coisas:

### 1️⃣ Autenticar o ngrok (primeira vez apenas)

Se ainda não autenticou o ngrok:

1. Acesse: https://dashboard.ngrok.com/get-started/your-authtoken
2. Faça login ou crie uma conta gratuita
3. Copie o **authtoken**
4. No terminal, execute:
   ```bash
   ngrok config add-authtoken SEU_TOKEN_AQUI
   ```

### 2️⃣ Iniciar o Proxy e o Túnel

**Opção A: Script Automático (Mais Fácil)**
```bash
# Windows (clique duplo ou execute no terminal)
start-all.bat
```

**Opção B: Manual (Se preferir)**
```bash
# Terminal 1: Iniciar proxy
cd proxy-server
npm start

# Terminal 2: Iniciar túnel
ngrok http 3001
```

### 3️⃣ Configurar no Vercel

1. **Copie a URL do ngrok** (aparece quando você inicia o ngrok)
   - Exemplo: `https://abc123.ngrok-free.app`

2. **Copie o PROXY_SECRET** do seu `.env.local`:
   ```
   PROXY_SECRET=proxy-nerd-2024-1591
   ```

3. **No Vercel**, adicione estas variáveis:
   - `PROXY_URL` = URL do ngrok
   - `PROXY_SECRET` = valor do `.env.local`
   - `NODE_ENV` = `production`

---

## 📝 Scripts Disponíveis

| Script | Descrição |
|--------|-----------|
| `start-proxy.bat` | Inicia apenas o servidor proxy |
| `start-ngrok.bat` | Inicia apenas o túnel ngrok |
| `start-all.bat` | Inicia proxy + ngrok automaticamente |

---

## ✅ Verificar se está funcionando

1. O proxy está rodando se você vê:
   ```
   ✅ Conectado ao banco de dados!
   🚀 Servidor Proxy rodando na porta 3001
   ```

2. O ngrok está funcionando se você vê:
   ```
   Forwarding: https://abc123.ngrok-free.app -> http://localhost:3001
   ```

3. Teste o proxy:
   - Acesse: `http://localhost:3001/health`
   - Deve retornar: `{"status":"ok","database":"connected"}`

---

## ⚠️ IMPORTANTE

**Mantenha ambos rodando** enquanto o app estiver no Vercel:
- ✅ Servidor Proxy (`npm start` na pasta `proxy-server`)
- ✅ Túnel ngrok (`ngrok http 3001`)

Se você fechar qualquer um deles, o app no Vercel parará de funcionar.

---

## 🔄 Próximos Passos

1. ✅ Autenticar ngrok (se ainda não fez)
2. ✅ Iniciar proxy + ngrok
3. ✅ Configurar variáveis no Vercel
4. ✅ Fazer deploy no Vercel
5. ✅ Testar o app!

---

## 🆘 Problemas?

### "ngrok: command not found"
**Solução**: O ngrok foi instalado globalmente. Se não encontrar, tente:
```bash
npx ngrok http 3001
```

### "PROXY_SECRET não configurado"
**Solução**: Verifique se o `.env.local` tem a variável `PROXY_SECRET`

### Proxy não conecta ao banco
**Solução**: Verifique se:
- SQL Server está rodando
- As credenciais no `.env.local` estão corretas
- A porta 1433 está acessível

---

**Pronto! Agora é só iniciar e configurar no Vercel!** 🎉

