# 🚀 Início Rápido: Cloudflare Tunnel

## ⚡ Instalação Rápida (3 passos)

### 1️⃣ Instalar Cloudflared

**Opção A - Automático (Recomendado):**
```powershell
# Execute como Administrador
.\install-cloudflared.ps1
```

**Opção B - Manual:**
1. Baixe: https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
2. Renomeie para `cloudflared.exe`
3. Coloque em `C:\Windows\System32\` (ou adicione ao PATH)

### 2️⃣ Iniciar Proxy + Tunnel

**Opção A - Script Automático:**
```batch
start-all-cloudflare.bat
```

**Opção B - Manual:**
```batch
# Terminal 1: Iniciar proxy
cd proxy-server
npm start

# Terminal 2: Iniciar tunnel
cloudflared tunnel --url http://localhost:3001
```

### 3️⃣ Configurar no Vercel

1. Copie a URL que apareceu (ex: `https://random-words-1234.trycloudflare.com`)
2. Vercel → Settings → Environment Variables
3. Atualize `PROXY_URL` com a URL copiada
4. Salve e aguarde o deploy

## ✅ Pronto!

Agora seu app está usando Cloudflare Tunnel sem warning page!

---

## 📖 Guia Completo

Para mais detalhes, veja: `docs/CLOUDFLARE_TUNNEL_SETUP.md`

## ❓ Problemas?

- **"cloudflared não encontrado"**: Execute `install-cloudflared.ps1`
- **Túnel não conecta**: Verifique se o proxy está rodando na porta 3001
- **URL muda sempre**: Use túnel nomeado (veja guia completo)
