# 🌐 Guia Completo: Configurar Cloudflare Tunnel

Este guia vai te ajudar a configurar o Cloudflare Tunnel para expor seu servidor proxy local na internet, substituindo o ngrok.

## ✅ Vantagens do Cloudflare Tunnel

- ✅ **Sem warning page** - Não tem página de aviso como o ngrok
- ✅ **URL estável** - A URL não muda a cada reinício
- ✅ **Mais rápido** - Geralmente tem melhor latência
- ✅ **Gratuito** - Plano gratuito robusto
- ✅ **Mais confiável** - Menos instabilidades

---

## 📋 Passo 1: Baixar o Cloudflared

### Windows (PowerShell)

1. Abra o PowerShell como **Administrador**
2. Execute o comando:

```powershell
# Baixar cloudflared
Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile "$env:USERPROFILE\cloudflared.exe"

# Mover para uma pasta no PATH (opcional, mas recomendado)
Move-Item "$env:USERPROFILE\cloudflared.exe" "C:\Windows\System32\cloudflared.exe" -Force
```

### Verificar instalação

```powershell
cloudflared --version
```

Se aparecer a versão, está instalado corretamente!

---

## 📋 Passo 2: Autenticar no Cloudflare (Opcional, mas Recomendado)

> **Nota**: Você pode usar o Cloudflare Tunnel sem criar conta, mas criar uma conta permite URLs personalizadas e melhor gerenciamento.

### 2.1 Criar conta no Cloudflare (se não tiver)

1. Acesse: https://dash.cloudflare.com/sign-up
2. Crie uma conta gratuita
3. Não precisa adicionar domínio (pode pular essa etapa)

### 2.2 Autenticar o cloudflared

```powershell
cloudflared tunnel login
```

Isso vai abrir o navegador para você fazer login. Após autenticar, você terá um arquivo de credenciais salvo.

---

## 📋 Passo 3: Iniciar o Túnel

### Opção A: Túnel Temporário (Mais Simples - Recomendado para começar)

Execute este comando no terminal:

```powershell
cloudflared tunnel --url http://localhost:3001
```

Você verá algo como:

```
+--------------------------------------------------------------------------------------------+
|  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable): |
|  https://random-words-1234.trycloudflare.com                                              |
+--------------------------------------------------------------------------------------------+
```

**Copie essa URL!** Ela será sua `PROXY_URL` no Vercel.

> ⚠️ **Importante**: Esta URL muda a cada vez que você reinicia o túnel. Se quiser uma URL fixa, use a Opção B.

### Opção B: Túnel Nomeado (URL Fixa - Recomendado para produção)

1. **Criar um túnel nomeado:**

```powershell
cloudflared tunnel create multi-dashboard-proxy
```

2. **Criar arquivo de configuração:**

Crie um arquivo `config.yml` na pasta do projeto com este conteúdo:

```yaml
tunnel: multi-dashboard-proxy
credentials-file: C:\Users\SEU_USUARIO\.cloudflared\[UUID].json

ingress:
  - hostname: multi-dashboard-proxy.trycloudflare.com
    service: http://localhost:3001
  - service: http_status:404
```

> **Nota**: Substitua `SEU_USUARIO` pelo seu nome de usuário do Windows e `[UUID]` pelo ID do túnel que foi criado.

3. **Iniciar o túnel:**

```powershell
cloudflared tunnel run multi-dashboard-proxy
```

---

## 📋 Passo 4: Verificar se o Proxy está Rodando

Antes de iniciar o túnel, certifique-se de que o servidor proxy está rodando:

```powershell
# Na pasta do projeto
cd proxy-server
npm start
```

Você deve ver:

```
✅ Conectado ao banco de dados!
🚀 Servidor Proxy rodando na porta 3001
```

---

## 📋 Passo 5: Configurar no Vercel

1. Acesse o dashboard do Vercel: https://vercel.com/dashboard
2. Selecione seu projeto `multi-dashboard`
3. Vá em **Settings** → **Environment Variables**
4. Atualize a variável `PROXY_URL`:
   - **Key**: `PROXY_URL`
   - **Value**: A URL do Cloudflare Tunnel (ex: `https://random-words-1234.trycloudflare.com`)
   - **Environments**: Production, Preview, Development (marque todos)
5. Clique em **Save**

---

## 📋 Passo 6: Testar

1. Faça um deploy no Vercel (ou aguarde o deploy automático)
2. Acesse sua aplicação
3. Verifique os logs do Vercel para ver se as requisições estão funcionando

---

## 🔄 Scripts de Automação

Criamos scripts para facilitar o uso. Veja os arquivos:

- `start-cloudflare.bat` - Inicia o Cloudflare Tunnel
- `start-all-cloudflare.bat` - Inicia proxy + Cloudflare Tunnel

---

## ❓ Troubleshooting

### Problema: "cloudflared: command not found"

**Solução**: O cloudflared não está no PATH. Use o caminho completo ou adicione ao PATH.

### Problema: Túnel não conecta

**Solução**: 
1. Verifique se o proxy está rodando na porta 3001
2. Verifique se não há firewall bloqueando
3. Tente reiniciar o túnel

### Problema: URL muda a cada reinício

**Solução**: Use um túnel nomeado (Opção B) ao invés de túnel temporário.

### Problema: Erro de autenticação

**Solução**: Execute `cloudflared tunnel login` novamente.

---

## 📚 Referências

- Documentação oficial: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/
- Downloads: https://github.com/cloudflare/cloudflared/releases

---

## 🎉 Pronto!

Agora você está usando Cloudflare Tunnel ao invés de ngrok. A principal vantagem é que **não há warning page** e a conexão é mais estável!

---

## Túnel fixo (connector gerenciado pelo dashboard)

Se você criou um **connector** no dashboard do Cloudflare (túnel fixo, gerenciado remotamente), use o guia separado:

- **[TUNEL_FIXO_CLOUDFLARE.md](TUNEL_FIXO_CLOUDFLARE.md)** – instalação do túnel fixo como serviço do Windows (script `install-tunnel-fixo-admin.bat`).
