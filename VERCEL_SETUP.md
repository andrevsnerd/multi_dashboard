# 🚀 Configuração do Vercel - Passo a Passo

## ✅ Informações do Banco de Dados

As seguintes variáveis de ambiente precisam ser configuradas no Vercel:

| Variável | Valor |
|----------|-------|
| `DB_SERVER` | `189.126.197.82` |
| `DB_DATABASE` | `LINX_PRODUCAO` |
| `DB_USERNAME` | `andre.nerd` |
| `DB_PASSWORD` | `nerd123@` |
| `DB_PORT` | `1433` |

---

## 📋 Passo a Passo no Vercel

### 1. Importar Projeto

1. Acesse [vercel.com](https://vercel.com) e faça login
2. Clique em **"Add New..."** → **"Project"**
3. Selecione o repositório `multi_dashboard` da lista
4. Clique em **"Import"**

### 2. Configurar Variáveis de Ambiente

Antes de fazer o deploy, configure as variáveis:

1. Na página de configuração do projeto, encontre a seção **"Environment Variables"**
2. Para cada variável abaixo, clique em **"Add"** e preencha:

#### Variável 1: DB_SERVER
- **Key**: `DB_SERVER`
- **Value**: `189.126.197.82`
- Marque: ✅ Production, ✅ Preview, ✅ Development

#### Variável 2: DB_DATABASE
- **Key**: `DB_DATABASE`
- **Value**: `LINX_PRODUCAO`
- Marque: ✅ Production, ✅ Preview, ✅ Development

#### Variável 3: DB_USERNAME
- **Key**: `DB_USERNAME`
- **Value**: `andre.nerd`
- Marque: ✅ Production, ✅ Preview, ✅ Development

#### Variável 4: DB_PASSWORD
- **Key**: `DB_PASSWORD`
- **Value**: `nerd123@`
- Marque: ✅ Production, ✅ Preview, ✅ Development

#### Variável 5: DB_PORT
- **Key**: `DB_PORT`
- **Value**: `1433`
- Marque: ✅ Production, ✅ Preview, ✅ Development

### 3. Verificar Build Settings

O Vercel deve detectar automaticamente:
- **Framework Preset**: Next.js
- **Build Command**: `npm run build`
- **Output Directory**: `.next`
- **Install Command**: `npm install`

Se estiver diferente, ajuste para os valores acima.

### 4. Deploy!

1. Após configurar todas as variáveis, clique em **"Deploy"**
2. Aguarde o processo completar (pode levar alguns minutos)
3. Quando concluir, você receberá uma URL como: `https://multi-dashboard-xyz.vercel.app`

---

## ⚠️ IMPORTANTE: Acesso ao Banco de Dados

O servidor SQL Server (`189.126.197.82`) precisa estar **acessível pela internet** para o Vercel conseguir conectar.

### Verificações Necessárias:

1. **Firewall do Servidor**:**
   - Porta `1433` deve estar aberta para conexões externas
   - O Vercel usa IPs dinâmicos, então pode ser necessário permitir uma faixa de IPs

2. **SQL Server Configuration:**
   - Verificar se o SQL Server aceita conexões TCP/IP
   - Verificar se a autenticação SQL está habilitada

3. **Teste de Conectividade:**
   - Após o deploy, se houver erro de conexão, verifique os logs do Vercel
   - Os logs mostrarão se a conexão foi recusada ou se há timeout

---

## 🔄 Após o Deploy

1. Acesse a URL fornecida pelo Vercel
2. Teste o app para verificar se está funcionando
3. Verifique os logs se houver algum erro

### Próximos Passos:

- Cada push para o GitHub fará deploy automático
- Você pode ver todos os deploys na aba **"Deployments"**
- Para fazer um novo deploy manual, vá em **Deployments** → **Redeploy**

---

## 🆘 Problemas Comuns

### Erro: "Cannot connect to database"
**Solução**: Verifique se o servidor SQL Server está acessível pela internet e se a porta 1433 está aberta no firewall.

### Erro no Build
**Solução**: Verifique os logs do build no Vercel. Geralmente são problemas de TypeScript ou dependências faltando.

### Variáveis não funcionam
**Solução**: Após adicionar variáveis, você precisa fazer um novo deploy. As variáveis são incluídas no tempo de build.

---

## ✅ Checklist Final

- [ ] Projeto importado no Vercel
- [ ] Todas as 5 variáveis de ambiente configuradas
- [ ] Build settings verificados
- [ ] Deploy realizado com sucesso
- [ ] App testado e funcionando
- [ ] Conexão com banco de dados funcionando

---

**Pronto! Seu app estará no ar em poucos minutos!** 🎉

