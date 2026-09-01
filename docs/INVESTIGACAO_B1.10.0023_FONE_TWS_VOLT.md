# Investigação de Perda de Estoque — FONE TWS VOLT SOUND AIR (B1.10.0023)

**Documento base para apresentação.** Cada seção = 1 slide. Só conteúdo e dados; sem formatação,
sem cores, sem layout. As linhas "Falar:" são roteiro de fala e **não vão na tela**.

- **Data da apuração:** 31/08/2026
- **Base:** LINX_PRODUCAO (Linx ERP), consulta direta ao banco
- **Escopo:** produto B1.10.0023 em todas as 8 filiais NERD, do primeiro dia até 31/08/2026
- **Elaborado por:** André Sabetta

**Estrutura:** 28 slides. O coração da apresentação são os slides 6 a 10 (os extratos de cada loja) —
é ali que a perda fica visível linha por linha.

---

## SLIDE 1 — Capa

**Título:** Investigação de Perda de Estoque

**Subtítulo:** FONE TWS VOLT SOUND AIR — código B1.10.0023

**Linha de apoio:** Morumbi 1 · Leblon · Higienópolis — apuração de 31/08/2026

**Rodapé:** Documento interno · Base: Linx (LINX_PRODUCAO) · Uso restrito

---

## SLIDE 2 — Sumário executivo

**Título:** O que descobrimos

**Faltam 4 peças deste fone:** 2 em Morumbi 1, 1 em Leblon, 1 em Higienópolis.

Testamos quatro explicações possíveis. Três caíram:

| Explicação | Resultado |
|---|---|
| O sistema errou o estoque | **Não.** O extrato fecha peça por peça nas 8 lojas |
| Venderam bipando o código errado | **Não.** Os produtos de código vizinho estão corretos |
| Romaneio perdido, troca, devolução ou ajuste | **Não.** Nenhum registro desse tipo existe |
| **As peças saíram da loja sem registro** | **É o que sobra** |

**A prova está no inventário de maio:** em Leblon e Higienópolis alguém **contou as peças na mão** e
o número bateu com o sistema. Elas existiam. Depois disso, desapareceram sem nenhum movimento.

**O caso mais claro é Leblon:** peças conferidas em 29/05, chegou mais mercadoria em 20/06, e depois
disso **o produto não teve UM único movimento em 72 dias**. Nenhuma venda, nenhuma transferência.
Deveria haver 4 na gaveta. Tem 3.

**Falar:** se a pessoa só vê um slide, é este. O resto do material é a demonstração.

---

## SLIDE 3 — Ficha do produto

**Título:** O produto

| Campo | Valor |
|---|---|
| Código | B1.10.0023 |
| Descrição | FONE TWS VOLT SOUND AIR |
| Cor | 01 — BRANCO (**cor única**) |
| Grade | ÚNICO (**sem tamanho**) |
| Linha | ELETRONICOS |
| Grupo | FONE DE OUVDO BLUETOOTH |
| Código de barra curto | 052605 |
| EAN-13 | 7898586439405 |
| Custo | R$ 89,90 |
| Preço | R$ 358,00 |

**Por que isso importa:** cor única e tamanho único eliminam de saída dois erros clássicos de
estoque. Não existe "confundiu a cor" nem "contou o tamanho errado" neste item. **Toda peça é
idêntica a toda outra peça.** Se o número não bate, é peça faltando — não é classificação errada.

---

## SLIDE 4 — A divergência

**Título:** O que o sistema diz x o que tem na prateleira

| Loja | Sistema (Linx) | Contado na prateleira | Diferença |
|---|---|---|---|
| **MORUMBI 1** | 3 | 1 | **falta 2** |
| **LEBLON** | 4 | 3 | **falta 1** |
| **HIGIENÓPOLIS** | 1 | 0 | **falta 1** |
| MORUMBI 2 | 3 | não conferido | ? |
| CENTER NORTE | 2 | não conferido | ? |
| ELDORADO | 1 | não conferido | ? |
| VILLA LOBOS | 0 | — | — |
| **TOTAL REDE** | **14** | | **falta 4 nas 3 lojas conferidas** |

**Perda apurada:** 4 peças = **R$ 359,60 de custo** = **R$ 1.432,00 de venda perdida**.

**Atenção:** três lojas ainda não foram conferidas (6 peças no sistema). O número real pode ser maior.

---

## SLIDE 5 — Como ler o extrato (legenda)

**Título:** Como ler as próximas telas

Os próximos slides mostram **todo** o histórico do produto em cada loja, do primeiro dia até hoje.
Cada linha é um movimento registrado no Linx.

**Tipos de movimento:**

| Aparece como | Significa |
|---|---|
| **ENTRADA** | Chegou mercadoria na loja (romaneio da matriz ou de outra loja) |
| **VENDA** | Foi vendida no caixa (mostro valor e vendedor) |
| **VENDA CANCELADA** | Ticket foi aberto e cancelado — **não baixa estoque** |
| **TRANSFERÊNCIA** | Saiu para outra loja |
| **VM** | Baixa como mostruário / visual merchandising |
| **INVENTÁRIO** | Contagem física geral — mostro o que contaram x o que o sistema dizia |

**Colunas:**

- **Qtd** = quanto aquele movimento somou (+) ou tirou (−) do estoque
- **Saldo** = quanto ficou no sistema **depois** daquele movimento
- Última linha da tabela = saldo de hoje no sistema

**A pergunta que cada extrato responde:** o saldo final do sistema é o resultado correto de todos os
movimentos? **Sim, em todas as lojas.** Então o problema não é o sistema — é o que aconteceu na loja
e nunca foi registrado.

**Falar:** vale gastar 30 segundos nesta tela. Quem entende a legenda entende sozinho os 3 próximos
slides.

---

## SLIDE 6 — EXTRATO: LEBLON (o caso mais claro)

**Título:** Extrato completo — Leblon

**O histórico inteiro da loja tem 3 linhas:**

| # | Data | Movimento | Qtd | Saldo | Documento | Detalhe |
|---|---|---|---|---|---|---|
| 1 | 14/05/2026 | ENTRADA | +2 | **2** | romaneio 832339 | recebido da matriz, conferido por NERD.LEBLON |
| 2 | 29/05/2026 | **INVENTÁRIO** | 0 | **2** | INVENTLEBLON280527 | **contaram 2 na mão · sistema dizia 2 · CONFERIU** |
| 3 | 20/06/2026 | ENTRADA | +2 | **4** | romaneio 833495 | recebido da matriz, conferido por NERD.LEBLON |
| | 21/06 a 31/08 | **NADA** | — | **4** | — | **72 dias sem um único movimento** |

**Sistema hoje: 4 · Prateleira hoje: 3 · FALTA 1**

**Leitura em uma frase:** a loja recebeu 4 peças, alguém contou fisicamente 2 delas em maio e estava
certo, chegaram outras 2 em junho, **ninguém tocou no produto no sistema por 72 dias** — e falta uma.

**Por que este caso é diferente dos outros:**

- Não houve venda → não teve como bipar o código errado
- Não houve transferência → não teve romaneio para digitar errado
- Não houve ajuste → ninguém mexeu no saldo
- Não houve nem contagem → o número nunca foi alterado por ninguém

**Falar:** não existe erro de operação que produza esse resultado. A peça saiu da loja.

---

## SLIDE 7 — EXTRATO: HIGIENÓPOLIS

**Título:** Extrato completo — Higienópolis

| # | Data | Movimento | Qtd | Saldo | Documento | Detalhe |
|---|---|---|---|---|---|---|
| 1 | 13/05/2026 | ENTRADA | +2 | **2** | romaneio 832297 | recebido da matriz (NERD.HIGI) |
| 2 | 28/05/2026 | **INVENTÁRIO** | 0 | **2** | INVENTHIGI280526 | **contaram 2 na mão · sistema dizia 2 · CONFERIU** |
| 3 | 19/06/2026 | ENTRADA | +2 | **4** | romaneio 833478 | recebido da matriz (NERD.HIGI) |
| 4 | 22/06/2026 | VENDA CANCELADA | 0 | **4** | ticket 00019296 | R$ 624 / 3 itens — **cancelamento legítimo, ver abaixo** |
| 5 | 22/06/2026 | VENDA | −1 | **3** | ticket 00019297 | R$ 258 · operador "VENDEDOR CAIXA" |
| 6 | 18/07/2026 | VENDA | −1 | **2** | ticket 00019558 | R$ 358 · MILENA |
| 7 | 29/07/2026 | VENDA | −1 | **1** | ticket 00019670 | R$ 328 · RAYSSA MELO |

**Sistema hoje: 1 · Prateleira hoje: 0 · FALTA 1**

**Sobre o cancelamento da linha 4 — é legítimo e serve de referência:**

| | Ticket cancelado 00019296 | Ticket bom 00019297 |
|---|---|---|
| Hora | cancelado às 09:46:07 | emitido às 09:46:42 (**35 segundos depois**) |
| Valor | R$ 624 | R$ 624 |
| Cliente | CPF 06881114834 | **mesmo CPF** |
| Operador | 0660 | **mesmo operador** |

Isso é correção de digitação: cancela e refaz na hora, com o mesmo cliente e o mesmo valor.
**Guardar este padrão** — no slide 19 mostro um cancelamento que **não** tem esse re-registro.

**Leitura em uma frase:** as 3 vendas são legítimas e rastreáveis (vendedora identificada, preço na
faixa normal). O problema é a **quarta peça**, que não tem venda nenhuma. Janela: depois de
28/05/2026.

---

## SLIDE 8 — EXTRATO: MORUMBI 1

**Título:** Extrato completo — Morumbi 1

| # | Data | Movimento | Qtd | Saldo | Documento | Detalhe |
|---|---|---|---|---|---|---|
| 1 | 15/05/2026 | VENDA | −1 | **−1** | ticket 00011766 | R$ 358 · MILENY TEIXEIRA — venda antes de a perna ter estoque |
| 2 | 22/05/2026 | AJUSTE | +3 | **2** | TRANSFE2205 | correção de CNPJ (MS.MDINIZ) |
| 3 | 26/05/2026 | **INVENTÁRIO** | −1 | **1** | INVENTMORUMBI2605 | **contaram 1 · sistema dizia 2 · JÁ FALTAVA 1** |
| 4 | 04/06/2026 | ENTRADA | +2 | **3** | romaneio 833055 | recebido da matriz (NERD.MORUMBI) |
| 5 | 25/06/2026 | ENTRADA | +1 | **4** | romaneio 833679 | transferência recebida de Morumbi 2 |
| 6 | 06/07/2026 | VENDA | −1 | **3** | ticket 00012803 | R$ 358 · ENZO MORAES |
| 7 | 23/07/2026 | ENTRADA | +1 | **4** | romaneio 834303 | recebido da matriz (NERD.MORUMBI) |
| 8 | 04/08/2026 | VENDA | −1 | **3** | ticket 00013440 | R$ 315 · STEPHANIE DE PAULA |
| 9 | 11/08/2026 | **VENDA CANCELADA** | 0 | **3** | ticket 00013589 | R$ 358 · login genérico "CAIXA" — **ver slide 19** |

**Sistema hoje: 3 · Prateleira hoje: 1 · FALTA 2**

**Explicando as linhas 1, 2 e 3 (não são perda):** Morumbi 1 opera em duas pernas de CNPJ
(RDRRRJ e RDRX). A mercadoria entrou em uma perna e a venda saiu na outra, gerando saldo negativo.
Os ajustes de maio corrigiram esse descasamento. **Isso é problema contábil, não perda.**

**O que É perda nesta loja:**

| Quando | Quanto | Como sabemos |
|---|---|---|
| Antes de 26/05/2026 | 1 peça | inventário contou 1 e o sistema dizia 2 |
| Depois de 26/05/2026 | 2 peças | sistema diz 3, prateleira tem 1 |
| **Total** | **3 peças do mesmo item em ~3 meses** | |

**Falar:** é a única loja com perda **recorrente documentada** no mesmo produto. É onde eu começaria.

---

## SLIDE 9 — EXTRATO: as outras 5 lojas (controle)

**Título:** As outras lojas — todas fecham

Mostro as demais lojas para provar que o extrato não "fecha por acaso" nem só onde é conveniente.

**MORUMBI 2 (RDRRX) — 11 movimentos**

| Data | Movimento | Qtd | Saldo | Detalhe |
|---|---|---|---|---|
| 12/05 | ENTRADA | +2 | 2 | romaneio 832257 |
| 16/05 | VENDA | −1 | 1 | R$ 270 · THAÍS LIMA |
| 03/06 | ENTRADA | +2 | 3 | romaneio 833038 |
| 16/06 | VENDA | −1 | 2 | R$ 298 · THAÍS LIMA |
| 21/06 | VENDA | −1 | 1 | R$ 298 · THAÍS LIMA |
| 24/06 | TRANSFERÊNCIA → Morumbi 1 | −1 | 0 | romaneio 031566 |
| 25/06 | ENTRADA | +1 | 1 | romaneio 833671 (veio de Eldorado) |
| 02/07 | VENDA | −1 | 0 | R$ 358 · THALIA LIMA |
| 23/07 | ENTRADA | +3 | 3 | romaneio 834306 |
| 28/07 | ENTRADA | +1 | 4 | romaneio 834405 (veio de Center Norte) |
| 14/08 | VENDA | −1 | **3** | R$ 358 · THALIA LIMA |

**CENTER NORTE — 4 movimentos**

| Data | Movimento | Qtd | Saldo | Detalhe |
|---|---|---|---|---|
| 13/05 | ENTRADA | +2 | 2 | romaneio 832295 |
| 20/06 | ENTRADA | +2 | 4 | romaneio 833494 |
| 22/07 | TRANSFERÊNCIA → Morumbi 2 | −1 | 3 | romaneio 032222 |
| 17/08 | **VM (mostruário)** | −1 | **2** | romaneio 032688 — **única baixa de mostruário da rede** |

**ELDORADO — 5 movimentos**

| Data | Movimento | Qtd | Saldo | Detalhe |
|---|---|---|---|---|
| 13/05 | ENTRADA | +2 | 2 | romaneio 832279 |
| 20/06 | ENTRADA | +2 | 4 | romaneio 833490 |
| 23/06 | TRANSFERÊNCIA → Morumbi 2 | −1 | 3 | romaneio 031507 |
| 05/08 | VENDA | −1 | 2 | R$ 368 · KAUÃ MEDINA |
| 09/08 | VENDA | −1 | **1** | R$ 398 · KAUÃ MEDINA |

**VILLA LOBOS — 9 movimentos (a loja que mais vendeu)**

| Data | Movimento | Qtd | Saldo | Detalhe |
|---|---|---|---|---|
| 12/05 | ENTRADA | +2 | 2 | romaneio 832249 |
| 13/05 | VENDA | −1 | 1 | R$ 398 · SAULO RIBEIRO |
| 05/06 | ENTRADA | +2 | 3 | romaneio 833067 |
| 07/07 | VENDA | −1 | 2 | R$ 398 · LUCAS SILVA |
| 23/07 | VENDA CANCELADA | 0 | 2 | R$ 358 — re-registrada no mesmo dia, mesmo cliente |
| 23/07 | VENDA | −1 | 1 | R$ 400 · SAULO RIBEIRO |
| 28/07 | ENTRADA | +1 | 2 | romaneio 834391 |
| 20/08 | VENDA | −1 | 1 | R$ 398 · SAULO RIBEIRO |
| 23/08 | VENDA | −1 | **0** | R$ 350 · SAULO RIBEIRO |

**MORUMBI RDRX (perna antiga de Morumbi 1) — 2 movimentos**

| Data | Movimento | Qtd | Saldo | Detalhe |
|---|---|---|---|---|
| 12/05 | ENTRADA | +2 | 2 | romaneio 832256 |
| 25/05 | AJUSTE (zeragem de CNPJ) | −2 | **0** | ZERATRANSF2505 — mercadoria migrada para RDRRRJ |

**Falar:** Villa Lobos vendeu 5 e ficou zerada — comportamento esperado de um produto que gira.
Leblon recebeu 4 e não vendeu nenhuma. O contraste está aqui.

---

## SLIDE 10 — Todos os saldos fecham

**Título:** Recalculamos tudo do zero — e bate

Somei **todos** os movimentos de cada loja desde o primeiro dia e comparei com o saldo que está
registrado no sistema hoje:

| Loja | Saldo recalculado pelos movimentos | Saldo registrado no Linx | Confere? |
|---|---|---|---|
| MATRIZ | 0 | 0 | sim |
| CENTER NORTE | 2 | 2 | sim |
| ELDORADO | 1 | 1 | sim |
| HIGIENÓPOLIS | 1 | 1 | sim |
| LEBLON | 4 | 4 | sim |
| MORUMBI 1 | 3 | 3 | sim |
| MORUMBI 2 | 3 | 3 | sim |
| MORUMBI RDRX | 0 | 0 | sim |
| VILLA LOBOS | 0 | 0 | sim |

**Nove de nove, sem uma peça de diferença.**

E as buscas que voltaram **vazias** — ou seja, nada a explicar por esses caminhos:

| Verificação | Resultado |
|---|---|
| Romaneio em trânsito não confirmado | nenhum |
| Entrada de loja pendente | nenhuma |
| Troca ou devolução de cliente | nenhuma |
| Ajuste feito pelo dashboard | nenhum |
| Venda marcada "não movimenta estoque" | nenhuma |

**Conclusão do slide:** o Linx registrou corretamente **tudo o que foi informado a ele**. O problema
é o que nunca foi informado.

---

## SLIDE 11 — As 33 peças, rastreadas

**Título:** De onde veio cada peça

**Produção na matriz — 4 lotes, 33 peças:**

| Data | Romaneio | Qtd | Responsável |
|---|---|---|---|
| 11/05/2026 | 832223 | 14 | FATIMA.NOBREGA |
| 02/06/2026 | 832911 | 6 | EDGE.SILVA |
| 19/06/2026 | 833455 | 8 | EDGE.SILVA |
| 23/07/2026 | 834297 | 5 | EDGE.SILVA |
| **Total** | | **33** | |

A matriz enviou as 33 peças para as lojas e encerrou com saldo zero.

**A conta da rede:**

```
  33   produzidas e enviadas pela matriz
−  18   vendidas (líquido, canceladas já descontadas)
−   1   baixada como mostruário/VM (Center Norte, 17/08)
──────
  14   = exatamente o estoque registrado hoje na rede
```

As 3 transferências entre lojas aparecem como saída em uma e entrada em outra, e se anulam.

**Falar:** a conta fecha nos dois sentidos — da produção até a prateleira. Não há peça "perdida no
sistema". As 4 que faltam sumiram **depois** de chegar na loja.

---

## SLIDE 12 — Quem vendeu o produto

**Título:** Vendas por loja

| Loja | Vendas | Observação |
|---|---|---|
| MORUMBI 2 | 5 | ficou com 3 |
| VILLA LOBOS | 5 | zerou o estoque |
| HIGIENÓPOLIS | 3 | **falta 1** |
| MORUMBI 1 | 3 | **falta 2** |
| ELDORADO | 2 | ficou com 1 |
| CENTER NORTE | 0 | baixou 1 como mostruário |
| **LEBLON** | **0** | **falta 1 — nunca vendeu nenhuma** |
| **Total** | **18** | |

Preço praticado: R$ 258 a R$ 400 (tabela R$ 358). Variação normal de desconto por loja.

**Falar:** Leblon é a única que recebeu, nunca vendeu e ainda perdeu peça. Mas **cuidado** — no slide
23 mostro por que "nunca vendeu" não é indício suficiente sozinho.

---

## SLIDE 13 — Hipótese 1: venderam com o código errado

**Título:** Testamos a hipótese do código trocado

**Por que era a suspeita mais forte:** os códigos são sequenciais **e da mesma marca VOLT** —
etiquetas impressas no mesmo lote, embalagens parecidas.

| Código curto | EAN | Produto |
|---|---|---|
| 052604 | 7898586439399 | POWERBANK VOLT 10.000MAH |
| **052605** | **7898586439405** | **FONE TWS VOLT SOUND AIR** |
| 052606 | 7898586439412 | CARREGADOR VEICULAR DUAL VOLT |

**Como testamos:** se o fone tivesse saído registrado como um dos vizinhos, o vizinho teria vendido
mais do que o físico permite. Isso apareceria como estoque negativo ou venda sem lastro. Puxamos o
extrato completo dos dois produtos nas 3 lojas.

**Resultado — hipótese descartada:**

| Produto vizinho | Morumbi 1 | Leblon | Higienópolis | Extrato fecha? |
|---|---|---|---|---|
| POWERBANK VOLT | 6 em estoque, **0 vendas** | 0 (3 transferidas) | 3 em estoque, **0 vendas** | sim |
| CARREGADOR DUAL VOLT | 2 em estoque, 2 vendas | 2 em estoque, 1 venda | 1 em estoque, 4 vendas | sim |

Nenhuma venda a mais. Nenhum saldo negativo. O POWERBANK, aliás, **está sobrando** — nunca vendeu
nada nessas lojas.

Verificação extra: **nenhum outro fone de ouvido** tem estoque negativo nessas 3 lojas.

**Falar:** era a explicação inocente que eu mais queria encontrar. Não está lá.

---

## SLIDE 14 — As outras hipóteses testadas

**Título:** O que mais foi verificado e descartado

| Hipótese | Como foi testada | Resultado |
|---|---|---|
| Erro de sistema / saldo corrompido | recálculo total dos movimentos x saldo registrado | **descartada** — bate nas 9 lojas |
| Romaneio perdido em trânsito | busca por entrada não confirmada | **descartada** — nenhuma |
| Cliente trocou ou devolveu | tabela de trocas do produto | **descartada** — vazia |
| Ajuste indevido pelo dashboard | histórico de ajustes do dashboard | **descartada** — vazio |
| Venda que não baixa estoque | flag "não movimenta estoque" nas vendas | **descartada** — nenhuma |
| Peça aberta como mostruário sem registrar | busca por baixas de VM no produto | **improvável** — o único VM registrado é Center Norte, loja que não tem falta |
| Confusão de cor ou tamanho | cadastro do produto | **impossível** — cor única e tamanho único |

**Falar:** sete caminhos verificados, sete fechados. O que sobra é o slide seguinte.

---

## SLIDE 15 — A PROVA: os inventários de maio

**Título:** Alguém contou essas peças na mão — e elas estavam lá

O extrato normal só mostra os itens que **geraram ajuste** no inventário. Item que conferiu não
aparece — e isso é indistinguível de "item que não foi contado". Fomos na tabela de contagem física
item a item. **O fone estava nas três contagens:**

| Inventário | Loja | Fechado em | Contaram na mão | Sistema dizia | Resultado |
|---|---|---|---|---|---|
| INVENTLEBLON280527 | LEBLON | 29/05/2026 11:15 | **2** | 2 | **CONFERIU** |
| INVENTHIGI280526 | HIGIENÓPOLIS | 28/05/2026 09:16 | **2** | 2 | **CONFERIU** |
| INVENTMORUMBI2605 | MORUMBI 1 | 26/05/2026 07:35 | **1** | 2 | **faltava 1** (ajustado) |

**Por que isso muda tudo:** em Leblon e Higienópolis as peças foram **fisicamente vistas, contadas e
confirmadas** no fim de maio. Elas existiam. Então o desaparecimento tem data:

| Loja | Janela do desaparecimento | Duração |
|---|---|---|
| **LEBLON** | depois de 29/05/2026 (e sem movimento desde 20/06) | **72 dias** |
| **HIGIENÓPOLIS** | depois de 28/05/2026 | 95 dias |
| **MORUMBI 1** | já havia perda antes de 26/05, e 2 peças depois | 97 dias |

**Falar:** é a diferença entre "não sabemos o que aconteceu" e "sabemos a janela de tempo". É o que
permite cruzar com câmera e escala de funcionários.

---

## SLIDE 16 — Linha do tempo: Leblon

**Título:** Leblon — 72 dias sem nada acontecer

```
14/05/2026   Chegam 2 peças (romaneio 832339)
                 ↓
29/05/2026   INVENTÁRIO — contaram 2 na mão · sistema 2 · CONFERIU
                 ↓
20/06/2026   Chegam 2 peças (romaneio 833495) → sistema passa a 4
                 ↓
             ┌─────────────────────────────────────────────┐
20/06 a      │  NENHUM MOVIMENTO NO SISTEMA                │
31/08        │  0 venda · 0 transferência · 0 ajuste       │   72 dias
             │  0 contagem · ninguém tocou no produto      │
             └─────────────────────────────────────────────┘
                 ↓
31/08/2026   Sistema: 4  ·  Prateleira: 3  ·  FALTA 1
```

**Não existe erro de operação que produza isso.** Não houve venda para bipar errado, não houve
romaneio para digitar torto, não houve ajuste para lançar errado. A peça saiu da loja.

---

## SLIDE 17 — Linha do tempo: Higienópolis

**Título:** Higienópolis — 95 dias de janela

```
13/05/2026   Chegam 2 peças (romaneio 832297)
                 ↓
28/05/2026   INVENTÁRIO — contaram 2 na mão · sistema 2 · CONFERIU
                 ↓
19/06/2026   Chegam 2 peças (romaneio 833478)      → sistema 4
22/06/2026   Venda de 1 (ticket 19297, R$ 258)     → sistema 3
18/07/2026   Venda de 1 (ticket 19558, R$ 358)     → sistema 2
29/07/2026   Venda de 1 (ticket 19670, R$ 328)     → sistema 1
                 ↓
31/08/2026   Sistema: 1  ·  Prateleira: 0  ·  FALTA 1
```

As 3 vendas são legítimas e rastreáveis: vendedora identificada, preço dentro da faixa, sem
irregularidade. **O problema é a quarta peça**, que não tem venda nenhuma.

Aqui houve movimentação no período, então a janela é mais larga que a de Leblon — a peça pode ter
saído em qualquer ponto após 28/05.

---

## SLIDE 18 — Linha do tempo: Morumbi 1

**Título:** Morumbi 1 — perda recorrente no mesmo item

```
26/05/2026   INVENTÁRIO — contaram 1 · sistema dizia 2 → JÁ FALTAVA 1 (ajustado)
                 ↓
04/06/2026   Chegam 2 peças                        → 3
25/06/2026   Chega 1 peça (de Morumbi 2)           → 4
06/07/2026   Venda de 1 (ticket 12803, R$ 358)     → 3
23/07/2026   Chega 1 peça                          → 4
04/08/2026   Venda de 1 (ticket 13440, R$ 315)     → 3
11/08/2026   Ticket 13589 ABERTO E CANCELADO (R$ 358)  → ver slide 19
                 ↓
31/08/2026   Sistema: 3  ·  Prateleira: 1  ·  FALTA 2
```

**Somando:** 1 peça perdida antes de maio + 2 depois = **3 peças do mesmo produto em cerca de 3
meses, na mesma loja.**

É a única loja com perda recorrente documentada neste item.

---

## SLIDE 19 — O único evento suspeito com data e hora

**Título:** Ticket 00013589 — Morumbi 1, 11/08/2026

| Campo | Valor |
|---|---|
| Loja | MORUMBI 1 |
| Ticket | 00013589 |
| Digitado em | 11/08/2026 às **13:48:23** |
| Cancelado em | 11/08/2026 às **13:49:43** — 1 minuto e 20 segundos depois |
| Itens no ticket | **1 único item: o fone** |
| Valor | R$ 358,00 |
| Valor pago | R$ 0,00 |
| Vendedor | código 7338 — login genérico **"CAIXA"** |
| Gerente no ticket | 7338 — **o mesmo login** |
| Cliente | **em branco** |
| Terminal | 001 |
| Re-registro da venda | **NENHUM**, nem no dia nem depois |

**Compare com o cancelamento legítimo de Higienópolis (slide 7):**

| | Higienópolis 22/06 (legítimo) | Morumbi 1 11/08 (suspeito) |
|---|---|---|
| Re-registro da venda | sim, em 35 segundos | **nenhum** |
| Cliente identificado | sim (CPF) | **em branco** |
| Itens no ticket | 3 | **1 (só o fone)** |
| Operador | vendedor identificado | **login genérico "CAIXA"** |

**Por que NÃO é prova:** cancelar venda é rotina no Linx. Morumbi 1 teve **141 tickets com
cancelamento e R$ 62.116 cancelados** entre maio e agosto. Isolado, este ticket não sustenta
acusação de ninguém.

**O que ele É:** o **único evento com data e hora exatas** que a investigação produziu.
**É o ponto de cruzamento com a câmera.**

**Falar:** pedir a gravação de 11/08/2026, faixa 13:40–14:00, terminal/caixa 001.

---

## SLIDE 20 — Contexto: cancelamentos não são de uma loja só

**Título:** Cancelamentos por loja (maio a agosto/2026)

| Loja | Tickets | Com cancelamento | % | Valor cancelado |
|---|---|---|---|---|
| MORUMBI 1 | 2.200 | 141 | 6,4% | **R$ 62.116,20** |
| MORUMBI 2 | 1.832 | 101 | 5,5% | R$ 34.236,35 |
| VILLA LOBOS | 1.327 | 101 | **7,6%** | R$ 32.136,90 |
| HIGIENÓPOLIS | 1.358 | 54 | 4,0% | R$ 23.847,28 |
| ELDORADO | 894 | 62 | 6,9% | R$ 21.449,53 |
| LEBLON | 2.031 | 62 | 3,1% | R$ 21.395,70 |
| CENTER NORTE | 1.473 | 57 | 3,9% | R$ 17.663,68 |
| MORUMBI RDRX | 320 | 13 | 4,1% | R$ 4.781,00 |

**Leitura honesta:** em **percentual**, Morumbi 1 (6,4%) **não** é fora da curva — Villa Lobos tem
7,6% e Eldorado 6,9%. Em **valor absoluto** é o dobro da segunda, mas também é a loja de maior
movimento.

**Cancelamentos em Morumbi 1 por vendedor:**

| Vendedor | Tickets cancelados | Valor |
|---|---|---|
| THALIA MYLLENA | 25 | R$ 13.169,00 |
| STEPHANIE DE PAULA | 22 | R$ 13.140,20 |
| RYAN | 17 | R$ 8.986,00 |
| ENZO MORAES | 21 | R$ 7.062,00 |
| KAUÃ MEDINA | 13 | R$ 6.140,00 |
| **login "CAIXA" (7338)** | **17** | **R$ 6.065,00** |
| GYOVANNA OLIVEIRA | 8 | R$ 3.786,00 |
| MILENA MAZZA | 8 | R$ 2.448,00 |
| AGATHA | 3 | R$ 926,00 |
| MILENY TEIXEIRA | 7 | R$ 492,00 |

**Falar:** nenhum vendedor se destaca de forma que sustente conclusão individual. O que este slide
mostra de problema **estrutural** é outro: **R$ 6.065 em cancelamentos sob um login que não
identifica pessoa.** Isso é ponto cego de controle, independente deste caso.

---

## SLIDE 21 — O quadro maior

**Título:** Este fone é a ponta visível de um problema recorrente

Resultado das últimas contagens gerais (todos os itens contados, não só eletrônicos):

| Loja | Inventário | Itens contados | Peças faltando | Peças sobrando | Custo da falta |
|---|---|---|---|---|---|
| MORUMBI 1 | 26/05/2026 | 6.433 | **1.269** | 567 | **R$ 24.428,85** |
| LEBLON | 29/05/2026 | 4.230 | 666 | 572 | R$ 14.632,35 |
| LEBLON | 17/03/2026 | 4.024 | 488 | 684 | R$ 11.628,71 |
| HIGIENÓPOLIS | 28/05/2026 | 7.631 | 610 | 311 | R$ 8.955,89 |
| HIGIENÓPOLIS | 09/03/2026 | 7.560 | 577 | 533 | R$ 17.874,00 |
| **Total das 5 contagens** | | | | | **R$ 77.519,80** |

**O padrão se repete em toda contagem, nas mesmas lojas.**

Parte das "sobras" é reclassificação (item lançado no código errado falta em um e sobra em outro),
mas a **falta líquida é consistente e alta**.

**Falar:** este slide reposiciona a conversa. As 4 peças do fone valem R$ 360 de custo. O que os
inventários mostram é ordem de grandeza de **R$ 9 mil a R$ 24 mil por loja, por contagem**.

---

## SLIDE 22 — O perfil do que desaparece

**Título:** Itens de maior valor faltando no inventário de Morumbi 1 (26/05/2026)

| Produto | Descrição | Sistema | Contado | Falta | Preço |
|---|---|---|---|---|---|
| 28.BT.B037 | TECLADO DOBRÁVEL WIWU | 1 | 0 | −1 | R$ 1.338 |
| W9.20.0001 | ESTABILIZADOR GIMBAL TOMATE MTY 8009 | 1 | 0 | −1 | R$ 1.348 |
| F6.11.13 | POWERBANK GEONAV 10.000MAH 3EM1 | 1 | 0 | −1 | R$ 748 |
| N1.2.0010 | ELITE HEADSET WIWU TD05 | 2 | 0 | −2 | R$ 678 |
| N4.53.0018 | CP TECLADO IPAD 10 2022 | 2 | 1 | −1 | R$ 598 |
| N1.12.0006 | CAIXA DE SOM BEATS 2 MULTI SP624 | 2 | 1 | −1 | R$ 498 |
| D5.10.0012 | HUB WIWU 5 EM 1 | 2 | 0 | −2 | R$ 489 |
| N2.P1.0012 | POWERBANK 5000MAH WUP-1004C | 5 | 0 | −5 | R$ 398 |
| N2.23.0001 | POWERBANK MAGNÉTICO 10000 PEINING | 3 | 0 | −3 | R$ 358 |
| N5.5.0015 | PT PROTECT PRO TABLET 13 CLEAR HD | 8 | 1 | −7 | R$ 258 |
| N2.99.0106 | POWERBANK PEINING 10000MAH WUP951 | 6 | 0 | −6 | R$ 188 |
| N5.9.0033 | PT BEEP IMPRESSÃO PROTECT PRO | 72 | 3 | −69 | R$ 198 |

**O perfil é consistente:** eletrônico pequeno, valor alto, fácil de carregar no bolso. Powerbank,
fone, teclado, caixa de som, película.

**Falar:** esse não é o padrão de erro de digitação — erro de digitação não escolhe produto caro e
pequeno. É o padrão de item que sai pela porta.

---

## SLIDE 23 — O que a apuração NÃO confirmou

**Título:** Uma suspeita que não se sustenta

**Suspeita inicial:** "Leblon nunca vendeu esse fone em 3,5 meses e perdeu peça — logo está vendendo
por fora."

**Por que não se sustenta:** Leblon tem **40 produtos de eletrônico acima de R$ 200, com estoque 2 ou
mais, e zero venda desde 01/06/2026.** Exemplos:

| Produto | Estoque | Preço |
|---|---|---|
| SPEAKER KARAOKE INOVA 2 MICROFONES | 4 | R$ 1.798 |
| CAIXA DE SOM RN03 120W HMASTON | 2 | R$ 1.408 |
| VENTILADOR JISULIFE STROLLER FAN 2S | 2 | R$ 1.168 |
| MÁQUINA DE CAFÉ TOMATE 72W | 2 | R$ 898 |
| FONE QCY CROSSKY GTR 2 | 2 | R$ 798 |
| FONE OEX MAKER POSCA HS117 | 2 | R$ 598 |
| CARREGADOR VOLT 65W 2X USB-C/USB | 3 | R$ 448 |
| FONE BLUETOOTH AERJOY GEONAV | 5 | R$ 438 |

Leblon é loja com **muito encalhe de eletrônico de ticket alto**. "Nunca vendeu" é o normal daquela
loja — não é anomalia.

**O que continua valendo em Leblon, independente disso:** a peça foi contada fisicamente em 29/05,
nada se moveu por 72 dias, e falta uma.

**Falar:** deixo este slide de propósito. Investigação que só apresenta o que confirma a tese não
serve para tomar decisão.

---

## SLIDE 24 — Conclusão

**Título:** Conclusão da apuração

**Descartado com evidência:** erro de sistema · venda com código errado · romaneio perdido · troca ou
devolução · ajuste indevido · baixa de mostruário não registrada · confusão de cor ou tamanho.

**O que sobra: perda física não registrada.**

**A evidência mais forte é Leblon:**

> Item contado na mão em 29/05/2026 e conferindo com o sistema. Entrada de mercadoria em 20/06/2026.
> **Nenhum movimento em 72 dias.** E falta 1 peça.
> Não existe erro operacional que produza esse resultado.

**Furto interno é a explicação que resta.** E o volume das últimas contagens — R$ 8,9 mil a R$ 24,4
mil de falta por loja, por inventário, de forma recorrente — indica que não é caso isolado deste
produto.

**Ressalva necessária e explícita:** esta apuração estabelece **onde**, **quanto** e **em qual janela
de tempo**. Ela **não identifica pessoa**. Nenhum dado deste documento aponta indivíduo como
responsável, e o único evento com hora precisa está registrado sob login genérico.

---

## SLIDE 25 — Números

**Título:** Impacto financeiro

**Este produto, nas 3 lojas conferidas:**

| Métrica | Valor |
|---|---|
| Peças faltando | 4 |
| Custo | R$ 359,60 |
| Venda perdida (preço de tabela) | R$ 1.432,00 |
| **% do lote produzido (33 peças)** | **12,1%** |

**Contexto da rede (últimas 5 contagens gerais):**

| Métrica | Valor |
|---|---|
| Custo total de falta apurada | R$ 77.519,80 |
| Lojas com padrão recorrente | Morumbi 1, Leblon, Higienópolis |
| Intervalo entre inventários | ~3 meses |

**Falar:** o número que importa não são os R$ 360. É **12% de um lote de produto novo desaparecendo
em 3 meses**.

---

## SLIDE 26 — Plano de ação

**Título:** O que fazer agora

**Imediato — esta semana**

1. **Câmera de Morumbi 1: 11/08/2026, 13:40 às 14:00, terminal 001.** É o único evento com data e
   hora que a apuração produziu (ticket 00013589).
2. **Eliminar o login genérico "CAIXA" (7338) em Morumbi 1.** R$ 6.065 em cancelamentos sob login que
   não identifica pessoa é ponto cego de controle, independente deste caso.
3. **Contar fisicamente o fone nas 3 lojas que faltam** — Morumbi 2 (3 no sistema), Center Norte (2),
   Eldorado (1). Fecha o número real da perda deste item.

**Curto prazo — 30 dias**

4. **Contagem cega semanal de eletrônico acima de R$ 300**, sem aviso prévio, nas 3 lojas com padrão
   recorrente — e **registrada como contagem no Linx**. Hoje a janela entre inventários é de 3 meses,
   o que torna qualquer apuração posterior quase impossível.
5. **Rodar esta mesma análise para os outros itens caros** dos inventários de maio: cruzar contagem
   física × movimentos posteriores × estoque atual. Produz a lista completa do que sumiu desde
   26–29/05 **sem precisar de nova contagem geral**.
6. **Alerta no dashboard:** eletrônico com estoque parado há mais de 45 dias e zero movimento. Hoje o
   caso Leblon passaria invisível indefinidamente.

**Estrutural**

7. **Revisar a impressão de etiquetas em sequência para produtos da mesma marca.** Os códigos
   052604 / 052605 / 052606 são três produtos VOLT diferentes com etiquetas do mesmo lote. Não causou
   este problema, mas é risco desnecessário.
8. **Reduzir o intervalo de inventário** nas lojas com falta acima de R$ 10 mil por contagem.

---

## SLIDE 27 — Anexo técnico: como a apuração foi feita

**Título:** Anexo — rastreabilidade da apuração

**Fontes consultadas (LINX_PRODUCAO, consulta direta):**

| Verificação | Tabela / join |
|---|---|
| Cadastro, cores e códigos | `PRODUTOS`, `PRODUTO_CORES`, `PRODUTOS_BARRA` |
| Saldo por filial | `ESTOQUE_PRODUTOS` |
| Entradas | `ESTOQUE_PROD_ENT` + `ESTOQUE_PROD1_ENT` (ROMANEIO_PRODUTO) |
| Saídas | `ESTOQUE_PROD_SAI` + `ESTOQUE_PROD1_SAI` (ROMANEIO_PRODUTO) |
| Romaneios de loja / trânsito | `LOJA_ENTRADAS`/`LOJA_SAIDAS` + `_PRODUTO` |
| Vendas | `LOJA_VENDA` + `LOJA_VENDA_PRODUTO` (CODIGO_FILIAL + TICKET) |
| Trocas e devoluções | `LOJA_VENDA_TROCA` |
| Inventário — ajustes aplicados | `ESTOQUE_PROD_CONTAGEM` + `ESTOQUE_PROD_CTG_AJUSTE` |
| **Inventário — contagem física** | **`ESTOQUE_PROD_CTG_ITENS`** |
| Ajustes do dashboard | `NERD_AJUSTE_HISTORICO` |

**Regras aplicadas:**

- Venda líquida = `QTDE − QTDE_CANCELADA`. Linha com `QTDE_CANCELADA <> 0` é **cancelamento**, não
  devolução — não devolve peça ao estoque.
- Vendas com `NAO_MOVIMENTA_ESTOQUE = 1` foram excluídas.
- Filiais resolvidas por código: Morumbi 1 = 000099/000116 · Morumbi 2 = 000115 · Leblon = 000095 ·
  Higienópolis = 000073 · Eldorado = 000114 · Villa Lobos = 000076 · Center Norte = 000089 ·
  Matriz = 000069.
- Morumbi 1 opera em duas pernas de CNPJ (RDRRRJ e RDRX). Os ajustes de maio/2026 (TRANSFE2205,
  ZERATRANSF2505, INVENTMORUMBI2605) corrigiram esse descasamento e **não** são perda.

**Nota metodológica — a chave da investigação:**

> `ESTOQUE_PROD_CTG_AJUSTE` (usada pelo extrato de produto do dashboard) só contém linha para item
> que **gerou ajuste**. Item que conferiu não aparece, o que é indistinguível de item não contado.
> A prova de conferência física está em `ESTOQUE_PROD_CTG_ITENS`, comparando `QTDE_CONTAGEM`
> (contado na mão) com `SALDO_CONTAGEM` (o que o sistema dizia naquele momento).
> **Foi essa comparação que fechou a janela temporal desta investigação.**

---

## SLIDE 28 — Notas de produção (não vai na apresentação)

**Slides essenciais**, se precisar de versão curta (9 slides):
1 · 2 · 4 · 6 (extrato Leblon) · 13 · 15 · 16 · 21 · 24 · 26

**Slides que são o coração do material:** 6, 7, 8 e 9 — os extratos. É onde a perda fica visível
linha por linha. Não cortar o slide 5 (legenda) se mantiver os extratos.

**Slides deliberadamente contra a tese:** 20 e 23. **Recomendo manter** — dão credibilidade à
conclusão e evitam que a apresentação seja lida como acusação montada.

**Privacidade:** nomes de vendedores aparecem nos slides 7, 8, 9 e 20. Se a apresentação for
compartilhada além da diretoria, considerar substituir por códigos.

**Conferência:** todos os valores, datas, romaneios e números de ticket foram verificados em
31/08/2026 contra LINX_PRODUCAO.
