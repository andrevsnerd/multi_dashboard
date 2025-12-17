# 🚀 Scripts de Configuração para VM Google Cloud

Este diretório contém scripts auxiliares para facilitar a instalação e configuração do servidor proxy na VM do Google Cloud.

## 📁 Arquivos

- **`install.sh`** - Script de instalação automática completa
- **`env.example`** - Arquivo de exemplo de configuração (.env.local)
- **`firewall-setup.sh`** - Script para configurar firewall do Google Cloud
- **`README.md`** - Este arquivo

## 🚀 Uso Rápido

### 1. Instalação Completa

```bash
# Na VM, execute:
cd ~
git clone [URL_DO_REPO] temp-repo
cd temp-repo
bash vm-setup/install.sh
```

### 2. Configurar Firewall (no Google Cloud Shell)

```bash
bash vm-setup/firewall-setup.sh
```

### 3. Configurar Variáveis de Ambiente

```bash
# Copiar exemplo
cp vm-setup/env.example ~/projects/multi-dashboard-vm/.env.local

# Editar com suas credenciais
nano ~/projects/multi-dashboard-vm/.env.local
```

## 📝 Passo a Passo Manual

Se preferir fazer manualmente, siga o guia completo:
- Veja: `../GUIA_DEPLOY_VM_24H.md`

## 🔧 Comandos Úteis

### Ver status do servidor
```bash
pm2 status
```

### Ver logs
```bash
pm2 logs proxy-server
```

### Reiniciar servidor
```bash
pm2 restart proxy-server
```

### Parar servidor
```bash
pm2 stop proxy-server
```

### Iniciar servidor
```bash
pm2 start proxy-server
```

## 🔒 Segurança

⚠️ **IMPORTANTE:**
- Nunca commite o arquivo `.env.local` com senhas reais
- Use um `PROXY_SECRET` forte e único
- Considere restringir o firewall apenas aos IPs do Vercel

## 📞 Suporte

Se tiver problemas, verifique:
1. Logs do PM2: `pm2 logs proxy-server`
2. Status do servidor: `pm2 status`
3. Conexão com banco: Teste manualmente
4. Firewall: Verifique no Google Cloud Console








