# 🆘 Troubleshooting - Erro 404

## ✅ Correção Aplicada:

Adicionei uma rota raiz (`/`) no proxy para evitar o erro 404. 

**Reinicie o proxy** para aplicar a mudança:

1. Pare o proxy (Ctrl+C no terminal do proxy)
2. Inicie novamente: `cd proxy-server && npm start`

---

## 🔍 Verificações Importantes:

### 1. Verificar se o Proxy está funcionando:

Teste o endpoint `/health` diretamente no navegador ou curl:

**Localmente:**
```
http://localhost:3001/health
```

**Via ngrok:**
```
https://gasometrical-itchingly-shiela.ngrok-free.dev/health
```

**Deve retornar:**
```json
{
  "status": "ok",
  "database": "connected",
  "server": "189.126.197.82"
}
```

### 2. Verificar se o ngrok está funcionando:

No terminal do ngrok, você deve ver:
- Status: **online**
- Forwarding: `https://...ngrok-free.dev -> http://localhost:3001`

### 3. Verificar Variáveis no Vercel:

Confirme que as variáveis estão configuradas corretamente:

- ✅ `PROXY_URL` = `https://gasometrical-itchingly-shiela.ngrok-free.dev`
- ✅ `PROXY_SECRET` = `proxy-nerd-2024-1591`
- ✅ `NODE_ENV` = `production`

### 4. Verificar Logs do Vercel:

1. Acesse seu projeto no Vercel
2. Vá em **Deployments**
3. Clique no último deploy
4. Veja os **logs** (aba "Logs")

**Procure por erros relacionados a:**
- "PROXY_URL não configurada"
- "Cannot connect to proxy"
- "Unauthorized"
- "ETIMEOUT"
- Erros de conexão com banco de dados

### 5. Verificar Logs do Proxy:

No terminal onde o proxy está rodando, você deve ver:
- Requisições sendo recebidas
- Queries sendo executadas
- Erros (se houver)

**Se você NÃO ver requisições no proxy quando acessar o app no Vercel, significa que o Vercel não está conseguindo se conectar ao proxy.**

---

## 🐛 Problemas Comuns:

### Problema 1: Proxy não recebe requisições

**Sintomas:**
- App no Vercel mostra erro
- Proxy não mostra nenhuma requisição nos logs
- Teste direto no `/health` funciona

**Possíveis causas:**
- `PROXY_URL` incorreta no Vercel
- ngrok não está rodando
- URL do ngrok mudou

**Solução:**
1. Verifique se o ngrok está rodando
2. Copie a URL atual do ngrok
3. Atualize `PROXY_URL` no Vercel
4. Faça redeploy

### Problema 2: Erro "Unauthorized"

**Sintomas:**
- Proxy recebe requisições mas retorna 401
- Logs do proxy mostram "Unauthorized"

**Possíveis causas:**
- `PROXY_SECRET` incorreto no Vercel
- Token não está sendo enviado

**Solução:**
1. Verifique se `PROXY_SECRET` no Vercel é exatamente: `proxy-nerd-2024-1591`
2. Verifique se não tem espaços extras
3. Faça redeploy

### Problema 3: "Cannot connect to database"

**Sintomas:**
- Proxy retorna erro 500
- Mensagem sobre conexão com banco

**Possíveis causas:**
- SQL Server não está acessível
- Credenciais incorretas

**Solução:**
1. Verifique se o SQL Server está rodando
2. Teste conexão local: `cd proxy-server && npm start`
3. Verifique se vê "✅ Conectado ao banco de dados!"

### Problema 4: "withRequest não disponível"

**Sintomas:**
- Erro sobre `withRequest` não disponível
- Algumas funcionalidades não funcionam

**Possíveis causas:**
- Código usa `withRequest` que não funciona via proxy
- Precisamos ajustar o código

**Solução:**
Este é um problema conhecido. Muitas funções dos repositories usam `withRequest` que não funciona via proxy. Precisamos ajustar o código para usar apenas `query()` ou adaptar as funções.

---

## 🧪 Teste Manual do Proxy:

Teste se o proxy está funcionando:

```bash
# Teste local
curl http://localhost:3001/health

# Teste via ngrok (substitua pela sua URL)
curl https://gasometrical-itchingly-shiela.ngrok-free.dev/health

# Teste de query (precisa do token)
curl -X POST https://gasometrical-itchingly-shiela.ngrok-free.dev/query \
  -H "Content-Type: application/json" \
  -H "X-Proxy-Token: proxy-nerd-2024-1591" \
  -d '{"query": "SELECT TOP 1 1 as test"}'
```

---

## 📞 Próximos Passos:

1. ✅ Reinicie o proxy (para aplicar a correção da rota `/`)
2. ✅ Teste o endpoint `/health` via ngrok
3. ✅ Verifique os logs do Vercel
4. ✅ Me informe o que você encontra nos logs

**Depois que reiniciar o proxy e testar, me diga:**
- O que aparece nos logs do Vercel?
- O que aparece nos logs do proxy quando você acessa o app?
- O teste do `/health` funciona via ngrok?

