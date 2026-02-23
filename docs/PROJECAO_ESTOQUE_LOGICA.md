# Projeção de Estoque — Lógica em Detalhes

Este documento descreve como a **Projeção de Estoque** funciona hoje (backend + frontend), do dado bruto até o número exibido na tela.

---

## 1. Visão geral

- **Objetivo:** Mostrar, por categoria/linha/subgrupo/grade, do **mês atual até dezembro do ano**, para cada mês:
  - **VENDA:** projeção de vendas (unidades).
  - **ESTOQUE:** estoque no **início** daquele mês (após subtrair as vendas dos meses anteriores).
  - **DURAÇÃO:** a partir do fim daquele mês, em **quantos dias** o estoque acabaria se as vendas seguintes seguirem a projeção.

- **Período exibido:** Sempre **mês atual → dezembro do mesmo ano** (ex.: em fevereiro: FEV a DEZ = 11 colunas).

---

## 2. Backend (`fetchProjecaoMensal` em `lib/repositories/controleEstoque.ts`)

### 2.1 Fontes de dados (queries)

| Dado | Fonte | Filtros importantes |
|------|--------|----------------------|
| **Estoque atual** | `ESTOQUE_PRODUTOS` + `PRODUTOS` | Filial (selecionada), grupo/linha/subgrupo/grade/coleção, exclusões (ex.: BAG, ASSISTENCIA). Agrupamento no **nível máximo** (categoria\|linha\|subgrupo\|grade\|coleção). |
| **Vendas ano passado** | `W_CTB_LOJA_VENDA_PEDIDO_PRODUTO` (varejo) +, se ScarfMe, `FATURAMENTO`/`W_FATURAMENTO_PROD_02` (e-commerce) | Ano = ano passado. Filial conforme `buildVendasFilialFilter`. Agrupado por mês e pela mesma chave detalhada. |
| **Vendas mês atual** | Mesma tabela de vendas (varejo + e-commerce ScarfMe) | Período = **1º do mês até “hoje”** com o **mesmo critério do Controle de Estoque**: `getCurrentMonthRange()` + `normalizeRangeForQuery()`, então `DATA_VENDA >= periodoStart AND DATA_VENDA < periodoEnd`. **Todas as filiais** (`vendasMesAtualFilialFilter` = sales + e-commerce). **Sem** filtro de linha/subgrupo/grade/coleção na query (só grupo e exclusões), para bater com “Venda Total (período)” do card. |

Ou seja: estoque respeita filial (e filtros de produto); vendas do mês atual são “todas as filiais” e mesmo período do card, para o número real e a projeção do mês baterem. Dados de mês anterior e últimos 30 dias (varejo, filial selecionada) alimentam a regra dos primeiros 5 dias.

### 2.2 Projeção de vendas por mês

- **Mês atual (primeira coluna):**
  - **Projeção do mês (valor exibido):** mesma regra do **Controle de Estoque**:
    - **Primeiros 5 dias do mês e zero vendas no mês:** usa média diária do **mês anterior** × dias corridos (ou, se não houver vendas no mês anterior, média diária dos **últimos 30 dias** × dias corridos); depois projeção = (vendasParaProjecao / diasParaProjecao) × dias do mês.
    - **Primeiros 5 dias do mês e já tem vendas no mês:** **média ponderada** 70% mês anterior + 30% mês atual (média diária de cada), depois projeção = (vendasParaProjecao / diasParaProjecao) × dias do mês.
    - **A partir do 6º dia (ou se não houver mês anterior/30 dias):** run rate puro: `(vendas reais do mês / dias corridos) × dias do mês`.
  - **Vendas reais (tooltip):** soma real varejo + e-commerce no período (1º do mês até hoje), mesma regra do card; fica em `vendasReais` só no mês atual.

- **Meses seguintes (até dezembro):**
  - Para cada mês: **vendas do mesmo mês no ano passado × 1,1**.
  - Se não houver dado naquele mês: **média mensal do ano passado × 1,1** (`(total ano passado / 12) × 1.1`).

### 2.3 Cadeia de estoque (backend)

Para cada chave (categoria|linha|subgrupo|grade|coleção):

1. **Estoque inicial:** valor vindo do mapa de estoque (soma por essa chave).
2. **Só são gerados meses do mês atual até dezembro:**  
   `quantidadeMeses = 13 - mesAtual` (ex.: fev = 2 → 11 meses).
3. Para cada mês `i` (0 = mês atual, 1 = próximo, …):
   - **Exibido:** `estoque[i]` = estoque no **início** do mês `i` (valor atual de `estoqueAtual`).
   - **Vendas do mês:** `vendas[i]` (projeção do mês atual ou ano passado +10%).
   - **Atualização para o próximo mês:**  
     - **Mês atual:** o estoque atual já reflete as vendas reais; descontar só a **diferença projetada**: `vendas a descontar = max(0, projeção do mês − vendas reais)`. Ex.: 200 de estoque, 50 vendas reais, projeção 80 → descontar 30 → próximo mês 170.  
     - **Outros meses:** `vendas a descontar = vendas[i]`.  
     `estoqueAtual = max(0, estoqueAtual - vendas a descontar)`.

Assim, a regra é: **estoque no início do mês − vendas a descontar = estoque no início do mês seguinte**; no mês atual, “vendas a descontar” é só o que ainda falta vender (projeção − real). Nada de “somar” estoques de linhas diferentes nessa etapa; cada chave tem sua própria cadeia.

### 2.4 Duração (backend)

Para cada mês `i`:

- **Significado:** “A partir do **fim** do mês `i`, mantendo a projeção dos meses seguintes, o estoque acabaria em **X dias**.”
- **Cálculo:**
  - Para o **mês atual** (i = 0): `remaining = estoque no início do mês seguinte` (já descontada a diferença projetada do mês atual). Para os **demais meses**: `remaining = estoque[i]` (início do mês `i`).
  - Para cada mês futuro `j` (j = i+1, i+2, … até dezembro):
    - `consumoDiario = vendas[j] / diasDoMes(j)`
    - `diasParaEsvaziar = remaining / consumoDiario`
    - Se `diasParaEsvaziar >= diasDoMes(j)`: consome o mês inteiro: `totalDias += diasDoMes(j)`, `remaining -= vendas[j]`, segue para o próximo mês.
    - Senão: estoque acaba no meio do mês: `totalDias += round(diasParaEsvaziar)` e para.
  - Se após todos os meses ainda sobrar estoque: `duracao = 999` (convenção “acaba em mais de 1 ano”). Se estoque no início já for 0: `duracao = 0`.

Ou seja: a duração usa o **mesmo** estoque e as **mesmas** vendas projetadas já calculadas; só simula “em quantos dias esse estoque some” com as vendas futuras.

---

## 3. Frontend (`ProjecaoEstoquePage.tsx`)

### 3.1 Meses exibidos

- `mesesExibicao`: do mês atual até dezembro do ano.
- Cálculo: `quantidadeMeses = 12 - getMonth(hoje)` (getMonth 0–11). Ex.: fevereiro → 11 meses (FEV–DEZ).

### 3.2 Agregação (merge) quando há mais de uma “linha” (ex.: várias grades)

Quando a tabela agrupa várias linhas do backend (ex.: nível 0 = uma linha por categoria agregando várias chaves), o frontend **não** soma os estoques mês a mês de cada chave (isso quebrava a matemática). Ele faz:

1. **Vendas:** para cada mês, soma as vendas de todos os itens:  
   `vendas[i] = soma(it.meses[i].vendas)`.
2. **Estoque:** uma **única** cadeia:
   - Estoque inicial agregado: `estoqueInicial = soma(it.meses[0].estoque)` (soma dos estoques iniciais de cada item).
   - Para cada mês `i`:  
     - `estoque[i] = estoqueInicial` (exibido).  
     - Depois: `estoqueInicial = max(0, estoqueInicial - vendas[i])` (para o próximo mês).

Assim, a regra continua: **estoque no início do mês − vendas (agregadas) desse mês = estoque no início do mês seguinte**. A subtração é sempre sequencial e única por “bloco” agregado.

### 3.3 Duração no frontend (após merge)

- Mesma ideia do backend: para cada mês `i`, `diasAteAcabarEstoque(meses, i)` usa `meses[i].estoque` e as vendas dos meses `i+1` em diante, com consumo diário = vendas do mês / dias do mês, e soma dias até o estoque zerar (ou 999 se não zerar no horizonte).
- É aplicada **depois** de montar a cadeia de estoque agregada, para que duração reflita o estoque e as vendas já agregados.

### 3.4 Filtros e expansão

- **Linhas excluídas (ScarfMe):** config da empresa (ex.: PRIVATE LABEL, etc.); categorias nessas linhas saem da lista.
- **Filtros de grupo/linha:** só entram categorias que batem com os filtros (e a API já pode ter reduzido por grupo/linha/subgrupo/grade).
- **Expansão (nível 0 → 1 → 2):** mesma regra do Controle de Estoque (NERD: grupo → subgrupos → grades; ScarfMe: linha → subgrupos → grades). Em cada nível, o merge acima é refeito (soma de vendas + uma cadeia de estoque por grupo de itens).

---

## 4. Resumo da matemática (como está hoje)

| Conceito | Fórmula / regra |
|----------|------------------|
| **Período** | Mês atual até dezembro do ano (sem janeiro do ano seguinte). |
| **VENDA mês atual** | Projeção: `(vendas reais até hoje / dias corridos) × dias do mês`. Tooltip: vendas reais (mesmo critério do card). |
| **VENDA outros meses** | Mesmo mês ano passado × 1,1; se faltar mês, média anual × 1,1. |
| **ESTOQUE** | Sempre **início do mês**. Cadeia: `estoque[0] = estoque atual`; no mês atual descontar só `max(0, projeção − vendas reais)`; nos outros `estoque[i] = estoque[i-1] - vendas[i-1]`. No merge: mesma regra, uma única cadeia. |
| **DURAÇÃO** | A partir do estoque no início daquele mês (tratado como “fim do mês” para a frase), simula consumo com as vendas projetadas dos meses seguintes e retorna o total de dias até zerar (ou 999). |

Com isso, a subtração é consistente em todo o fluxo: **estoque atual e ritmo de vendas projetadas → estoque no início de cada mês → duração em dias até acabar**.
