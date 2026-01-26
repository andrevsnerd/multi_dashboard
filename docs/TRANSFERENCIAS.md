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

### 2. Condição básica de transferência
```typescript
Se alguma filial com vendas tem estoque < 1
  E há estoque disponível em outras filiais (≥ 1 unidade)
  → Produto pode ser transferido
```

**Exemplo:**
- Loja A: vendeu 3 unidades, estoque 0
- Loja B: vendeu 1 unidade, estoque 3 unidades
- → **Pode transferir** (Loja B tem estoque disponível)

**Regras de estoque disponível:**
- Se a loja origem **também vende**: precisa ter pelo menos **2 unidades** (para deixar 1)
- Se a loja origem **não vende** (loja parada): pode transferir mesmo tendo apenas **1 unidade**

**Por quê?** Não precisa de estoque excessivo. Se há estoque disponível e uma loja precisa, deve transferir. A única restrição é não zerar lojas que também vendem.

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
- ✅ Se a filial **também vende**: Estoque ≥ 2 (pode transferir pelo menos 1, deixando 1 na origem)
- ✅ Se a filial **não vende** (loja parada): Estoque ≥ 1 (pode transferir mesmo tendo apenas 1)

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

### Lógica Conservadora (Evita Estoques Excessivos):

Como haverá transferências semanais regulares, o sistema não cria estoques muito grandes. A lógica é mais conservadora:

#### Caso 1: Uma única loja precisa
```typescript
estoqueMinimo = max(2, vendas do período)
quantidadeNecessaria = max(estoqueMinimo - estoqueAtual, 2)
```

**Exemplo:**
- LEBLON vendeu 5 unidades em 30 dias
- Estoque atual: 0
- Estoque mínimo = max(2, 5) = **5 unidades**
- Quantidade necessária = max(5 - 0, 2) = **5 unidades**

**Por quê?** Envia pelo menos o equivalente às vendas do período, já que haverá novas transferências semanais se necessário.

#### Caso 2: Múltiplas lojas precisam (Distribuição Proporcional)

Quando há múltiplas lojas precisando do mesmo produto, o sistema divide proporcionalmente baseado nas vendas de cada uma:

```typescript
totalVendas = soma de todas as vendas das lojas que precisam
estoqueTotalDisponivel = soma do estoque de todas as origens
proporcao = vendas desta loja / totalVendas
quantidade = proporcao × estoqueTotalDisponivel
```

**Exemplo Prático:**

**Cenário:**
- Estoque disponível: 5 unidades
- Loja A: vendeu 5 unidades
- Loja B: vendeu 3 unidades
- Total de vendas: 8 unidades

**Cálculo:**
1. Loja A: (5/8) × 5 = 3.125 → **3 unidades**
2. Loja B: (3/8) × 5 = 1.875 → **2 unidades**

**Por quê?** Evita que uma loja fique com todo o estoque. Distribui de forma justa baseado nas vendas de cada loja.

---

## 🎯 Seleção da Origem

O sistema escolhe a melhor filial para transferir de:

### Processo:

1. **Verifica Matriz (Sempre Prioridade)**
   - Matriz pode transferir mesmo tendo apenas **1 unidade**
   - **Por quê?** Matriz não vende, serve unicamente para abastecer lojas
   - Se matriz tem estoque ≥ 1 → **Usa matriz primeiro**

2. **Se não houver matriz disponível**
   - Busca lojas paradas ou e-commerce parado
   - Entre elas, escolhe a com **maior estoque**
   - Por quê? Assim ainda sobra algo para a loja parada

3. **Se não houver lojas paradas**
   - Usa outras filiais com estoque disponível

### Múltiplas Origens para o Mesmo Destino:

Se uma loja precisa de mais unidades do que uma origem pode fornecer, o sistema **completa com outras origens** seguindo a ordem de prioridade:

**Exemplo:**
- Loja precisa de **5 unidades**
- Matriz tem **1 unidade** → Transfere 1 da matriz
- Loja parada tem **4 unidades** → Transfere 4 da loja parada
- **Resultado:** Loja recebe 5 unidades (1 da matriz + 4 da loja parada)

**Ordem de completar:**
1. Matriz (se ainda tiver estoque)
2. Lojas paradas (maior estoque primeiro)
3. Outras filiais

**Por quê?** Garante que a loja receba a quantidade necessária, mesmo que precise vir de múltiplas origens.

---

## 💰 Cálculo da Quantidade a Transferir

O sistema calcula exatamente quanto transferir:

### Quantidade Base:
```typescript
quantidade = min(quantidadeFaltante, estoqueOrigem - 1)
```

### Regras Especiais:

#### 1. Distribuição Proporcional (Múltiplas Lojas):
Quando há múltiplas lojas precisando do mesmo produto, o sistema divide proporcionalmente:

```typescript
Se múltiplas lojas precisam:
  - Calcula proporção baseada nas vendas
  - Divide estoque disponível proporcionalmente
  - Garante mínimo de 1 unidade para cada loja
```

**Exemplo:**
- Estoque disponível: 5 unidades
- Loja A vendeu 5, Loja B vendeu 3
- Loja A recebe: (5/8) × 5 = 3 unidades
- Loja B recebe: (3/8) × 5 = 2 unidades

**Por quê?** Evita que uma loja fique com todo o estoque, distribui de forma justa.

#### 2. Se a Origem também tem Vendas:

**Quando há distribuição proporcional (múltiplas lojas precisando):**
- A distribuição proporcional já garante justiça
- Lojas que vendem deixam apenas **1 unidade** (mínimo)
- Não calcula estoque mínimo baseado em vendas da origem
- **Por quê?** A distribuição proporcional prioriza as lojas que mais precisam, respeitando a hierarquia de vendas

**Quando há apenas uma loja precisando:**
- Lojas que vendem deixam pelo menos **1 unidade**
- Transfere o necessário para a loja destino

**Exemplo com distribuição proporcional:**
- Loja 1 (origem): 20 unidades, vendeu 5
- Loja 2 (destino): 0 unidades, vendeu 8 → **Prioridade 1**
- Loja 3 (destino): 0 unidades, vendeu 4 → **Prioridade 2**
- Estoque total disponível: 20 unidades
- **Total vendas de TODAS as lojas:** 5 + 8 + 4 = 17 unidades

**Distribuição proporcional (considerando TODAS as lojas):**
- Loja 1 deveria ter: (5/17) × 20 = 5.88 → **6 unidades** (fica com 6)
- Loja 2 deveria ter: (8/17) × 20 = 9.41 → **9 unidades** (recebe 9)
- Loja 3 deveria ter: (4/17) × 20 = 4.71 → **5 unidades** (recebe 5)

**Transferências:**
- Loja 1 transfere: 20 - 6 = **14 unidades**
- Loja 2 recebe: **9 unidades**
- Loja 3 recebe: **5 unidades**

**Por quê?** A distribuição considera TODAS as lojas que vendem (incluindo a origem). Quem vendeu mais recebe mais proporcionalmente. A loja 1 que vendeu 5 não fica com apenas 1 unidade, fica com 6 (proporcional às suas vendas).

#### 3. Se é Lojas Parada:
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

### Exemplo 1: Uma Loja Precisa

**Produto:** N5.16.0002 - PT BEEP HYDROGEL CLEAR (CLEAR)

**Situação:**
- MORUMBI: 25 unidades, sem vendas (parada)
- LEBLON: 0 unidades, vendeu 5 unidades

### Processo:

1. **Filtros:** ✅ Produto tem vendas, estoque total (25) ≥ 4 (2 filiais × 2)

2. **Lojas que precisam:**
   - LEBLON: 5 vendas, estoque 0 → **Única loja que precisa**

3. **Lojas com estoque:**
   - MORUMBI: 25 unidades, parada → **Prioridade 1** (loja parada)

4. **Cálculo de necessidade:**
   - LEBLON: vendeu 5 unidades → precisa de **5 unidades** (equivalente às vendas)

5. **Transferências:**
   - MORUMBI → LEBLON: 5 unidades

6. **Resultado:**
   - MORUMBI: 25 → 20 unidades (ficou com 20)
   - LEBLON: 0 → 5 unidades (recebeu equivalente às vendas)

---

### Exemplo 2: Múltiplas Lojas (Distribuição Proporcional)

**Produto:** N5.16.0002 - PT BEEP HYDROGEL CLEAR (CLEAR)

**Situação:**
- MORUMBI: 5 unidades, sem vendas (parada)
- LEBLON: 0 unidades, vendeu 5 unidades
- VILLA LOBOS: 0 unidades, vendeu 3 unidades

### Processo:

1. **Filtros:** ✅ Produto tem vendas, estoque total (5) ≥ 4 (2 filiais × 2)

2. **Lojas que precisam:**
   - LEBLON: 5 vendas, estoque 0
   - VILLA LOBOS: 3 vendas, estoque 0
   - **Total de vendas:** 8 unidades

3. **Lojas com estoque:**
   - MORUMBI: 5 unidades, parada → **Prioridade 1** (loja parada)

4. **Cálculo de necessidade (Distribuição Proporcional):**
   - Estoque disponível: 5 unidades
   - LEBLON: (5/8) × 5 = 3.125 → **3 unidades**
   - VILLA LOBOS: (3/8) × 5 = 1.875 → **2 unidades**

5. **Transferências:**
   - MORUMBI → LEBLON: 3 unidades
   - MORUMBI → VILLA LOBOS: 2 unidades

6. **Resultado:**
   - MORUMBI: 5 → 0 unidades (esvaziou)
   - LEBLON: 0 → 3 unidades (recebeu proporcionalmente)
   - VILLA LOBOS: 0 → 2 unidades (recebeu proporcionalmente)

**Por quê distribuição proporcional?** Evita que LEBLON (que vendeu mais) fique com todas as 5 unidades, garantindo que VILLA LOBOS também receba uma parte justa.

---

## 🎓 Conclusão

A página de Transferências automatiza a redistribuição de estoque de forma inteligente, priorizando:
- Lojas que vendem mas estão sem estoque
- Lojas paradas como origem
- Proteção de estoque mínimo
- Evitar desperdícios e duplicações
- **Distribuição proporcional** quando múltiplas lojas precisam
- **Lógica conservadora** para evitar estoques excessivos

### Princípios Fundamentais:

1. **Conservadorismo:** Não cria estoques muito maiores que as vendas, já que haverá transferências semanais
2. **Proporcionalidade:** Quando há múltiplas lojas, divide proporcionalmente baseado nas vendas
3. **Justiça:** Evita que uma loja fique com todo o estoque disponível
4. **Eficiência:** Transfere apenas o necessário, não tudo

O sistema garante que cada loja receba exatamente o que precisa, quando precisa, maximizando as vendas e otimizando o estoque de forma justa e eficiente.
