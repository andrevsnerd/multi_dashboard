# Script de Análise - Controle de Movimento

Este script analisa detalhadamente os KPIs de Controle de Movimento, mostrando:

1. **Entradas brutas na matriz** - Todas as entradas antes de remover devoluções
2. **Devoluções identificadas** - Produtos que retornaram de lojas
3. **Entradas líquidas** - Após remover devoluções
4. **Produtos únicos que entraram** - Agrupados por PRODUTO + COR
5. **Vendas dos produtos que entraram** - Apenas vendas dos produtos que entraram no período
6. **Resumo final dos KPIs** - Cálculos finais
7. **Produtos que entraram mas não venderam** - Itens parados

## Como usar

### Exemplo básico (mês atual, SCARFME)
```bash
python analisar_controle_movimento.py
```

### Exemplo com período específico
```bash
python analisar_controle_movimento.py --company scarfme --start 2025-01-01 --end 2025-01-31
```

### Exemplo com filial específica
```bash
python analisar_controle_movimento.py --company scarfme --filial "MORUMBI - JJJ"
```

### Exemplo com linhas específicas (SCARFME)
```bash
python analisar_controle_movimento.py --company scarfme --linhas PASHMINA LENÇOS
```

### Exemplo com grupos (NERD)
```bash
python analisar_controle_movimento.py --company nerd --grupos CAMISETAS CALÇAS
```

### Exemplo completo
```bash
python analisar_controle_movimento.py \
  --company scarfme \
  --start 2025-01-01 \
  --end 2025-01-31 \
  --filial "MORUMBI - JJJ" \
  --linhas PASHMINA LENÇOS
```

## Parâmetros

- `--company`: Empresa (`scarfme` ou `nerd`) - padrão: `scarfme`
- `--start`: Data inicial no formato `YYYY-MM-DD` - padrão: início do mês atual
- `--end`: Data final no formato `YYYY-MM-DD` - padrão: início do próximo mês
- `--filial`: Filial específica para filtrar vendas
- `--linhas`: Lista de linhas (apenas SCARFME)
- `--grupos`: Lista de grupos (apenas NERD)

## O que o script mostra

### 1. Entradas na Matriz (antes de remover devoluções)
- Total de registros de entrada
- Quantidade total
- Custo total

### 2. Devoluções Identificadas
- Produtos que entraram na matriz mas tiveram saída correspondente em lojas na mesma data
- Lista das devoluções encontradas

### 3. Entradas Líquidas
- Entradas após remover devoluções
- Quantidade e custo líquidos

### 4. Produtos Únicos que Entraram
- Agrupados por PRODUTO + COR_PRODUTO
- Lista dos produtos que entraram

### 5. Vendas dos Produtos que Entraram
- Apenas vendas de produtos que entraram no período
- Considera trocas e cancelamentos
- Top 20 produtos mais vendidos

### 6. Resumo Final dos KPIs
- **Entradas do Período**: Quantidade e custo
- **Vendidos**: Quantidade e valor
- **Itens Parados**: Quantidade e custo
- **Taxa de Venda**: Percentual vendido

### 7. Produtos que Entraram mas Não Venderam
- Lista de produtos parados
- Quantidade e custo parados

## Lógica Aplicada

O script segue a mesma lógica do repositório TypeScript:

1. **Apenas entradas na matriz**: 
   - SCARFME: `SCARF ME - MATRIZ`
   - NERD: `NERD`

2. **Remove devoluções**: 
   - Produtos que entraram na matriz mas tiveram saída correspondente em lojas na mesma data
   - Mesmo PRODUTO + COR_PRODUTO

3. **Vendas relacionadas**: 
   - Apenas vendas de produtos que entraram no período
   - Considera trocas e cancelamentos

4. **Itens parados**: 
   - Entradas - Vendidos
   - Custo calculado pelo custo médio das entradas

## Dependências

- `pandas`
- `pyodbc`

Instalar com:
```bash
pip install pandas pyodbc
```
