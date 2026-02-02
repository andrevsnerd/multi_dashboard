# Guia: Página de Transferências

## 📋 O que é esta página

A página de **Controle de Transferências** mostra quais produtos devem ser transferidos de uma filial para outra: de lojas com estoque disponível para lojas que estão vendendo mas estão sem estoque. As sugestões são calculadas automaticamente.

---

## 📅 Período usado: últimos 30 dias

**A página sempre usa os últimos 30 dias** (contando de hoje para trás) para decidir:

- Quais lojas **venderam** e precisam de estoque  
- Quais lojas estão **paradas** (sem vendas nesses 30 dias) e podem ceder estoque  
- Quanto transferir, com base nas vendas desse período  

Não há opção para mudar o período: é sempre **últimos 30 dias**. Assim o resultado fica estável mesmo quando troca o mês.

---

## 🎯 Para que serve

Ajuda a redistribuir estoque de forma inteligente:

- Atender lojas que vendem mas estão sem estoque  
- Priorizar lojas paradas (com estoque e sem vendas) como origem  
- Evitar que a mesma loja receba o mesmo produto de várias origens  
- Transferir só o necessário, não tudo  

---

## 🔍 Quando um produto entra na lista

Antes de sugerir transferências, o sistema verifica:

### 1. O produto precisa ter vendas

Se ninguém vendeu esse produto nos últimos 30 dias, ele **não aparece** na lista. Produto sem venda não precisa de transferência.

### 2. Condição básica

O produto só entra se:

- Alguma filial **com vendas** está com estoque zerado ou negativo  
- E existe estoque em outras filiais (pelo menos 1 unidade)  

**Exemplo:**  
- Loja A: vendeu 3 unidades, estoque 0  
- Loja B: vendeu 1 unidade, estoque 3 unidades  
- → **Pode transferir** (Loja B tem estoque disponível)  

**Regras de quem pode ceder estoque:**  
- Se a loja **também vende**: precisa ter pelo menos **2 unidades** (para deixar 1 na origem)  
- Se a loja **não vende** (loja parada): pode ceder mesmo tendo só **1 unidade**  

Assim não zeramos lojas que também vendem.

---

## 🏪 Quem precisa receber

O sistema considera que uma filial **precisa receber** quando:

- Teve vendas nos últimos 30 dias  
- Estoque está zerado ou negativo (estoque negativo é tratado como zero)  

**Ordem de prioridade (quem aparece primeiro):**  
1. Quem **vendeu mais**  
2. Em empate, quem tem **menos estoque**  

**Exemplo:**  
- LEBLON: vendeu 10, estoque 0 → prioridade 1  
- VILLA LOBOS: vendeu 5, estoque 0 → prioridade 2  

Assim atendemos primeiro quem tem mais demanda.

---

## 📦 Quem pode ser origem (ceder estoque)

Uma filial pode ser origem quando:

- **Se também vende:** tem pelo menos 2 unidades (para deixar 1)  
- **Se não vende (loja parada):** tem pelo menos 1 unidade  

### Lojas paradas (marcadas em laranja)

Uma loja é considerada **parada** quando:

- Tem estoque (pelo menos 1 unidade)  
- **Não** teve vendas nos últimos 30 dias  
- A **última entrada** de estoque nessa filial foi há **pelo menos 14 dias** (ou não há registro de última entrada)  

Ou seja: além de não vender, o estoque precisa estar “parado” há pelo menos 14 dias (sem entrada recente). Assim evitamos tratar como parada uma loja que acabou de receber mercadoria. Se não houver data de última entrada no sistema, a loja pode ser considerada parada.

Essas lojas são priorizadas como origem, pois o estoque não está saindo por venda.

### Ordem de prioridade da origem

1. **Matriz** — sempre primeiro (estoque principal da empresa)  
2. **Lojas paradas e e-commerce parado** — entre elas, a com **maior estoque** primeiro  
3. **Outras filiais** — ordenadas por maior estoque  

**Exemplo:**  
- Matriz: 50 unidades → prioridade 1  
- LEBLON (parada): 30 unidades → prioridade 2  
- VILLA LOBOS (parada): 15 unidades → prioridade 3  
- CENTER NORTE (com vendas): 20 unidades → prioridade 4  

---

## 🚫 Evitar duplicidade

O sistema garante que **a mesma loja destino não receba o mesmo produto de várias origens em excesso**.  
Para cada produto e cada loja que precisa, ele controla quanto já foi “reservado” para aquele destino e só sugere novas origens até completar o necessário.  
Assim cada loja recebe o que precisa, sem sobra desnecessária.

**Exemplo:**  
- LEBLON precisa de 15 unidades  
- MORUMBI já foi indicada para enviar 15 para LEBLON  
- → VILLA LOBOS **não** é indicada a enviar mais para LEBLON (já está atendido)  

---

## 📊 Quanto cada loja precisa

O sistema não cria estoque excessivo; a lógica é conservadora, pois haverá transferências regulares.

### Uma única loja precisa

- Calcula um estoque mínimo com base nas vendas dos últimos 30 dias  
- Sugere pelo menos o suficiente para cobrir essa necessidade (mínimo 2 unidades)  

**Exemplo:**  
- LEBLON vendeu 5 unidades nos últimos 30 dias, estoque 0  
- O sistema sugere enviar **5 unidades** para LEBLON  

### Várias lojas precisam do mesmo produto

O estoque disponível é **dividido de forma proporcional** às vendas de cada uma:

- Soma as vendas de todas as lojas que precisam  
- Cada uma recebe uma parte proporcional às suas vendas  
- Nenhuma fica com zero se houver estoque para distribuir  

**Exemplo:**  
- Estoque disponível: 5 unidades  
- Loja A vendeu 5, Loja B vendeu 3 (total 8)  
- Loja A recebe: 3 unidades  
- Loja B recebe: 2 unidades  

Assim a distribuição fica justa.

---

## 🎯 De onde sai cada transferência

A ordem de escolha da origem é:

1. **Matriz** — se tiver pelo menos 1 unidade, usa primeiro  
2. **Lojas paradas** — entre elas, a com **maior estoque**  
3. **Outras filiais** com estoque disponível  

Se uma loja precisa de mais do que uma origem pode fornecer, o sistema **completa com outras origens** nessa mesma ordem.

**Exemplo:**  
- Loja precisa de 5 unidades  
- Matriz tem 1 → sugere 1 da matriz  
- Loja parada tem 4 → sugere 4 da loja parada  
- **Resultado:** 5 unidades no total (1 + 4)  

---

## 💰 Quantidade a transferir

- **Lojas que também vendem:** deixam pelo menos 1 unidade na origem; o resto pode ser transferido  
- **Lojas paradas (há 14+ dias):** podem ceder até o necessário; em casos de poucas unidades e necessidade real, o sistema pode sugerir enviar tudo  
- **Lojas com estoque mas que entraram há menos de 14 dias:** mesmo sem vendas, deixam pelo menos 1 unidade (só são tratadas como “paradas” e podem ceder tudo depois de 14 dias da última entrada)  
- **Distribuição proporcional:** quando várias lojas precisam, as quantidades são divididas conforme as vendas de cada uma (incluindo origens que vendem), para que ninguém fique com estoque desproporcional  

---

## 📊 Como a tela está organizada

As sugestões aparecem **agrupadas por filial de origem** e, dentro de cada origem, **por filial de destino**:

- Cada bloco é uma filial de origem (ex.: MORUMBI, LEBLON)  
- Dentro do bloco, as linhas estão agrupadas por “Transferir para” (filial destino)  
- Em cada grupo: produto, descrição, cor, quantidade a transferir  
- No topo do bloco: total de itens e de unidades  
- Você pode filtrar para ver só as transferências de **uma filial** (dropdown “Filial de Origem”)  

### Recursos da tela

- **Exportar PDF:** o botão “Exportar PDF” gera um documento com todas as sugestões da tela (respeitando o filtro de filial). As linhas marcadas como “Realizada” aparecem em destaque no PDF.  
- **Marcar como Realizada:** cada linha tem um campo para marcar que aquela transferência **já foi feita** (ainda pendente de atualização no sistema). As linhas marcadas ficam em destaque e são salvas para você. Use para acompanhar o que já saiu.  

Em algumas empresas podem aparecer colunas adicionais (código de barras, subgrupo, grade).  

---

## 🖱️ Detalhes ao passar o mouse

Ao passar o mouse na descrição do produto, aparece um resumo com:

- Nome do produto, código e cor  
- Estoque por filial  
- Vendas por filial (últimos 30 dias)  
- **Dias parado:** para lojas com estoque e sem vendas  
  - Se não vendeu no período nem nos últimos 30 dias: **30+ dias**  
  - Se vendeu nos últimos 30 dias mas não no período exibido: mostra os dias do período  
  - Só aparece para lojas que estão paradas  

---

## 📋 Resumo do fluxo

1. O sistema usa sempre os **últimos 30 dias** para vendas e prioridades  
2. Filtra produtos que têm vendas e estoque suficiente no total  
3. Identifica lojas que **precisam** (vendem e estão sem estoque)  
4. Identifica lojas que **podem ceder** (com estoque disponível)  
5. Prioriza matriz e depois lojas paradas como origem  
6. Calcula quanto cada destino precisa (e distribui proporcionalmente se várias precisam)  
7. Evita duplicidade (não manda demais para o mesmo destino)  
8. Agrupa e exibe por filial de origem  

---

## ✅ O que o sistema garante

- **Sem duplicidade:** cada produto não é enviado em excesso para a mesma loja destino  
- **Só o necessário:** as quantidades seguem a necessidade calculada  
- **Lojas paradas primeiro:** como origem, para esvaziar estoque parado  
- **Proteção da origem:** lojas que vendem não ficam com estoque zerado  
- **Várias lojas podem receber:** cada uma na medida do que precisa  

---

## 🎓 Em resumo

A página de **Controle de Transferências** usa sempre os **últimos 30 dias** para sugerir de onde e para onde transferir, priorizando:

- Lojas que vendem mas estão sem estoque  
- Lojas paradas como origem  
- Proteção de estoque mínimo nas origens que vendem  
- Distribuição proporcional quando várias lojas precisam  
- Sem excessos nem duplicidade  

Assim cada loja recebe o que precisa, quando precisa, de forma clara e organizada.
