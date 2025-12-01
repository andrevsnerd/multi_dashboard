# 🚀 Guia Completo: Deploy 24/7 na VM Google Cloud

Este guia te ajudará a configurar uma versão do projeto que roda 24 horas por dia na VM do Google Cloud, **sem remover ou alterar** a configuração atual do seu PC.

---

## 📋 Pré-requisitos

- ✅ VM do Google Cloud já criada
- ✅ IP estático configurado na VM
- ✅ Acesso SSH à VM
- ✅ Permissão do TI para autorizar IP no banco de dados

---

## 🎯 Visão Geral da Solução

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│   Vercel    │ ──────> │  VM Google   │ ──────> │ SQL Server  │
│  (Frontend) │         │  (Proxy)     │         │  (Banco)    │
└─────────────┘         └──────────────┘         └─────────────┘
                              │
                              │ IP Estático
                              │ Autorizado pelo TI
                              ▼
```

**Diferença do modelo atual:**
- **Atual (PC):** PC → ngrok → Vercel → ngrok → PC → Banco
- **Nova (VM):** Vercel → VM (IP estático) → Banco

---

## 📝 Passo a Passo Completo

### **PASSO 1: Obter o IP Estático da VM**

1. Acesse o [Google Cloud Console](https://console.cloud.google.com)
2. Vá em **VPC network** → **IP addresses**
3. Encontre o IP estático da sua VM
4. **Anote este IP** - você precisará dele para o TI

**Exemplo:** `34.123.45.67`

---

### **PASSO 2: Solicitar Autorização do IP no Banco de Dados**

Entre em contato com o TI e solicite:

> "Preciso autorizar o IP `[SEU_IP_ESTATICO]` para acessar o SQL Server `189.126.197.82:1433` com as credenciais `andre.nerd`."

**Informações para o TI:**
- **IP da VM:** `[SEU_IP_ESTATICO]`
- **Servidor SQL:** `189.126.197.82`
- **Porta:** `1433`
- **Protocolo:** TCP/IP

---

### **PASSO 3: Conectar na VM via SSH**

#### **Opção A: Usar o Google Cloud Shell (Recomendado)**

1. No Google Cloud Console, clique no ícone de terminal (Cloud Shell) no topo
2. Execute:
```bash
gcloud compute ssh [NOME_DA_VM] --zone=[ZONA_DA_VM]
```

#### **Opção B: SSH direto (se configurado)**

```bash
ssh [USUARIO]@[IP_ESTATICO]
```

**Exemplo:**
```bash
ssh usuario@34.123.45.67
```

---

### **PASSO 4: Instalar Node.js na VM**

Na VM, execute os seguintes comandos:

```bash
# Atualizar sistema
sudo apt update && sudo apt upgrade -y

# Instalar Node.js 18.x (LTS)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Verificar instalação
node --version
npm --version
```

**Deve mostrar:**
```
v18.x.x
9.x.x
```

---

### **PASSO 5: Instalar Git e Clonar o Projeto**

```bash
# Instalar Git
sudo apt install -y git

# Criar diretório para o projeto
mkdir -p ~/projects
cd ~/projects

# Clonar seu repositório (substitua pela URL do seu repo)
git clone [URL_DO_SEU_REPOSITORIO] multi-dashboard-vm

# OU se não tiver repo, vamos criar os arquivos manualmente
cd multi-dashboard-vm
```

---

### **PASSO 6: Configurar o Servidor Proxy na VM**

#### **6.1. Instalar dependências do proxy**

```bash
cd ~/projects/multi-dashboard-vm/proxy-server
npm install
```

#### **6.2. Criar arquivo de configuração**

```bash
cd ~/projects/multi-dashboard-vm
nano .env.local
```

**Cole o seguinte conteúdo (ajuste conforme necessário):**

```env
# Configurações do Banco de Dados
DB_SERVER=189.126.197.82
DB_DATABASE=LINX_PRODUCAO
DB_USERNAME=andre.nerd
DB_PASSWORD=nerd123@
DB_PORT=1433

# Configurações do Proxy
PROXY_PORT=3001
PROXY_SECRET=seu-token-super-secreto-mude-isso-123456
```

**Salve:** `Ctrl + O`, `Enter`, `Ctrl + X`

---

### **PASSO 7: Testar Conexão com o Banco**

```bash
cd ~/projects/multi-dashboard-vm/proxy-server
npm start
```

**Se funcionar, você verá:**
```
✅ Conectado ao banco de dados!
🚀 Servidor Proxy rodando na porta 3001
```

**Se der erro de conexão:**
- Verifique se o TI já autorizou o IP
- Verifique se as credenciais estão corretas
- Teste a conexão do banco diretamente (se possível)

**Pare o servidor:** `Ctrl + C`

---

### **PASSO 8: Configurar Firewall da VM**

A VM precisa aceitar conexões na porta 3001 (ou outra que você escolher).

#### **No Google Cloud Console:**

1. Vá em **VPC network** → **Firewall**
2. Clique em **Create Firewall Rule**
3. Configure:
   - **Name:** `allow-proxy-server`
   - **Direction:** Ingress
   - **Targets:** All instances in the network
   - **Source IP ranges:** `0.0.0.0/0` (ou apenas IPs do Vercel se souber)
   - **Protocols and ports:** TCP → `3001`
4. Clique em **Create**

#### **Ou via linha de comando:**

```bash
gcloud compute firewall-rules create allow-proxy-server \
    --allow tcp:3001 \
    --source-ranges 0.0.0.0/0 \
    --description "Allow proxy server on port 3001"
```

---

### **PASSO 9: Configurar o Servidor para Rodar Automaticamente (PM2)**

Instalar PM2 para manter o servidor rodando 24/7:

```bash
# Instalar PM2 globalmente
sudo npm install -g pm2

# Iniciar o servidor proxy com PM2
cd ~/projects/multi-dashboard-vm/proxy-server
pm2 start server.js --name "proxy-server"

# Configurar para iniciar automaticamente ao reiniciar a VM
pm2 startup
pm2 save
```

**Comandos úteis do PM2:**
```bash
pm2 status          # Ver status
pm2 logs proxy-server  # Ver logs
pm2 restart proxy-server  # Reiniciar
pm2 stop proxy-server    # Parar
```

---

### **PASSO 10: Configurar no Vercel**

Agora você precisa configurar o Vercel para usar a VM ao invés do ngrok.

#### **10.1. Obter a URL da VM**

A URL será: `http://[IP_ESTATICO]:3001`

**Exemplo:** `http://34.123.45.67:3001`

⚠️ **IMPORTANTE:** Se você quiser usar HTTPS (recomendado), veja a opção alternativa no final deste guia.

#### **10.2. Configurar Variáveis no Vercel**

1. Acesse seu projeto no [Vercel](https://vercel.com)
2. Vá em **Settings** → **Environment Variables**
3. Configure:

   **Variável 1:**
   - **Key:** `PROXY_URL`
   - **Value:** `http://[SEU_IP_ESTATICO]:3001`
   - **Environments:** ✅ Production, ✅ Preview, ✅ Development

   **Variável 2:**
   - **Key:** `PROXY_SECRET`
   - **Value:** `seu-token-super-secreto-mude-isso-123456` (mesmo do `.env.local` da VM)
   - **Environments:** ✅ Production, ✅ Preview, ✅ Development

   **Variável 3:**
   - **Key:** `NODE_ENV`
   - **Value:** `production`
   - **Environments:** ✅ Production

4. Clique em **Save**

#### **10.3. Fazer Deploy**

```bash
# No seu PC local (ou via Git)
git push
```

O Vercel fará o deploy automaticamente e começará a usar a VM.

---

### **PASSO 11: Testar a Solução**

1. Acesse seu dashboard no Vercel
2. Tente carregar dados
3. Verifique os logs na VM:

```bash
pm2 logs proxy-server
```

**Se funcionar:** Você verá requisições chegando na VM! 🎉

---

## 🔒 Opção Avançada: HTTPS com Nginx (Recomendado)

Se você quiser usar HTTPS (mais seguro), configure um Nginx como reverse proxy:

### **Instalar Nginx:**

```bash
sudo apt install -y nginx
sudo apt install -y certbot python3-certbot-nginx
```

### **Configurar Nginx:**

```bash
sudo nano /etc/nginx/sites-available/proxy-server
```

**Cole:**

```nginx
server {
    listen 80;
    server_name [SEU_IP_ESTATICO];

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/proxy-server /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### **Configurar SSL (Opcional):**

Se você tiver um domínio apontando para o IP:

```bash
sudo certbot --nginx -d seu-dominio.com
```

**No Vercel, use:** `https://seu-dominio.com` ou `https://[IP_ESTATICO]`

---

## 🔄 Manter Ambos os Modelos Funcionando

### **Modelo Atual (PC):**
- Continua funcionando normalmente
- Use quando quiser testar localmente
- Não precisa mudar nada

### **Modelo Novo (VM):**
- Roda 24/7 automaticamente
- Vercel usa este por padrão quando `PROXY_URL` está configurado
- PM2 mantém o servidor sempre ativo

### **Alternar entre os dois:**

**Para usar o PC:**
- No Vercel, remova ou comente a variável `PROXY_URL`
- Inicie o proxy no PC e o ngrok

**Para usar a VM:**
- No Vercel, configure `PROXY_URL` com o IP da VM
- Certifique-se que o PM2 está rodando na VM

---

## 🛠️ Troubleshooting

### **Erro: "Cannot connect to database"**

1. Verifique se o TI autorizou o IP:
```bash
# Na VM, teste a conexão
telnet 189.126.197.82 1433
```

2. Verifique as credenciais no `.env.local`

3. Verifique se o firewall permite conexões de saída na porta 1433

### **Erro: "Connection timeout" no Vercel**

1. Verifique se o firewall da VM permite entrada na porta 3001
2. Verifique se o PM2 está rodando:
```bash
pm2 status
```

3. Teste a URL diretamente:
```bash
curl http://[IP_ESTATICO]:3001/health
```

### **Servidor para de funcionar**

1. Verifique os logs:
```bash
pm2 logs proxy-server
```

2. Reinicie:
```bash
pm2 restart proxy-server
```

3. Verifique se o PM2 está configurado para iniciar automaticamente:
```bash
pm2 startup
pm2 save
```

---

## 📊 Monitoramento

### **Ver status do servidor:**
```bash
pm2 status
pm2 monit
```

### **Ver logs em tempo real:**
```bash
pm2 logs proxy-server --lines 50
```

### **Reiniciar após mudanças:**
```bash
cd ~/projects/multi-dashboard-vm/proxy-server
git pull  # Se usar Git
pm2 restart proxy-server
```

---

## ✅ Checklist Final

- [ ] IP estático da VM anotado
- [ ] TI autorizou o IP no banco de dados
- [ ] Node.js instalado na VM
- [ ] Projeto clonado/configurado na VM
- [ ] `.env.local` configurado com credenciais
- [ ] Conexão com banco testada e funcionando
- [ ] Firewall da VM configurado (porta 3001)
- [ ] PM2 instalado e servidor rodando
- [ ] PM2 configurado para iniciar automaticamente
- [ ] Variáveis configuradas no Vercel (`PROXY_URL` e `PROXY_SECRET`)
- [ ] Deploy no Vercel realizado
- [ ] Teste final: Dashboard carregando dados da VM

---

## 🎉 Pronto!

Agora seu dashboard está disponível 24/7! A VM do Google Cloud mantém o servidor proxy sempre ativo, e o Vercel se conecta diretamente a ela.

**Lembre-se:**
- O modelo do PC continua funcionando normalmente
- A VM roda independentemente
- Você pode alternar entre os dois quando quiser

---

## 📞 Suporte

Se tiver problemas:
1. Verifique os logs: `pm2 logs proxy-server`
2. Teste a conexão: `curl http://[IP]:3001/health`
3. Verifique o firewall do Google Cloud
4. Confirme com o TI se o IP está autorizado


