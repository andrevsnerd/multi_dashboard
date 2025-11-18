# 🔗 Configuração do Proxy Local - Guia Completo

## 📋 O que é isso?

Como seu SQL Server está apenas na sua rede local e não está acessível pela internet, criamos uma solução de **proxy local**:

1. **Servidor Proxy** roda na sua máquina local
2. **Túnel** (ngrok/Cloudflare) expõe o proxy na internet
3. **Vercel** se conecta ao proxy via internet
4. **Proxy** acessa o SQL Server local

```
Vercel (internet) → Túnel (ngrok) → Proxy Local → SQL Server (sua rede)
```

---

## 🚀 Passo 1: Instalar Dependências do Proxy

1. Abra o terminal na pasta do projeto
2. Entre na pasta do proxy:
   ```bash
   cd proxy-server
   ```

3. Instale as dependências:
   ```bash
   npm install
   ```

---

## 🔧 Passo 2: Configurar Variáveis de Ambiente

O servidor proxy usa as mesmas variáveis do seu `.env.local`. 

**Crie um arquivo `.env.local` na raiz do projeto** (se ainda não existir) com:

```env
DB_SERVER=189.126.197.82
DB_DATABASE=LINX_PRODUCAO
DB_USERNAME=andre.nerd
DB_PASSWORD=nerd123@
DB_PORT=1433
PROXY_PORT=3001
PROXY_SECRET=seu-token-secreto-mude-isso
```

**⚠️ IMPORTANTE**: Mude o `PROXY_SECRET` para algo seguro! Este será usado para autenticar as requisições do Vercel.

---

## 🚀 Passo 3: Iniciar o Servidor Proxy

1. Na pasta `proxy-server`, execute:
   ```bash
   npm start
   ```

2. Você verá:
   ```
   🔄 Conectando ao banco de dados...
   ✅ Conectado ao banco de dados!
   🚀 Servidor Proxy rodando na porta 3001
   📡 Aguardando requisições...
   ```

3. **Deixe esse terminal aberto** enquanto o app estiver rodando no Vercel.

---

## 🌐 Passo 4: Expor o Proxy na Internet (ngrok)

Você precisa expor o servidor proxy na internet. A opção mais simples é usar **ngrok**:

### Opção A: ngrok (Gratuito e Simples)

1. **Instalar ngrok**:
   - Acesse: https://ngrok.com/download
   - Baixe e extraia o ngrok
   - Ou use via npm (mais fácil):
     ```bash
     npm install -g ngrok
     ```

2. **Criar conta gratuita**:
   - Acesse: https://dashboard.ngrok.com/signup
   - Crie uma conta gratuita
   - Copie seu **authtoken** da dashboard

3. **Autenticar ngrok**:
   ```bash
   ngrok config add-authtoken SEU_AUTHTOKEN_AQUI
   ```

4. **Iniciar túnel** (em um novo terminal):
   ```bash
   ngrok http 3001
   ```

5. **Copiar a URL** que aparecerá, algo como:
   ```
   Forwarding: https://abc123.ngrok-free.app -> http://localhost:3001
   ```

   **Esta é a URL que você vai usar no Vercel!** Copie a URL `https://abc123.ngrok-free.app`

### Opção B: Cloudflare Tunnel (Mais Estável)

Se preferir uma solução mais estável e gratuita:

1. Instale o Cloudflare Tunnel:
   ```bash
   # Windows (PowerShell como Admin)
   Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile "cloudflared.exe"
   ```

2. Execute o túnel:
   ```bash
   cloudflared tunnel --url http://localhost:3001
   ```

3. Copie a URL fornecida (formato similar ao ngrok)

---

## ⚙️ Passo 5: Configurar Variáveis no Vercel

Agora você precisa configurar as variáveis no Vercel para usar o proxy:

1. Acesse seu projeto no Vercel
2. Vá em **Settings** → **Environment Variables**
3. Adicione as seguintes variáveis:

| Key | Value |
|-----|-------|
| `PROXY_URL` | A URL do ngrok (ex: `https://abc123.ngrok-free.app`) |
| `PROXY_SECRET` | O mesmo valor que você colocou no `.env.local` (ex: `seu-token-secreto-mude-isso`) |
| `NODE_ENV` | `production` |

**⚠️ IMPORTANTE**:
- **NÃO** adicione as variáveis do banco (`DB_SERVER`, `DB_DATABASE`, etc.) no Vercel quando usar proxy
- Apenas `PROXY_URL` e `PROXY_SECRET` são necessárias
- Marque todas para **Production**, **Preview** e **Development**

---

## 🎯 Passo 6: Fazer Deploy no Vercel

1. Faça o push das mudanças para o GitHub:
   ```bash
   git add .
   git commit -m "Adiciona suporte a proxy local"
   git push
   ```

2. O Vercel fará deploy automático

3. **Antes de testar**, certifique-se de que:
   - ✅ O servidor proxy está rodando (`npm start` na pasta `proxy-server`)
   - ✅ O túnel ngrok está ativo
   - ✅ As variáveis estão configuradas no Vercel

---

## ✅ Testar

1. Acesse a URL do seu app no Vercel
2. Teste se está carregando os dados
3. Se houver erros, verifique os logs do Vercel

---

## 🔄 Manter Rodando

**IMPORTANTE**: Para o app funcionar no Vercel, você precisa manter rodando:

1. **Servidor Proxy** (`npm start` na pasta `proxy-server`)
2. **Túnel ngrok** (`ngrok http 3001`)

Se você fechar qualquer um deles, o app no Vercel parará de funcionar.

---

## 🔐 Segurança

1. **Mude o `PROXY_SECRET`** para algo seguro e único
2. **Não compartilhe** a URL do ngrok publicamente
3. O proxy tem autenticação básica via token
4. Considere usar Cloudflare Tunnel para mais segurança

---

## 🆘 Problemas Comuns

### Erro: "PROXY_URL não configurada"
**Solução**: Verifique se você adicionou a variável `PROXY_URL` no Vercel

### Erro: "Unauthorized"
**Solução**: Verifique se `PROXY_SECRET` no Vercel é igual ao do seu `.env.local`

### Erro: "Cannot connect to proxy"
**Solução**: 
- Verifique se o servidor proxy está rodando
- Verifique se o túnel ngrok está ativo
- Verifique se a URL do ngrok está correta no Vercel

### App funciona localmente mas não no Vercel
**Solução**: Certifique-se de que:
- O servidor proxy está rodando
- O túnel está ativo
- As variáveis estão configuradas no Vercel

---

## 📝 Checklist Final

- [ ] Instalou dependências do proxy (`npm install` na pasta `proxy-server`)
- [ ] Configurou `.env.local` com `PROXY_SECRET`
- [ ] Iniciou o servidor proxy (`npm start`)
- [ ] Instalou e configurou ngrok
- [ ] Iniciou o túnel ngrok (`ngrok http 3001`)
- [ ] Copiou a URL do ngrok
- [ ] Configurou `PROXY_URL` e `PROXY_SECRET` no Vercel
- [ ] Fez deploy no Vercel
- [ ] Testou o app

---

## 💡 Dicas

1. **ngrok gratuito**: A URL muda a cada vez que você reinicia. Se precisar de URL fixa, considere upgrade ou Cloudflare Tunnel
2. **Script para iniciar tudo**: Você pode criar um script `.bat` (Windows) ou `.sh` (Linux/Mac) para iniciar proxy + ngrok automaticamente
3. **PM2** (opcional): Use PM2 para manter o proxy rodando em background: `npm install -g pm2 && pm2 start proxy-server/server.js`

---

**Pronto! Agora seu app no Vercel consegue acessar seu banco local via proxy!** 🎉

