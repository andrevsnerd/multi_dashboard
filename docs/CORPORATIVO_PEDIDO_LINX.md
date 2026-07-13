# Pedido corporativo → Pedido de Venda Atacado no Linx (form 080201SPK)

Especificação técnica do fluxo. Objetivo: quando um pedido do e-commerce corporativo
for **aprovado** por admin/diretor/supervisor, gravá-lo como um **Pedido de Venda Atacado
real** no Linx, reaproveitando o cadastro do cliente. Baseado em introspecção read-only do
`LINX_PRODUCAO` e análise de **25.314 pedidos (24 meses)**.

---

## 1. Onde e como o Linx cria o pedido

A tela dos prints é **`080201SPK — Pedido de Venda Digitação Rápida`**. Ela grava em duas
tabelas (não nas tabelas de venda POS `LOJA_VENDA`, que são outra coisa — venda já realizada):

| Papel | Tabela | Linhas | PK |
|---|---|---|---|
| Cabeçalho do pedido | **`VENDAS`** | ~90k | `PEDIDO` |
| Itens do pedido | **`VENDAS_PRODUTO`** | ~490k | `(PEDIDO, PRODUTO, COR_PRODUTO, ENTREGA, ITEM_PEDIDO)` |

`VENDAS.TABELA_FILHA = 'VENDAS_PRODUTO'` em 100% dos pedidos — é o "ponteiro" do Linx para a
tabela-filha de itens.

### Numeração do pedido (`SEQUENCIAIS`)
Existem **dois streams** que gravam em `VENDAS`:
- **Manual / Digitação Rápida (o nosso fluxo)** → número de `SEQUENCIAIS.TABELA_COLUNA = 'VENDAS.PEDIDO'` (hoje ~**88k**).
- Lote / e-commerce importado → `SEQUENCIAIS 'VENDAS_LOTE.PEDIDO_EXTERNO'` (hoje ~**831k**). **Não usar.**

`PEDIDO` é `char(12)`, número **puro alinhado à esquerda, sem zero-padding** (ex.: `'56435       '`).
Alocação atômica idêntica ao cadastro de cliente (`criarClienteCorporativo`):
`UPDATE SEQUENCIAIS WITH (UPDLOCK, HOLDLOCK) SET SEQUENCIA = CAST(CAST(SEQUENCIA AS INT)+1 AS VARCHAR)`.

---

## 2. Gatilhos (triggers) — por que inserir é seguro

| Trigger | Tabela | Evento | O que faz |
|---|---|---|---|
| `LXI_VENDAS` | VENDAS | **INSERT** | Só valida FKs (FILIAL, TRANSPORTADORA, NATUREZA_SAIDA, CLIENTE_ATACADO, COND_PGTO, TAB_PRECO, COLECAO, MOEDA, TIPO, REPRESENTANTE, GERENTE…) e grava `VENDAS_STATUS_LOG`. **Não mexe em estoque nem faturamento.** |
| `LXU_VENDAS` | VENDAS | UPDATE | Pesado (766 linhas): cascata para `VENDAS_PACK`, `VENDAS_RATEIO`, `PRODUCAO_ORDEM`, `ESTOQUE_SAI*`, etc. **Só dispara em UPDATE.** |
| `LXU_VENDAS_PRODUTO` | VENDAS_PRODUTO | UPDATE | Realização: escreve em `LOJA_VENDA`, `LOJA_VENDA_TROCA`, `QTDE_CANCELADA`, `VALOR_PAGO`. **Só em UPDATE.** |
| `LXUDT_*` | ambas | UPDATE | Mantêm `DATA_PARA_TRANSFERENCIA`. |
| `LXD_VENDAS_PRODUTO` | VENDAS_PRODUTO | DELETE | — |

**Conclusão:** `VENDAS_PRODUTO` **não tem trigger de INSERT**, e a cascata de estoque/faturamento
só ocorre em UPDATE. Inserir um pedido **aberto** (como a Digitação Rápida faz) **não movimenta
estoque nem gera NF** — a separação/faturamento é feito depois pelos operadores no Linx.
⚠️ Todo valor de FK precisa existir; `NATUREZA_SAIDA` deve ser **NULL** (é o que 100% dos pedidos têm).

---

## 3. Cabeçalho `VENDAS` — o que é padronizável (constante em 25.314 pedidos)

| Campo | Valor | Frequência | Origem no nosso fluxo |
|---|---|---|---|
| `TIPO` | `VENDA ATACADO` | **100%** | constante |
| `MOEDA` | `R$` | **100%** | constante |
| `TABELA_FILHA` | `VENDAS_PRODUTO` | **100%** | constante |
| `COLECAO` | `62` | **100%** | constante (é fixo, ignora a coleção do produto) |
| `STATUS` | (vazio) | **100%** | NULL/`' '` |
| `NATUREZA_SAIDA` | NULL | **100%** | NULL |
| `TIPO_RATEIO` | `0` (COMUM) | 99.9% | constante `0` |
| `REPRESENTANTE` | `SEM REPRESENTANTE` | 97.7% | constante |
| `GERENTE` | `SEM REPRESENTANTE` | 97.8% | constante |
| `INDICADOR_VENDA` | `V` | 83% | constante `V` |
| `TIPO_FRETE` | (vazio) | 92.9% | NULL |
| `APROVACAO` | (vazio) | 92.9% | `' '` |
| `ROMANEIO` | (vazio) | 100% | NULL (preenchido no faturamento) |

### Campos que derivam do **cadastro do cliente** (`CLIENTES_ATACADO`, casado por `CLIFOR`)
| Campo | % que bate com o cadastro | Regra |
|---|---|---|
| `CONDICAO_PGTO` | **97.8%** | `CLIENTES_ATACADO.CONDICAO_PGTO` (fallback `01`) |
| `CODIGO_TAB_PRECO` | **92.8%** | `CLIENTES_ATACADO.CODIGO_TAB_PRECO` (fallback `01`) |
| `CLIENTE_ATACADO` | (chave) | = `CADASTRO_CLI_FOR.NOME_CLIFOR` **verbatim** (com espaços). Resolver a partir do `CLIFOR`. |
| `NOME_CLIFOR_ENTREGA` | — | = `CLIENTE_ATACADO` (mesmo cliente) |

Isso explica **PF vs PJ** sem tratamento especial: PF ≈ sempre `COND 01`/`TAB 01`; PJ carrega
tabela/condição próprias — e ambos já estão no cadastro. **Derivar do cadastro cobre os dois.**

### Campos decididos no momento do pedido (não vêm do cadastro)
| Campo | Observação |
|---|---|
| `FILIAL` | **Fixo `SCARF ME - MATRIZ`** (decisão do dono). Deve existir em `FILIAIS` exatamente assim (existe). A empresa fiscal da NF é definida depois no faturamento. |
| `TRANSPORTADORA` | Escolhida no pedido (cadastro bate só 27%). Padrão corporativo = **`CORREIOS - SEDEX`** (59.7% da base; combina com o frete R$90 por Correios). Deve existir em `TRANSPORTADORAS`. |
| `TRANSP_REDESPACHO` | = `TRANSPORTADORA` |
| `EMISSAO`, `CADASTRAMENTO`, `DATA_PARA_TRANSFERENCIA` | `GETDATE()` (hora do servidor) — mesma abordagem do cadastro; **ver bug EMISSAO-UTC** (nunca gravar UTC). |
| `APROVADO_POR` | Tag identificando origem, ex.: `CORP WEB / <aprovador>` (a base tem `NF SEM PEDIDO` para gerados de NF, e `USER / MÁQUINA` para digitados). |
| Totais `TOT_QTDE_*`, `TOT_VALOR_*`, `VALOR_SUB_ITENS` | Somatório dos itens (na criação: `ENTREGAR = ORIGINAL`). |
| `FATOR_VENDA_LIQUIDA` | `1` |

---

## 4. Itens `VENDAS_PRODUTO` — grade VO/VE

Quantidades ficam numa **grade de tamanhos**: `VO1..VO48` (venda original) e `VE1..VE48`
(a entregar). Verificado: **`QTDE_ORIGINAL = SUM(VO1..VO48)` em 100% de 52.190 linhas**;
**99,6% das linhas usam só `VO1`** (lenços são tamanho único).

### Mapeamento do EAN → posição da grade (canônico via `PRODUTOS_BARRA`)
`PRODUTOS_BARRA` (SKU/EAN) dá, a partir do **código de barra**:
`PRODUTO`, `COR_PRODUTO` (char(10), formato exato do Linx), **`TAMANHO` = ordinal 1-based na grade**, `GRADE`.

> Ex. do print: EAN `031454`/`7898586258358` → PRODUTO `13.02.0516`, COR `10`, **TAMANHO=1**, GRADE `8X130` ⇒ `VO1 = qtd`.
> Multi-size (grade `P/M/G`): `PRODUTOS_TAMANHOS` lista `TAMANHO_1=P, _2=M, _3=G`; `VO[ordinal]=qtd` (validado: VO=[2,2,3]→QO=7).

### Regras de construção de cada linha
- **Agrupar itens do carrinho por `(PRODUTO, COR_PRODUTO)`**; tamanhos diferentes do mesmo
  produto+cor vão em **posições VO diferentes da MESMA linha** (a PK inclui produto+cor).
- `ITEM_PEDIDO = '0000'` sempre (a PK já separa por produto+cor; a base confirma `'0000'` mesmo com vários itens).
- `ENTREGA` = `EMISSAO` (data). Faz parte da PK.
- Na criação: `VE_i = VO_i`, `QTDE_ENTREGAR = QTDE_ORIGINAL`, `VALOR_ENTREGAR = VALOR_ORIGINAL`.
- `PRECO1` = preço unitário; `VALOR_ORIGINAL = PRECO1 × QTDE_ORIGINAL` (sem desconto).
- ⚠️ **Colunas COMPUTADAS — NÃO inserir**: `VENDAS.FATOR_VENDA_LIQUIDA`, `VENDAS_PRODUTO.QTDE_LIQUIDA`,
  `VENDAS_PRODUTO.VALOR_LIQUIDO` (o Linx calcula sozinho). Inserir nelas dá erro.
- Campos NOT NULL a preencher: `PEDIDO, PRODUTO, COR_PRODUTO, ENTREGA` (+ `ITEM_PEDIDO` tem default `'0000'`). Todo o resto tem default.
- ✅ **Validado contra produção** (INSERT real com ROLLBACK): aloca o nº, insere `VENDAS`+`VENDAS_PRODUTO`,
  passa por todos os triggers de FK, e reverte sem consumir sequencial.

---

## 5. Estado atual do código (o que já existe)

- **Checkout salva só no Neon** (`corporativo_pedidos`, status `pendente`) — [lib/repositories/corporativoStore.ts](../lib/repositories/corporativoStore.ts). Não toca no Linx.
- Cada item do pedido já carrega `produto, ean, cor, corNome, tamanho, grade, quantidade, precoUnitario, subtotal`.
- **Padrão a reusar**: [lib/repositories/clienteCorporativo.ts](../lib/repositories/clienteCorporativo.ts) `criarClienteCorporativo()` — aloca de `SEQUENCIAIS` e insere em 2 tabelas do Linx numa transação (`SET XACT_ABORT ON; BEGIN TRAN … COMMIT`), parametrizado, roda direto e via proxy.

---

## 6. Fluxo proposto

```
Cliente (cliente_corporativo)          Admin / Diretor / Supervisor           Linx
──────────────────────────────         ────────────────────────────          ──────────────
carrinho → checkout                     lista de pedidos "pendente"
  → criarPedido() [Neon, pendente] ───► revisa / edita itens/qtd/preço
                                        → "Aprovar"  ───────────────────────►  aloca PEDIDO (SEQUENCIAIS.VENDAS.PEDIDO)
                                                                                INSERT VENDAS (1) + VENDAS_PRODUTO (N)
                                                                                numa transação
                                        ◄── grava pedido_linx no Neon ◄────────  (pedido ABERTO; sem estoque/NF)
                                            status = 'efetivado'
```

- Espelha o fluxo de **aprovação do cadastro** (`/corporativo/aprovacoes`). Cliente nunca escreve no Linx direto.
- Idempotência: guardar `pedido_linx` (número gerado) em `corporativo_pedidos`; bloquear reaprovação se já efetivado (mesmo espírito das travas anti-duplicação de transferências).

### Esqueleto do INSERT (transacional, parametrizado)
```sql
SET NOCOUNT ON; SET XACT_ABORT ON; BEGIN TRAN;
  DECLARE @n INT;
  UPDATE SEQUENCIAIS WITH (UPDLOCK,HOLDLOCK)
     SET @n = CAST(SEQUENCIA AS INT)+1, SEQUENCIA = CAST(CAST(SEQUENCIA AS INT)+1 AS VARCHAR(12))
   WHERE TABELA_COLUNA='VENDAS.PEDIDO';
  DECLARE @PEDIDO CHAR(12) = CAST(@n AS VARCHAR(12));   -- left-aligned, sem zero-pad

  INSERT INTO VENDAS (PEDIDO, COLECAO, CODIGO_TAB_PRECO, TIPO, CONDICAO_PGTO, FILIAL,
     CLIENTE_ATACADO, NOME_CLIFOR_ENTREGA, TRANSPORTADORA, TRANSP_REDESPACHO, MOEDA,
     REPRESENTANTE, GERENTE, EMISSAO, CADASTRAMENTO, TABELA_FILHA, INDICADOR_VENDA,
     APROVADO_POR, FATOR_VENDA_LIQUIDA, TIPO_RATEIO,
     TOT_QTDE_ORIGINAL, TOT_QTDE_ENTREGAR, TOT_VALOR_ORIGINAL, TOT_VALOR_ENTREGAR, VALOR_SUB_ITENS)
  VALUES (@PEDIDO, '62', @tab, 'VENDA ATACADO', @cond, @filial,
     @nomeClifor, @nomeClifor, @transp, @transp, 'R$',
     'SEM REPRESENTANTE', 'SEM REPRESENTANTE', GETDATE(), GETDATE(), 'VENDAS_PRODUTO', 'V',
     @aprovadoPor, 1, 0,
     @totQtd, @totQtd, @totValor, @totValor, @totValor);

  -- por linha agrupada (produto,cor): VO[ordinal via PRODUTOS_BARRA.TAMANHO] = qtd
  INSERT INTO VENDAS_PRODUTO (PEDIDO, PRODUTO, COR_PRODUTO, ENTREGA, ITEM_PEDIDO,
     QTDE_ORIGINAL, QTDE_ENTREGAR, QTDE_LIQUIDA, PRECO1, VALOR_ORIGINAL, VALOR_ENTREGAR,
     VALOR_LIQUIDO, VO1 /*..VOk*/, VE1 /*..VEk*/)
  VALUES (@PEDIDO, @produto, @cor, GETDATE(), '0000',
     @q, @q, @q, @preco, @valor, @valor, @valor, @vo1, @ve1);
COMMIT;
SELECT @PEDIDO AS pedido;
```

---

## 7. Decisões do dono (fechadas)

1. **`PRECO1` = preço do catálogo corporativo** (`corporativo_catalogo.preco_atacado`, o que o cliente
   viu). O aprovador pode ajustar antes de efetivar.
2. **`FILIAL` = `SCARF ME - MATRIZ` fixo** para todo pedido corporativo (não usar a canônica dinâmica).
   Precisa existir exatamente assim em `FILIAIS` (existe — 19,6% da base). A empresa fiscal que emite a
   NF é decidida depois, no faturamento pelos operadores do Linx — não afeta a criação do pedido aberto.
3. **`APROVADO_POR` = tag interna fixa** (ex.: `CORP WEB`). **Nunca exibida ao cliente** — some da UI do
   cliente; aparece só na gestão (admin/diretor/supervisor).
4. **`CONDICAO_PGTO` = sempre do cadastro** do cliente (`CLIENTES_ATACADO.CONDICAO_PGTO`).
5. **Frete → vai na observação (`VENDAS.OBS`)**, ex.: `FRETE: R$ 90,00`. Não vira linha de item nem
   campo próprio. O valor é o **frete fixo único** em [`lib/corporativo/config.ts`](../lib/corporativo/config.ts)
   (`FRETE_FIXO`) — hoje R$ 90 (provisório); mudar lá vale para exibição e gravação.
