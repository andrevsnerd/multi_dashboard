# Proxy Multi-Dashboard na AWS EC2

Este guia configura o servidor proxy na sua instância **AWS EC2** para que o Vercel se comunique diretamente com ele, **sem depender do túnel Cloudflare**.

## Dados da sua instância (exemplo)

| Campo | Valor |
|-------|--------|
| **Nome** | multidash_sp |
| **Instance ID** | i-025084364fdfb815e |
| **IP público** | 54.207.0.241 |
| **DNS público** | ec2-54-207-0-241.sa-east-1.compute.amazonaws.com |
| **Região** | sa-east-1a |
| **Chave SSH** | multi_key |

---

## Passo 1: Liberar porta 3001 no Security Group (AWS)

O Vercel precisa acessar o proxy na porta **3001**.

1. No **AWS Console** → **EC2** → **Instances** → selecione a instância **multidash_sp**.
2. Aba **Security** → clique no **Security group** (ex.: `launch-wizard-2`).
3. **Edit inbound rules** → **Add rule**:
   - **Type**: Custom TCP
   - **Port range**: 3001
   - **Source**: Anywhere-IPv4 (`0.0.0.0/0`) ou, se quiser restringir, use os [IPs do Vercel](https://vercel.com/docs/security/ip-allowlist) (opcional).
   - **Description**: Proxy Multi-Dashboard (Vercel)
4. **Save rules**.

---

## Passo 2: Conectar na EC2 e colocar o código

### Conectar por SSH

No seu PC (PowerShell ou terminal), usando a chave que você usa para a EC2:

```bash
ssh -i "caminho/para/multi_key.pem" ubuntu@54.207.0.241
```

(Se o usuário da sua AMI for `ec2-user`, use `ec2-user` em vez de `ubuntu`.)

### Opção A – Clonar o repositório (se tiver Git na EC2 e repo acessível)

```bash
cd ~
git clone <URL_DO_SEU_REPOSITORIO> multi-dashboard
cd multi-dashboard
```

### Opção B – Copiar o projeto do seu PC via SCP

No **seu PC** (na pasta do projeto):

```powershell
scp -i "caminho/para/multi_key.pem" -r "C:\Users\NERD TIJUCA\Documents\NERD - ANDRE\Dashboard NERD\multi-dashboard" ubuntu@54.207.0.241:~/multi-dashboard
```

Depois, na EC2:

```bash
cd ~/multi-dashboard
```

---

## Passo 3: Rodar o script de instalação na EC2

Na EC2, dentro da pasta do projeto:

```bash
cd ~/multi-dashboard
chmod +x aws-setup/install-aws.sh
bash aws-setup/install-aws.sh
```

O script:

- Atualiza o sistema
- Instala Node.js 18 e PM2
- Instala dependências do `proxy-server`
- Cria `.env.local` de exemplo (se não existir)
- Sobe o proxy com PM2 e configura para iniciar no boot

Quando pedir, **edite o `.env.local`** com os dados reais do banco:

```bash
nano ~/multi-dashboard/.env.local
```

Exemplo (ajuste com seu servidor SQL e usuário/senha):

```env
DB_SERVER=177.92.78.250
DB_DATABASE=LINX_PRODUCAO
DB_USERNAME=seu_usuario
DB_PASSWORD=sua_senha
DB_PORT=1433

PROXY_PORT=3001
PROXY_SECRET=um-token-secreto-forte-e-unico
```

Salve (Ctrl+O, Enter) e saia (Ctrl+X). Se o script tiver parado esperando você editar, continue até o fim.

Reinicie o proxy para carregar o `.env`:

```bash
pm2 restart proxy-server
pm2 logs proxy-server
```

Confirme que aparece algo como “Conectado ao banco de dados!” e “Servidor Proxy rodando na porta 3001”.

---

## Passo 4: Configurar o Vercel

No **Vercel** → seu projeto → **Settings** → **Environment Variables**:

| Nome | Valor | Ambiente |
|------|--------|----------|
| **PROXY_URL** | `http://54.207.0.241:3001` | Production (e Preview se quiser) |
| **PROXY_SECRET** | O **mesmo** valor de `PROXY_SECRET` do `.env.local` da EC2 | Production (e Preview se quiser) |

Não use `https` na PROXY_URL a menos que você tenha configurado SSL na EC2 (ex.: nginx + certificado). Com IP direto, `http` é suficiente; a segurança fica no `PROXY_SECRET`.

Faça um **redeploy** do projeto no Vercel para carregar as novas variáveis.

---

## Passo 5: Testar

1. No navegador: `http://54.207.0.241:3001/health`  
   - Deve retornar JSON com `"status":"ok"` (e possivelmente pedir o header `X-Proxy-Token`; no nosso caso o health pode estar aberto).
2. Testar o app no Vercel: abrir uma tela que usa o banco (ex.: dashboard, relatórios) e ver se os dados carregam sem erro.

Se algo falhar:

- **EC2**: `pm2 logs proxy-server` e conferir se não há erro de conexão com o SQL.
- **Vercel**: verificar em **Settings → Environment Variables** se `PROXY_URL` e `PROXY_SECRET` estão corretos e se fez redeploy.
- **Firewall**: confirmar que o Security Group da EC2 permite entrada TCP na porta **3001**.

---

## Comandos úteis na EC2

```bash
pm2 status
pm2 logs proxy-server
pm2 restart proxy-server
pm2 stop proxy-server
```

---

## Resumo

- **Antes**: Vercel → Cloudflare Tunnel → sua máquina/VM → SQL Server.  
- **Agora**: Vercel → **sua EC2 (54.207.0.241:3001)** → SQL Server.  
- Nada de túnel; o proxy roda direto na AWS e o Vercel usa o IP público da EC2.

Se o IP público da instância mudar (ex.: sem Elastic IP e reinício), atualize **PROXY_URL** no Vercel. Com Elastic IP **54.207.0.241** fixo, não precisa alterar.
