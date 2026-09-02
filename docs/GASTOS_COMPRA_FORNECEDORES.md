# Gastos de Compra — Fornecedores e calendário de pagamento

> Consulta rápida: quem são os fornecedores, como cada um paga, onde isso fica
> gravado e o que mexer para mudar/adicionar um.

## O que é o "Fornecedor" aqui

No painel **Gastos de Compra** o fornecedor não é só um rótulo: **cada fornecedor
paga do seu jeito**, então escolher o nome no lançamento **monta o parcelamento
sozinho** (datas, valores e, quando tem, os canais de pagamento).

- O campo fica em **Nova compra → Identificação e datas → Fornecedor**, e também
  em **Compra em trânsito → Pagamento → Fornecedor** (é de lá que sai o
  fornecedor da compra lançada automaticamente ao confirmar o trânsito).
- O padrão é **vazio** (`— sem fornecedor —`): nesse caso a compra nasce inteira,
  vencendo na data da compra, e quem divide é o usuário (2x, 3x, % à mão).
- Escolher um fornecedor aplica o calendário dele na hora. Depois disso dá para
  ajustar linha a linha: **o que é digitado à mão nunca é sobrescrito**. Trocar
  de fornecedor refaz as parcelas (é justamente o que se está pedindo).

## Os fornecedores e como cada um paga

Os prazos são **dias corridos contados da data da compra** (30/60/90…), não meses
de calendário. Parcelas iguais: o último centavo cai na última parcela, então a
soma fecha exata.

| Fornecedor | Como paga |
|---|---|
| **Salete** | 2x iguais: **90** e **120** dias. |
| **Telma** | 1x: **30** dias. |
| **Roseli (Pashmina)** | 3x iguais: **90**, **120** e **150** dias. |
| **Fátima (Fashion)** | 2x iguais: **30** e **60** dias. |
| **Premier** | 3x iguais: **30**, **60** e **90** dias. |
| **Índia (Kunal)** | **13x iguais**: entrada à vista (dia 0) + 12 parcelas de 30 em 30 dias (30 a 360). Sem canais. |
| **China (Nick)** | Dois pagamentos **paralelos** sobre o mesmo total: Transferência bancária 40% + Alibaba 60%. Cada canal se divide em 30% **no ato do pedido**, 50% **no despacho** (+30 dias) e 20% **60 dias após o despacho** (+90 dias). As datas coincidem — o dia soma os dois. |
| **China (Hannah)** | Mesmos canais do Nick (Transferência 40% + Alibaba 60%), mas fecha no despacho: 30% **no ato do pedido** e os **70% restantes no despacho** (+30 dias). Sem a parcela de 60 dias depois. |
| **Nepal** | Igual à China (Nick) (por enquanto). |

> **Índia — entrada:** os 13 pagamentos são **iguais** (a entrada é 1/13 do
> total, como cada uma das 12). Se a entrada passar a ter percentual próprio,
> muda só a linha `india_kunal` da tabela de regras.

**Por que fornecedores iguais são entradas separadas:** só o Nepal ainda copia o
calendário do Nick. Cada fornecedor tem a própria linha na tabela de regras
justamente para que, quando um mudar, mude só a linha dele — foi o que aconteceu
com a Hannah, que saiu do 30/50/20 para 30/70 sem tocar em ninguém.

### Sobre os canais (China e afins)

Uma compra importada tem **dois pagamentos correndo em paralelo** sobre o mesmo
total (transferência bancária e Alibaba), cada um com o próprio 30/50/20. Como as
datas coincidem, o painel mostra os dois separados **e** somados por dia. Cada
parcela conta **uma vez**, no mês do próprio vencimento.

## Onde isso fica gravado

- **Na compra (o "lote"):** a chave do fornecedor (`salete`, `china_hannah`, …)
  é gravada no campo **`fornecedor`** do lote, na tabela `compra_gastos_lotes`
  (coluna `fornecedor`, que já existia). É esse campo que responde "de quem foi
  esta compra" depois — aparece na gaveta da compra e na exportação em Excel.
- **O parcelamento gerado também é salvo** (datas, valores, canal e etapa de cada
  parcela). O fornecedor diz **de onde as parcelas vieram**; as parcelas salvas
  são **o que elas são** — inclusive depois de ajustadas à mão.
- **Compra antiga** tem texto livre nesse campo (era um input). A leitura é
  tolerante: valor que não é uma chave conhecida é exibido como está, e continua
  disponível no select de edição para não ser apagado sem querer.

## Onde mexer no código

| O quê | Onde |
|---|---|
| Lista de fornecedores (tipo) | [lib/types/compra-gasto.ts](../lib/types/compra-gasto.ts) — `CompraGastoFornecedor` |
| Regra de pagamento de cada um | [lib/utils/compra-gastos-agregacao.ts](../lib/utils/compra-gastos-agregacao.ts) — tabela `REGRAS` |
| Opções do select / rótulos | mesma tabela, exportada em `COMPRA_GASTO_FORNECEDORES` |
| Rótulo de exibição e leitura tolerante | `rotuloFornecedor`, `ehFornecedorConhecido`, `modeloDoFornecedor` |
| Geração das parcelas | `gerarParcelasModelo` (mesmo arquivo) |
| Select no lançamento | [components/compras/NovaCompraModal.tsx](../components/compras/NovaCompraModal.tsx) |
| Select ao editar parcelamento | [components/compras/GastosCompraDrawer.tsx](../components/compras/GastosCompraDrawer.tsx) |
| Select no pagamento da Compra em trânsito | [components/lista-loja/ComprasTransitoPage.tsx](../components/lista-loja/ComprasTransitoPage.tsx) |
| Editor de parcelas (aplica o calendário) | [components/compras/ParcelasEditor.tsx](../components/compras/ParcelasEditor.tsx) |

### Adicionar um fornecedor novo

1. Acrescente a chave em `CompraGastoFornecedor` (types).
2. Acrescente a linha em `REGRAS` com `label`, `dica`, `etapas` e, se o pagamento
   for em canais paralelos, `canais`.
3. Acrescente a chave na lista de ordem dentro de `COMPRA_GASTO_FORNECEDORES` —
   é ela que define a ordem no select.

Nada mais: os selects, a dica na tela, a exportação e a geração das parcelas leem
tudo dessa mesma tabela.

### Mudar o calendário de um fornecedor

Edite só as `etapas` (e `canais`) da linha dele em `REGRAS`. **Compras já
lançadas não mudam** — o parcelamento delas está salvo. A regra nova vale para o
que for gerado dali em diante (ou para quem reabrir a compra e escolher o
fornecedor de novo).

## Catálogo Premier — preço padrão

O tipo de compra **Premier** abre o catálogo inteiro com o **preço unitário de
tabela já preenchido**: na prática o que muda de uma compra para a outra é a
quantidade. O preço continua **editável** — reajuste é corrigido na linha, e o
que a compra grava é o valor digitado, não o padrão.

| Item | Preço un. padrão |
| --- | --- |
| Sacola SP63 | 3,1200 |
| Caixa Lenço | 3,6500 |
| Lamina | 0,3710 |
| Faixinha | 0,1007 |
| Tag | 0,1290 |
| Sacola SP28 | *(sem preço de tabela)* |
| Caixa CTC-90 | *(sem preço de tabela)* |
| Caixa Rígida | *(sem preço de tabela)* |
| Caixa Pashimina | 5,4790 |
| Sacola SP11 | 5,8400 |

A lista vive em `COMPRA_GASTO_PREMIER_CATALOGO`
([lib/types/compra-gasto.ts](../lib/types/compra-gasto.ts)) — é lá que se muda
preço ou se acrescenta item; a tela deriva tudo dela.

⚠️ **São centavos com quatro casas, não milhar.** Faixinha e Tag custam décimos
de centavo e a compra vem em milhares de unidades, então o preço unitário desta
tela é lido, gravado e exibido com 4 casas (5.800 faixinhas: 0,1007 = R$ 584,06;
arredondado para 0,10 daria R$ 580,00). Por isso `parsePrecoUnitario`/`moneyUnit`
em vez de `parseMoeda`/`money`, e `numUnit` no store.

Na mesma tela, **quantidade** é lida com `parseQtd`: em pt-BR "5.800 unidades"
é cinco mil e oitocentos, e o ponto só vale como decimal quando não forma grupos
de três ("1.5" = 1,5).

## Pontos de atenção

- **Compra em trânsito → Pagamento:** o select é o mesmo, mais uma opção
  **"Outro (digitar)"** que abre um campo de texto para nome fora da lista
  (fornecedor eventual, sem calendário cadastrado). Fornecedor digitado assim é
  gravado como texto e **não gera parcelamento** — o plano fica por conta de quem
  está lançando. Compras antigas com texto livre abrem já nesse modo.
- **O parcelamento da Compra em trânsito é gravado em dias/%** sobre a data da
  compra, então ele reancora sozinho na confirmação. Escolher o fornecedor lá
  monta o plano; o que vai para o painel é o plano, não o nome do calendário.
- **Premier é as duas coisas**: um *tipo de compra* (o catálogo de embalagem e
  material, já com o preço de tabela preenchido — só a quantidade é digitada) e um
  *fornecedor* (3x, 30/60/90). Escolher o tipo de compra Premier já marca o
  fornecedor Premier — dá para trocar depois, se a compra for de outro.
- **Parcelas iguais** vêm do helper `iguaisEm([dias…])`: para mudar um prazo,
  mexa só na lista de dias. Percentual diferente por etapa (como a China) é
  escrito à mão na própria linha.
