# ✅ Configuração Completa - Resumo

## 🎉 O que já foi feito automaticamente:

1. ✅ **Dependências do proxy instaladas** (`proxy-server/node_modules`)
2. ✅ **PROXY_SECRET configurado** no `.env.local`:
   ```
   PROXY_SECRET=proxy-nerd-2024-1591
   ```
3. ✅ **ngrok instalado globalmente** (pode usar `ngrok` em qualquer lugar)
4. ✅ **Scripts de inicialização criados**:
   - `start-proxy.bat` - Inicia apenas o proxy
   - `start-ngrok.bat` - Inicia apenas o ngrok
   - `start-all.bat` - Inicia proxy + ngrok juntos
5. ✅ **Conexão com banco testada e funcionando** ✅

---

## 📋 Próximos Passos (Você precisa fazer):

### 1️⃣ Autenticar o ngrok (APENAS UMA VEZ)

Se ainda não autenticou:

1. Acesse: https://dashboard.ngrok.com/get-started/your-authtoken
2. Faça login ou crie conta gratuita
3. Copie o **authtoken**
4. Execute no terminal:
   ```bash
   ngrok config add-authtoken SEU_TOKEN_AQUI
   ```

### 2️⃣ Iniciar Proxy + Túnel

**Opção A: Automático (Recomendado)**
```bash
# Windows - clique duplo ou execute:
start-all.bat
```

**Opção B: Manual**
```bash
# Terminal 1:
cd proxy-server
npm start

# Terminal 2:
ngrok http 3001
```

### 3️⃣ Configurar no Vercel

Quando o ngrok iniciar, você verá algo como:
```
Forwarding: https://abc123.ngrok-free.app -> http://localhost:3001
```

1. **Copie a URL do ngrok**: `https://abc123.ngrok-free.app`

2. **No Vercel**, adicione as variáveis:
   - `PROXY_URL` = `https://abc123.ngrok-free.app`
   - `PROXY_SECRET` = `proxy-nerd-2024-1591` (do seu `.env.local`)
   - `NODE_ENV` = `production`

3. **NÃO adicione** as variáveis do banco (`DB_SERVER`, etc.) quando usar proxy

4. **Faça deploy** no Vercel

---

## 🔑 Informações Importantes:

### PROXY_SECRET
```
proxy-nerd-2024-1591
```
**Guarde este valor!** Você precisará dele no Vercel.

### Porta do Proxy
```
3001
```

### Variáveis no Vercel
| Key | Value | Onde pegar |
|-----|-------|------------|
| `PROXY_URL` | URL do ngrok | Aparece quando inicia `ngrok http 3001` |
| `PROXY_SECRET` | `proxy-nerd-2024-1591` | Do seu `.env.local` |
| `NODE_ENV` | `production` | Fixo |

---

## ✅ Checklist Final:

- [ ] ngrok autenticado (`ngrok config add-authtoken`)
- [ ] Proxy rodando (`npm start` na pasta `proxy-server`)
- [ ] ngrok rodando (`ngrok http 3001`)
- [ ] URL do ngrok copiada
- [ ] Variáveis configuradas no Vercel
- [ ] Deploy feito no Vercel
- [ ] App testado e funcionando

---

## 🆘 Problemas Comuns:

### "ngrok: command not found"
**Solução**: O ngrok foi instalado globalmente. Se não encontrar:
```bash
npx ngrok http 3001
```

### "Cannot connect to database" no Vercel
**Solução**: 
- Verifique se o proxy está rodando localmente
- Verifique se o ngrok está rodando
- Verifique se `PROXY_URL` e `PROXY_SECRET` estão corretos no Vercel

### Proxy não inicia
**Solução**: 
- Verifique se a porta 3001 está livre
- Verifique se o `.env.local` tem todas as variáveis necessárias
- Execute `npm install` novamente na pasta `proxy-server`

---

## 📞 Comandos Úteis:

```bash
# Testar conexão com banco
cd proxy-server
node -e "require('dotenv').config({path: '../.env.local'}); const sql = require('mssql'); sql.connect({user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, server: process.env.DB_SERVER, database: process.env.DB_DATABASE, port: Number(process.env.DB_PORT || 1433), options: {encrypt: false, trustServerCertificate: true}}).then(() => console.log('✅ OK')).catch(err => console.error('❌', err.message));"

# Verificar se proxy está rodando
curl http://localhost:3001/health

# Ver status do ngrok
curl http://127.0.0.1:4040/api/tunnels
```

---

## 🎯 Pronto!

Tudo configurado! Agora é só:
1. Autenticar ngrok (se ainda não fez)
2. Iniciar proxy + ngrok
3. Configurar no Vercel
4. Fazer deploy

**Boa sorte!** 🚀

