## ⛔ REGRA OBRIGATÓRIA E ÚNICA — CÁLCULO DE VENDAS / FATURAMENTO

**Existe UMA só lógica válida para buscar venda/faturamento no sistema inteiro. Qualquer outra está PROIBIDA.**

Toda venda líquida DEVE vir da lógica validada "com trocas", que é:

- **Físico (POS):** base `LOJA_VENDA_PRODUTO` (join `LOJA_VENDA`), com
  `ISNULL(vp.QTDE_CANCELADA,0) = 0`, desconto = `QTDE × PRECO_LIQUIDO × ISNULL(FATOR_DESCONTO_VENDA,0)`,
  **abatendo as trocas** via `LOJA_VENDA_TROCA` (trocas de item **e** trocas puras/devoluções).
  Fórmula: `VALOR_LIQUIDO = (PRECO_LIQUIDO × QTDE) − DESCONTO_VENDA − VALOR_TROCA`.
- **E-commerce:** `FATURAMENTO` + `W_FATURAMENTO_PROD_02`, com `NOTA_CANCELADA = 0`
  e `NATUREZA_SAIDA IN ('100.02','100.022')`, valor = `SUM(VALOR_LIQUIDO)`.

**Nunca escreva SQL nova de vendas.** Sempre reuse uma destas funções canônicas:

- `fetchProductsWithDetails` — [lib/repositories/products.ts](lib/repositories/products.ts) (produto × cor)
- `fetchProdutoQtdePorFilial` / `fetchFilialProdutoSales` — [lib/repositories/performance.ts](lib/repositories/performance.ts) (por filial)
- `fetchSalesTotals` — [lib/services/salesTotals.ts](lib/services/salesTotals.ts) (totais/tickets)
- `fetchVendasFaturamento` — [lib/repositories/reportVendas.ts](lib/repositories/reportVendas.ts) (relatório, usa `fetchProductsWithDetails`)

**PROIBIDO:** calcular faturamento a partir de `W_CTB_LOJA_VENDA_PEDIDO_PRODUTO`, ou qualquer
soma crua tipo `PRECO_LIQUIDO × QTDE − DESCONTO_VENDA` (desconto absoluto) que **ignore trocas**.
Foi exatamente isso que fez o Gerador de Apresentações divergir do Gerador de Relatórios.

Já migrados para a regra: [colecaoPresentation.ts](lib/repositories/colecaoPresentation.ts) e
[collectionReport.ts](lib/repositories/collectionReport.ts) (Relatório Claude + comparativos + Painel de Coleções).

> ⚠️ Pendência — ainda calculam faturamento fora da regra (migrar para a lógica validada):
> - [clientes.ts](lib/repositories/clientes.ts) — desconto absoluto, W_CTB, sem trocas
> - [productDetail.ts](lib/repositories/productDetail.ts) — desconto absoluto, W_CTB, sem trocas
> - [reportClientesFilial.ts](lib/repositories/reportClientesFilial.ts) — desconto absoluto, W_CTB, sem trocas
> - [vendedores-v2.ts](lib/repositories/vendedores-v2.ts) — W_CTB, sem trocas (parte usa FATOR, parte absoluto)
> - [controleMovimento.ts](lib/repositories/controleMovimento.ts) — W_CTB + desconto absoluto, trata troca de item mas não trocas puras
> - [lojaRaioX.ts](lib/repositories/lojaRaioX.ts) e [claudeReport.ts](lib/repositories/claudeReport.ts) — usam FATOR (desconto certo) mas de W_CTB e sem trocas

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
