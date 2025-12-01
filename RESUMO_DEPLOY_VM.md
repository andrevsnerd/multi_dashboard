# 📋 Resumo Executivo: Deploy 24/7 na VM

## 🎯 Objetivo

Configurar uma versão do projeto que roda 24 horas por dia na VM do Google Cloud, **sem alterar** a configuração atual do PC.

---

## ✅ Checklist Rápido

### **Fase 1: Preparação**
- [ ] Obter IP estático da VM no Google Cloud Console
- [ ] Solicitar ao TI autorização do IP no banco de dados
- [ ] Conectar na VM via SSH

### **Fase 2: Instalação na VM**
- [ ] Executar script de instalação: `bash vm-setup/install.sh`
- [ ] Configurar `.env.local` com credenciais do banco
- [ ] Testar conexão com banco de dados

### **Fase 3: Configuração de Rede**
- [ ] Configurar firewall do Google Cloud (porta 3001)
- [ ] Verificar se servidor está rodando: `pm2 status`

### **Fase 4: Configuração no Vercel**
- [ ] Adicionar variável `PROXY_URL=http://[IP_ESTATICO]:3001`
- [ ] Adicionar variável `PROXY_SECRET=[MESMO_TOKEN_DA_VM]`
- [ ] Fazer deploy

### **Fase 5: Teste Final**
- [ ] Acessar dashboard no Vercel
- [ ] Verificar se dados carregam corretamente
- [ ] Verificar logs na VM: `pm2 logs proxy-server`

---

## 🔑 Informações Importantes

### **IP Estático da VM:**
```
[ANOTAR AQUI]
```

### **Token Secreto (PROXY_SECRET):**
```
[GERAR UM TOKEN FORTE]
```

### **URL do Proxy:**
```
http://[IP_ESTATICO]:3001
```

---

## 📚 Documentação Completa

Para instruções detalhadas, consulte:
- **Guia Completo:** `GUIA_DEPLOY_VM_24H.md`
- **Scripts Auxiliares:** `vm-setup/README.md`

---

## 🆘 Problemas Comuns

### **Erro de conexão com banco**
→ Verificar se TI autorizou o IP

### **Timeout no Vercel**
→ Verificar firewall da VM (porta 3001)

### **Servidor para de funcionar**
→ Verificar PM2: `pm2 status` e `pm2 logs`

---

## 💡 Dica

Mantenha ambos os modelos funcionando:
- **PC:** Para desenvolvimento e testes
- **VM:** Para produção 24/7


