# Log Detalhado de Entradas de Estoque

Este script gera um log detalhado mostrando **exatamente** como as entradas de estoque são calculadas, com exemplos reais de registros do banco de dados.

## O que o script faz?

O script analisa e mostra:

1. **Estoque Atual**: Estoque atual por produto+cor (soma de todas as filiais)
2. **Entradas da Semana**: Todas as entradas dos últimos 7 dias, com detalhes de cada romaneio
3. **Entradas da Semana Passada**: Entradas do período de 7-14 dias atrás
4. **Vendas da Semana**: Vendas dos últimos 7 dias
5. **E-commerce da Semana**: Vendas e-commerce dos últimos 7 dias
6. **Cálculo do Estoque Semana Passada**: Mostra a fórmula e o cálculo passo a passo
7. **Exemplo Detalhado**: Para um produto específico, mostra todos os cálculos com números reais
8. **Resumo Geral**: Totais e estatísticas

## Como funciona o cálculo?

### Entradas na Semana
As entradas são buscadas da tabela `ESTOQUE_PROD_ENT` e `ESTOQUE_PROD1_ENT` onde:
- `E.EMISSAO >= data_7_dias_atras` (últimos 7 dias)
- Agrupadas por `PRODUTO + COR_PRODUTO`
- Soma de todas as quantidades (`QTDE`)

### Estoque Semana Passada
O estoque da semana passada é calculado usando a fórmula reversa:

```
Estoque Semana Passada = Estoque Atual - Entradas (7 dias) + Vendas (7 dias) + E-commerce (7 dias)
```

**Por quê?** Porque se hoje temos X unidades e entraram Y unidades na semana, então semana passada tínhamos X - Y unidades (desconsiderando vendas).

Mas como também houve vendas e e-commerce, precisamos "voltar" essas vendas ao estoque:
- Se venderam Z unidades, então semana passada tínhamos Z unidades a mais
- Se venderam W unidades no e-commerce, então semana passada tínhamos W unidades a mais

### Diferença Semanal
A diferença semanal mostra se o estoque aumentou ou diminuiu:

```
Diferença Semanal = Estoque Atual - Estoque Semana Passada
```

Se positivo (+1.562), significa que o estoque aumentou em 1.562 unidades na semana.
Se negativo, significa que o estoque diminuiu.

## Como usar?

### Opção 1: Analisar um produto específico
```bash
python log_entradas_estoque.py
# Escolha opção 1
# Digite: PASHMINA (ou parte do nome)
```

### Opção 2: Analisar uma linha inteira
```bash
python log_entradas_estoque.py
# Escolha opção 2
# Digite: PASHMINA
```

### Opção 3: Analisar todos os produtos
```bash
python log_entradas_estoque.py
# Escolha opção 3
```

## Exemplo de Saída

Para o produto PASHMINA, você verá algo como:

```
[2] ENTRADAS DA SEMANA (Últimos 7 dias)
  Período: 15/01/2025 até 22/01/2025
  ✓ 45 registros de entrada encontrados
  ✓ Total de entradas na semana: 1.562 unidades
  ✓ 12 produtos únicos com entradas

  [DETALHAMENTO POR PRODUTO+COR]
    • PASHMINA | BEGE:
        Total: 450 unidades em 3 romaneio(s)
          - Romaneio 12345 | 20/01/2025 | Filial: MATRIZ | Qtd: 200
          - Romaneio 12346 | 19/01/2025 | Filial: MATRIZ | Qtd: 150
          - Romaneio 12347 | 18/01/2025 | Filial: LOJA 1 | Qtd: 100
    • PASHMINA | PRETO:
        Total: 1.112 unidades em 5 romaneio(s)
        ...

[6] CÁLCULO DO ESTOQUE DA SEMANA PASSADA
  Fórmula: Estoque Semana Passada = Estoque Atual - Entradas (7 dias) + Vendas (7 dias) + E-commerce (7 dias)

  [RESUMO POR PRODUTO+COR]
  Produto                                          Cor                  Estoque Atual   Entradas Semana  Entradas Sem Pass    Estoque Sem Pass        Diferença
  -------------------------------------------------- -------------------- --------------- ------------------ -------------------- ------------------ ------------
  PASHMINA                                         BEGE                         4.102              450                  320                3.972              +130
  PASHMINA                                         PRETO                        2.540              1.112                  890                2.518               +22

[7] EXEMPLO DETALHADO - PRIMEIRO PRODUTO COM MAIOR ESTOQUE
  Produto: PASHMINA
  Cor: BEGE
  Código Produto: 12345
  Código Cor: 01

  [CÁLCULOS]
    Estoque Atual: 4.102 unidades
    Entradas na Semana (últimos 7 dias): 450 unidades
    Vendas na Semana (últimos 7 dias): 280 unidades
    E-commerce na Semana (últimos 7 dias): 0 unidades

    Estoque Semana Passada = Estoque Atual - Entradas + Vendas + E-commerce
    Estoque Semana Passada = 4.102 - 450 + 280 + 0
    Estoque Semana Passada = 3.932 unidades

    Diferença Semanal = Estoque Atual - Estoque Semana Passada
    Diferença Semanal = 4.102 - 3.932
    Diferença Semanal = +170 unidades
```

## Entendendo o resultado

No exemplo acima para PASHMINA BEGE:
- **Estoque Atual**: 4.102 unidades
- **Entradas na Semana**: 450 unidades (entraram 450 unidades nos últimos 7 dias)
- **Estoque Semana Passada**: 3.932 unidades (calculado: 4.102 - 450 + 280)
- **Diferença Semanal**: +170 unidades (o estoque aumentou 170 unidades na semana)

Isso significa que:
- Semana passada havia 3.932 unidades
- Entraram 450 unidades
- Foram vendidas 280 unidades
- Resultado: 3.932 + 450 - 280 = 4.102 unidades (estoque atual)

## Tabelas do Banco de Dados Utilizadas

- `ESTOQUE_PRODUTOS`: Estoque atual por produto+cor+filial
- `ESTOQUE_PROD_ENT`: Cabeçalho dos romaneios de entrada
- `ESTOQUE_PROD1_ENT`: Itens dos romaneios de entrada (produto, cor, quantidade)
- `LOJA_VENDA_PRODUTO`: Vendas de loja física
- `FATURAMENTO` + `W_FATURAMENTO_PROD_02`: Vendas e-commerce
- `PRODUTOS`: Dados dos produtos
- `CORES_BASICAS`: Descrição das cores
- `FILIAIS`: Dados das filiais

## Observações Importantes

1. **Agrupamento**: Os cálculos são feitos agrupando por `PRODUTO + COR_PRODUTO`, somando todas as filiais
2. **Período**: "Semana" = últimos 7 dias corridos (não semana calendário)
3. **Semana Passada**: Período de 7-14 dias atrás (não a semana anterior completa)
4. **Filtros**: O script respeita os mesmos filtros usados no dashboard (filial, linha, grupo, etc.)
