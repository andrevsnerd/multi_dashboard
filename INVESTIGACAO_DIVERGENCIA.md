# 🔍 Investigação: Divergência entre Script Python e Sistema Web

## 📊 Situação Atual

- **Script Python:** 255 clientes
- **Sistema Web:** 221 clientes
- **Diferença:** 34 clientes (13% a menos no sistema)

## 🔍 Análise do Script Python

O script Python busca:
```sql
WHERE 
    YEAR(CADASTRAMENTO) >= 2025
    AND (YEAR(CADASTRAMENTO) > 2025 OR (YEAR(CADASTRAMENTO) = 2025 AND MONTH(CADASTRAMENTO) >= 11))
    AND LTRIM(RTRIM(CAST(FILIAL AS VARCHAR))) = 'NERD MORUMBI RDRRRJ'
```

**Período:** Novembro 2025 até a data mais recente (27/11/2025)
**Resultado:** 255 clientes encontrados

## 🔍 Análise do Sistema Web

O sistema web busca:
```sql
WHERE 
    CAST(cv.CADASTRAMENTO AS DATE) >= CAST(@startDate AS DATE)
    AND CAST(cv.CADASTRAMENTO AS DATE) < CAST(@endDate AS DATE)
    AND LTRIM(RTRIM(CAST(cv.FILIAL AS VARCHAR))) = LTRIM(RTRIM(CAST(@filial AS VARCHAR)))
```

**Período:** Depende do que o usuário seleciona (ex: 01/11 a 27/11)
**Resultado:** 221 clientes encontrados

## 🤔 Possíveis Causas

### 1. **Período Diferente**
- Se o usuário selecionou um período menor que "01/11 a 27/11", o sistema vai mostrar menos
- **Ação:** Verificar qual período o usuário está selecionando no sistema

### 2. **Problema com JOIN**
- O sistema faz `LEFT JOIN` com `LOJA_VENDEDORES`
- Se houver algum problema com o JOIN que cause exclusão de registros
- **Ação:** Verificar se o JOIN está causando perda de registros

### 3. **Filtro de Filial**
- O filtro de filial pode não estar funcionando corretamente
- Pode haver espaços extras ou diferenças no nome da filial
- **Ação:** Verificar se o filtro está correto (já corrigimos com LTRIM/RTRIM)

### 4. **Clientes com Nome NULL ou Vazio**
- O sistema usa `ISNULL(cv.CLIENTE_VAREJO, 'SEM NOME')`
- O script Python não trata NULL da mesma forma
- **Ação:** Verificar se há clientes sendo ignorados por causa de nome NULL

### 5. **Problema com COUNT**
- O sistema pode estar usando `COUNT(DISTINCT)` que remove duplicatas
- Mas a query principal não usa DISTINCT
- **Ação:** Verificar se há duplicatas sendo contadas no script Python

## 🔧 Logs Adicionados

Adicionei logs detalhados no código para investigar:
1. Datas processadas (startDateStr, endDateStr)
2. Filtros aplicados (company, filial, searchTerm, filialFilter)
3. Query SQL completa
4. Quantidade de resultados
5. Amostra dos primeiros 5 registros

## 📝 Próximos Passos

1. **Testar no sistema web** com período exato: 01/11/2025 a 27/11/2025
2. **Verificar os logs** no console do servidor para ver:
   - Qual período está sendo usado
   - Qual filtro de filial está sendo aplicado
   - Quantos registros a query retorna
3. **Comparar diretamente** os resultados:
   - Quais clientes estão no script Python mas não no sistema
   - Quais clientes estão no sistema mas não no script Python
4. **Verificar se há duplicatas** no script Python que não deveriam estar lá

## 🎯 Hipótese Principal

**A diferença mais provável é o período:**
- O script Python busca "novembro 2025 até hoje" (dinâmico)
- O sistema web busca o período que o usuário seleciona (fixo)
- Se o usuário selecionou um período menor, vai mostrar menos clientes

**Mas também pode ser:**
- Algum problema com o JOIN que está excluindo registros
- Clientes com nomes mal formatados sendo ignorados
- Problema com o filtro de filial (mas já corrigimos com LTRIM/RTRIM)



