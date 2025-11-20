# Scripts de Teste e Investigação

Este diretório contém scripts Python para investigar a diferença entre os valores do sistema e da planilha CSV.

## Scripts Disponíveis

### 1. `test_ecommerce_investigation.py`
**Objetivo**: Testa a query exata do script de exportação e compara com diferentes variações.

**O que faz**:
- Testa a query EXATA do `exportar_todos_relatorios.py`
- Testa a query do sistema (com `<` em vez de `<=`)
- Analisa registros do dia 20 que podem estar sendo excluídos
- Compara diferentes colunas de valor (VALOR_LIQUIDO, VALOR, etc.)
- Verifica variações do nome da filial (espaços em branco)

**Como executar**:
```bash
python test_ecommerce_investigation.py
```

### 2. `test_compare_with_csv.py`
**Objetivo**: Compara diretamente os dados do banco com a planilha CSV exportada.

**O que faz**:
- Busca dados do banco com os mesmos filtros da planilha
- Carrega e filtra o CSV `ecommerce.csv`
- Compara registros, valores e quantidades
- Identifica notas que estão apenas no CSV ou apenas no banco
- Analisa diferenças por data

**Como executar**:
```bash
python test_compare_with_csv.py
```

**Nota**: O script procura o CSV em vários locais:
- `data/ecommerce.csv`
- `../data/ecommerce.csv`
- `./ecommerce.csv`
- `ecommerce.csv`

### 3. `test_deep_analysis.py`
**Objetivo**: Análise profunda para encontrar problemas específicos.

**O que faz**:
- Verifica duplicatas
- Verifica problemas com JOINs
- Analisa variações do nome da filial
- Analisa diferenças por nota fiscal
- Verifica registros especiais (QTDE = 0, VALOR_LIQUIDO NULL, etc.)

**Como executar**:
```bash
python test_deep_analysis.py
```

## Requisitos

```bash
pip install pandas pyodbc
```

## Filtros Aplicados

Todos os scripts usam os mesmos filtros que a planilha:
- **FILIAL**: `SCARFME MATRIZ CMS`
- **EMISSAO**: `2025-11-01` até `2025-11-20` (inclusive)
- **NATUREZA_SAIDA**: `'100.02'` ou `'100.022'`
- **NOTA_CANCELADA**: `0`

## Valores Esperados

- **VALOR_LIQUIDO**: `400,056.09`
- **QTDE**: `1,845`

## Interpretação dos Resultados

### Se a diferença for no filtro de data:
- O sistema pode estar usando `< @endDate` em vez de `<= @endDate`
- Solução: Alterar para usar `CAST(f.EMISSAO AS DATE) <= CAST(@endDate AS DATE)`

### Se a diferença for no nome da filial:
- Pode haver espaços em branco no final do nome
- Solução: Usar `LTRIM(RTRIM(f.FILIAL))` no JOIN e no filtro

### Se a diferença for na coluna de valor:
- A planilha pode estar usando `VALOR` em vez de `VALOR_LIQUIDO`
- Solução: Verificar qual coluna a planilha realmente usa

### Se houver registros duplicados:
- Pode haver problema no JOIN
- Solução: Verificar a lógica do JOIN

## Próximos Passos

1. Execute `test_ecommerce_investigation.py` primeiro para ter uma visão geral
2. Se tiver acesso ao CSV, execute `test_compare_with_csv.py` para comparação direta
3. Execute `test_deep_analysis.py` para análise detalhada
4. Use os resultados para identificar a causa exata
5. Corrija o código TypeScript com base nos resultados

