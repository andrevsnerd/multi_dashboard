# Guia de uso — Consultar os dados pelo Claude

Este guia é para quem vai **conversar com o Claude** e pedir informações das lojas
(NERD e SCARF ME): vendas, estoque, produtos, compras, etc. Você pergunta em
português normal e o Claude busca os números direto no sistema.

Não precisa saber nada técnico. Só ler os exemplos abaixo e adaptar.

---

## 1. Como conectar (uma vez só)

Você precisa de **dois dados** (peça para quem administra):
- **Link (URL):** `https://SEU-APP.vercel.app/api/mcp`
- **Token (senha):** algo como `mcp_94e2...` (uma chave secreta)

### Opção A — Claude (app de computador ou site claude.ai) — *recomendado*
1. Abra o Claude → **Settings (Configurações)** → **Connectors (Conectores)**.
2. Clique em **Add custom connector** (Adicionar conector).
3. No campo de URL, cole o link **com o token no final**, assim:
   ```
   https://SEU-APP.vercel.app/api/mcp?token=COLE_O_TOKEN_AQUI
   ```
4. Salve. Pronto — vai aparecer "multi-dashboard" com as ferramentas disponíveis.

> O token no final do link é o que libera o acesso. **Trate esse link como senha.**

### Opção B — Claude Code (para quem usa o terminal)
```bash
claude mcp add --transport http multi-dashboard https://SEU-APP.vercel.app/api/mcp \
  --header "Authorization: Bearer COLE_O_TOKEN_AQUI"
```

Depois de conectar, é só conversar.

---

## 2. O jeito certo de perguntar

O Claude entende português normal. Para a resposta vir certinha, ajuda **dizer 3 coisas** quando fizer sentido:

1. **A empresa:** "na NERD" ou "na SCARF ME" (são bases separadas).
2. **O período:** "mês passado", "de 5 de maio até hoje", "últimos 90 dias", "ontem".
3. **A loja (se quiser uma só):** "na Higienópolis", "no Morumbi", "no e-commerce".

Se você não disser, o Claude assume o padrão (rede toda / período padrão) — e você
pode sempre refinar na pergunta seguinte ("e só na Paulista?", "e em abril?").

> Dica: pode encadear. Pergunte "quais os 10 mais vendidos da SCARF ME?" e depois
> "me detalha o primeiro" — ele já entende que é o produto do topo.

---

## 3. O que dá pra perguntar (com exemplos)

### 📈 Vendas e faturamento
- "Como foram as vendas da SCARF ME mês passado?"
- "Quanto a NERD faturou de 5 de maio até hoje?"
- "Compara o faturamento da Higienópolis neste mês com o mês anterior."
- "Quanto vendeu o e-commerce da SCARF ME nos últimos 90 dias?"

### 🏆 Produtos mais vendidos
- "Quais os 30 produtos mais vendidos da SCARF ME?"
- "Top 10 capas na NERD." *(capas é uma categoria)*
- "Qual a pashmina mais vendida da SCARF ME?"
- "Os mais vendidos na filial Morumbi mês passado." *(usa período livre)*
- "O que mais vendeu ontem na SCARF ME?"
- "Quanto cada produto da linha PASHMINA vendeu entre 1 e 20 de maio?"

> Diferença útil: para **mais vendidos + sugestão de compra + estoque**, ele usa
> uma visão de janelas (12 meses / 60 dias / mês). Para um **período exato** (datas),
> ele usa a consulta por período. Você não precisa escolher — só pergunte.

### 📦 Estoque (quanto tem e onde está)
- "Quanto tem de estoque da SCARF ME hoje, por filial?"
- "Onde está o produto 07.A1.00B3? Quanto tem em cada loja?"
- "Quanto de estoque a NERD tem na linha de capas?"

### 🔎 Ficha de um produto (360°)
- "Me mostra tudo do produto 07.A1.00B3 da SCARF ME."
- "Quando esse produto entrou pela última vez?"
- "Qual foi a última vez que ele vendeu?"
- "Esse produto vendeu ontem? Quanto?"
- "Quanto esse produto vendeu de 5 do mês passado até hoje?"

### 🅰️ Curva ABC
- "O produto 07.A1.00B3 é curva A nos últimos 12 meses?"
- "E neste mês, continua curva A?"
- "Me dá a tabela ABC geral da SCARF ME do mês passado." *(visão completa, SCARF ME)*

### 🚨 Sem estoque / rupturas + sugestão de compra
- "Quais produtos estão sem estoque na SCARF ME?"
- "Produtos zerados que ainda vendem, com sugestão de compra."
- "Qual a sugestão de compra dos mais vendidos da NERD?"

### 🐢 Produtos parados (encalhe)
- "Quais produtos estão parados há mais de 120 dias na SCARF ME?"
- "Me lista o que não vende há mais de 90 dias na NERD."
- "Encalhe há mais de 180 dias na Paulista."

### 🚚 Compras em trânsito (o que comprou e quando chega)
- "O que está chegando de compra na SCARF ME?"
- "O produto X foi comprado? Quando chega?"
- "Quanto tem comprado em trânsito e qual o valor?"

### 🔁 Romaneios (entradas e saídas/transferências)
- "Últimas entradas (recebimentos) da NERD."
- "Saídas e transferências da SCARF ME nos últimos 15 dias."
- "Me acha o romaneio 833045."

### 👥 Vendedores e clientes
- "Ranking de vendedores da NERD mês passado."
- "Quem mais vendeu na Higienópolis?"
- "Top 20 clientes da SCARF ME por compras neste ano."

### 🧭 Descoberta (quando não souber os nomes)
- "Quais empresas e filiais existem?"
- "Quais categorias (grupos/linhas) a SCARF ME tem?"

---

## 4. Perguntas combinadas (o Claude resolve em etapas)

Você pode pedir coisas mais ricas e ele junta as ferramentas sozinho:

- "Quais os 5 mais vendidos da SCARF ME e, do primeiro, onde tem estoque e quando
  foi a última entrada?"
- "Me diz os produtos parados há mais de 120 dias na NERD e quanto cada um vendeu
  nos últimos 90 dias."
- "Da linha PASHMINA, quais estão sem estoque e qual a sugestão de compra?"

---

## 5. Coisas boas de saber

- **Duas empresas separadas:** sempre diga NERD ou SCARF ME. Os números não se misturam.
- **Categorias diferem por empresa:** NERD usa **grupos** (ex.: CAPAS); SCARF ME usa
  **linhas / subgrupos / coleções / grades** (ex.: PASHMINA). Se errar, é só ele te avisar
  os nomes disponíveis — pergunte "quais categorias existem?".
- **Período livre:** qualquer intervalo de datas funciona (de 1 dia até o que quiser).
- **Compras em trânsito** mostram o que foi cadastrado na ferramenta de compras do
  dashboard (não os pedidos automáticos do ERP).
- **Curva ABC completa** (tabela) hoje é da SCARF ME; a curva **de um produto** funciona
  nas duas empresas.
- **Demora:** algumas consultas pesadas (curva, mais vendidos do ano) levam alguns
  segundos. É normal.

---

## 6. Segurança

- O **link com o token é uma senha.** Não poste em grupo público, e-mail aberto, etc.
- Compartilhe só com donos/diretoria.
- Se vazar, peça para o administrador **gerar um token novo** (o antigo para de funcionar).

---

## Apêndice — Para o administrador (deploy)

1. **Token:** gere um valor forte e privado (ex.: `node -e "console.log('mcp_'+require('crypto').randomBytes(24).toString('hex'))"`).
2. **Local (dev):** está em `.env.local` como `MCP_API_TOKEN=...`.
3. **Produção (Vercel):** Project → Settings → Environment Variables → adicione
   `MCP_API_TOKEN` com o mesmo valor (Production). As variáveis do banco/proxy
   (`PROXY_URL`, `PROXY_SECRET`, etc.) já existem e são reaproveitadas.
4. **Deploy:** `git push` (ou redeploy no painel da Vercel) para publicar a rota `/api/mcp`.
5. **Conexão:** entregue ao time o link `https://SEU-APP.vercel.app/api/mcp?token=SEU_TOKEN`
   (Claude.ai/Desktop) ou o comando `claude mcp add ...` com header (Claude Code).
6. **Rotacionar token:** troque `MCP_API_TOKEN` (env local + Vercel) e redistribua o link.

Detalhes técnicos das tools: ver [mcp-server.md](mcp-server.md).
