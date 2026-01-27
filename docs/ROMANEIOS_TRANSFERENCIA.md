# Investigação: Romaneios em Transferências

## Resumo da Investigação

Após investigar o banco de dados LINX, foram encontrados os seguintes padrões:

### Padrão Dominante (100% dos casos)

**Todas as transferências** entre filiais seguem o padrão:
- **Romaneio de SAÍDA**: Número sequencial (ex: `016030`)
- **Romaneio de ENTRADA**: Mesmo número com prefixo "T" (ex: `T016030`)

### Campos Relacionados

1. **ESTOQUE_PROD_SAI** (Saída):
   - `ROMANEIO_PRODUTO`: Romaneio da saída (ex: `016030`)
   - `FILIAL_DESTINO`: Filial de destino
   - `ROMANEIO_DESTINO`: Romaneio de entrada esperado (ex: `T016030`)
   - `MOV_INTERNA`: Geralmente `0` (false)

2. **ESTOQUE_PROD_ENT** (Entrada):
   - `ROMANEIO_PRODUTO`: Romaneio da entrada (ex: `T016030`)
   - `FILIAL_ORIGEM`: Filial de origem
   - `ROMANEIO_ORIGEM`: Romaneio de saída relacionado (ex: `016030`)
   - `ACERTO_ENTRADA`: Geralmente `0` (false)
   - `NF_ENTRADA_PROPRIA`: Geralmente `0` (false)

### Casos Especiais Investigados

1. **MOV_INTERNA = 1**: Nenhum caso encontrado
2. **ACERTO_ENTRADA = 1**: Encontrados casos, mas sem `ROMANEIO_ORIGEM` (não são transferências entre filiais)
3. **NF_ENTRADA_PROPRIA = 1**: Nenhum caso encontrado
4. **Romaneios Iguais**: Nenhum caso encontrado no histórico completo

## Conclusão

**Baseado na investigação, o padrão correto é SEMPRE usar romaneios diferentes:**
- Saída: `ROMANEIO_SAIDA` (ex: `028964`)
- Entrada: `T{ROMANEIO_SAIDA}` (ex: `T028964`)

## Abordagem Recomendada

### Para o Script `criar_transferencia.py`:

1. **Sempre gerar romaneios diferentes**:
   - Romaneio de saída: Buscar próximo número da sequência `ESTOQUE_PROD_SAI.ROMANEIO_PRODUTO`
   - Romaneio de entrada: Adicionar prefixo "T" ao romaneio de saída

2. **Preencher campos de relacionamento**:
   - Em `ESTOQUE_PROD_SAI`: `FILIAL_DESTINO` e `ROMANEIO_DESTINO`
   - Em `ESTOQUE_PROD_ENT`: `FILIAL_ORIGEM` e `ROMANEIO_ORIGEM`

3. **Campos padrão**:
   - `MOV_INTERNA = 0`
   - `ACERTO_ENTRADA = 0`
   - `NF_ENTRADA_PROPRIA = 0`

### Exceções (caso apareçam no futuro)

Se em algum momento aparecerem casos com romaneios iguais, investigar:
- Se `MOV_INTERNA = 1` (movimentação interna)
- Se há alguma configuração especial no LINX
- Se é um caso de ajuste/acerto de estoque

## Exemplo de SQL Correto

```sql
-- SAÍDA
INSERT INTO ESTOQUE_PROD_SAI (
    ROMANEIO_PRODUTO,      -- '028964'
    FILIAL,
    FILIAL_DESTINO,
    ROMANEIO_DESTINO,      -- 'T028964'
    MOV_INTERNA            -- 0
) VALUES (...);

-- ENTRADA
INSERT INTO ESTOQUE_PROD_ENT (
    ROMANEIO_PRODUTO,      -- 'T028964'
    FILIAL,
    FILIAL_ORIGEM,
    ROMANEIO_ORIGEM,       -- '028964'
    ACERTO_ENTRADA,        -- 0
    NF_ENTRADA_PROPRIA     -- 0
) VALUES (...);
```

## Data da Investigação

- **Data**: 27/01/2026
- **Período Analisado**: Últimos 365 dias
- **Total de Transferências Analisadas**: 50+ casos
- **Casos com Romaneios Iguais**: 0 (0%)
- **Casos com Romaneios Diferentes**: 100% (todos com prefixo "T")
