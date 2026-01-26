# Documentação: Página de Transferências

## 📋 Visão Geral

A página de **Transferências** identifica produtos que devem ser transferidos de filiais com estoque disponível para filiais que estão vendendo mas estão sem estoque. O sistema calcula automaticamente as transferências necessárias baseado em regras de negócio específicas.

---

## 🎯 Objetivo

Redistribuir estoque de forma inteligente para:
- Atender lojas que estão vendendo mas estão sem estoque
- Priorizar lojas paradas (com estoque mas sem vendas) como origem
- Evitar transferências duplicadas
- Transferir apenas o necessário, não tudo

---

## 🔍 Filtros Iniciais

Antes de calcular transferências, o sistema verifica se o produto atende aos critérios básicos:

### 1. Produto deve ter vendas
```typescript
Se totalVendas === 0 OU projecaoVendaMes === 0
  → Ignora o produto (não precisa transferir)
```

**Por quê?** Produtos sem vendas não precisam ser transferidos, pois não há demanda.

### 2. Condição de estoque suficiente
```typescript
Se estoque total >= (número de filiais sem matriz) × 2
  E alguma filial com vendas tem estoque < 1
  → Produto pode ser transferido
```

**Exemplo:**
- 5 filiais (sem contar matriz)
- Estoque total necessário: 5 × 2 = 10 unidades
- Se o produto tem 10+ unidades E alguma loja vendendo está zerada
- → Pode transferir

**Por quê?** Garante que há estoque suficiente para distribuir sem esgotar completamente as origens.

---

## 🏪 Identificação de Filiais que Precisam

O sistema identifica quais filiais precisam receber estoque:

### Critérios:
- ✅ Tem vendas no período (`sales > 0`)
- ✅ Estoque < 1 (zero ou negativo)

### Ordenação de Prioridade:
1. **Quem vendeu mais** primeiro
2. Em caso de empate, **quem tem menos estoque** primeiro

**Exemplo:**
- LEBLON: vendeu 10 unidades, estoque 0 → **Prioridade 1**
- VILLA LOBOS: vendeu 5 unidades, estoque 0 → **Prioridade 2**

**Por quê?** Atende primeiro quem tem maior demanda e maior risco de perder vendas.

---

## 📦 Identificação de Filiais com Estoque Disponível

O sistema identifica quais filiais podem ser origem das transferências:

### Critérios:
- ✅ Estoque ≥ 2 (pode transferir pelo menos 1, deixando 1 na origem)

### Identificação de Lojas Paradas (Laranja):
```typescript
isParada = estoque > 1 
  E vendas no período === 0 
  E vendas últimos 30 dias === 0
```

**Por quê?** Lojas paradas têm estoque que não está sendo vendido, ideal para transferir.

### Ordenação de Prioridade para Origem:

1. **Matriz** (sempre primeiro)
   - É o estoque principal da empresa
   - Sempre priorizada como origem

2. **Lojas Paradas e E-commerce Parado** (mesma prioridade)
   - Entre elas, ordenadas por **maior estoque primeiro**
   - Por quê? Assim ainda sobra algo para a loja, só esvazia em último caso

3. **Outras Filiais**
   - Apenas se não houver matriz ou lojas paradas disponíveis
   - Ordenadas por maior estoque

**Exemplo:**
- Matriz: 50 unidades → **Prioridade 1**
- LEBLON (parada): 30 unidades → **Prioridade 2**
- VILLA LOBOS (parada): 15 unidades → **Prioridade 3**
- CENTER NORTE (com vendas): 20 unidades → **Prioridade 4**

---

## 🚫 Sistema Anti-Duplicação

O sistema evita que múltiplas lojas transfiram o mesmo produto para a mesma loja destino.

### Como funciona:

1. **Mapa Global de Rastreamento**
   ```typescript
   quantidadeTransferidaPorDestino = {
     "PRODUTO123|VERMELHO|LEBLON": 15,
     "PRODUTO456|AZUL|VILLA LOBOS": 8
   }
   ```

2. **Chave Única**
   - Formato: `produto|cor|filialDestino`
   - Exemplo: `N5.16.0002|CLEAR|NERD LEBLON`

3. **Verificações Antes de Transferir**
   - ✅ Verifica quanto já foi transferido para aquele destino
   - ✅ Calcula quanto ainda falta
   - ✅ Se já foi transferido o suficiente, **pula essa loja**
   - ✅ Se já foi transferido ≥ 2 unidades e falta < 2, **pula**

**Exemplo:**
- LEBLON precisa de 15 unidades
- MORUMBI já transferiu 15 unidades para LEBLON
- → VILLA LOBOS **não transfere** mais para LEBLON (já está atendido)

**Por quê?** Evita desperdício e garante que cada loja receba exatamente o que precisa, sem excessos.

---

## 📊 Cálculo de Necessidade

Para cada filial destino, o sistema calcula quanto estoque ela precisa:

### Fórmula:
```typescript
vendaDiariaDestino = vendas no período / dias no período
estoqueMinimoDestino = max(15, vendaDiariaDestino × 15)
quantidadeNecessaria = max(estoqueMinimoDestino - estoqueAtual, 2)
```

### Exemplo Prático:

**Cenário:**
- LEBLON vendeu 30 unidades em 30 dias
- Estoque atual: 0

**Cálculo:**
1. Venda diária = 30 / 30 = **1 unidade/dia**
2. Estoque mínimo = max(15, 1 × 15) = **15 unidades**
3. Quantidade necessária = max(15 - 0, 2) = **15 unidades**

**Por quê?** Garante estoque suficiente para 15 dias de vendas, com mínimo de 15 unidades ou 2 unidades (o que for maior).

---

## 🎯 Seleção da Origem

O sistema escolhe a melhor filial para transferir de:

### Processo:

1. **Verifica Matriz**
   - Se matriz tem estoque ≥ 2 → **Usa matriz**

2. **Se não houver matriz disponível**
   - Busca lojas paradas ou e-commerce parado
   - Entre elas, escolhe a com **maior estoque**
   - Por quê? Assim ainda sobra algo para a loja parada

3. **Se não houver lojas paradas**
   - Usa outras filiais com estoque disponível

**Exemplo:**
- Matriz: 5 unidades disponíveis → **Escolhe matriz**
- Se matriz não disponível:
  - LEBLON (parada): 30 unidades → **Escolhe LEBLON**
  - VILLA LOBOS (parada): 15 unidades → Não escolhe (LEBLON tem mais)

---

## 💰 Cálculo da Quantidade a Transferir

O sistema calcula exatamente quanto transferir:

### Quantidade Base:
```typescript
quantidade = min(quantidadeFaltante, estoqueOrigem - 1)
```

### Regras Especiais:

#### 1. Se a Origem também tem Vendas:
```typescript
Se origem.vendas > 0:
  - Calcula estoque mínimo da origem
  - Se após transferência ficar abaixo do mínimo:
    - Ajusta quantidade para não zerar origem
```

**Exemplo:**
- Origem: 20 unidades, vende 2/dia
- Estoque mínimo origem: 30 unidades (2 × 15)
- Quantidade necessária destino: 15 unidades
- **Problema:** 20 - 15 = 5 (abaixo do mínimo de 30)
- **Solução:** Transfere apenas 1 unidade (deixa 19 na origem)

**Por quê?** Protege lojas que também vendem, não as deixa sem estoque mínimo.

#### 2. Se é Lojas Parada:
```typescript
Se origem é loja parada:
  - Normalmente: transfere só o necessário
  - Exceção: se loja parada tem ≤ 5 unidades E é obrigatório enviar:
    - Pode transferir tudo
```

**Por quê?** Lojas paradas podem ceder mais estoque, mas só transfere tudo se realmente necessário e se a loja tem poucas unidades.

---

## 📝 Registro e Atualização

Após criar uma transferência:

1. **Adiciona à lista** de transferências
2. **Atualiza estoque disponível** na origem (reduz a quantidade)
3. **Registra no mapa global** a quantidade transferida para aquele destino

**Exemplo:**
- Transferência criada: MORUMBI → LEBLON, 15 unidades
- Estoque MORUMBI: 50 → 35 (atualizado)
- Mapa: `"PRODUTO123|VERMELHO|LEBLON": 15` (registrado)
- Próxima verificação: VILLA LOBOS vê que LEBLON já recebeu 15, não transfere mais

---

## 📊 Agrupamento e Exibição

### Processo:

1. **Agrupa por filial de origem**
   - Todas as transferências de MORUMBI juntas
   - Todas as transferências de LEBLON juntas
   - etc.

2. **Calcula totais**
   - Número de itens distintos
   - Quantidade total de unidades

3. **Ordena alfabeticamente** por nome da origem

4. **Exibe na interface** agrupado por origem

---

## 🖱️ Tooltip de Detalhes

Ao passar o mouse sobre a descrição do produto, aparece um tooltip com:

### Informações Exibidas:

#### Header:
- Nome do produto (descrição)
- Código e cor do produto

#### Conteúdo:
- **Estoque por filial:** Quantidade em estoque em cada filial
- **Vendas por filial:** Vendas no período selecionado
- **Dias parado:** Para lojas com estoque e sem vendas
  - Se não teve venda no período nem nos últimos 30 dias: **30+ dias**
  - Se teve venda nos últimos 30 dias mas não no período: **dias do período**
  - Só aparece para lojas que realmente estão paradas

### Ordenação:
- Matriz primeiro
- Depois outras filiais ordenadas alfabeticamente

---

## 📋 Resumo do Fluxo Completo

```
1. Filtra produtos com vendas e estoque suficiente
   ↓
2. Identifica lojas que precisam (estoque < 1 com vendas)
   ↓
3. Identifica lojas com estoque disponível (≥ 2)
   ↓
4. Prioriza matriz como origem
   ↓
5. Depois prioriza lojas paradas (maior estoque primeiro)
   ↓
6. Calcula necessidade de cada destino
   ↓
7. Verifica se já foi transferido (anti-duplicação)
   ↓
8. Calcula quantidade a transferir
   ↓
9. Protege estoque mínimo da origem (se ela também vende)
   ↓
10. Registra transferência e atualiza estoques
    ↓
11. Agrupa e exibe por filial de origem
```

---

## ✅ Garantias do Sistema

A lógica garante que:

- ✅ **Não há transferências duplicadas**
  - Cada produto só é transferido uma vez para cada loja destino
  - Múltiplas lojas podem transferir o mesmo produto, mas para destinos diferentes

- ✅ **Apenas o necessário é transferido**
  - Calcula exatamente quanto cada loja precisa
  - Não transfere tudo, só o necessário

- ✅ **Lojas paradas são priorizadas**
  - Como origem, para esvaziar estoque parado
  - Prioriza lojas com mais estoque (para sobrar algo)

- ✅ **Lojas que vendem não ficam sem estoque mínimo**
  - Se a origem também vende, mantém estoque mínimo
  - Protege contra perda de vendas na origem

- ✅ **Múltiplas lojas podem receber**
  - Se há estoque suficiente, várias lojas podem receber do mesmo produto
  - Cada uma recebe apenas o que precisa

---

## 🎨 Interface Visual

### Estrutura:

Para cada filial de origem:

1. **Header Azul**
   - Nome da filial de origem
   - Total de itens (quantidade total de unidades)

2. **Tabela**
   - Produto (código)
   - Descrição (com tooltip ao passar mouse)
   - Cor
   - Destino (loja que vai receber)
   - Quantidade a transferir

3. **Footer**
   - Número de itens distintos para transferência
   - Total de unidades

---

## 🔧 Configurações e Parâmetros

### Valores Fixos:

- **Estoque mínimo base:** 15 unidades
- **Estoque ideal base:** 20 unidades
- **Multiplicador de estoque mínimo:** 15 dias
- **Multiplicador de estoque ideal:** 25 dias
- **Quantidade mínima de transferência:** 2 unidades
- **Estoque mínimo na origem ao transferir:** 1 unidade
- **Dias parado mínimo:** 30 dias

### Cálculos Dinâmicos:

- **Venda diária:** Baseada no período selecionado
- **Estoque mínimo:** Adaptado à venda diária de cada loja
- **Quantidade necessária:** Baseada na necessidade real de cada destino

---

## 📚 Exemplo Completo

### Cenário:

**Produto:** N5.16.0002 - PT BEEP HYDROGEL CLEAR (CLEAR)

**Situação:**
- MORUMBI: 25 unidades, sem vendas (parada)
- LEBLON: 0 unidades, vendeu 12 unidades
- VILLA LOBOS: 0 unidades, vendeu 8 unidades
- CENTER NORTE: 5 unidades, vendeu 3 unidades

### Processo:

1. **Filtros:** ✅ Produto tem vendas, estoque total (30) ≥ 4 (2 filiais × 2)

2. **Lojas que precisam:**
   - LEBLON: 12 vendas, estoque 0 → **Prioridade 1**
   - VILLA LOBOS: 8 vendas, estoque 0 → **Prioridade 2**

3. **Lojas com estoque:**
   - MORUMBI: 25 unidades, parada → **Prioridade 1** (loja parada)
   - CENTER NORTE: 5 unidades, com vendas → **Prioridade 2**

4. **Cálculo de necessidade:**
   - LEBLON: 12 vendas / 30 dias = 0.4/dia → mínimo 15 → precisa 15
   - VILLA LOBOS: 8 vendas / 30 dias = 0.27/dia → mínimo 15 → precisa 15

5. **Transferências:**
   - MORUMBI → LEBLON: 15 unidades
   - MORUMBI → VILLA LOBOS: 10 unidades (restante disponível: 25 - 15 = 10)

6. **Resultado:**
   - MORUMBI: 25 → 0 unidades (esvaziou, mas era parada)
   - LEBLON: 0 → 15 unidades (recebeu)
   - VILLA LOBOS: 0 → 10 unidades (recebeu parcialmente)

---

## 🎓 Conclusão

A página de Transferências automatiza a redistribuição de estoque de forma inteligente, priorizando:
- Lojas que vendem mas estão sem estoque
- Lojas paradas como origem
- Proteção de estoque mínimo
- Evitar desperdícios e duplicações

O sistema garante que cada loja receba exatamente o que precisa, quando precisa, maximizando as vendas e otimizando o estoque.
