# 🚀 INICIAR AGORA - Passo a Passo Rápido

## ✅ O que já foi feito:

1. ✅ ngrok autenticado com sucesso!
2. ✅ Dependências instaladas
3. ✅ Configurações prontas
4. ✅ Scripts criados

---

## 🎯 Agora você precisa fazer 2 coisas:

### 1️⃣ Iniciar o Proxy e o ngrok

**OPÇÃO A: Automático (Mais Fácil) 🎯**
```bash
start-all.bat
```
*Este comando inicia tudo automaticamente em janelas separadas*

**OPÇÃO B: Manual**
Abra **2 terminais**:

**Terminal 1** - Proxy:
```bash
cd proxy-server
npm start
```

**Terminal 2** - ngrok:
```bash
ngrok http 3001
```

---

### 2️⃣ Copiar a URL do ngrok

Quando o ngrok iniciar, você verá algo como:

```
Forwarding:  https://abc123-def456.ngrok-free.app -> http://localhost:3001
```

**COPIE A URL** `https://abc123-def456.ngrok-free.app` (sua URL será diferente!)

---

## ⚙️ Configurar no Vercel

Agora que você tem a URL do ngrok, configure no Vercel:

### Passo 1: Acessar o Vercel
1. Acesse: https://vercel.com
2. Faça login
3. Selecione seu projeto `multi_dashboard`

### Passo 2: Adicionar Variáveis de Ambiente
1. Vá em **Settings** → **Environment Variables**
2. Adicione as seguintes variáveis (clique em **Add** para cada uma):

#### Variável 1: PROXY_URL
- **Key**: `PROXY_URL`
- **Value**: A URL do ngrok que você copiou (ex: `https://abc123-def456.ngrok-free.app`)
- Marque: ✅ **Production**, ✅ **Preview**, ✅ **Development**
- Clique em **Save**

#### Variável 2: PROXY_SECRET
- **Key**: `PROXY_SECRET`
- **Value**: `proxy-nerd-2024-1591`
- Marque: ✅ **Production**, ✅ **Preview**, ✅ **Development**
- Clique em **Save**

#### Variável 3: NODE_ENV
- **Key**: `NODE_ENV`
- **Value**: `production`
- Marque: ✅ **Production**, ✅ **Preview**, ✅ **Development**
- Clique em **Save**

### Passo 3: Fazer Deploy
1. Vá em **Deployments**
2. Clique nos **3 pontos (...)** do último deploy
3. Selecione **Redeploy**
4. Aguarde o deploy concluir

---

## ✅ Verificar se está funcionando

### Verificar o Proxy:
1. Abra o navegador
2. Acesse: `http://localhost:3001/health`
3. Deve retornar: `{"status":"ok","database":"connected","server":"189.126.197.82"}`

### Verificar o ngrok:
1. No terminal do ngrok, você verá a URL ativa
2. Acesse: `https://SUA-URL-NGROK.ngrok-free.app/health`
3. Deve retornar o mesmo JSON acima

### Verificar no Vercel:
1. Após o deploy, acesse a URL do seu app no Vercel
2. O app deve carregar os dados do banco

---

## ⚠️ IMPORTANTE

**Para o app funcionar no Vercel, você precisa manter rodando:**
- ✅ Servidor Proxy (janela "Proxy Server" ou terminal 1)
- ✅ Tunnel ngrok (janela "ngrok Tunnel" ou terminal 2)

**Se você fechar qualquer um deles, o app no Vercel parará de funcionar!**

---

## 📝 Checklist

- [ ] ngrok autenticado ✅ (JÁ FEITO!)
- [ ] Proxy iniciado (`npm start` na pasta `proxy-server`)
- [ ] ngrok iniciado (`ngrok http 3001`)
- [ ] URL do ngrok copiada
- [ ] Variáveis configuradas no Vercel:
  - [ ] `PROXY_URL` = URL do ngrok
  - [ ] `PROXY_SECRET` = `proxy-nerd-2024-1591`
  - [ ] `NODE_ENV` = `production`
- [ ] Deploy feito no Vercel
- [ ] App testado e funcionando

---

## 🆘 Problemas?

### Proxy não inicia
- Verifique se a porta 3001 está livre
- Execute `npm install` novamente na pasta `proxy-server`

### ngrok mostra erro
- Verifique se o token foi configurado: `ngrok config check`
- Tente reiniciar: `ngrok http 3001`

### Vercel mostra erro de conexão
- Verifique se o proxy está rodando localmente
- Verifique se o ngrok está rodando
- Verifique se `PROXY_URL` e `PROXY_SECRET` estão corretos no Vercel
- Certifique-se de que fez um novo deploy após adicionar as variáveis

---

## 📞 Informações Importantes

**PROXY_SECRET para o Vercel:**
```
proxy-nerd-2024-1591
```

**Porta do Proxy:**
```
3001
```

**Arquivo de referência:**
Veja `VERCEL_VARS.txt` para informações detalhadas sobre as variáveis.

---

**Pronto! Agora é só iniciar e configurar! 🚀**

