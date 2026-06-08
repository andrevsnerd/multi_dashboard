# Servidor MCP — multi-dashboard

Servidor MCP (Model Context Protocol) remoto que expõe os dados do dashboard
como **tools estruturadas read-only** para o Claude. O time pergunta em
linguagem natural no Claude e ele consulta os dados via estas tools.

- **Endpoint (Streamable HTTP):** `/api/mcp`
- **Rota:** [app/api/[transport]/route.ts](../app/api/[transport]/route.ts) (`basePath: '/api'`, SSE desabilitado)
- **Tools:** [lib/mcp/](../lib/mcp/) — `registry.ts` registra tudo; cada tool em `tools/`.
- **Auth:** Bearer token (`Authorization: Bearer <MCP_API_TOKEN>`).

## Variáveis de ambiente

| Var | Onde | Descrição |
|-----|------|-----------|
| `MCP_API_TOKEN` | `.env.local` (dev) e Vercel (prod) | Token Bearer. **Use um valor forte e privado.** Sem ele, o servidor nega tudo (fail-closed). |
| `PROXY_URL` / `PROXY_SECRET` | já existentes | Reaproveitadas — o MCP usa a mesma camada de banco (`lib/db/connection.ts`). |

Em produção (Vercel), defina `MCP_API_TOKEN` em Project → Settings → Environment Variables.

## Tools

### Fase 1 — descoberta + vendas
| Tool | O que faz |
|------|-----------|
| `listar_empresas` | Lista empresas (`nerd`, `scarfme`). |
| `listar_filiais` | Lista filiais de uma empresa (campo `valor` = o que passar em `filial`), e grupos lógicos. |
| `vendas` | Resumo de vendas de um período (faturamento, qtd, tickets, ticket médio, estoque) com comparativo vs. período anterior. Filtros: filial, grupos, subgrupos, linhas, coleções, grades. |

### Fase 2 — estoque + movimentação
| Tool | O que faz |
|------|-----------|
| `estoque` | Saldo de estoque agregado por filial (+ vendas no período e 30d) + totais. `incluirProdutos=true` traz topProdutos. Filtros: filial, linha, subgrupo, coleção, grade. |
| `entradas` | Lista romaneios de **entrada** (recebimentos). Filtros: `dias`, `limite`, `busca` (nº romaneio), `filiais`, `produto`. Com `produto`, retorna só as entradas daquele SKU (nº de romaneio, qtd recebida e custo). Escopo padrão = filiais da empresa. |
| `saidas` | Lista romaneios de **saída/transferência** (origem→destino). Mesmos filtros de `entradas`. |
| `defeitos` | Itens enviados para **DEFEITO** (saída tipo "DEFEITO" ou destino NERD DEFEITOS / BAZAR SCARF ME) no período. Totais (qtd + **valor sugerido**) + lista POR PRODUTO×COR (produto, cor, qtd, preço sugerido = PRECO_REPOSICAO_1, valor sugerido). Filtros: `filial` (loja origem), `responsavel` (quem registrou), `produto`/`busca`. Padrão = mês atual. Fonte: ESTOQUE_PROD_SAI + ESTOQUE_PROD1_SAI. |
| `movimento` | KPIs de movimentação: entradas (qtd/custo), vendidos (qtd/valor), itens parados — com comparativo vs. mês anterior. Filtros: filial, grupos, linhas, coleções, subgrupos, grades. |
| `transferencias` | Base por produto para análise de transferência entre filiais (estoque + vendas 30d/60d/12m por filial). Retorna totais + top N (`limite`). |

> Nota: `entradas`/`saidas` usam `fetchLogEntradas`/`fetchLogSaidas`, que filtram por **filiais** (não por empresa). As tools escopam automaticamente pelas filiais da empresa quando `filiais` é omitido.

### Fase 3 — categorias + analíticas
| Tool | O que faz |
|------|-----------|
| `listar_categorias` | Vocabulário de produto para filtrar. **NERD → grupos**; **SCARF ME → linhas, coleções, subgrupos, grades**. Considera produtos com venda no período/filial. |
| `vendedores` | Ranking de vendedores por faturamento no período (qtd, **desconto concedido**, tickets, ticket médio, participação). Filtros: produto (`produto`) + filial + categorias. `ordenarPor: "desconto"` → ranking de quem mais descontou (geral ou no produto). `limite` (padrão 50). |
| `vendedor_produtos` | **Inverso** do filtro produto→vendedor: fixa UM vendedor e lista TODOS os produtos que ele vendeu no período (produto, descrição, cor, categoria, qtd, faturamento **e desconto**), ordenado por faturamento. Responde "quais produtos a Stephanie vendeu" e "quanto ela descontou em cada". `vendedor` (apelido/código) obrigatório; `filial` opcional (omitir = todas). Filtros: categoria + `busca` (descrição) + `produto` (SKU). |
| `clientes` | Ranking de clientes por compras no período. Filtros: filial, vendedor, busca (nome). `limite` (padrão 100). |
| `curva_abc` | Curva ABC de SKUs por receita — **MESMOS dados p/ NERD e SCARF ME**: resumo (receita, unidades, SKUs, **estoque, rupturas, cobertura**), curva A/B/C (com estoque) e topCurvaA (curva, rank, participação acumulada, estoque). SCARF ME = relatório completo (`fetchClaudeReport`) + rankings subgrupo/coleção. NERD = caminho enxuto (`fetchFilialProdutoSales` + `fetchStockByProduto`) + ranking por grupo — mesma classificação ABC e mesmas métricas de estoque, sem o histórico de 4 anos (que causava timeout). Filtros: filial; e (SCARF ME) coleções/subgrupos/grades. |

### Fase 4 — produto (ficha 360) + ranking + compras
| Tool | O que faz |
|------|-----------|
| `top_produtos` | Ranking de produtos mais vendidos com **estoque atual** e **sugestão de compra** por item. Filtros: filial + categoria (NERD→grupos; SCARF ME→linhas/subgrupos/coleções/grades). Ex.: "top capas em NERD" → `grupos:["CAPAS"]`. Janelas fixas (12m/60d/mês atual), não aceita range arbitrário. |
| `sem_estoque` | Rupturas: produtos com estoque ≤ 0 que venderam nos últimos 12m, com sugestão de compra. Filtros de filial/categoria. |
| `produto` | Ficha 360 de UM produto. Identifica por `produto` (código geral; + `cor` p/ variação) OU por `codigoBarras` (EAN → já trava produto+cor). Traz: estoque total + **por filial** (onde está), **última venda** (com **vendedor** e **desconto** da venda), **vendas por filial** (ONDE vendeu, respeita inicio/fim), **top vendedores** (QUEM mais vendeu — qtd/receita **e desconto** por vendedor), **desconto total** no período, **detalhe venda a venda** (`vendas.detalhe`: cada dia×filial×vendedor×cor com qtd/receita/**desconto**), **última entrada** (com **nº de romaneio**, qtd recebida e custo) + últimas entradas, receita/qtd no período, custo/preço. |
| `compras_transito` | Compras em trânsito: o que foi comprado, quanto, custo e **quando chega** (`dataRecebimento`). Busca por `produto`/`status`. Fonte: cadastro de compras em trânsito do dashboard (não é pedido do ERP). |
| `produtos_vendidos` | Ranking de produtos vendidos em um **período arbitrário** (datas exatas, inclusive um único dia). Responde "mais vendidos no mês passado", "o que vendeu ontem". Filtros combináveis: filial + categoria (grupo/linha/subgrupo/coleção/grade) + `busca` (trecho da **descrição** — ex.: marca "geonav", "lenço"). Devolve a lista (quais) + totais do período (quanto faturou/vendeu o conjunto). Ideal para ações em produtos com termo no nome ou de uma categoria. |
| `produtos_desconto` | Descontos do período. `totais.desconto` = **TOTAL da empresa** (sem cap) → responde "quanto de desconto tivemos no mês". `produtos` = detalhe POR PRODUTO×COR (quanto descontou em cada, R$ e % do bruto, qtd, faturamento), do maior ao menor, só itens com desconto. `vendedor` opcional relaciona desconto × produto × vendedor. Filtros: filial, categoria, `busca` (descrição), `produto` (SKU). Fonte = W_CTB.DESCONTO_VENDA (mesma da ficha). |
| `produto_curva` | Curva ABC de um produto em **duas janelas**: últimos 12 meses e mês atual. Responde "é curva A nos 12m?" e "é curva A neste mês?" (independente). NERD e SCARF ME, escopo rede. |
| `produtos_parados` | Produtos com estoque **sem venda há mais de N dias** (você escolhe `dias`: 90, 120, 180…). Filtros de filial/categoria. Ordenado por estoque (maior encalhe primeiro). |

Padrão de uso pelo Claude: **descobrir** (`listar_filiais`, `listar_categorias`) → **filtrar** → **consultar** (`vendas`, `top_produtos`, `produto`, …). Para a ficha de um produto: `top_produtos` (acha o código) → `produto` (detalha).

### Cobertura das perguntas típicas
| Pergunta | Tool |
|---|---|
| "relatório dos mais vendidos" / "top capas NERD" / "pashmina mais vendida" | `top_produtos` |
| "quanto tem de estoque" / "onde está" | `produto` (ou `estoque`) |
| "consultar produto por código" (+ cor) | `produto` com `produto` (+ `cor`) |
| "consultar pelo código de barras / EAN" | `produto` com `codigoBarras` (resolve produto+cor) |
| "quando entrou" / "última vez que vendeu" | `produto` |
| "onde vendeu essas N unidades" / "onde vendeu nos últimos X meses" | `produto` → `vendas.porFilial` (com inicio/fim) |
| "qual vendedor fez a última venda" | `produto` → `vendas.ultimaVenda.vendedor` (null se e-commerce) |
| "quem mais vendeu este produto" | `produto` → `vendas.topVendedores` (com inicio/fim) |
| "qual o desconto dessa venda" / "quanto de desconto esse produto deu no mês" | `produto` → `vendas.ultimaVenda.desconto` / `vendas.descontoPeriodo` |
| "quais vendedores deram mais desconto neste produto" | `produto` → `vendas.topVendedores[].desconto`, ou `vendedores` com `produto` + `ordenarPor: "desconto"` |
| "quais produtos o vendedor X vendeu" / "detalhe das vendas da Stephanie" | `vendedor_produtos` (vendedor + período) |
| "no geral, quem deu mais desconto" | `vendedores` com `ordenarPor: "desconto"` |
| "quanto de desconto tivemos no mês" (total da empresa) | `produtos_desconto` → `totais.desconto` |
| "quais produtos venderam com desconto e quanto cada (por produto×cor)" | `produtos_desconto` → `produtos` (+ `vendedor` p/ relacionar) |
| "quanto a Stephanie descontou em cada produto" | `vendedor_produtos` (campo `desconto`) ou `produtos_desconto` com `vendedor` |
| "detalhe cada venda do produto: data, filial, vendedor, desconto" | `produto` → `vendas.detalhe` (+ `cor` p/ focar; inicio/fim p/ período) |
| "qual o romaneio da última entrada" / "últimas N entradas do produto" | `produto` (ficha) ou `entradas` com `produto` |
| "produtos sem estoque" | `sem_estoque` |
| "sugestão de compra do produto" | `top_produtos` / `sem_estoque` (campo `sugestaoCompra`) |
| "foi comprado / quando chega / em trânsito" | `compras_transito` |
| "quantos/quais produtos foram pra defeito esse mês (qtd e valor)" | `defeitos` (+ `filial`/`responsavel` p/ filtrar) |
| "vendeu ontem? quanto vendeu no período X?" | `produtos_vendidos` (ranking) ou `produto` (um SKU, inicio=fim) |
| "quanto venderam os produtos com 'geonav' no nome, e quais" | `produtos_vendidos` com `busca: "geonav"` (+ inicio/fim) |
| "quais produtos da linha/subgrupo/grupo/grade/coleção X mais venderam" | `produtos_vendidos` com o filtro de categoria (+ inicio/fim) |
| "é curva A nos 12 meses? e neste mês?" | `produto_curva` (NERD + SCARF ME) |
| "qual produto está parado há mais de X dias?" | `produtos_parados` (`dias` configurável) |
| "tabela/ranking ABC geral" (SCARF ME) | `curva_abc` |

> Notas: (1) `top_produtos` usa janelas fixas (12m/60d/mês) **+ sugestão de compra**; para período arbitrário use `produtos_vendidos`. (2) `curva_abc` (tabela ABC completa) é SCARF ME apenas; `produto_curva` (curva de 1 produto) atende ambas as empresas. (3) `compras_transito` reflete o cadastro manual do dashboard, não pedidos do ERP.

## Como conectar

Guia passo a passo para o time: [mcp-guia.md](mcp-guia.md).

O token é aceito de **duas formas**:
- Header: `Authorization: Bearer <MCP_API_TOKEN>` (Claude Code / API).
- URL: `?token=<MCP_API_TOKEN>` (ou `?k=`) — para conectores que só aceitam URL,
  sem precisar de OAuth (Claude.ai / Claude Desktop). Quando não há header de auth,
  a rota normaliza o `?token=` para o header esperado ([app/api/[transport]/route.ts](../app/api/[transport]/route.ts), `withUrlToken`).

### Claude.ai / Claude Desktop (conector do time) — sem OAuth
Settings → Connectors → *Add custom connector* → URL **com o token**:
```
https://<seu-app>.vercel.app/api/mcp?token=<MCP_API_TOKEN>
```
> O token vai na URL → **use sempre HTTPS** e trate o link como senha. Para rotacionar,
> troque `MCP_API_TOKEN` (env local + Vercel) e redistribua o link.

### Claude Code (CLI) — header
```bash
claude mcp add --transport http multi-dashboard https://<seu-app>.vercel.app/api/mcp \
  --header "Authorization: Bearer <MCP_API_TOKEN>"
```

## Teste rápido (local)

Com o `next dev` rodando e `MCP_API_TOKEN` no `.env.local`:
```bash
# tools/list (stateless)
curl -s -X POST http://127.0.0.1:3000/api/mcp \
  -H "Authorization: Bearer $MCP_API_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Próximas fases

4. Hardening: OAuth 2.1 (Claude.ai), rate limit, auditoria, escopo por `allowedCompanies`/permissões do users-store. Avaliar `curva_abc` para NERD.
