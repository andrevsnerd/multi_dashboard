# 📝 Guia de Atualização - Como Fazer Deploy Após Modificações

## 🎯 Quando Usar Este Guia

Use este guia **toda vez** que você fizer modificações no código e quiser atualizar a aplicação no Vercel.

---

## 📋 Passo a Passo Completo

### **PASSO 1: Verificar o Código Local** ✅

1. **Teste o código localmente** (opcional, mas recomendado):
   ```bash
   npm run dev
   ```
   - Acesse: http://localhost:3000
   - Teste as funcionalidades modificadas

2. **Teste o build local** (importante!):
   ```bash
   npm run build
   ```
   - Se houver erros, corrija antes de continuar
   - O build deve passar sem erros

---

### **PASSO 2: Commit e Push para o GitHub** 📤

1. **Verificar o status**:
   ```bash
   git status
   ```
   - Veja quais arquivos foram modificados

2. **Adicionar os arquivos modificados**:
   ```bash
   git add .
   ```
   - Ou adicione arquivos específicos: `git add arquivo1.ts arquivo2.ts`

3. **Fazer commit**:
   ```bash
   git commit -m "Descrição do que foi modificado"
   ```
   - Exemplo: `git commit -m "Adiciona nova funcionalidade de filtro"`
   - Use mensagens descritivas!

4. **Enviar para o GitHub**:
   ```bash
   git push
   ```
   - Aguarde a conclusão do push

---

### **PASSO 3: Verificar/Iniciar o Proxy Server** 🔄

⚠️ **IMPORTANTE**: O proxy server **deve estar rodando** para a aplicação no Vercel funcionar!

1. **Verificar se o proxy está rodando**:
   - Abra o terminal onde o proxy server estava rodando
   - Se não estiver rodando, veja o PASSO 4

2. **Se o proxy está rodando**, verifique se está funcionando:
   - Deve mostrar: `✅ Conectado ao banco de dados!`
   - Deve mostrar: `🚀 Servidor Proxy rodando na porta 3001`

---

### **PASSO 4: Iniciar o Proxy Server (se necessário)** 🚀

1. **Navegar para a pasta do proxy**:
   ```bash
   cd proxy-server
   ```

2. **Iniciar o proxy server**:
   ```bash
   npm start
   ```
   - Ou use o script: `npm run start` (da raiz)
   - Ou use: `.\start-proxy.ps1` (PowerShell)
   - Ou use: `start-proxy.bat` (CMD)

3. **Aguardar a inicialização**:
   - Deve aparecer: `✅ Conectado ao banco de dados!`
   - Deve aparecer: `🚀 Servidor Proxy rodando na porta 3001`
   - **Anote o token**: `🔑 Token de autenticação: proxy-nerd-2024-XXXX`

---

### **PASSO 5: Iniciar o Ngrok (se necessário)** 🌐

⚠️ **IMPORTANTE**: O ngrok **deve estar rodando** para expor o proxy na internet!

1. **Verificar se o ngrok está rodando**:
   - Abra o terminal onde o ngrok estava rodando
   - Se não estiver rodando, veja abaixo

2. **Iniciar o ngrok**:
   ```bash
   npx ngrok http 3001
   ```
   - Ou use o script: `.\start-ngrok.bat`

3. **Copiar a URL do ngrok**:
   - Procure por: `Forwarding  https://xxxxx.ngrok-free.app -> http://localhost:3001`
   - **Copie a URL**: `https://xxxxx.ngrok-free.app`
   - ⚠️ **Esta URL muda toda vez que você reinicia o ngrok!**

---

### **PASSO 6: Atualizar Variáveis no Vercel (se o ngrok mudou)** 🔧

⚠️ **SOMENTE necessário se você reiniciou o ngrok e a URL mudou!**

1. **Acessar o Vercel**:
   - Acesse: https://vercel.com
   - Faça login
   - Selecione o projeto `multi_dashboard`

2. **Atualizar PROXY_URL**:
   - Vá em **Settings** → **Environment Variables**
   - Procure por `PROXY_URL`
   - Clique em **Edit** (ou **Add** se não existir)
   - Cole a **nova URL do ngrok** (Passo 5)
   - Marque: ✅ Production, ✅ Preview, ✅ Development
   - Clique em **Save**

3. **Verificar PROXY_SECRET**:
   - Procure por `PROXY_SECRET`
   - Verifique se o valor está correto (mesmo token do Passo 4)
   - Se estiver diferente, atualize com o token atual

---

### **PASSO 7: Verificar Deploy no Vercel** 🔍

1. **Acessar o Vercel**:
   - Acesse: https://vercel.com → seu projeto `multi_dashboard`

2. **Verificar Deployments**:
   - Vá em **Deployments**
   - Procure pelo deploy mais recente
   - Deve aparecer automaticamente após o push (Passo 2)

3. **Aguardar o deploy**:
   - O deploy pode levar alguns minutos
   - Verifique o status:
     - ⏳ **Building**: Em andamento
     - ✅ **Ready**: Concluído com sucesso
     - ❌ **Error**: Houve erro (veja os logs)

---

### **PASSO 8: Verificar se Funcionou** ✅

1. **Acessar o app**:
   - Clique na URL do deploy mais recente
   - Ou use a URL de produção do projeto

2. **Testar as funcionalidades**:
   - Navegue pelo app
   - Teste as modificações que você fez
   - Verifique se os dados carregam corretamente

3. **Verificar logs (se houver erro)**:
   - No Vercel, vá em **Deployments** → clique no deploy
   - Vá em **Logs** ou **Function Logs**
   - Procure por erros e corrija conforme necessário

---

## 🎯 Resumo Rápido (Quando Estiver Acostumado)

```bash
# 1. Testar localmente
npm run build

# 2. Commit e push
git add .
git commit -m "Sua mensagem"
git push

# 3. Verificar se proxy e ngrok estão rodando
# (Se não estiverem, iniciar conforme Passos 4 e 5)

# 4. Atualizar PROXY_URL no Vercel (se ngrok mudou)

# 5. Aguardar deploy automático no Vercel

# 6. Testar o app no Vercel
```

---

## ⚠️ Problemas Comuns

### **Erro de Build**
- **Solução**: Execute `npm run build` localmente e corrija os erros antes de fazer push

### **Erro 401 no Vercel**
- **Causa**: Token `PROXY_SECRET` está incorreto ou faltando
- **Solução**: Verifique o token no proxy server e atualize no Vercel (Passo 6)

### **Erro de Conexão no Vercel**
- **Causa**: `PROXY_URL` está incorreta ou ngrok não está rodando
- **Solução**: Verifique se o ngrok está rodando e atualize a URL no Vercel (Passo 6)

### **Proxy não Conecta ao Banco**
- **Causa**: Banco de dados inacessível ou variáveis `.env.local` incorretas
- **Solução**: Verifique se o banco está acessível e as variáveis estão corretas

### **Deploy não Atualiza**
- **Causa**: Deploy antigo ou cache
- **Solução**: Faça um redeploy manual no Vercel (Deployments → 3 pontos → Redeploy)

---

## 📝 Checklist Rápido

Antes de fazer modificações e deploy:

- [ ] Código foi testado localmente
- [ ] `npm run build` passou sem erros
- [ ] Proxy server está rodando
- [ ] Ngrok está rodando
- [ ] Anotou a URL do ngrok (se mudou)
- [ ] Atualizou `PROXY_URL` no Vercel (se necessário)
- [ ] Verificou `PROXY_SECRET` no Vercel
- [ ] Fez commit e push para o GitHub
- [ ] Aguardou deploy concluir no Vercel
- [ ] Testou o app no Vercel

---

## 🚀 Dica Pro

Para facilitar, crie um script que faça tudo automaticamente:

```bash
# build-deploy.sh (ou .bat no Windows)
npm run build
git add .
git commit -m "$1"
git push
echo "✅ Código enviado! Aguardando deploy no Vercel..."
```

---

**🎉 Pronto! Agora você tem um guia completo para fazer deploy sempre que modificar o código!**

