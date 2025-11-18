# 🚀 Guia de Deploy - Dashboard Multi-Company

Este guia te ajudará a hospedar seu app Next.js gratuitamente no **Vercel** de forma simples e rápida.

## 📋 Pré-requisitos

Antes de começar, você precisa:

1. ✅ Uma conta no **GitHub** (gratuita)
2. ✅ Uma conta no **Vercel** (gratuita)
3. ✅ Seu banco de dados SQL Server **acessível pela internet** (ou uma solução alternativa)

---

## 🎯 PASSO 1: Preparar o Repositório no GitHub

### 1.1. Criar um repositório no GitHub

1. Acesse [github.com](https://github.com)
2. Clique no botão **"+"** no canto superior direito
3. Selecione **"New repository"**
4. Preencha:
   - **Repository name**: `multi-dashboard` (ou qualquer nome que você preferir)
   - Deixe **público** (public) ou privado, como preferir
   - **NÃO** marque "Initialize with README"
5. Clique em **"Create repository"**

### 1.2. Fazer o primeiro commit (se ainda não fez)

Se você ainda não commitou seu código, execute no terminal:

```bash
# Verificar se já existe um repositório git
git status

# Se não existir, inicializar
git init

# Adicionar todos os arquivos
git add .

# Fazer o primeiro commit
git commit -m "Initial commit"

# Conectar ao repositório do GitHub (substitua SEU_USUARIO pelo seu usuário do GitHub)
git remote add origin https://github.com/SEU_USUARIO/multi-dashboard.git

# Renomear branch para main (se necessário)
git branch -M main

# Enviar para o GitHub
git push -u origin main
```

**⚠️ IMPORTANTE**: Certifique-se de que seu `.gitignore` está funcionando e **NÃO** está commitando arquivos `.env` com senhas!

---

## 🎯 PASSO 2: Criar Conta no Vercel

1. Acesse [vercel.com](https://vercel.com)
2. Clique em **"Sign Up"**
3. Escolha **"Continue with GitHub"** (mais fácil para conectar seu repositório)
4. Autorize o Vercel a acessar seu GitHub
5. Complete o cadastro

---

## 🎯 PASSO 3: Fazer Deploy no Vercel

### 3.1. Importar Projeto

1. Após fazer login no Vercel, clique em **"Add New..."** → **"Project"**
2. Você verá seus repositórios do GitHub. Clique em **"Import"** no repositório `multi-dashboard`
3. O Vercel detectará automaticamente que é um projeto Next.js

### 3.2. Configurar Variáveis de Ambiente

**ESTA É A PARTE MAIS IMPORTANTE!** Você precisa configurar as variáveis de ambiente do banco de dados:

1. Na página de configuração do projeto, encontre a seção **"Environment Variables"**
2. Adicione as seguintes variáveis (clique em **"Add"** para cada uma):

   - **Nome**: `DB_SERVER`
     - **Valor**: [Você precisa me fornecer o endereço do servidor do banco]
     - Exemplo: `189.126.197.82` ou `seu-servidor.database.windows.net`

   - **Nome**: `DB_DATABASE`
     - **Valor**: [Você precisa me fornecer o nome do banco de dados]
     - Exemplo: `LINX_PRODUCAO`

   - **Nome**: `DB_USERNAME`
     - **Valor**: [Você precisa me fornecer o usuário do banco]
     - Exemplo: `andre.nerd`

   - **Nome**: `DB_PASSWORD`
     - **Valor**: [Você precisa me fornecer a senha do banco]
     - ⚠️ **IMPORTANTE**: Nunca compartilhe essa senha publicamente!

   - **Nome**: `DB_PORT` (OPCIONAL)
     - **Valor**: `1433` (ou a porta que você usa)
     - Se não informar, usará 1433 por padrão

3. Para cada variável, marque os ambientes:
   - ✅ **Production**
   - ✅ **Preview** (opcional, mas recomendado)
   - ✅ **Development** (opcional)

### 3.3. Configurar Build Settings

O Vercel já deve ter detectado automaticamente:
- **Framework Preset**: Next.js
- **Build Command**: `npm run build`
- **Output Directory**: `.next`
- **Install Command**: `npm install`

Se não estiver correto, você pode ajustar manualmente, mas geralmente o padrão está certo.

### 3.4. Deploy!

1. Clique em **"Deploy"**
2. Aguarde alguns minutos enquanto o Vercel:
   - Instala as dependências (`npm install`)
   - Compila o projeto (`npm run build`)
   - Faz o deploy

---

## 🎯 PASSO 4: Verificar o Deploy

Após o deploy concluir:

1. Você verá uma URL como: `https://multi-dashboard-xyz.vercel.app`
2. Clique na URL para acessar seu app
3. Teste se está funcionando corretamente

---

## ⚠️ PROBLEMAS COMUNS E SOLUÇÕES

### ❌ Erro: "Cannot connect to database"

**Causa**: O banco de dados SQL Server não está acessível pela internet.

**Soluções possíveis**:

1. **Verificar Firewall do Servidor**:
   - Certifique-se de que a porta 1433 (ou a porta do SQL Server) está aberta
   - O Vercel usa IPs dinâmicos, então pode ser necessário permitir acesso amplo temporariamente para testar

2. **Usar Azure SQL Database** (se aplicável):
   - Se seu banco estiver no Azure, certifique-se de que "Allow Azure services" está habilitado
   - Configure regras de firewall para permitir acesso

3. **Usar um Túnel SSH**:
   - Configure um túnel usando serviços como [ngrok](https://ngrok.com) ou similar
   - Mais complexo, mas funciona se o banco não estiver acessível diretamente

### ❌ Erro no Build

**Causa**: Problemas de compilação TypeScript ou dependências.

**Solução**: 
- Verifique os logs de build no Vercel
- Execute `npm run build` localmente para ver se há erros
- Certifique-se de que todas as dependências estão no `package.json`

### ❌ Variáveis de Ambiente Não Funcionam

**Solução**:
- Verifique se você adicionou as variáveis no Vercel corretamente
- Após adicionar variáveis, você precisa fazer um novo deploy
- As variáveis são adicionadas em tempo de build, não depois

---

## 🔄 Atualizações Futuras

A partir de agora, sempre que você:

1. Fizer um `git push` para o GitHub
2. O Vercel **automaticamente** fará um novo deploy!

Para atualizações manuais:
1. Acesse seu projeto no Vercel
2. Vá em **"Deployments"**
3. Clique nos três pontos (...) do deploy mais recente
4. Selecione **"Redeploy"**

---

## 📝 Informações que Preciso de Você

Para continuar, preciso que você me forneça:

1. ✅ **DB_SERVER**: O endereço do servidor SQL Server
2. ✅ **DB_DATABASE**: O nome do banco de dados
3. ✅ **DB_USERNAME**: O usuário do banco
4. ✅ **DB_PASSWORD**: A senha do banco (⚠️ me envie em privado se possível)
5. ✅ **DB_PORT**: A porta (se não for 1433)

**OU**, se você preferir, posso te guiar para criar essas variáveis diretamente no Vercel depois que você tiver a conta configurada.

---

## 🎉 Pronto!

Depois de seguir esses passos, seu app estará no ar e acessível para qualquer pessoa com a URL!

Qualquer dúvida, é só me perguntar! 😊

