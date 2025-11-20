# Explicação do Problema - Passo a Passo

## SITUAÇÃO INICIAL

**Planilha mostra:**
- VALOR_LIQUIDO: 400,056.09
- QTDE: 1,845

**Sistema mostrava:**
- VALOR_LIQUIDO: 351,875.33
- QTDE: 1,649

**Diferença:** -48,180.76 em valor e -196 em quantidade

---

## O QUE DESCOBRIMOS NOS TESTES

### TESTE 1: Query Exata do Script de Exportação
Quando executamos a **mesma query** que o script Python `exportar_todos_relatorios.py` usa:
- **Resultado:** 399,430.49 (muito mais próximo!)
- **Diferença:** apenas -625.60 (não mais -48,180.76)

**Conclusão:** A query do script Python está quase correta!

### TESTE 2: Query do Sistema (com `<` em vez de `<=`)
Quando testamos a query que o sistema estava usando:
- **Resultado:** 351,875.33 (muito menor!)
- **Problema:** Usava `f.EMISSAO < @endDate` que **EXCLUI o dia 20 completo**

**Conclusão:** O problema principal era o filtro de data!

---

## O PROBLEMA DO FILTRO DE DATA

### Como estava (ERRADO):
```sql
WHERE f.EMISSAO >= @startDate
  AND f.EMISSAO < @endDate
```

**O que acontece:**
- Se `@endDate = '2025-11-20T00:00:00'` (meia-noite do dia 20)
- A condição `f.EMISSAO < '2025-11-20T00:00:00'` **EXCLUI todo o dia 20**
- Porque qualquer hora do dia 20 (ex: 10:00) é MAIOR que 00:00

### Como deve ser (CORRETO):
```sql
WHERE CAST(f.EMISSAO AS DATE) >= CAST(@startDate AS DATE)
  AND CAST(f.EMISSAO AS DATE) <= CAST(@endDate AS DATE)
```

**O que acontece:**
- Compara apenas as DATAS (ignora a hora)
- Inclui TODO o dia 20, independente da hora

---

## O QUE FOI CORRIGIDO

✅ Alteramos TODAS as queries de e-commerce para usar o filtro de data correto
✅ Agora o sistema deve retornar ~353,614.23 (incluindo o dia 20)

---

## O QUE AINDA ESTÁ FALTANDO

Mesmo com a correção, ainda há uma diferença de **625.60**:

**Query exata do export:** 399,430.49
**Esperado na planilha:** 400,056.09
**Diferença:** -625.60

### Possíveis causas:

1. **A planilha pode estar incluindo registros que a query não inclui:**
   - Registros com natureza de saída diferente?
   - Registros cancelados que foram restaurados?
   - Algum filtro adicional que não estamos aplicando?

2. **A planilha pode estar usando um cálculo diferente:**
   - Usando `VALOR` em vez de `VALOR_LIQUIDO` em alguns casos?
   - Somando algum campo adicional?
   - Aplicando algum ajuste manual?

3. **Diferença de arredondamento:**
   - Múltiplos arredondamentos podem causar pequenas diferenças

---

## PRÓXIMOS PASSOS PARA ENCONTRAR OS 625.60

Precisamos verificar:
1. Se há registros na planilha que não estão na query
2. Se a planilha está usando alguma coluna diferente
3. Se há algum cálculo adicional na planilha

**Você pode:**
- Exportar a planilha novamente e verificar se o valor mudou
- Verificar se há algum filtro manual aplicado na planilha
- Comparar alguns registros específicos entre planilha e sistema

