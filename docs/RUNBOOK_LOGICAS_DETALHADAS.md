# Runbook Técnico de Lógicas (Camada 3)

Objetivo: guia de alteração segura com **fórmulas exatas**, **funções-alvo**, **origem SQL** e **passos de validação**.

Use junto com:

- `docs/MAPA_RAPIDO_TOKENS.md` (navegação rápida)
- `docs/MAPA_LOGICAS_PAGINAS_COMPLETO.md` (cobertura de todas as páginas)

---

## 1) Regras globais de arquitetura

- Roteamento/permissão:
  - `lib/config/nav-route-map.ts`
  - `lib/auth/permissions.ts`
  - `components/layout/Sidebar.tsx`
  - `components/auth/AuthGuard.tsx`
- Diferença por empresa (`nerd` x `scarfme`) centralizada em:
  - `lib/config/company.ts`
- Padrão de cálculo:
  - regra pesada no backend (`lib/repositories/*`)
  - consolidação visual/agregação final no frontend

---

## 2) Dashboard (`/:company`)

Arquivos-alvo:

- UI: `components/dashboard/CompanyDashboard.tsx`
- API: `app/api/dashboard-data/route.ts`
- Repository: `lib/repositories/sales.ts`

Fórmulas principais:

- variação percentual:
  - `((atual - anterior) / anterior) * 100`
- ticket médio:
  - `receita / tickets`
- projeção mensal (frontend):
  - `(receita acumulada / dias decorridos) * dias do mês`

Fontes SQL principais:

- `LOJA_VENDA_PRODUTO`, `LOJA_VENDA`, `LOJA_VENDA_TROCA`
- `W_CTB_LOJA_VENDA_PEDIDO_PRODUTO`
- `FATURAMENTO`, `W_FATURAMENTO_PROD_02` (e-commerce scarfme)
- `ESTOQUE_PRODUTOS` (resumo de estoque)

Pontos críticos:

- tratamento de trocas/devoluções afeta receita líquida
- `scarfme` com “todas filiais” agrega varejo + e-commerce

Checklist de mudança:

- alterou fórmula? validar:
  - `/api/dashboard-data`
  - cards (`SummaryCards`)
  - gráfico diário
  - metas (`/api/goals`)

---

## 3) Produtos (`/:company/produtos`)

Arquivos-alvo:

- UI: `components/products/ProductsPage.tsx`
- API: `app/api/products/route.ts`
- Repository: `lib/repositories/products.ts`

Fórmulas/regras:

- `averagePrice = totalRevenue / totalQuantity`
- `markup = averagePrice / cost`
- `isNew`:
  - true quando sem venda no período anterior e sem histórico prévio
- variações:
  - receita/quantidade vs período anterior
- `acimaDoTicket`:
  - mantém item quando preço médio vendido > preço sugerido

Fontes SQL:

- `W_CTB_LOJA_VENDA_PEDIDO_PRODUTO`
- `FATURAMENTO`, `W_FATURAMENTO_PROD_02`
- `PRODUTOS`, `ESTOQUE_PRODUTOS`

Pontos críticos:

- filtros múltiplos (grupo/linha/coleção/subgrupo/grade) combinados
- `filterByRegistrationDate` inclui produto sem venda

Validação rápida:

- aplicar filtro simples e múltiplo
- comparar total sem filtro vs soma por filtro
- testar `groupByColor`

---

## 4) Produto detalhado (`/:company/produto-detalhado`)

Arquivos-alvo:

- UI: `components/products/ProductDetailPage.tsx`
- APIs: `app/api/product-detail/*`
- Repository: `lib/repositories/productDetail.ts`

Regras:

- consolida vendas, custos, preços e estoque por filial/produto
- atualização de preço/custo via endpoint dedicado

Fontes SQL:

- `PRODUTOS`
- `PRODUTOS_PRECOS`
- vendas (`LOJA_*`, `W_CTB_*`, ecom)
- `ESTOQUE_PRODUTOS`

Ponto crítico:

- alteração de atualização de preço/custo precisa preservar compatibilidade no frontend e auditoria de operação

---

## 5) Controle de estoque (`/:company/controle-estoque`)

Arquivos-alvo:

- UI: `components/stock/ControleEstoquePage.tsx`
- API: `app/api/controle-estoque/route.ts`
- Repository: `lib/repositories/controleEstoque.ts`

Regras:

- endpoint multipropósito com `dataType=*`
- combina:
  - estoque atual
  - vendas históricas
  - projeções e detalhes por nível

Fontes SQL recorrentes:

- `ESTOQUE_PRODUTOS` (+ relacionadas)
- `W_CTB_LOJA_VENDA_PEDIDO_PRODUTO`
- `LOJA_VENDA*`, `LOJA_VENDA_TROCA`
- `FATURAMENTO`, `W_FATURAMENTO_PROD_02`
- `PRODUTOS`

Pontos críticos:

- arquivo extenso: prefira editar função específica alvo
- diferenças por empresa/filial impactam todos os cartões

---

## 6) Projeção de estoque (`/:company/controle-estoque/projecao`)

Arquivos-alvo:

- UI: `components/stock/ProjecaoEstoquePage.tsx`
- API: `app/api/controle-estoque/route.ts` (`dataType=projecao-mensal`)
- Repository: `fetchProjecaoMensal` em `lib/repositories/controleEstoque.ts`
- referência funcional: `docs/PROJECAO_ESTOQUE_LOGICA.md`

Fórmulas-chave:

- mês atual: run-rate com regra especial de início de mês
- meses futuros: mês homólogo ano anterior * fator (1.1)
- cadeia:
  - `estoque[0] = estoque atual`
  - `estoque[i+1] = max(0, estoque[i] - vendaProjetada[i])`
- duração:
  - simulação de consumo diário projetado até zerar estoque

Ponto crítico:

- parte da consolidação final ocorre no frontend; manter consistência backend x UI

---

## 7) Lista de compra sugerida + Curva ABC

Rotas:

- `/:company/controle-estoque/projecao/lista-compra`

Arquivos:

- UI: `components/stock/ListaCompraSugeridaPage.tsx`
- API: `app/api/controle-estoque/lista-compra-sugerida/route.ts`
- Repository: `lib/repositories/controleEstoque.ts`

Lógica ABC:

- ordena por faturamento base (`valor3meses`)
- acumulado percentual:
  - A <= 80%
  - B <= 95%
  - C > 95%
- distribuição de quantidade:
  - método Hamilton para distribuir `qtdCompra`

Dados auxiliares por item:

- `/api/controle-estoque/estoque-por-filial-item`
- `/api/controle-estoque/vendas-por-filial-item`

Ponto crítico:

- mudança em sorting/filtro altera classe ABC e compra final

---

## 8) Compra final (persistência de seleção)

API:

- `app/api/controle-estoque/compra-final/route.ts`

Store:

- `lib/utils/compra-final-store.ts`

Persistência:

- Neon: `compra_final_items`
- fallback: `data/compra-final.json`

Chaves:

- `companyKey`
- `contextKey`
- `itemKey` (ex.: produto/cor)

Regras:

- upsert por PK composta
- quantidade manual arredondada e normalizada

Validação:

- testar troca de `contextKey` (itens devem ficar isolados)

---

## 9) Compras salvas (snapshot da compra)

APIs:

- `app/api/controle-estoque/compras-salvas/route.ts`
- `app/api/controle-estoque/compras-salvas/[id]/route.ts`

Store:

- `lib/utils/compra-salva-store.ts`

Persistência:

- Neon: `compras_salvas` (items JSONB)
- fallback: `data/compras-salvas.json`

Regras:

- cria snapshot com `sourceContextKey`
- permite editar título e `qtdManual` por item
- item pode armazenar `custoUnitario`
- listagem resumida calcula `totalValor` por compra
  - `totalValor = soma(qtdManual * custo)`
  - custo preferencial: `custoUnitario` salvo no item
  - fallback: custo em lote do ERP (`PRODUTOS.CUSTO_REPOSICAO1`) via `fetchCustosPorProdutos` em `lib/repositories/controleEstoque.ts`

Arquivos impactados nesta lógica:

- `app/api/controle-estoque/compras-salvas/route.ts`
- `lib/types/compra-salva.ts`
- `lib/utils/compra-salva-store.ts`
- `components/stock/ComprasSalvasListPanel.tsx`

Ponto crítico:

- consistência entre snapshot salvo e estado atual da lista

---

## 10) Lista Loja (`/:company/lista-loja`)

Arquivos:

- UI: `components/lista-loja/ListaLojaPage.tsx`
- APIs: `app/api/lista-loja/route.ts`, `app/api/lista-loja/[id]/route.ts`

Persistência:

- Neon (`lista_loja`) com itens em JSONB

Integrações:

- APIs de produto/filial/estoque para enriquecer itens da lista

Ponto crítico:

- mistura persistência Neon com dados operacionais MSSQL pode gerar divergência visual/operacional

---

## 11) Saídas e entradas (`/:company/saidas-entradas-produtos`)

Arquivos:

- UI: `components/saidas-entradas-produtos/SaidasEntradasProdutosPage.tsx`
- API: `app/api/saidas-entradas-produtos/executar/route.ts`
- Executor: `lib/saida-entrada-executor.js`

Tabelas SQL principais:

- `ESTOQUE_PROD_SAI`, `ESTOQUE_PROD1_SAI`
- `ESTOQUE_PROD_ENT`, `ESTOQUE_PROD1_ENT`
- `LOJA_SAIDAS`, `LOJA_ENTRADAS`
- `SEQUENCIAIS`, `ESTOQUE_PRODUTOS`

Regras:

- permissão por filial de origem/destino
- geração de romaneio
- execução em lote

Ponto crítico:

- manter atomicidade e logs quando houver falha parcial

---

## 12) Transferência de produtos (`/:company/transferencia-produtos`)

Arquivos:

- UI: `components/transferencia-produtos/TransferenciaProdutosPage.tsx`
- API: `app/api/transferencia-produtos/executar/route.ts`
- Executor: `lib/transfer-executor.js`

Regras:

- transferência entre filiais com regras de permissão
- tipos de romaneio e responsáveis podem ser fixos por usuário

Ponto crítico:

- qualquer alteração deve ser testada com usuário restrito e usuário admin

---

## 13) Romaneios (`/:company/romaneios` e detalhe)

Arquivos:

- `components/romaneios/RomaneiosPage.tsx`
- `components/romaneios/RomaneioDetalhePage.tsx`
- APIs: `app/api/romaneios/*`, `app/api/romaneio-confirmar-entrada/route.ts`

Stores auxiliares:

- `lib/utils/destino-romaneio-store.ts`
- `lib/utils/romaneio-confirmacao-store.ts`

Regras:

- exibe saídas/entradas e permite confirmação por item
- atualiza quantidade e destino conforme fluxo logístico

Ponto crítico:

- manter coerência entre log, confirmação e movimento efetivo de estoque

---

## 14) Controle de transferências (`/:company/controle-transferencias`)

Arquivos:

- UI: `components/controle-transferencias/ControleTransferenciasPage.tsx`
- API: `app/api/controle-transferencias/route.ts`
- Repository: `lib/repositories/controleTransferencias.ts`

Integrações:

- transferências realizadas e quantidade real (`/api/transferencias-realizadas*`, `/api/transferencias-quantidade-real`)

Ponto crítico:

- reconciliação entre cálculo sugerido e execução real

---

## 15) Performance (`/:company/controle-performance*`)

Arquivos:

- UI: `components/performance/ControlePerformancePage.tsx`, `FilialPerformancePage.tsx`
- APIs: `app/api/controle-performance/*`, `app/api/filial-performance/route.ts`
- Repository: `lib/repositories/performance.ts`

Fórmulas:

- projeção meta:
  - `(vendas atual / dias decorridos) * dias do mês`
- variação:
  - `((atual - anterior) / anterior) * 100`
- ABC por filial/produto (drilldown)

Ponto crítico:

- canonicalização de filiais (grupos) deve bater com config da empresa

---

## 16) Clientes e vendedores

Arquivos:

- `components/clientes/*`
- `components/vendedores/*`
- APIs `app/api/clientes*`, `app/api/vendedores*`
- repositories: `lib/repositories/clientes.ts`, `lib/repositories/vendedores-v2.ts`

Regras:

- drilldown de vendedor -> cliente/produto
- depende fortemente de query params de contexto

Ponto crítico:

- navegação direta sem params quebra fluxo de detalhe

---

## 17) Mapa de clientes

Arquivo:

- `app/api/mapa-clientes/route.ts`

Fontes:

- `FATURAMENTO`
- `W_FATURAMENTO_PROD_02`

Regra:

- consolidação geográfica por UF/região para scarfme

---

## 18) Admin

Arquivos:

- `app/admin/page.tsx`
- `app/api/admin/users*`
- `app/api/admin/transferencia-permissoes*`
- `lib/auth/users-store-neon.ts` e stores de permissão

Regra:

- gestão de usuário, role, permissões, empresa e logística

Ponto crítico:

- modelo atual usa sessão em localStorage + header custom; mudanças exigem atenção de segurança

---

## 19) Runbook de alteração segura (passo a passo)

1. Identificar a página e o domínio.
2. Abrir API da tela (`app/api/.../route.ts`).
3. Ir apenas na função de repository chamada pela API.
4. Validar regra por empresa em `lib/config/company.ts`.
5. Conferir impactos de permissão/menu (se rota de navegação).
6. Testar:
   - `nerd` e `scarfme`
   - filial única e todas
   - usuário admin e usuário restrito
7. Se houver persistência auxiliar, validar Neon e fallback JSON.

