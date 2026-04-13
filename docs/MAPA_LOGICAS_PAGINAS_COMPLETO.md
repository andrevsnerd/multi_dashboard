# Mapa Completo de Lógicas por Página

Objetivo: documentação operacional detalhada para consulta em tarefas complexas, cobrindo **todas as páginas** com:

- rota e componente principal
- APIs consumidas
- backend/repository e fontes SQL
- lógica de cálculo/regra de negócio
- persistência (Neon/Redis/JSON/local/session)
- status da rota (menu, sem menu, legada)

---

## 1) Inventário geral

Total mapeado: **35 páginas** (`app/**/page.tsx`).

Domínios:

- autenticação/entrada
- admin
- dashboard
- produtos
- clientes/vendedores/mapa
- estoque/projeção/compras
- transferências/romaneios/saídas-entradas/lista
- performance/movimento
- relatórios/especial

---

## 2) Matriz de páginas (todas)

| Rota | Componente principal | APIs da tela | Backend/SQL principal | Persistência | Status |
|---|---|---|---|---|---|
| `/` | `Home` | — | `lib/auth/permissions.ts` | `localStorage` (`dashboard-user`) | Sem menu |
| `/login` | `LoginPage` | `/api/auth/login` | `users-store` (`dashboard_users` ou `data/users.json`) | `localStorage` | Sem menu |
| `/admin` | `AdminPage` | `/api/admin/users`, `/api/admin/transferencia-permissoes`, `/api/transferencia-produtos/*` | stores admin + permissões | Neon/JSON fallback | Menu (admin) |
| `/admin/extrato-produto` | `ExtratoPage` | `/api/admin/extrato-produto` | queries em `ESTOQUE_*`, `LOJA_*`, `LOJA_VENDA*`, `PRODUTOS` | sem cache local | Sem menu |
| `/admin/transferencia-permissoes` | redirect | — | redireciona para `/admin` | — | **Legada** |
| `/:company` | `CompanyDashboard` | `/api/dashboard-data`, `/api/goals` | `lib/repositories/sales.ts` + metas | Redis/JSON metas | Menu |
| `/:company/produtos` | `ProductsPage` | `/api/products`, `/api/sales-summary`, `/api/products/search`, `/api/products/{grupos,linhas,colecoes,subgrupos,grades}` | `lib/repositories/products.ts` | estado client | Menu |
| `/:company/produto-detalhado` | `ProductDetailPage` | `/api/product-detail`, `/api/product-detail/{precos,custos,update-price-or-cost}`, `/api/products/search` | `lib/repositories/productDetail.ts` | estado client | Menu |
| `/:company/produtos-recentes` | `ProductsRecentPage` | bloco de produtos | `products.ts` | estado client | Sem menu |
| `/:company/blackfriday` | `BlackFridayPage` | `/api/filial-performance` | `sales.ts` | estado client | Sem menu |
| `/:company/clientes` | `ClientesPage` | `/api/clientes` | `lib/repositories/clientes.ts` | estado client | Menu |
| `/:company/vendedores` | `VendedoresPage` | `/api/vendedores`, `/api/products/*` | `lib/repositories/vendedores-v2.ts` | estado client | Menu |
| `/:company/vendedores/detalhe` | `VendedorDetalhePage` | `/api/vendedores/[vendedor]/produtos`, `/api/vendedores/[vendedor]/clientes` | `vendedores-v2.ts` | querystring | Sem menu |
| `/:company/vendedores/detalhe/cliente` | `ClienteDetalhePage` | `/api/clientes/[cliente]/produtos` | `vendedores-v2.ts` | querystring | Sem menu |
| `/:company/vendedores/detalhe/produto` | `VendedorProdutoDetalhePage` | `/api/vendedores/[vendedor]/produto-vendas` | `vendedores-v2.ts` | querystring | Sem menu |
| `/:company/mapa-clientes` | `MapaClientesPage` | `/api/mapa-clientes` | `FATURAMENTO`, `W_FATURAMENTO_PROD_02` | estado client | Menu (somente scarfme) |
| `/:company/lista-loja` | `ListaLojaPage` | `/api/lista-loja`, `/api/lista-loja/[id]`, `/api/transferencia-produtos/*`, `/api/controle-estoque/*-item` | Neon `lista_loja` + MSSQL auxiliar | Neon + estado client | Menu |
| `/:company/controle-estoque` | `ControleEstoquePage` | `/api/controle-estoque?dataType=*`, `/api/products/*` | `lib/repositories/controleEstoque.ts` | `sessionStorage` | Menu |
| `/:company/controle-estoque/projecao` | `ProjecaoEstoquePage` | `/api/controle-estoque?dataType=projecao-mensal`, `/api/controle-estoque/lista-compra-sugerida` | `fetchProjecaoMensal` (`controleEstoque.ts`) | `sessionStorage` | Sem menu |
| `/:company/controle-estoque/projecao/lista-compra` | `ListaCompraSugeridaPage` | `/api/controle-estoque/lista-compra-sugerida`, `/api/controle-estoque/compra-final`, `/api/controle-estoque/compras-salvas`, `*-item` | `controleEstoque.ts` + stores compra | Neon/JSON + sessionStorage | Sem menu |
| `/:company/controle-estoque/projecao/lista-compra/compras-salvas/[id]` | `CompraSalvaDetalhePage` | `/api/controle-estoque/compras-salvas/[id]`, `/api/controle-estoque/lista-compra-sugerida`, `*-item` | `compra-salva-store` | Neon/JSON | Sem menu |
| `/:company/controle-estoque/estoquedetalhado01` | `EstoqueDetalhado01Page` | `/api/controle-estoque/detalhes` | `controleEstoque.ts` | lê cache de sessão | Sem menu |
| `/:company/controle-estoque/estoquedetalhado01-produto` | `EstoqueDetalhado01ProdutoPage` | `/api/controle-estoque/detalhes` | `controleEstoque.ts` | estado client | Sem menu |
| `/:company/controle-estoque/estoquedetalhado02` | `EstoqueDetalhado02Page` | `/api/controle-estoque/detalhes-por-filial` | `controleEstoque.ts` | estado client | Sem menu |
| `/:company/controle-giro` | `ControleGiroPage` | `/api/controle-giro`, `/api/products/*` | `controleEstoque.ts` | estado client | Menu |
| `/:company/estoque-por-filial` | `StockByFilialPage` | `/api/stock-by-filial` | `lib/repositories/stockByFilial.ts` | estado client | Sem menu (planejada no sidebar) |
| `/:company/saidas-entradas-produtos` | `SaidasEntradasProdutosPage` | `/api/saidas-entradas-produtos/executar`, `/api/transferencia-produtos/*`, `/api/destino-romaneio` | `lib/saida-entrada-executor.js` | Neon/JSON stores + MSSQL | Menu |
| `/:company/transferencia-produtos` | `TransferenciaProdutosPage` | `/api/transferencia-produtos/executar` + catálogos | `lib/transfer-executor.js` | MSSQL + stores | Menu |
| `/:company/controle-transferencias` | `ControleTransferenciasPage` | `/api/controle-transferencias`, `/api/transferencias-realizadas`, `/api/transferencias-quantidade-real` | `lib/repositories/controleTransferencias.ts` | Neon + MSSQL | Menu |
| `/:company/romaneios` | `RomaneiosPage` | `/api/romaneios/saidas`, `/api/romaneios/entradas` | `logSaidas.ts`, `logEntradas.ts` | stores auxiliares | Menu |
| `/:company/romaneios/[romaneio]` | `RomaneioDetalhePage` | `/api/romaneio-confirmar-entrada`, `/api/romaneios/editar-qtd`, `/api/saidas-entradas-produtos/executar` | stores + atualização operacional | Neon/JSON + MSSQL | Sem menu |
| `/:company/controle-movimento` | `ControleMovimentoPage` | `/api/controle-movimento`, `/api/controle-movimento/detalhes` | `lib/repositories/controleMovimento.ts` | estado client | Sem menu |
| `/:company/controle-performance` | `ControlePerformancePage` | `/api/controle-performance` | `lib/repositories/performance.ts` | metas Redis/JSON | Menu |
| `/:company/controle-performance/filial` | `FilialPerformancePage` | `/api/controle-performance/filial` | `performance.ts` | estado client | Sem menu (drilldown) |
| `/:company/exportar-relatorios` | `ExportarRelatoriosPage` | `/api/relatorios/query`, `/api/relatorios/processar` | `lib/repositories/relatorios.ts` | processamento em memória | Menu |

---

## 3) Lógicas detalhadas obrigatórias

## 3.1 Curva ABC

Arquivos:

- `components/stock/ListaCompraSugeridaPage.tsx`
- `components/performance/FilialPerformancePage.tsx`

Regras:

- classificação por faturamento acumulado:
  - A até 80%
  - B até 95%
  - C restante
- na lista de compra:
  - `calcularCurvas()` classifica;
  - distribuição da `qtdCompra` com método de Hamilton (`hamiltonDistribute`) para itens A;
  - B/C podem entrar conforme toggles de inclusão.

Origem dos dados:

- `/api/controle-estoque/lista-compra-sugerida`
- backend em `lib/repositories/controleEstoque.ts` (top produtos período recente)

---

## 3.2 Compras salvas

Arquivos:

- `app/api/controle-estoque/compras-salvas/route.ts`
- `app/api/controle-estoque/compras-salvas/[id]/route.ts`
- `lib/utils/compra-salva-store.ts`

Persistência:

- Neon: tabela `compras_salvas` (`items` em JSONB)
- fallback: `data/compras-salvas.json`

Regras:

- chave por `companyKey` + `id`
- guarda contexto de origem (`sourceContextKey`) e itens com `qtdManual`
- suporta listar, criar, atualizar item, renomear, remover item e excluir compra

---

## 3.3 Compra final

Arquivos:

- `app/api/controle-estoque/compra-final/route.ts`
- `lib/utils/compra-final-store.ts`

Persistência:

- Neon: `compra_final_items` com PK composta (`company_key`, `context_key`, `item_key`)
- fallback: `data/compra-final.json`

Regras:

- contexto obrigatório (`contextKey`) para isolar sessão lógica da compra
- `qtdManual` normalizada para inteiro
- operações: upsert, patch de quantidade, remoção por item

---

## 3.4 Produtos comprados e listas

Casos:

- lista sugerida (projeção/ABC): `ListaCompraSugeridaPage`
- compra final (itens escolhidos manualmente): `compra-final`
- compra salva (snapshot persistido): `compras-salvas`
- lista loja operacional: `ListaLojaPage` + `api/lista-loja/*`

Ponto crítico:

- são quatro conceitos próximos com persistências diferentes; ao alterar regra, alinhar nomenclatura e UX para evitar ambiguidade operacional.

---

## 3.5 Saídas e entradas

Arquivos:

- `components/saidas-entradas-produtos/SaidasEntradasProdutosPage.tsx`
- `app/api/saidas-entradas-produtos/executar/route.ts`
- `lib/saida-entrada-executor.js`

Tabelas SQL principais:

- `ESTOQUE_PROD_SAI`, `ESTOQUE_PROD1_SAI`
- `ESTOQUE_PROD_ENT`, `ESTOQUE_PROD1_ENT`
- `LOJA_SAIDAS`, `LOJA_ENTRADAS`
- `SEQUENCIAIS`, `ESTOQUE_PRODUTOS`

Regras:

- respeita permissões por filial (`filiaisOrigem`/`filiaisDestino`)
- fluxo gera/usa romaneio e grava movimentação de estoque
- inclui modo lote e integração com telas de romaneio

---

## 3.6 Controle de estoque e projeção

Arquivos:

- `components/stock/ControleEstoquePage.tsx`
- `components/stock/ProjecaoEstoquePage.tsx`
- `lib/repositories/controleEstoque.ts`
- `docs/PROJECAO_ESTOQUE_LOGICA.md`

Regras macro:

- backend calcula blocos de estoque/venda/projeção;
- frontend agrega níveis e consolida exibição;
- mês atual com regra especial (run-rate e ajuste de parcial);
- meses futuros com referência histórica + fator.

Persistência auxiliar:

- `sessionStorage` para alguns caches de contexto e reposição.

---

## 3.7 Transferências e romaneios

Arquivos:

- `lib/transfer-executor.js`
- `components/romaneios/*`
- `app/api/romaneios/*`
- stores: `destino-romaneio-store.ts`, `romaneio-confirmacao-store.ts`

Regras:

- saída/entrada com rastreio por romaneio
- confirmação parcial de entrada por item
- filtros por filial atribuída/permissões

Persistência:

- Linx (operacional) + Neon/JSON para metadados auxiliares

---

## 3.8 Dashboard, performance, produtos, clientes/vendedores, mapa, admin

- **Dashboard (`/:company`)**
  - agrega resumo, top categorias/produtos, série diária e metas.
  - principal: `sales.ts` + `/api/dashboard-data`.
- **Performance (`/controle-performance*`)**
  - comparação período atual vs anterior, projeção de meta e drilldown por filial.
  - principal: `performance.ts`.
- **Produtos (`/produtos`, `/produto-detalhado`)**
  - filtros combinados, variação histórica, preço/custo, estoque por filial.
  - principais: `products.ts`, `productDetail.ts`.
- **Clientes/Vendedores**
  - consultas em repositórios dedicados com drilldown por cliente/produto.
- **Mapa clientes**
  - distribuição geográfica via faturamento e-commerce.
- **Admin**
  - usuários/permissões e configurações logísticas centralizadas.

---

## 4) Estado de ativação (navegação)

Fonte de verdade:

- `components/layout/Sidebar.tsx`
- `lib/config/nav-route-map.ts`
- `lib/auth/permissions.ts`

Classificação:

- **Ativas no menu:** dashboard, produtos, vendedores, clientes, estoque/giro/performance, transferências, romaneios, saídas-entradas, lista loja, exportar relatórios, mapa (scarfme), admin (admin only).
- **Ativas sem menu:** produtos recentes, blackfriday, controle-movimento, estoque-por-filial, projeção/lista-compra e páginas de detalhe.
- **Legada:** `/admin/transferencia-permissoes` (redirect).

---

## 5) Checklist de manutenção (para não quebrar regra de negócio)

- nova página:
  - criar rota
  - mapear `PermissionKey`
  - atualizar `nav-route-map`
  - incluir/remover no `Sidebar` conforme objetivo
- nova lógica de cálculo:
  - definir se cálculo é backend ou frontend
  - garantir endpoint explícito
  - documentar fonte SQL/tabela
- fluxo com persistência:
  - validar Neon e fallback JSON
  - validar chave de contexto (`contextKey`, `sourceContextKey`, etc.)
- operação crítica (estoque/transferência/romaneio):
  - conferir consistência entre tabelas de saída/entrada/estoque
  - testar com permissões restritas por filial

