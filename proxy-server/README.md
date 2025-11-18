# 🔗 Servidor Proxy Local

Servidor proxy que atua como ponte entre o Vercel (internet) e seu SQL Server (rede local).

## 🚀 Instalação Rápida

1. **Instalar dependências**:
   ```bash
   cd proxy-server
   npm install
   ```

2. **Configurar variáveis de ambiente**:
   
   O servidor usa o arquivo `.env.local` da raiz do projeto.
   
   Adicione também no `.env.local`:
   ```env
   PROXY_PORT=3001
   PROXY_SECRET=seu-token-secreto-aqui
   ```

3. **Iniciar servidor**:
   ```bash
   npm start
   ```

## 🌐 Expor na Internet

Use um túnel para expor o servidor:

### ngrok (Recomendado - Mais Simples)

1. Instalar: `npm install -g ngrok`
2. Autenticar: `ngrok config add-authtoken SEU_TOKEN`
3. Iniciar túnel: `ngrok http 3001`
4. Copiar a URL fornecida (ex: `https://abc123.ngrok-free.app`)

### Cloudflare Tunnel (Mais Estável)

1. Baixar: https://github.com/cloudflare/cloudflared/releases
2. Executar: `cloudflared tunnel --url http://localhost:3001`
3. Copiar a URL fornecida

## ⚙️ Configurar no Vercel

No Vercel, adicione as variáveis:

- `PROXY_URL`: URL do túnel (ex: `https://abc123.ngrok-free.app`)
- `PROXY_SECRET`: Mesmo valor do `.env.local`
- `NODE_ENV`: `production`

## 📡 Endpoints

- `GET /health`: Health check
- `POST /query`: Executa query SQL com parâmetros

## 🔐 Autenticação

Todas as requisições precisam do header:
```
X-Proxy-Token: seu-token-secreto
```

## ⚠️ Importante

- Mantenha o servidor rodando enquanto o app estiver no Vercel
- A URL do ngrok muda a cada reinício (plano gratuito)
- Se mudar a URL, atualize no Vercel

