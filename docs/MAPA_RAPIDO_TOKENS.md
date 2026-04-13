# Mapa Rápido Técnico (Economia de Tokens)

Objetivo: servir como base de consulta curta para tarefas complexas sem reabrir arquivos grandes do projeto.

## Como usar este conjunto de documentos

Leia sempre este arquivo primeiro e siga o roteador abaixo:

- Se a tarefa for simples (achar rota, API, arquivo, status de página/menu):
  - ficar apenas neste arquivo (`MAPA_RAPIDO_TOKENS.md`).
- Se a tarefa exigir entendimento de uma página específica ponta a ponta:
  - abrir `docs/MAPA_LOGICAS_PAGINAS_COMPLETO.md`.
- Se a tarefa alterar regra de negócio, cálculo, SQL, persistência ou fluxo crítico:
  - abrir `docs/RUNBOOK_LOGICAS_DETALHADAS.md`.

Regra prática de decisão:

- “Onde mexer?” -> **Mapa Rápido**
- “Como essa página funciona?” -> **Mapa Completo**
- “Como alterar sem quebrar?” -> **Runbook Detalhado**

Prompt recomendado para iniciar qualquer tarefa:

- “Leia `docs/MAPA_RAPIDO_TOKENS.md` e decida se precisa consultar `MAPA_LOGICAS_PAGINAS_COMPLETO.md` e/ou `RUNBOOK_LOGICAS_DETALHADAS.md` antes de implementar.”

### Ordem obrigatória de leitura (anti desperdício de tokens)

1. Ler **somente** `docs/MAPA_RAPIDO_TOKENS.md`.
2. Definir tipo de tarefa:
   - `T1` localização simples (rota/API/arquivo/menu)
   - `T2` entendimento de uma página/fluxo
   - `T3` alteração de regra/cálculo/SQL/persistência
3. Abrir documentos adicionais apenas se necessário:
   - `T1` -> parar no Mapa Rápido (não abrir outros docs)
   - `T2` -> abrir `docs/MAPA_LOGICAS_PAGINAS_COMPLETO.md`
   - `T3` -> abrir `docs/RUNBOOK_LOGICAS_DETALHADAS.md` e, se faltar contexto de página, também o `MAPA_LOGICAS_PAGINAS_COMPLETO.md`
4. Só depois iniciar análise de código/implementação.

### Regra de parada (muito importante)

- Se já encontrou:
  - rota correta
  - API correta
  - 1 arquivo principal de UI
  - 1 arquivo principal de regra (repository/store)
  então **parar de explorar** e implementar.

### Limite de contexto por tarefa

- Antes de implementar, usar no máximo:
  - 1 doc (T1)
  - 2 docs (T2)
  - 2 ou 3 docs (T3)
- E no código:
  - 1 a 2 arquivos de UI
  - 1 a 2 arquivos de API
  - 1 a 2 arquivos de regra

Se exceder isso, reavaliar escopo para não gastar tokens desnecessários.

### Checklist rápido antes de começar

- Já classifiquei a tarefa em `T1`, `T2` ou `T3`?
- Estou lendo apenas os docs necessários para esse tipo?
- Já identifiquei o menor conjunto de arquivos para agir?
- Já tenho critérios de validação objetivos?

### Prompt padrão (versão forte, recomendada)

Use este prompt no início de qualquer tarefa:

`Leia somente docs/MAPA_RAPIDO_TOKENS.md e classifique a tarefa em T1/T2/T3. Só abra os outros documentos se a classificação exigir. Em seguida, informe o conjunto mínimo de arquivos que será usado (UI/API/regra), os passos de execução e as validações. Evite exploração extra para economizar tokens.`

## 1) Snapshot do sistema

- Stack: `Next.js` (App Router), `React`, `TypeScript`, `mssql`, `@neondatabase/serverless`, `@upstash/redis`.
- Entradas principais:
  - UI em `app/(companies)/[company]/*`.
  - APIs em `app/api/**/route.ts`.
  - Regras de negócio em `lib/repositories/*`.
- Multiempresa:
  - `nerd` e `scarfme` em `lib/config/company.ts`.
  - Mapeamento de filiais, grupos e e-commerce concentrado em `lib/config/company.ts`.
- Autenticação/autorização:
  - Sessão local em `components/auth/AuthContext.tsx`.
  - Guard de rota em `components/auth/AuthGuard.tsx`.
  - Mapa permissão->segmento em `lib/config/nav-route-map.ts` + `lib/auth/permissions.ts`.

## 2) Mapa visual de fluxo de dados

```mermaid
flowchart LR
  UI[Páginas app/(companies)/[company]] --> API[app/api/**/route.ts]
  API --> REPO[lib/repositories/*.ts]
  REPO --> DB1[(SQL Server ERP<br/>LOJA_VENDA*, ESTOQUE_PRODUTOS, FATURAMENTO)]
  API --> STORE[(Neon/Redis/JSON store<br/>metas e utilitários)]
  REPO --> UTIL[lib/config/company.ts<br/>filtros, grupos, ecommerce]
  UTIL --> REPO
```

## 3) Rotas de páginas e status

Critério de status usado neste mapa:

- **Ativa (menu):** aparece no `Sidebar`.
- **Ativa (sem menu):** rota existente e funcional, mas não exposta no menu principal.
- **Legada:** existe apenas para redirecionamento/compatibilidade.
- **Planejada/inativa de UI:** há sinais de TODO/comentário indicando recurso não exibido.

### 3.1 Rotas ativas no menu (Sidebar)

Fonte: `components/layout/Sidebar.tsx`.

- `/:company` -> Dashboard (`CompanyDashboard`).
- `/:company/produtos` -> Produtos por venda.
- `/:company/produto-detalhado` -> Produto detalhado.
- `/:company/vendedores`
- `/:company/clientes`
- `/:company/controle-estoque`
- `/:company/controle-giro`
- `/:company/controle-performance`
- `/:company/controle-transferencias`
- `/:company/transferencia-produtos`
- `/:company/romaneios`
- `/:company/saidas-entradas-produtos`
- `/:company/lista-loja`
- `/:company/exportar-relatorios`
- `/:company/mapa-clientes` (somente quando empresa atual = `scarfme`)

### 3.2 Rotas existentes, mas não priorizadas no menu (ocultas/uso pontual)

- `/:company/produtos-recentes`
- `/:company/controle-movimento`
- `/:company/blackfriday`
- `/:company/estoque-por-filial` (há TODO explícito no Sidebar para ativação futura)
- `/:company/controle-performance/filial`
- `/:company/controle-estoque/estoquedetalhado01`
- `/:company/controle-estoque/estoquedetalhado01-produto`
- `/:company/controle-estoque/estoquedetalhado02`
- `/:company/controle-estoque/projecao`
- `/:company/controle-estoque/projecao/lista-compra`
- `/:company/controle-estoque/projecao/lista-compra/compras-salvas/[id]`
- `/:company/vendedores/detalhe`
- `/:company/vendedores/detalhe/produto`
- `/:company/vendedores/detalhe/cliente`
- `/:company/romaneios/[romaneio]`

### 3.3 Rotas globais/admin

- `/` seleção da empresa.
- `/login`
- `/admin`
- `/admin/extrato-produto`
- `/admin/transferencia-permissoes` (**legada**: redireciona para `/admin`)

### 3.4 Diferenças importantes (menu x permissão x rota)

- `controle-movimento` e `blackfriday`:
  - existem em `PermissionKey` e têm página em `app/(companies)/[company]/*`;
  - atualmente não aparecem no menu do `Sidebar`.
- `estoque-por-filial`:
  - tem página e permissão;
  - no `Sidebar` há TODO/comentário de ativação futura.
- `admin/transferencia-permissoes`:
  - rota existe, porém é de transição e redireciona para `/admin`.
- Regra prática: para mudar navegação sem quebrar acesso, sempre revisar em conjunto:
  - `types/auth.ts`
  - `lib/config/nav-route-map.ts`
  - `components/layout/Sidebar.tsx`
  - `components/auth/AuthGuard.tsx`

## 4) Pontos de atenção de rota/permissão (importante para não quebrar acesso)

- Fonte oficial de segmentação para autorização: `lib/config/nav-route-map.ts`.
- O `AuthGuard` aplica `canAccessPath()` (`lib/auth/permissions.ts`) e redireciona para primeira rota permitida.
- Itens do menu filtram por permissão no `Sidebar`.
- Divergências para lembrar:
  - Existem páginas implementadas fora do menu (não significa inativa).
  - `PermissionKey` inclui chaves que podem não estar no `NAV_ROUTE_MAP` (ex.: revisar sempre os dois arquivos ao criar rota nova).

## 5) Domínios principais e lógica de cálculo

## 5.1 Dashboard executivo

- UI: `components/dashboard/CompanyDashboard.tsx`.
- API agregadora: `app/api/dashboard-data/route.ts`.
- Repositório principal: `lib/repositories/sales.ts`.
- Cálculos críticos:
  - Receita líquida considera trocas/devoluções (`LOJA_VENDA_TROCA`) e trocas puras.
  - Comparação com período anterior via `shiftRangeByMonths`.
  - Ticket médio = receita / tickets.
  - Projeção mensal na UI por run rate do mês atual.
  - Para `scarfme`, agrega varejo + e-commerce quando filial = todas.

## 5.2 Produtos e filtros comerciais

- UI: `components/products/*` (`ProductsPage`, `ProductDetailPage`, tabelas).
- APIs: `app/api/products/*`, `app/api/product-detail/*`, `app/api/top-products`, `app/api/top-categories`.
- Repositório: `lib/repositories/products.ts` e `lib/repositories/productDetail.ts`.
- Cálculos críticos:
  - Variação de receita/quantidade vs período anterior.
  - `isNew`: produto sem histórico anterior.
  - Filtros multi-valor (grupo/linha/coleção/subgrupo/grade).
  - Modo `acimaDoTicket` (preço médio vendido > preço sugerido).
  - `filterByRegistrationDate` inclui produtos cadastrados no período sem venda.

## 5.3 Estoque e projeção

- UI: `components/stock/*` (`ControleEstoquePage`, `ProjecaoEstoquePage`, detalhados).
- APIs: `app/api/controle-estoque/*`.
- Repositório núcleo: `lib/repositories/controleEstoque.ts` (arquivo grande).
- Documentos de apoio já existentes:
  - `docs/PROJECAO_ESTOQUE_LOGICA.md`
  - `docs/PROJECAO_ESTOQUE_HISTORICO.md`
- Regras centrais:
  - Cadeia mensal: estoque início do mês -> consumo projetado -> próximo mês.
  - Mês atual usa regra híbrida (real + projeção) para evitar dupla subtração.
  - Duração em dias simula consumo progressivo mês a mês.

## 5.4 Performance por filial/categoria

- UI: `components/performance/*`.
- APIs: `app/api/controle-performance/*`, `app/api/filial-performance`.
- Repositório: `lib/repositories/performance.ts`.
- Lógica:
  - Compara mês atual vs mês anterior (ou ano anterior, conforme modo).
  - Categoria muda por empresa:
    - `nerd`: grupo.
    - `scarfme`: linha.
  - Exclui matriz/deposito e combina e-commerce separadamente quando aplicável.

## 5.5 Transferências, romaneios e saídas/entradas

- UI:
  - `components/transferencia-produtos/*`
  - `components/controle-transferencias/*`
  - `components/romaneios/*`
  - `components/saidas-entradas-produtos/*`
- APIs principais:
  - `app/api/transferencia-produtos/*`
  - `app/api/controle-transferencias/route.ts`
  - `app/api/romaneios/*`
  - `app/api/saidas-entradas-produtos/*`
  - `app/api/destino-romaneio/route.ts`
- Repositórios:
  - `lib/repositories/controleTransferencias.ts`
  - `lib/repositories/logEntradas.ts`
  - `lib/repositories/logSaidas.ts`
- Documentos de apoio:
  - `docs/TRANSFERENCIAS.md`
  - `docs/TRANSFERENCIAS_PERSISTENCIA.md`
  - `docs/ROMANEIOS_TRANSFERENCIA.md`

## 6) APIs centrais por domínio (atalho mental)

- Dashboard e KPIs:
  - `/api/dashboard-data`
  - `/api/sales-summary`
  - `/api/daily-revenue`
  - `/api/top-products`
  - `/api/top-categories`
- Produtos:
  - `/api/products`
  - `/api/products/{grupos|linhas|colecoes|subgrupos|grades|search}`
  - `/api/product-detail`
  - `/api/product-detail/{precos|custos|update-price-or-cost}`
- Estoque:
  - `/api/controle-estoque`
  - `/api/controle-estoque/{detalhes|detalhes-por-filial|estoque-por-filial-item|vendas-por-filial-item|projecao-historico|lista-compra-sugerida}`
  - `/api/stock-by-filial`
- Performance:
  - `/api/controle-performance`
  - `/api/controle-performance/filial`
  - `/api/controle-performance/filial/produtos-vendedores`
  - `/api/filial-performance`
- Operação/logística:
  - `/api/controle-transferencias`
  - `/api/transferencia-produtos/*`
  - `/api/romaneios/*`
  - `/api/saidas-entradas-produtos/*`
  - `/api/controle-movimento/*`
  - `/api/lista-loja/*`
- Admin/auth:
  - `/api/auth/login`
  - `/api/admin/users`
  - `/api/admin/transferencia-permissoes`
  - `/api/admin/extrato-produto`

## 6.1 Endpoints utilitários transversais

- `/api/data` (apoio a gráficos/dados gerais).
- `/api/goals` (metas no dashboard).
- `/api/relatorios/query` e `/api/relatorios/processar`.
- `/api/transferencias-realizadas/*` e `/api/transferencias-quantidade-real`.

## 7) Componentes reutilizáveis críticos

- Layout e navegação:
  - `components/layout/PageLayout.tsx`
  - `components/layout/Sidebar.tsx`
- Auth:
  - `components/auth/AuthContext.tsx`
  - `components/auth/AuthGuard.tsx`
- Filtros:
  - `components/filters/DateRangeFilter.tsx`
  - `components/filters/FilialFilter.tsx`
  - `components/filters/MultiSelectFilter.tsx`
  - `components/filters/SelectFilter.tsx`
- KPIs:
  - `components/dashboard/SummaryCards.tsx`

## 8) Hotspots (arquivos caros em tokens)

- `lib/repositories/controleEstoque.ts`
  - Motivo: muito extenso e com múltiplas regras por empresa/período/projeção.
  - Como consultar rápido: buscar primeiro pela função-alvo (`fetchProjecaoMensal`, `build...Filter`, `fetch...`), sem ler arquivo inteiro.
- `lib/repositories/products.ts`
  - Motivo: filtros combinados, e-commerce + varejo, regras de variação.
  - Como consultar rápido: focar em `fetchProductsWithDetails` e helpers de filtro.
- `lib/repositories/sales.ts`
  - Motivo: SQL extenso com tratamento de trocas e modo leve/completo.
  - Como consultar rápido: ir direto em `fetchSalesSummary`, `fetchTopProducts`, `fetchDailyRevenue`.
- `components/layout/Sidebar.tsx`
  - Motivo: define menu real e itens ocultos por regra.
  - Como consultar rápido: bloco `allNavItems` e TODOs.

## 9) Playbook para economizar tokens em tarefas futuras

- Se a tarefa for de acesso/visibilidade de página:
  1. `lib/config/nav-route-map.ts`
  2. `lib/auth/permissions.ts`
  3. `components/layout/Sidebar.tsx`
- Se a tarefa for de KPI/valor divergente no dashboard:
  1. `app/api/dashboard-data/route.ts`
  2. `lib/repositories/sales.ts`
  3. `lib/config/company.ts` (filiais/e-commerce/exclusões)
- Se a tarefa for de projeção de estoque:
  1. `docs/PROJECAO_ESTOQUE_LOGICA.md`
  2. `lib/repositories/controleEstoque.ts`
  3. `components/stock/ProjecaoEstoquePage.tsx`
- Se a tarefa for transferência/romaneio:
  1. `docs/TRANSFERENCIAS.md`
  2. `app/api/transferencia-produtos/*`
  3. `lib/repositories/controleTransferencias.ts`
- Se a tarefa for lista loja / operação diária:
  1. `components/lista-loja/ListaLojaPage.tsx`
  2. `app/api/lista-loja/route.ts`
  3. `app/api/lista-loja/[id]/route.ts`
- Se a tarefa for produtos/filtros:
  1. `lib/repositories/products.ts`
  2. `app/api/products/route.ts`
  3. `components/products/ProductsPage.tsx`

## 9.1 Método rápido de investigação (economia máxima)

- Passo 1 (roteamento): validar rota em `app/(companies)/[company]` e menu no `Sidebar`.
- Passo 2 (contrato API): abrir só o `route.ts` do endpoint da tela.
- Passo 3 (regra): abrir somente a função chamada no repository (evitar leitura integral).
- Passo 4 (empresa): conferir `lib/config/company.ts` para diferenças de filial/e-commerce.
- Passo 5 (dados estranhos): checar se há agregação híbrida `scarfme` (varejo + e-commerce).

## 10) Checklist de manutenção (sempre que criar nova rota)

- Criou página em `app/(companies)/[company]/.../page.tsx`?
- Atualizou `types/auth.ts` (nova `PermissionKey`)?
- Atualizou `lib/config/nav-route-map.ts`?
- Atualizou `components/layout/Sidebar.tsx` (menu e permission)?
- Validou bloqueio no `AuthGuard` (`canAccessPath`)?

## 11) Checklist de re-check periódico (manter o mapa funcional)

- Conferir se páginas novas em `app/(companies)/[company]/**/page.tsx` entraram neste mapa.
- Conferir endpoints novos em `app/api/**/route.ts` e classificar por domínio.
- Revisar diferenças entre:
  - permissões (`types/auth.ts`)
  - mapeamento de segmento (`nav-route-map.ts`)
  - navegação efetiva (`Sidebar.tsx`)
- Marcar rotas legadas com comportamento de redirecionamento.
- Atualizar hotspots quando arquivos crescerem muito (principalmente repositories).

