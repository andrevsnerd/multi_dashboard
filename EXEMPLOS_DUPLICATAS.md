# Exemplos Concretos de Duplicatas

## O PROBLEMA EM PALAVRAS SIMPLES

**Um mesmo item de nota aparece VÁRIAS VEZES na planilha porque o cliente tem múltiplos registros na tabela CLIENTES_VAREJO.**

---

## EXEMPLO CONCRETO

### Nota: 000001181, Série: 13, Item: 000001

**O que DEVERIA aparecer (1 linha):**
```
NF_SAIDA    | SERIE_NF | ITEM   | PRODUTO    | QTDE | VALOR_LIQUIDO | CLIENTE
000001181   | 13       | 000001 | 28.Q1.00Q3 | 1    | 0.01          | RAFAEL OLIVEIRA
```

**O que REALMENTE aparece na query do Python (4 linhas):**
```
NF_SAIDA    | SERIE_NF | ITEM   | PRODUTO    | QTDE | VALOR_LIQUIDO | CLIENTE          | UF
000001181   | 13       | 000001 | 28.Q1.00Q3 | 1    | 0.01          | RAFAEL OLIVEIRA  | SP
000001181   | 13       | 000001 | 28.Q1.00Q3 | 1    | 0.01          | RAFAEL OLIVEIRA  | SP
000001181   | 13       | 000001 | 28.Q1.00Q3 | 1    | 0.01          | RAFAEL OLIVEIRA  | SP
000001181   | 13       | 000001 | 28.Q1.00Q3 | 1    | 0.01          | RAFAEL OLIVEIRA  | SP
```

**Resultado:**
- ✅ **Correto:** VALOR_LIQUIDO = 0.01 (contado 1 vez)
- ❌ **Errado:** VALOR_LIQUIDO = 0.04 (contado 4 vezes: 0.01 x 4)

---

## POR QUE ISSO ACONTECE?

### 1. A tabela CLIENTES_VAREJO tem duplicatas

O cliente "RAFAEL OLIVEIRA" tem **4 registros** na tabela `CLIENTES_VAREJO`:
- Todos com a mesma UF (SP)
- Mas são registros diferentes (talvez com datas diferentes, IDs diferentes, etc.)

### 2. O LEFT JOIN multiplica as linhas

Quando fazemos:
```sql
LEFT JOIN CLIENTES_VAREJO cv ON f.NOME_CLIFOR = cv.CLIENTE_VAREJO
```

**O que acontece:**
- 1 item de nota (NF_SAIDA + SERIE_NF + ITEM)
- 4 registros em CLIENTES_VAREJO para o mesmo cliente
- **Resultado:** 1 x 4 = **4 linhas na query!**

---

## EXEMPLOS DE IMPACTO

### Top 10 itens mais afetados:

| Nota      | Item   | Cliente              | Valor Correto | Vezes | Valor Errado (Somado) |
|-----------|--------|----------------------|---------------|-------|----------------------|
| 000001490 | 000001 | ALESSANDRA OLIVEIRA  | 423.30        | 7x    | 2,963.10             |
| 000001389 | 000001 | PATRICIA CARVALHO    | 414.80        | 7x    | 2,903.60             |
| 000001769 | 000001 | PATRICIA CARVALHO    | 368.00        | 7x    | 2,576.00             |
| 000001361 | 000001 | MARIA RIBEIRO        | 139.30        | 6x    | 835.80               |
| 000001811 | 000001 | MARIA ALMEIDA        | 553.50        | 5x    | 2,767.50             |

**Veja:** Um item de 423.30 vira 2,963.10 quando somado errado!

---

## IMPACTO TOTAL

- **Total de itens afetados:** 97 itens
- **Valor CORRETO (sem duplicatas):** 26,761.15
- **Valor ERRADO (com duplicatas):** 72,577.41
- **Erro total:** 45,816.26

---

## COMO FUNCIONA O LEFT JOIN

### Cenário Normal (sem duplicatas):
```
FATURAMENTO          CLIENTES_VAREJO
-----------          ---------------
Item 1 → Cliente A   Cliente A (1 registro)
                     
Resultado: 1 linha ✅
```

### Cenário com Duplicatas:
```
FATURAMENTO          CLIENTES_VAREJO
-----------          ---------------
Item 1 → Cliente A   Cliente A (registro 1)
                     Cliente A (registro 2)
                     Cliente A (registro 3)
                     Cliente A (registro 4)
                     
Resultado: 4 linhas ❌ (mesmo item contado 4 vezes!)
```

---

## SOLUÇÃO

### Opção 1: Remover duplicatas no Python
```python
def processar_ecommerce(df):
    df = converter_datas(df, ['EMISSAO', 'DATA_SAIDA', 'ENTREGA'])
    # Remover duplicatas: manter apenas 1 linha por NF_SAIDA + SERIE_NF + ITEM
    df = df.drop_duplicates(subset=['NF_SAIDA', 'SERIE_NF', 'ITEM'])
    salvar_relatorio(df, 'ecommerce', 'Ecommerce')
```

### Opção 2: Corrigir a query SQL
Usar DISTINCT ou subquery para pegar apenas 1 registro de CLIENTES_VAREJO por cliente.

### Opção 3: Usar a query do sistema TypeScript
A query do sistema **NÃO tem esse problema** porque não faz LEFT JOIN com CLIENTES_VAREJO.

---

## CONCLUSÃO

**As duplicatas são:**
- O mesmo item de nota aparecendo múltiplas vezes
- Causadas pelo LEFT JOIN com CLIENTES_VAREJO
- Que inflam os valores totais

**Exemplo prático:**
- Item de 100.00 aparece 4 vezes
- Soma errada: 400.00
- Soma correta: 100.00

