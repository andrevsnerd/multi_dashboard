# Guia de uso — Consultar os dados pelo Claude

Este guia é para quem vai **conversar com o Claude** e pedir informações das lojas
(NERD e SCARF ME): vendas, estoque, produtos, compras, etc. Você pergunta em
português normal e o Claude busca os números direto no sistema.

Não precisa saber nada técnico. Só ler os exemplos abaixo e adaptar.

---

## 1. Como conectar (uma vez só)

Você precisa de **um link único** (já tem tudo incluído):

### Claude (app de computador ou site claude.ai) — *recomendado*
1. Abra o Claude → **Settings (Configurações)** → **Connectors (Conectores)**.
2. Clique em **Add custom connector** (Adicionar conector).
3. Cole este link no campo de URL:
   ```
   https://multi-dashboard.vercel.app/api/mcp?token=scarfme2026
   ```
4. Salve. Pronto — vai aparecer "multi-dashboard" com as ferramentas disponíveis.

> **Esse link é a sua senha.** Não compartilhe publicamente. Só pra donos/diretoria.

Depois de conectar, é só conversar com o Claude normalmente. Ele vai usar as
ferramentas automaticamente quando entender que precisa de dados.

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
- "Os 10 mais vendidos esse mês na NERD, por cor." *(produtos_vendidos já vem por cor; uma linha por produto×cor)*
- "Top da NERD geral, não só eletrônicos." *(linha="todas")* — "E só de ASSISTENCIA?" *(linha="ASSISTENCIA")*
- "Quais os 30 produtos mais vendidos da SCARF ME?"
- "Top 10 capas na NERD." *(capas é uma categoria)*
- "Qual a pashmina mais vendida da SCARF ME?"
- "Os mais vendidos na filial Morumbi mês passado." *(usa período livre)*
- "O que mais vendeu ontem na SCARF ME?"
- "Quanto cada produto da linha PASHMINA vendeu entre 1 e 20 de maio?"
- "Quanto venderam no mês os produtos com 'geonav' na descrição, e quais foram?" *(busca por termo no nome)*
- "Quais produtos da linha LENÇOS mais venderam esse mês?"
- "Mais vendidos do subgrupo X / grupo Y / grade Z / coleção W esse mês." *(qualquer categoria)*

> Diferença útil: para **mais vendidos + sugestão de compra + estoque**, ele usa
> uma visão de janelas (12 meses / 60 dias / mês). Para um **período exato** (datas),
> ele usa a consulta por período. Você não precisa escolher — só pergunte.

### 📦 Estoque (quanto tem e onde está)
- "Quanto tem de estoque da SCARF ME hoje, por filial?"
- "Onde está o produto 07.A1.00B3? Quanto tem em cada loja?"
- "Quanto de estoque a NERD tem na linha de capas?"

### 🔎 Ficha de um produto (360°)
- "Me mostra tudo do produto 07.A1.00B3 da SCARF ME." *(código = visão geral)*
- "E só na cor preta?" *(código do produto + cor)*
- "Me mostra o produto do código de barras 7891234567890." *(EAN já traz produto + cor)*
- "Quando esse produto entrou pela última vez?"
- "Qual foi a última vez que ele vendeu?"
- "Esse produto vendeu ontem? Quanto?"
- "Quanto esse produto vendeu de 5 do mês passado até hoje?"
- "Onde (em quais filiais) ele vendeu essas unidades?"
- "Onde esse produto mais vendeu nos últimos 6 meses?"
- "Qual vendedor foi responsável pela última venda desse produto?"
- "Quais vendedores mais venderam esse item?"
- "Quanto de desconto esse produto deu nesse mês?"
- "Qual o desconto dessa última venda e quem foi o vendedor?"
- "Quais vendedores deram mais desconto nesse produto?"

### 🅰️ Curva ABC
- "O produto 07.A1.00B3 é curva A nos últimos 12 meses?"
- "E neste mês, continua curva A?"
- "Me dá a tabela ABC geral da SCARF ME do mês passado." *(visão completa)*
- "E a curva ABC da NERD desse mês?" *(ABC por SKU/receita também funciona na NERD)*

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
- "Quantos produtos foram pra defeito esse mês na NERD? Quais, quantidade e valor?"
- "Defeitos da loja Eldorado esse mês (por produto e valor sugerido)."
- "Qual o romaneio da última entrada do produto 07.A1.00B3 na SCARF ME?"
- "Mostra as últimas 3 entradas do produto X (data, romaneio, filial e quantidade)."

### 👥 Vendedores e clientes
- "Ranking de vendedores da NERD mês passado."
- "Quem mais vendeu na Higienópolis?"
- "Quais vendedores deram mais desconto na SCARF ME esse mês?"
- "Quais produtos a Stephanie vendeu esse mês (com valores)?" *(fixa o vendedor, lista os produtos)*
- "Detalhe das vendas do vendedor X — todos os produtos."
- "Quanto de desconto tivemos esse mês na NERD?" *(total da empresa)*
- "Quais produtos foram vendidos com desconto esse mês e quanto foi descontado em cada (por cor)?"
- "E os descontos que a Stephanie deu, por produto?" *(relaciona desconto × produto × vendedor)*
- "Detalha cada venda da PASHMINA OFF WHITE: data, filial, vendedor e desconto." *(venda a venda)*
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

## Apêndice — Deploy checklist

Código e configurações:
- ✅ Rota `/api/mcp` → [app/api/[transport]/route.ts](../app/api/[transport]/route.ts)
- ✅ 19 tools registradas → [lib/mcp/registry.ts](../lib/mcp/registry.ts)
- ✅ Token no `.env.local` → `MCP_API_TOKEN=scarfme2026`
- ✅ Suporte a `?token=` na URL (sem OAuth, funciona no Claude.ai/Desktop)

Para publicar (uma vez só):
1. **Vercel → Environment Variables → adicione `MCP_API_TOKEN=scarfme2026`** (selecionar "Production").
   As variáveis do banco (`PROXY_URL`, `PROXY_SECRET`) já existem e são reaproveitadas.
2. **`git push`** (ou redeploy no painel da Vercel).
3. **Link final para compartilhar:**
   ```
   https://multi-dashboard.vercel.app/api/mcp?token=scarfme2026
   ```

Para rotacionar o token depois (ex.: se vazar):
1. Gere um novo: `node -e "console.log('scarfme_' + require('crypto').randomBytes(16).toString('hex'))"`
2. Atualize em `.env.local` e Vercel (`MCP_API_TOKEN`).
3. Redistribua o novo link.

Detalhes técnicos das tools: ver [mcp-server.md](mcp-server.md).
