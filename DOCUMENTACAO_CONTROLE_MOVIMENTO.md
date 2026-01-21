# Documentação - Controle de Movimento

## 📊 O QUE ESTÁ SENDO MOSTRADO

### 1. **ENTRADAS DO PERÍODO**
- **Quantidade**: Total de produtos que entraram no período selecionado
- **Custo**: Custo total das entradas (QTDE × CUSTO_REPOSICAO1)
- **Comparação**: Mostra variação percentual vs período anterior

### 2. **VENDIDOS**
- **Quantidade**: Total de produtos vendidos (dos que entraram no período)
- **Valor**: Valor líquido das vendas (após descontos e trocas)
- **Comparação**: Mostra variação percentual vs período anterior

### 3. **ITENS PARADOS**
- **Quantidade**: Entradas - Vendidos (o que falta vender)
- **Custo**: Custo dos itens parados (calculado pelo custo médio das entradas)

---

## 🔍 COMO ESTÁ SENDO FILTRADO

### **FILTROS APLICADOS NAS ENTRADAS**

#### 1. **Apenas Entradas na Matriz**
- **SCARFME**: Apenas `'SCARF ME - MATRIZ'`
- **NERD**: Apenas `'NERD'`
- **Motivo**: Considerar apenas compras reais, não transferências internas

#### 2. **Desconto de Devoluções (NÃO REMOVE COMPLETAMENTE)**
- **IMPORTANTE**: Não remove a entrada completamente, apenas desconta a quantidade devolvida
- Se entraram 10 unidades e saíram 3 para loja na mesma data, conta 7 unidades
- Se entraram 10 unidades e saíram 10 ou mais, não conta nada (foi tudo devolvido)
- **Critério de devolução**:
  - Mesmo `PRODUTO`
  - Mesma `COR_PRODUTO`
  - Mesma data de `EMISSAO`
  - Saída em loja normal (não matriz, não e-commerce)
- **Cálculo**: Quantidade Líquida = Quantidade Entrada - Quantidade Saída (se > 0)

#### 3. **Filtros de Produto (aplicados nas entradas)**
- **Grupos** (NERD): Filtra por `GRUPO_PRODUTO`
- **Linhas** (SCARFME): Filtra por `LINHA`
- **Coleções** (SCARFME): Filtra por `COLECAO`
- **Subgrupos**: Filtra por `SUBGRUPO_PRODUTO`
- **Grades**: Filtra por `GRADE`

#### 4. **Exclusão de Linhas (SCARFME)**
Linhas excluídas automaticamente:
- `PRIVATE LABEL`
- `GASTRONOMICA`
- `PERFUMARIA`
- `CASHMERE`
- `ELETRONICOS`
- `EMBALAGENS`
- `CAPAS E ACESSORIOS P/ CEL`

#### 5. **Filtros de Validação**
- Remove produtos sem categoria (`GRUPO_PRODUTO` ou `LINHA` vazios)
- Remove produtos com categoria = `'SEM GRUPO'` ou `'SEM LINHA'`
- Remove produtos sem `PRODUTO` (NULL)

---

### **FILTROS APLICADOS NAS VENDAS**

#### 1. **Relacionamento com Entradas**
- **IMPORTANTE**: Apenas vendas de produtos que entraram no período são consideradas
- Relacionamento por: `PRODUTO + COR_PRODUTO`
- Se um produto entrou no período, todas as vendas dele no período são contabilizadas

#### 2. **Filtro de Filial (Vendas)**
- Respeita o filtro de filial selecionado pelo usuário
- **SCARFME**:
  - Se filial específica: apenas essa filial
  - Se "VAREJO": apenas filiais normais (sem e-commerce)
  - Se "Todas": todas as filiais normais (sem e-commerce)
- **NERD**: Respeita filial selecionada

#### 3. **Filtros de Produto (aplicados nas vendas)**
- Mesmos filtros das entradas:
  - **Grupos** (NERD)
  - **Linhas** (SCARFME)
  - **Coleções** (SCARFME)
  - **Subgrupos**
  - **Grades**

#### 4. **Exclusão de Linhas (SCARFME)**
- Mesmas linhas excluídas das entradas

#### 5. **Tratamento de Trocas e Cancelamentos**
- **Cancelamentos**: Vendas com `QTDE_CANCELADA > 0` são ignoradas
- **Trocas**: Quantidade e valor de trocas são subtraídos das vendas
- **Cálculo líquido**:
  - Quantidade = `QTDE - QTDE_TROCA` (se não cancelado)
  - Valor = `(PRECO_LIQUIDO × QTDE) - DESCONTO_VENDA - VALOR_TROCA` (se não cancelado)

---

## 📅 FILTRO DE PERÍODO

- **Período Atual**: Definido pelo `DateRangeFilter` (startDate até endDate)
- **Período Anterior**: Calculado automaticamente (1 mês antes do período atual)
- **Comparação**: Mostra variação percentual entre período atual e anterior

---

## 🔗 LÓGICA DE RELACIONAMENTO

### **Fluxo de Cálculo**

1. **Buscar Entradas Líquidas** (matriz, sem devoluções, com filtros)
2. **Listar Produtos Únicos** que entraram (PRODUTO + COR_PRODUTO)
3. **Buscar Vendas** desses produtos no período (com filtros de filial e produto)
4. **Calcular Itens Parados** = Entradas - Vendidos

### **Garantia de Consistência**

- As vendas são **sempre** relacionadas com produtos que entraram
- Se um produto não entrou no período, suas vendas **não são contabilizadas**
- Os filtros de produto são aplicados tanto nas entradas quanto nas vendas
- O filtro de filial afeta apenas as vendas (entradas são sempre da matriz)

---

## 📋 RESUMO DOS FILTROS

| Filtro | Entradas | Vendas | Observação |
|--------|----------|--------|------------|
| **Período** | ✅ | ✅ | Mesmo período |
| **Matriz** | ✅ | ❌ | Entradas apenas na matriz |
| **Filial** | ❌ | ✅ | Vendas respeitam filial selecionada |
| **Grupos** | ✅ | ✅ | Aplicado em ambos |
| **Linhas** | ✅ | ✅ | Aplicado em ambos |
| **Coleções** | ✅ | ✅ | Aplicado em ambos |
| **Subgrupos** | ✅ | ✅ | Aplicado em ambos |
| **Grades** | ✅ | ✅ | Aplicado em ambos |
| **Exclusão de Linhas** | ✅ | ✅ | SCARFME apenas |
| **Desconto de Devoluções** | ✅ | ❌ | Apenas nas entradas (desconta quantidade, não remove) |
| **Trocas/Cancelamentos** | ❌ | ✅ | Apenas nas vendas |

---

## ⚠️ PONTOS IMPORTANTES

1. **Entradas são sempre da matriz**: Não importa o filtro de filial, as entradas sempre vêm da matriz
2. **Vendas são relacionadas**: Apenas vendas de produtos que entraram no período são contabilizadas
3. **Devoluções são descontadas (não removidas)**: Se um produto entrou e foi parcialmente devolvido, conta apenas a diferença. Exemplo: entrou 10, saiu 3 = conta 7
4. **Linhas excluídas**: SCARFME automaticamente exclui linhas não autorizadas
5. **Itens parados**: Calculado como diferença, garantindo que não seja negativo

---

## 🎯 EXEMPLO PRÁTICO

**Cenário**: Janeiro 2025, SCARFME, Filial "MORUMBI - JJJ", Linha "PASHMINA"

1. **Entradas**: 
   - Busca entradas em `SCARF ME - MATRIZ` em janeiro
   - Desconta devoluções (quantidade entrada - quantidade saída)
   - Filtra apenas linha "PASHMINA"
   - Remove linhas excluídas

2. **Vendas**:
   - Lista produtos únicos que entraram (PASHMINA, janeiro)
   - Busca vendas desses produtos em janeiro
   - Filtra apenas filial "MORUMBI - JJJ"
   - Remove trocas e cancelamentos

3. **Itens Parados**:
   - Entradas - Vendidos
   - Custo = Quantidade parada × Custo médio das entradas
