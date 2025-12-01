# 🔍 Análise de Divergências: Script Python vs Sistema

## 📊 Comparação Detalhada

### 1️⃣ **FILTRO DE FILIAL**

**Script Python:**
```sql
AND LTRIM(RTRIM(CAST({col_filial} AS VARCHAR))) = 'NERD MORUMBI RDRRRJ'
```
- Remove espaços antes e depois
- Comparação exata com string literal

**Meu Sistema:**
```sql
AND cv.FILIAL = @filial
```
- Usa parâmetro `@filial`
- **PROBLEMA:** Pode não funcionar se houver espaços extras no banco

**✅ CORREÇÃO NECESSÁRIA:**
```sql
AND LTRIM(RTRIM(CAST(cv.FILIAL AS VARCHAR))) = LTRIM(RTRIM(CAST(@filial AS VARCHAR)))
```

---

### 2️⃣ **FILTRO DE PERÍODO**

**Script Python:**
```sql
WHERE 
    YEAR({col_data}) >= 2025
    AND (YEAR({col_data}) > 2025 OR (YEAR({col_data}) = 2025 AND MONTH({col_data}) >= 11))
```
- Busca: **Novembro 2025 até a data mais recente disponível**
- Lógica: Ano >= 2025, mas se for 2025, só mês >= 11

**Meu Sistema:**
```sql
WHERE CAST(cv.CADASTRAMENTO AS DATE) >= CAST(@startDate AS DATE)
  AND CAST(cv.CADASTRAMENTO AS DATE) < CAST(@endDate AS DATE)
```
- Busca: **Período específico selecionado pelo usuário** (ex: 01/11 a 27/11)
- **DIFERENÇA:** O script busca "novembro até hoje", meu sistema busca período fixo

**⚠️ ISSO NÃO É UM ERRO, É DIFERENTE:**
- O script Python busca um período dinâmico (novembro até hoje)
- Meu sistema busca o período que o usuário seleciona no filtro
- Se o usuário seleciona 01/11 a 27/11, só busca esse período

---

### 3️⃣ **ORDENAÇÃO**

**Script Python:**
```sql
ORDER BY {col_data}, CLIENTE_VAREJO
```
- **ASC** (crescente): Mais antigo primeiro
- Ordena por data, depois por nome do cliente

**Meu Sistema:**
```sql
ORDER BY cv.CADASTRAMENTO DESC, cv.CLIENTE_VAREJO
```
- **DESC** (decrescente): Mais recente primeiro
- Ordena por data (mais recente), depois por nome do cliente

**✅ CORREÇÃO NECESSÁRIA:** Mudar para ASC para corresponder ao script

---

### 4️⃣ **VENDEDOR**

**Script Python:**
```sql
SELECT {col_vendedor} AS VENDEDOR
FROM CLIENTES_VAREJO
-- NÃO FAZ JOIN com LOJA_VENDEDORES
```
- Usa apenas `cv.VENDEDOR` (código do vendedor)
- Não busca nome completo

**Meu Sistema:**
```sql
LEFT JOIN LOJA_VENDEDORES lv
  ON LTRIM(RTRIM(CAST(cv.VENDEDOR AS VARCHAR))) = LTRIM(RTRIM(CAST(lv.VENDEDOR AS VARCHAR)))
SELECT ISNULL(lv.VENDEDOR_APELIDO, ISNULL(lv.NOME_VENDEDOR, cv.VENDEDOR)) AS vendedor
```
- Faz JOIN com `LOJA_VENDEDORES`
- Usa prioridade: `VENDEDOR_APELIDO` > `NOME_VENDEDOR` > `VENDEDOR`
- **DIFERENÇA:** Meu sistema mostra nome completo, script mostra código

**⚠️ ISSO PODE SER INTENCIONAL:**
- Meu sistema é melhor (mostra nome completo)
- Mas pode divergir se o script espera código

---

### 5️⃣ **CAMPOS SELECIONADOS**

**Script Python:**
```sql
SELECT 
    {col_data} AS DATA_CADASTRO,
    CLIENTE_VAREJO AS NOME_CLIENTE,
    CASE WHEN DDD IS NOT NULL AND TELEFONE IS NOT NULL 
         THEN DDD + ' ' + TELEFONE 
         ELSE ISNULL(TELEFONE, '') END AS TELEFONE,
    CASE WHEN DDD_CELULAR IS NOT NULL AND CELULAR IS NOT NULL 
         THEN DDD_CELULAR + ' ' + CELULAR 
         ELSE ISNULL(CELULAR, '') END AS CELULAR,
    ISNULL(EMAIL, '') AS EMAIL,
    ISNULL(CPF_CGC, '') AS CPF_CNPJ,
    {col_vendedor} AS VENDEDOR,
    {col_filial} AS FILIAL
```

**Meu Sistema:**
```sql
SELECT 
    CAST(cv.CADASTRAMENTO AS DATE) AS data,
    ISNULL(cv.CLIENTE_VAREJO, 'SEM NOME') AS nomeCliente,
    CASE WHEN cv.DDD IS NOT NULL AND cv.TELEFONE IS NOT NULL 
         THEN cv.DDD + ' ' + cv.TELEFONE 
         ELSE ISNULL(cv.TELEFONE, '') END AS telefone,
    ISNULL(cv.CPF_CGC, '') AS cpf,
    ISNULL(cv.ENDERECO, '') AS endereco,
    ISNULL(cv.COMPLEMENTO, '') AS complemento,
    ISNULL(cv.BAIRRO, '') AS bairro,
    ISNULL(cv.CIDADE, '') AS cidade,
    ISNULL(lv.VENDEDOR_APELIDO, ISNULL(lv.NOME_VENDEDOR, cv.VENDEDOR)) AS vendedor,
    cv.FILIAL AS filial
```

**DIFERENÇAS:**
- Script não busca: `ENDERECO`, `COMPLEMENTO`, `BAIRRO`, `CIDADE` (mas meu sistema precisa para exibir)
- Script busca: `CELULAR`, `EMAIL` (meu sistema não busca)
- Script não faz JOIN com `LOJA_VENDEDORES`

---

## 🔧 CORREÇÕES NECESSÁRIAS

### 1. **Corrigir Filtro de Filial (com LTRIM/RTRIM)**
### 2. **Mudar Ordenação para ASC (mais antigo primeiro)**
### 3. **Verificar se o nome do vendedor está correto (pode manter JOIN)**

---

## ✅ O QUE ESTÁ CORRETO

1. ✅ Tabela: `CLIENTES_VAREJO`
2. ✅ Coluna de data: `CADASTRAMENTO`
3. ✅ Lógica de filtro de data (CAST AS DATE)
4. ✅ JOIN com LOJA_VENDEDORES (melhoria em relação ao script)

---

## ❓ O QUE PRECISA SER DECIDIDO

1. **Período:** Manter período fixo (selecionado pelo usuário) ou mudar para "novembro até hoje"?
2. **Vendedor:** Manter nome completo (JOIN) ou usar apenas código?
3. **Campos:** Adicionar CELULAR e EMAIL na busca?



