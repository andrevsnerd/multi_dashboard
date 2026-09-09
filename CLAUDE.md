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

## ⛔ REGRA OBRIGATÓRIA — RECONSTRUIR ESTOQUE POR MOVIMENTO

**Assunto diferente da regra acima.** Aqui é *quantidade de peça em estoque*, não dinheiro.
A regra de venda/faturamento continua exatamente como está — nada abaixo a altera.
Em especial: no estoque a peça devolvida **volta como unidade**; no faturamento a troca
**abate valor**. São contas separadas e as duas já estão certas.

**Estoque atual nunca se calcula.** Ele é lido de `ESTOQUE_PRODUTOS.ESTOQUE`, que é o número
do Linx. Só remonte saldo por movimento para *auditar* esse número (é o que o Extrato de
Produto faz) — nunca para substituí-lo.

Quando precisar remontar, o saldo só fecha com estas **8 fontes**:

```
  ESTOQUE_PROD_ENT/ESTOQUE_PROD1_ENT        (+ QTDE)
− ESTOQUE_PROD_SAI/ESTOQUE_PROD1_SAI        (− QTDE)
+ ESTOQUE_PROD_CTG_AJUSTE                   (+ QTDE_AJUSTE, com ESTOQUE_AJUSTADO = 1)
+ LOJA_ENTRADAS/LOJA_ENTRADAS_PRODUTO       (+ QTDE_ENTRADA)
− LOJA_SAIDAS/LOJA_SAIDAS_PRODUTO           (− QTDE_SAIDA)
− LOJA_VENDA_PRODUTO                        (− QTDE)
+ LOJA_VENDA_TROCA                          (+ QTDE, devolução volta ao estoque)
− FATURAMENTO/FATURAMENTO_PROD              (− QTDE, com NOTA_CANCELADA = 0)
```

Referência da implementação: [app/api/extrato-produto/route.ts](app/api/extrato-produto/route.ts).
Não escreva essa conta de novo — copie de lá.

**PROIBIDO 1 — nunca subtrair `QTDE_CANCELADA` da venda.** Linha cancelada no Linx grava
`QTDE = 0` e `QTDE_CANCELADA = 1`: a venda não aconteceu, o estoque nunca desceu, então
subtrair **inventa uma devolução**. O campo também tem lixo (há linha com 319.135.272, de
90.911 linhas canceladas no banco), o que estoura qualquer soma. O movimento da venda é
`QTDE`, e só — mesma postura das funções canônicas de venda, que filtram a linha cancelada
em vez de compensá-la.

**PROIBIDO 2 — nunca somar `ENTRADAS`/`ENTRADAS_PRODUTO` (NF de compra).** Ela já vem
refletida no romaneio de entrada; somar conta a mesma peça duas vezes.

**Não filtre `NATUREZA_SAIDA` na NF de saída.** Qualquer NF de saída baixa estoque. O filtro
`NATUREZA_SAIDA IN ('100.02','100.022')` pertence à regra de faturamento (dinheiro), não aqui.

`LOJA_VENDA_TROCA` e `FATURAMENTO`/`FATURAMENTO_PROD` têm triggers próprios em
`ESTOQUE_PRODUTOS` — é por isso que precisam entrar. Confira com
`node scripts/conferir-movimento-estoque.mjs`. Medido em 09/09/2026: NERD matriz
11.374/11.378 SKUs (99,96%), NERD MORUMBI RDRRRJ 5.872/5.872 (100%). Se a taxa cair, a
fórmula foi quebrada.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
