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

### Opção 1: Direto na VM/EC2 (ex.: AWS) — sem túnel

Se o proxy rodar em uma instância com IP público (ex.: AWS EC2), o Vercel pode acessá-lo diretamente.

1. Na VM/EC2: libere a porta **3001** no firewall (Security Group na AWS).
2. Siga o guia: **`docs/AWS_PROXY_SETUP.md`** ou use o script **`aws-setup/install-aws.sh`**.
3. No Vercel: `PROXY_URL=http://<IP_PUBLICO>:3001` (ex.: `http://54.207.0.241:3001`).

Não é necessário ngrok nem Cloudflare Tunnel.

### Opção 2: Túnel (máquina local)

Use um túnel para expor o servidor quando ele roda na sua máquina:

### Cloudflare Tunnel (Recomendado - Sem Warning Page)

**✅ RECOMENDADO**: Cloudflare Tunnel é mais estável e não tem warning page!

1. **Instalar cloudflared**:
   - Windows: Baixe de https://github.com/cloudflare/cloudflared/releases
   - Ou use: `start-cloudflare.bat` (instala automaticamente)
   
2. **Iniciar túnel**:
   ```bash
   cloudflared tunnel --url http://localhost:3001
   ```
   - Ou use: `start-cloudflare.bat`
   - Ou use: `start-all-cloudflare.bat` (inicia proxy + tunnel)

3. **Copiar a URL** fornecida (ex: `https://random-words-1234.trycloudflare.com`)

📖 **Guia completo**: Veja `docs/CLOUDFLARE_TUNNEL_SETUP.md` para instruções detalhadas

### ngrok (Alternativa)

1. Instalar: `npm install -g ngrok`
2. Autenticar: `ngrok config add-authtoken SEU_TOKEN`
3. Iniciar túnel: `ngrok http 3001`
4. Copiar a URL fornecida (ex: `https://abc123.ngrok-free.app`)

⚠️ **Nota**: ngrok free plan tem warning page que pode causar problemas

## ⚙️ Configurar no Vercel

No Vercel, adicione as variáveis:

- `PROXY_URL`: URL do túnel (ex: `https://random-words-1234.trycloudflare.com` para Cloudflare ou `https://abc123.ngrok-free.app` para ngrok)
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
- **Cloudflare Tunnel**: URL temporária muda a cada reinício, mas pode criar túnel nomeado para URL fixa
- **ngrok**: URL muda a cada reinício (plano gratuito)
- Se mudar a URL, atualize `PROXY_URL` no Vercel

