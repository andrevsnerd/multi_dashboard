# INVESTIGAÇÃO: PADRÃO DE ROMANEIOS NO LINX

## 📊 DESCOBERTAS

### 1. **Padrão de Romaneios de SAÍDA (ESTOQUE_PROD_SAI)**
- ✅ **Formato**: Numérico de 6 dígitos (ex: `028964`, `016030`, `028833`)
- ✅ **Sequência**: Controlada por `SEQUENCIAIS` → `ESTOQUE_PROD_SAI.ROMANEIO_PRODUTO`
- ✅ **Atual**: `028964` (gerado pelo nosso script)

### 2. **Padrão de Romaneios de ENTRADA (ESTOQUE_PROD_ENT)**
- ⚠️ **Dois padrões diferentes encontrados**:
  
  **Padrão A (mais comum)**: `T` + 6 dígitos
  - Exemplos: `T016030`, `T016011`, `T016004`
  - Formato: 7 caracteres
  - Sequência: Controlada por `SEQUENCIAIS` → `ESTOQUE_PROD_ENT.ROMANEIO_PRODUTO`
  
  **Padrão B (gerado pela stored procedure)**: `A01` + 5 dígitos
  - Exemplo: `A0119739` (gerado para nosso romaneio `028964`)
  - Formato: 8 caracteres
  - **Possível origem**: `LOJA_ENTRADAS.ROMANEIO_PRODUTO` ou lógica específica da stored procedure

### 3. **Tabela SEQUENCIAIS - Controle de Numeração**

```
ESTOQUE_PROD_SAI.ROMANEIO_PRODUTO  →  028964  (6 dígitos numéricos)
ESTOQUE_PROD_ENT.ROMANEIO_PRODUTO  →  028836  (6 dígitos numéricos)
LOJA_ENTRADAS.ROMANEIO_PRODUTO     →  R0000139 (formato alfanumérico)
```

## ⚠️ PROBLEMA IDENTIFICADO

O romaneio de entrada `A0119739` gerado pela stored procedure `LX_GERA_TRANSFERENCIA_AUTOMATICA` **NÃO segue o padrão esperado** de `T` + número.

### Possíveis causas:
1. A stored procedure pode estar usando `LOJA_ENTRADAS.ROMANEIO_PRODUTO` ao invés de `ESTOQUE_PROD_ENT.ROMANEIO_PRODUTO`
2. Pode haver uma lógica específica na stored procedure que gera romaneios com prefixo "A01" para certas condições
3. Pode ser um padrão específico para transferências automáticas vs. manuais

## 🔍 PRÓXIMOS PASSOS

1. **Investigar a stored procedure** para entender a lógica de geração do romaneio `A0119739`
2. **Verificar se há controle** sobre qual sequência usar (ESTOQUE_PROD_ENT vs LOJA_ENTRADAS)
3. **Avaliar se o padrão "A01..." é aceitável** ou se devemos forçar o padrão "T..."

## 💡 RECOMENDAÇÃO

O romaneio `028964` que geramos está **correto** (seguindo o padrão numérico de 6 dígitos).

O romaneio de entrada `A0119739` gerado pela stored procedure está **diferente do padrão comum**, mas pode ser o comportamento esperado da stored procedure para transferências automáticas.

**Pergunta**: O formato `A0119739` é aceitável no sistema LINX, ou devemos investigar como forçar o padrão `T028964`?
