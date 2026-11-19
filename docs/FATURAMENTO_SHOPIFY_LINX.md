# Faturamento Shopify → Linx (NF-e de e-commerce)

Mapeamento feito em 17/11/2026 a partir dos prints do Linx (Clientes 001015SPK, Faturamento de
Produto Acabado 100101SPK, Monitor de Controle da NF-e 100135SPK) e de leitura do banco
LINX_PRODUCAO (só SELECT). Exemplos de referência: NF NERD 001/000001559 (Bianca, pedido
Shopify **#1710**) e 001/000001560 (Patrícia Sbrissa, pedido **#1711**).

> Os prints misturam os dois pedidos: o cadastro é da Bianca (#1710 — Alça Universal **Black**,
> cor 06, desconto 5% = 9,90, frete 21,90, total 210,00 = NF 1559), mas os valores da tela de
> NF (Cappuccino S1, PRIMEIRA10 −19,80, frete 25,94, total 204,14) são do #1711 = NF 1560.

---

## 1. Como é feito hoje (manual, NERD **e** Scarf Me)

| Passo | Onde | Tempo médio |
|---|---|---|
| 1. Abrir o pedido pago no Shopify | Shopify admin | — |
| 2. Achar o cliente (nome/código) ou cadastrar | Clientes 001015SPK | ~1 min antes da NF |
| 3. Criar a NF: natureza, cliente, itens, frete, desconto, peso, transportadora… | 100101SPK | 1 NF a cada 2–3 min |
| 4. Selecionar a NF e "Envia NFe para Sefaz" | Monitor 100135SPK | 3–5 h depois do save |

**Volume:** a Scarf Me fatura à mão também — ~700–1.500 NFs/mês (MSC até 30/06, AKS desde
01/07, rodízio). NERD: ~20/mês em nov. Em 100% das NFs de e-commerce: `TIPO_FATURAMENTO='PADRAO'`,
`COD_TRANSACAO='FATURAMENTO_022'`, pedido interno "NF SEM PEDIDO". Não existe integração automática.

---

## 2. O que o Shopify já entrega (Admin GraphQL, ao vivo)

O espelho Neon (`shopify_orders`) não guarda endereço nem CPF → buscar o pedido ao vivo.

| Dado | Campo Shopify | Destino no Linx |
|---|---|---|
| CPF/CNPJ | `localizedFields` `TAX_CREDENTIAL_BR` (também `customAttributes.payment_additional_taxid`) | `CGC_CPF` (+COBRANCA/ENTREGA_CGC) |
| Nome | `shippingAddress.name` | `RAZAO_SOCIAL` (maiúsc.), `NOME_CLIFOR = LEFT(razão,25)` |
| Endereço | `address1` = "Rua X, 604" | `ENDERECO` + `NUMERO` (separar na última vírgula) |
| Complemento/bairro | `address2` | `COMPLEMENTO`; `BAIRRO` vem do CEP (ViaCEP/BrasilAPI) |
| Cidade/UF/CEP | `city`, `provinceCode`, `zip` | cidade **sem acento**, IBGE pelo CEP |
| Telefone | `shippingAddress.phone` "67998660096" | `DDD1='067'`, `TELEFONE1='998660096'` |
| E-mail | `email` | `EMAIL` = `EMAIL_NFE` (maiúsc.) |
| Itens | `lineItems.sku` (= `PRODUTOS_BARRA.CODIGO_BARRA`) | `PRODUTO`, `COR_PRODUTO`, `TAMANHO` |
| Preço | `originalUnitPriceSet` | `FATURAMENTO_PROD.PRECO` |
| Desconto | `totalDiscountsSet` (+ `discountCodes`) | `DESCONTO` / `PORC_DESCONTO` do cabeçalho |
| Frete | `totalShippingPriceSet` | `FRETE` |
| Pagamento | `transactions.gateway` (PagBrasil Pix/cartão) | `INFO_PGTO=90` "SEM PAGAMENTO" (já pago no site) |
| Nº do pedido | `name` "#1710" | `FATURAMENTO.OBS` (hoje digitado à mão; NERD deixa vazio em 28%) |

SKU → produto: `PRODUTOS_BARRA` (ex.: 051065 → X2.03.0023 cor 06; 051641 → cor S1) e, para os
casos difíceis, o mapeamento já existente em `shopify_variant_map` / `shopify_variant_linx_extra`.

---

## 3. Aba CLIENTES — cadastro PF de e-commerce

Tabelas: `CADASTRO_CLI_FOR` (PK `NOME_CLIFOR` varchar 25) + `CLIENTES_ATACADO` + `CLIENTE_REPRE`.
Código: `SEQUENCIAIS 'CLIENTES_ATACADO.CLIFOR'` + 1 (hoje 850792). Reaproveita
`lib/repositories/clienteCorporativo.ts` como base (cópia nova, não alterar o corporativo).

### Padrão medido (novos desde mai/2026 — NERD n=33, Scarf n=4.279)

| Campo | Valor | Aderência |
|---|---|---|
| PJ_PF / INDICADOR_FISCAL_TERCEIRO | 0 / 8 (não contribuinte) | 100% |
| RG_IE (+COBRANCA/ENTREGA_IE) | `'9999999999999999999'` (19 noves) | 98–100% |
| Cobrança e entrega | cópia exata do endereço principal (+ RAZAO_SOCIAL, CGC, DDD, tel) | ~100% |
| COD_MUNICIPIO_IBGE (3 vias) | IBGE da cidade | ~100% |
| CIDADE | **sem acento**, maiúsc. (trigger casa com `LCF_LX_MUNICIPIO`) | 100% |
| Texto | tudo MAIÚSCULO; nome/endereço mantêm acento | 100% |
| PAIS | 'BRASIL'; DDI omitido (banco grava ' ') | 97% |
| CLIENTES_ATACADO.TIPO | 'WEB' | 97–99% |
| CONCEITO / PONTUALIDADE / TIPO_BLOQUEIO | 'BOM' / 'INDEFINIDO' / 'INDEFINIDO' | 100% |
| TRANSPORTADORA (cadastro) | 'NOSSO CARRO' | 100% |
| CONDICAO_PGTO / CODIGO_TAB_PRECO | '01' / '01' | 100% |
| CTB_CONTA_CONTABIL | '1120302' (no plano é "VISA ELECTRON" — confirmar c/ contabilidade) | 99–100% |
| INDICADOR_VENDA / MOEDA | 'V' / 'R$' | 100% |
| REGIAO | **derivar da UF** (hoje é manual e erra ~30% fora do Sudeste) | — |
| FILIAL | Scarf: 'SCARF ME - MATRIZ' (100%). NERD: histórico 'SCARF ME - MATRIZ' (94%), mas 16/11 passou a 'NERD' — **decidir** | — |
| CLIENTE_REPRE | 'SEM REPRESENTANTE', comissão 0, principal 1 | 99–100% |

UF → REGIAO (`REGIOES_VENDA`): NORTE AC AM AP PA RO RR TO · NORDESTE AL BA CE MA PB PE PI RN SE ·
CENTRO OESTE DF GO MS MT · SUDESTE ES MG RJ SP · SUL PR RS SC.

### Busca e reaproveitamento

- 1º por CPF (`CGC_CPF = @cpf`, parâmetro **VarChar** p/ usar o índice) → listar **todos** os
  cadastros do CPF (há CPF com até 36), com nome, CEP, cidade, última NF. Depois por nome/código.
- 9,5% dos novos da Scarf já tinham o CPF (cadastro refeito); 16/11 a NERD duplicou
  'PATRÍCIA SBRISSA'/'PATRICIA SBRISSA'. A tela sugere o existente quando CPF bate.
- 35% dos reaproveitados tiveram endereço alterado → ação "usar e atualizar endereço"
  (UPDATE das 3 vias; trigger grava `CADASTRO_CLI_FOR_LOG` e recalcula IBGE pela cidade).
- Colisão de `NOME_CLIFOR` com outro CPF: o Linx usa espaço à esquerda; sugerimos sufixo.

### Triggers relevantes

`LXI_CADASTRO_CLI_FOR`: completa/valida IBGE (erro 30002 se cidade não casar), ETL p/ lojas.
`LXI_CLIENTES_ATACADO`: FK de todos os lookups. `LXU_CADASTRO_CLI_FOR`: log + recálculo IBGE.

> **Bug existente no corporativo:** `clienteCorporativo.ts` grava CIDADE com acento
> (BRASÍLIA, NITERÓI…). Entra porque manda o IBGE, mas qualquer edição posterior de cidade/UF
> no Linx falha com 30002. Correção separada, sob autorização.

### Cadastro PJ (CNPJ) — fluxo separado (18/11/2026)

Botão próprio "Cadastrar PJ (CNPJ)" (`ClientePjForm.tsx` → `/api/faturamento-ecommerce/clientes-pj`
→ `clientesPj.ts`). O cadastro de pessoa física recusa CNPJ (tela, rota e repositório) e
oferece abrir o PJ com os dados digitados; pedido do Shopify com CNPJ abre direto o PJ.

- **Perfil WEB (padrão) ou CORPORATIVO** — seletor no topo do formulário; trocar o Tipo
  para WEB/CORPORATIVO troca o perfil junto. Cada perfil grava o conjunto inteiro, medido
  nos CNPJs cadastrados desde 2025 (`PERFIS_CLIENTE_PJ` em `config.ts`):

  | | WEB (97) | CORPORATIVO (87) |
  |---|---|---|
  | CTB_CONTA_CONTABIL | 1120302 | 1120101 |
  | INDICADOR_VENDA | V | ' ' |
  | AGRUPAMENTO_ITENS | 0 | 2 |
  | CODIGO_TAB_PRECO | 01 | 05 |
  | TRANSPORTADORA | NOSSO CARRO | CORREIOS - SEDEX |

  O repositório recusa Tipo de um perfil com o outro perfil selecionado.
- Campos do cadastro corporativo: IE ISENTO, IE/IM/SUFRAMA/tributação, cobrança e entrega
  próprias, 2º telefone, limite, OBS. Filial = a da empresa (NERD / SCARF ME - MATRIZ).
  Busca CNPJ na BrasilAPI + CEP para o IBGE. CIDADE das 3 vias vem do IBGE (sem acento).
- **Indicador fiscal pelo perfil (editável): WEB 8, CORPORATIVO 1.** As pernas do e-commerce
  (Simples) não têm exceção de venda para contribuinte — com indicador 1/16 a
  `FX_ID_EXCECAO_IMPOSTO` cai em 1117 "DEVOLUÇÃO COMPRA" (CSOSN 900) e a prévia bloqueia
  com "fature pela MATRIZ". Com 8: 5102/6108 CSOSN 102. Na Matriz o 1 funciona em SP e fora
  (100% dos corporativos têm 1 e saem pela Matriz, 100.05). Indicador 1 com IE ISENTO é aceito
  pela SEFAZ (105 NFs da Matriz autorizadas desde jun/2025). Informar IE troca para 1.
- IE gravada só com dígitos. DDD '011' (com zero) e DDD2 = DDD1 sem 2º telefone, como o cadastro
  modelo do dono (850797) — o CNPJ WEB simulado bate com ele em 180 de 181 colunas (a outra é
  PJ_PF, que o modelo, sendo CPF, tem 0).
- **Os 4 modos na própria página (19/11/2026, pedido do dono):** pessoa física e CNPJ, cada um
  com perfil WEB ou CORPORATIVO (`PERFIS_CLIENTE_PF` / `PERFIS_CLIENTE_PJ`). Trocar o perfil
  troca o conjunto inteiro; Tipo de um perfil com o outro selecionado é recusado (tela e
  servidor). PF CORPORATIVO = conjunto do corporativo (1120101, tabela 05, CORREIOS - SEDEX,
  ind. venda ' ') com as regras de PF da área Corporativo (agrupamento 0, RG ISENTO, indicador 8).
  A área Corporativo continua como está. Página chama "Faturamento E-com / Matriz" nas duas
  empresas (a NERD não tem filial extra; o nome é o mesmo).

**Validação 18/11/2026 (ROLLBACK, contra o Linx real):** padrão medido desde 2025 — PF WEB
(12.655), PJ WEB (97), PJ CORPORATIVO (87, todos do dashboard corporativo). Os 3 cadastros
simulados batem campo a campo (indicador, agrupamento, ind. venda, conta, tabela,
transportadora, condição, conceito, pontualidade, filial, IE, representante, DDD). Matriz de
faturamento (prévia com clientes reais): WEB → pernas/NERD ok, Matriz só em SP; contribuinte
(1/16) → só Matriz (100.05/100.08), pernas/NERD bloqueiam — igual ao histórico de NFs.

---

## 4. Aba FATURAMENTO — gravar a NF (equivalente ao 100101SPK)

Fluxo: escolher pedido pago do Shopify (fila "não faturados" = sem NF com OBS `#nnnn`) →
cliente (aba 3) → NF pré-preenchida → conferir → **Gravar** → NF com `STATUS_NFE=1` e chave.

### O que uma NF grava (uma transação)

1. **Pedido "NF SEM PEDIDO"** — `VENDAS` + `VENDAS_PRODUTO` (nº de `SEQUENCIAIS 'VENDAS.PEDIDO'`),
   `APROVADO_POR='NF SEM PEDIDO'`, `TIPO='VENDA ATACADO'`, `COLECAO='62'`, qtde já entregue
   (`QTDE_ENTREGUE`=qtde, `VO1`/grade). Base: `lib/repositories/pedidoVendaLinx.ts`.
   Colunas computadas: `FATOR_VENDA_LIQUIDA`, `QTDE_LIQUIDA`, `VALOR_LIQUIDO`, rowversion `TIMESTAMP`.
2. **FATURAMENTO** (cabeçalho) — nº de `FATURAMENTO_SEQUENCIAIS(FILIAL,SERIE)` +1 com UPDLOCK
   (NERD '001' = 1560; AKS '1' = 4493; MSC '1' = 3942).
3. **FATURAMENTO_PROD** (produto×cor, grade F1..F48) — **baixa estoque no INSERT** (trigger) na
   filial de `COD_FILIAL_ESTOQUE` (obrigatório). `TIMESTAMP` é o preço codificado via
   `dbo.FX_PRODUCAO_PRECO`. Valida que o item exista em `VENDAS_PRODUTO`.
4. **FATURAMENTO_ITEM** (fiscal, item×tamanho) — NCM, CFOP, CSOSN, exceção, rateio de
   desconto/frete por item, IBPT.
5. **FATURAMENTO_IMPOSTO** — via proc oficial `LX_GERA_IMPOSTOS_SAIDA` (a partir da exceção).
6. **FATURAMENTO_OBSERVACAO** — via `LX_INFORMACAO_COMPLEMENTAR_NOTA_FISCAL` (Simples + IBPT);
   texto do tipo 7 (DIFAL zerado, só 100.022) é montado no cliente → replicar.
7. **CHAVE_NFE** calculada no Node (cUF 35 + AAMM + CNPJ + 55 + série SINTEGRA '055' + nNF +
   tpEmis 1 + cNF aleatório 8 + DV mód. 11).

Gerado **depois**, pela autorização (não inserir): `STATUS_NFE=5`, protocolo, XML em
`DADOS_CADASTRO_XML_NFE`, contábil `CTB_LANCAMENTO*`, contas a receber `CTB_A_RECEBER_*`, `FATURA`.

### Cabeçalho — defaults medidos (NERD / MSC / AKS)

| Campo | Valor | Aderência |
|---|---|---|
| NATUREZA_SAIDA | 100.02 se UF cliente = SP (UF da filial), senão 100.022 | NERD 100%, Scarf ~98% |
| SERIE_NF | NERD '001'; MSC/AKS '1' | 100% |
| Filial Scarf | ativa do rodízio (hoje AKS) — `resolveCompanyDynamic` | — |
| CONDICAO_PGTO | '01' 30 DIAS | 97–100% |
| TIPO_FRETE | '2' FOB | ~100% |
| TRANSPORTADORA / TRANSP_REDESPACHO | 'CORREIOS - SEDEX' (alt. 'NOSSO CARRO') | 82–95% |
| PESO_LIQUIDO / PESO_BRUTO / VOLUMES / TIPO_VOLUME | 1 / 1,1 / 1 / 'CAIXA DE PAPELAO' | ~100% |
| INFO_PGTO | 90 'SEM PAGAMENTO' | 97–100% |
| AGRUPAMENTO_ITENS | 2 Referência+Cor+Tamanho | ~100% |
| INDICA_CONSUMIDOR_FINAL / INDICA_PRESENCA_COMPRADOR | 1 / 0 | ~100% |
| REPRESENTANTE / GERENTE | 'SEM REPRESENTANTE' | ~100% |
| RATEIO_FILIAL / RATEIO_CENTRO_CUSTO | COD_FILIAL da filial / '001' | 100% |
| Contábil | tipo ITR / operação 100 (da natureza) | 100% |
| TIPO_EMISSAO_NFE / FIN_EMISSAO_NFE / UTC | 1 / 1 / 3 | ~100% |
| Desconto | **só no cabeçalho**: `PORC_DESCONTO` + `DESCONTO = round(sub×%/100,2)` | 100% |
| OBS | `#<nº pedido Shopify>` (sempre — hoje NERD esquece 28%) | — |
| EMISSAO / DATA_SAIDA / DATA_HORA_EMISSAO | data / data / data+hora do **SQL Server** (`GETDATE()`) | — |

`VALOR_TOTAL = VALOR_SUB_ITENS − DESCONTO − DESCONTO_COND_PGTO + FRETE + SEGURO + ENCARGO`
(bate em 6.368/6.368 NFs). Espelhos `MPADRAO_*` iguais.

### Regra fiscal

- Exceção: `dbo.FX_ID_EXCECAO_IMPOSTO(...)` (pode ser chamada em SELECT) → CSOSN 102,
  CFOP (indicador 11: 5102/6108; 10: 5101/6107; 71/ST: 5405/6404), impostos e CSTs.
- **⚠️ NERD (000069) tem exceção por UF criada sob demanda** (BA, PE, PR, CE, MG, RR, RS, ES, MS,
  DF, PA, RJ, SP). Para UF sem exceção (ex.: GO, SC) a função cai em **1117 "DEVOLUÇÃO COMPRA",
  CSOSN 900** → NF errada. A NF 1559 só passou porque alguém criou a exceção MS (1274) às 13:04,
  antes de transmitir. AKS usa uma genérica (1201) para todas as UFs.
  → A tela **bloqueia** quando a exceção não é a esperada, até o fiscal criar uma genérica para
  a NERD (decisão do contador).

### Travas obrigatórias

- Pedido Shopify já faturado (OBS `#nnnn` existente na filial) → bloqueia (anti-duplicidade).
- Pedido não pago / cancelado / reembolsado → bloqueia.
- SKU sem produto no Linx → bloqueia o item (vincular antes).
- Estoque: `PERMITE_EST_NEGATIVO` está **true** em NERD 000069, AKS, MSC (lido em 17/11/2026) —
  o trigger não confere saldo; a tela avisa saldo insuficiente.
- Emissão em data fechada (`CM_DATA_FECHAMENTO`, `CTB_FECHAMENTO` tipo 03) → trigger recusa.
- Número/estoque são consumidos no save: NF errada exige cancelamento/inutilização no monitor.
- Usuário gravado = usuário do Linx (`resolveResponsavelLinx`), nunca o do dashboard.

### Faturar pela Matriz da Scarf Me (18/11/2026)

Pedido do site às vezes é faturado pela `SCARF ME - MATRIZ` (cód. 001), como o corporativo.
Ela entra na lista de filiais da Scarf Me como **extra, fora do rodízio** (`PADROES.scarfme.nota.filiaisExtras`):
vem por último, nunca vira a principal (a principal é só entre as pernas, por NF 100.02/100.022).

- **Regime normal (CRT 3), não Simples.** Declarado no config (`simplesNacional: false`) —
  `FILIAIS.TIPO_TRIBUTACAO` não serve (MSC e CMS, que são Simples, estão vazias). As pernas do
  rodízio continuam sempre Simples, com o cálculo de antes intocado (`valorImposto`).
- **Naturezas** medidas nas NFs dela: 100.05 VENDA PRIVATE (dentro e fora de SP; 1.204 NFs) e
  100.08 REVENDA (cliente indicador 16; 2.004 NFs). Nunca usou 100.02/100.022.
- **Impostos** (`impostosRegimeNormal`): base = item − desconto + frete/seguro (pelas flags da
  exceção), redução da exceção (ICMS 33,33% em SP); taxa da exceção ou, se 0, a do ICMS da
  operação (`UNIDADES_FEDERACAO_ICMS` SP→SP 18, →RJ/MG 12, →CE/BA 7); base arredondada, valor
  truncado sobre a base exata; IBS/CBS = alíquota do tipo sobre item − ICMS − PIS − COFINS,
  arredondado; `BASE_IMPOSTO_CALC` = base. DICMS (11/71/72/73) não é gravado (como o Linx faz
  para contribuinte). Conferência em 18/11 contra NFs reais out–nov: base 100%; ICMS 100% em
  NF de 1 item; PIS/COFINS 2.329/2.330; IBS/CBS ~98,6%. Em NF de **vários itens** o Linx reparte
  o ICMS do total e ~metade dessas NFs tem alguma linha ±R$ 0,01 diferente deste cálculo.
- **Consumidor final** = só indicador 8 (empresa 1 e revenda 16 = 0); IBPT (tributos
  aproximados, OBS tipo 6) só para consumidor final. Sem OBS tipo 7 (DIFAL).
- **Trava:** não contribuinte (indicador ≠ 1/16) de outra UF tem DIFAL → bloqueado (fature no
  Linx). Também bloqueia exceção com CSOSN (3 dígitos) e imposto fora da lista conhecida.
- **Numeração:** NF_SAIDA com a largura do sequencial da filial (Matriz 7 dígitos `0043671`;
  pernas 9). A chave usa sempre 9. Detalhe, busca e envio procuram nas duas larguras.
- `ENTREGA_CIF` = `TIPO_FRETE.FRETE_PAGO` (vale para todas: '2'→0, '01'→1, '04'→9, '05'→3).
- XML gerado pela `LX_GERA_NFE_SEFAZ_4_00` numa simulação desfeita: CRT 3, CST 20, pRedBC
  33,3333, indFinal 0. O texto legal da redução (`INFORMACAO_COMPLEMENTAR`) o Linx preenche no envio.
- A Matriz **não aceita estoque negativo**: o trigger recusa a NF se não houver saldo.

---

## 5. Aba SEFAZ — monitor e envio

### Como o Linx envia de verdade

O botão "Envia NFe para Sefaz" **não é um gatilho de banco**. O próprio Visual Linx (desktop):
1. `LX_EXECUTE_PROCESS 'LX_GERA_NFE_SEFAZ_4_00'` (proc **criptografada**) → XML 4.00;
2. `UPDATE FATURAMENTO SET STATUS_NFE=2/3`;
3. chama por HTTP a API **Linx Fiscal Flow (MIDe Evo)** — `INTEGRACOES_API` ID 6,
   `https://api-evo.fiscalflow.linx.com.br/` (uma config para todas as empresas);
4. devolve o retorno via `LX_PROCESSAMENTO_RETORNO_MIDe_SEFAZ` (criptografada) →
   STATUS_NFE 5 / 4, `DADOS_CADASTRO_XML_NFE`, `LX_CTB_INTEGRAR_FATURAMENTO`.

Os "jobs" no rodapé do monitor são registros de `LX_EXECUTE_PROCESS`
(`PROCESSOS_SISTEMA_ATIVIDADES`), não SQL Agent. Não há fila no banco.

### STATUS_NFE

| STATUS | LOG | Filtro do monitor |
|---|---|---|
| 1 | 0 | Não Enviado (NF gravada, chave pronta) |
| 2 | 0 / 99 | Aguardando envio / Erro ao validar |
| 3 | 0 | Enviado (aguardando retorno) |
| 4 | 99 | Rejeitado |
| 5 / 6 | 0 | Autorizado / Aut. fora do prazo |
| 42 | 0/99 | Cancelamento aguardando / com erro |
| 49 / 50 | 0 | Cancelada / Canc. fora do prazo |
| 52 / 59 | — | Inutilização aguardando / Inutilizado |
| 70 | 0 | Uso denegado |

### Fase 1 (fazer já, seguro)

- Lista das NFs por status (filial/período), com filtros iguais ao monitor.
- Motivo da rejeição: `EDI_ARQUIVO`(chave) ⨝ `EDI_ARQUIVO_LOG` ⨝ `PROCESSOS_SISTEMA_ATIVIDADES`
  (`STATUS_PROCESSO=3`, MENSAGEM) + último `MIDE_NFE_LOG` `ERP.015` (cStat/xMotivo).
- **XML autorizado**: `MIDE_NFE_LOG` `ERP.002` (cru) ou `DADOS_CADASTRO_XML_NFE.XML_CONTEUDO`.
- **DANFE PDF** gerado no dashboard a partir do XML (o Linx não guarda PDF).
- Alertas: NFs em STATUS 1 há mais de X horas; NFs presas em 2/3; 49 com `NOTA_CANCELADA=0`.
- O envio continua no Monitor do Linx.

### Contrato da Fiscal Flow (descoberto em 17/11/2026, nos arquivos do Linx desktop)

Fonte: textos legíveis de `C:\Linx\Recursos\lx_nfe.app` (Visual FoxPro compilado) + log
`MIDE_NFE_LOG` (ERP.001 = corpo enviado, gzip+base64; ERP.015 = retorno). Só leitura.

- **XML**: gerado pelo BANCO — `LX_EXECUTE_PROCESS 'LX_GERA_NFE_SEFAZ_4_00', '''nf'',''serie'',''filial'''`
  (params da proc: @NOTAFISCAL, @SERIENOTA, @FILIALNOTA, @RETORNA_XML, @APP_VERSAO) devolve o cursor
  `curXML` com `XML_NFE` (NF-e 4.00 **sem assinatura**), `CHAVE_NFE`, `status_processo`, `TAMANHO_XML`, `email_nfe`.
- **Assinatura**: feita pela Fiscal Flow (certificado na nuvem da Linx). `INTEGRACOES_API.CERTIFICADO` vazio.
- **Autenticação**: `{END_PRODUCAO}/Linx-TCS0101-BO-TcsAutorizacao-TcsAutorizacaoDomainService.svc/json/AuthenticateJson?userName=…&password=…&applicationId=DE02E733-A636-4C41-907F-55C8721FCCDF`
  (USUARIO/PASSW de `INTEGRACOES_API` ID 6) → `{"AuthenticateJsonResult":[{Key:1..4, Value}]}`.
- **Envio**: `POST {END_PRODUCAO}/api/NFWebApi/EnviaNFeXmlCompactado`, cabeçalhos `Content-Type: application/json`,
  `ApplicationID: DE02E733-…`, `CurrentCompany`, `AutorizationToken`, `CurrentUser`, `AccessGroup` (as 4 chaves);
  corpo = string JSON com base64(gzip(`{"Xml":"<NFe…>","DevolveXml":true,"tpAmb":1,"XmlAssinado":false}`)).
- **Retorno**: JSON `chNFe, nProt, cStat, xMotivo, dhRetorno, XmlCompactado (nfeProc em gzip+base64), MensagemErro…`.
- **Gravar no Linx** (o que o desktop faz depois): `LX_EXECUTE_PROCESS 'LX_XML_MIDE_NFE_ENVIADO'`,
  `EXEC LX_PROCESSAMENTO_RETORNO_MIDe_SEFAZ @MENSAGEM=nfeProc, @TIPO_MENSAGEM='2' (nfeProc completo — inferido da
  versão legível), @CHAVE_NFE_LINX, @DTH_RECEBIMENTO, @STATUS=cStat, @MOTIVO=xMotivo, @NUMERO_PROTOCOLO=nProt`,
  `EXEC LX_DADOS_CADASTRO_XML_NFE @MENSAGEM, @CHAVE_NFE_LINX, @GRAVA_XML=1`,
  `LX_EXECUTE_PROCESS 'LX_CTB_INTEGRAR_FATURAMENTO ','''filial'',''nf'',''serie'''`.
- **Status antes do envio** (igual ao desktop): `EDI_ARQUIVO` da chave (COD_LAYOUT 9990, insere se não existe) +
  `EDI_ARQUIVO_LOG`; erro na geração → 2/99; `LX_VALIDA_NFE_PARA_ENVIO` → 2/0; antes do POST → 3/0; falha de
  comunicação → 1/0. Só envia NF em 1, 2/99, 3/99 ou 4/99.
- **Outros endpoints**: `/api/NFWebApi/ConsultaNFe`, `/CancelaNFe`, `/CancelamentoEvento`, `/InutilizaNFe`,
  `/CartaCorrecaoNFe`. Homologação: `END_HOMOLOGACAO` (evo-hml).

### Envio pelo dashboard — implementado (17/11/2026)

Código: `lib/faturamento-ecommerce/fiscal-flow.ts` (cliente da API) + `lib/repositories/faturamentoEcommerce/sefaz.ts`
(fluxo) + rotas `/notas/enviar`, `/notas/verificar`, `/sefaz/teste` + `SefazPainel.tsx` (detalhe da NF).

**Validações feitas (17/11/2026, sem enviar nada):**
- `LX_GERA_NFE_SEFAZ_4_00` rodada em transação na NF pendente AKS 4511: **não faz COMMIT** (@@TRANCOUNT
  continuou 1), não altera a NF, devolve `XML_NFE, TAMANHO_XML, CHAVE_NFE, EMAIL_NFE, EMAIL_DESTINATARIO`.
- **XML**: (A) procedure hoje × XML que o Linx enviou (ERP.001) em 6 NFs reais — idêntico (só o telefone
  do emitente muda quando se REGERA NF já autorizada; em NF nova sai igual ao enviado hoje). (B) NF simulada
  pelo gravador do dashboard + XML gerado na mesma transação × XML enviado da NF real — idêntico exceto
  chave/nº, data de pagamento (= emissão), espaços na OBS e 1 centavo de rateio de frete entre itens
  (ordem de digitação). `simularXmlNota` faz isso sob demanda.
- **Corpo do envio** montado pelo dashboard = corpo que o Linx enviou na NF 1559 (descompactado, igual).
- `@TIPO_MENSAGEM = 2` confirmado na chamada montada pelo Linx (`'<xml>', 2, '<chave>', ...`).

**⚠️ `LX_EXECUTE_PROCESS` faz `COMMIT` de qualquer transação aberta** (`WHILE @@TRANCOUNT>0 COMMIT`).
Nunca chamá-lo (nem a `LX_PROCESSAMENTO_RETORNO_MIDe_SEFAZ`, que o usa por dentro) dentro de simulação
com ROLLBACK — a simulação viraria gravação real.

**Ainda não testado (precisa da credencial da Fiscal Flow; o Claude Code bloqueou o uso automático):**
autenticação (GET/POST), cabeçalhos, `ConsultaNFe` (valor de `serie`) e o envio real. O botão
"Testar conexão com a Fiscal Flow" (Monitor) faz autenticação + consulta de NF autorizada sem enviar nada.

Exige reimplementar o cliente: gerar XML pela proc criptografada (formato do result set
desconhecido), autenticar e enviar à API Fiscal Flow (endpoint/contrato JSON **não estão no
banco**), devolver o retorno à proc de retorno (`@TIPO_MENSAGEM` desconhecido), criar
`EDI_ARQUIVO`. Caminhos: documentação/suporte Linx, ou capturar um envio real (Fiddler + XEvents)
e testar na homologação do Fiscal Flow. Riscos: envio duplo com o monitor, NF presa em 2/3,
timeout com autorização desconhecida, efeitos do STATUS 5 (contábil/livro).

> **Segurança:** o login de leitura do banco consegue ler usuário/senha/certificado do Fiscal
> Flow em `INTEGRACOES_API`, e `MIDE_NFE_LOG` guarda tokens em texto aberto.

---

## 6. Implementado (17/11/2026)

Página **`/[nerd|scarfme]/faturamento-ecommerce`** — permissão própria `faturamento-ecommerce`
(admin, logística; diretor só leitura). NERD e Scarf Me separadas: padrões, filiais e séries
em `lib/faturamento-ecommerce/config.ts` (`PADROES`).

| Aba | O que faz | Código |
|---|---|---|
| 1. Clientes | Busca por CPF/código/nome (escopo da empresa; opção "outras empresas"); cadastro com padrões editáveis + CEP→IBGE; aviso de CPF repetido (409); atualizar endereço/contato nas 3 vias | `lib/repositories/faturamentoEcommerce/clientes.ts` |
| 2. Faturamento | Nova NF: cliente, filial (Scarf Me: ativa do rodízio), natureza pela UF, padrões editáveis, itens por SKU/código/descrição com estoque; **Conferir** (exceção fiscal, CFOP, CSOSN, totais, bloqueios), **Simular** (grava e desfaz) e **Gravar** (STATUS_NFE=1). Encontrar NF por nº/cliente/CPF/chave/#pedido | `lib/repositories/faturamentoEcommerce/notas.ts` |
| 3. Monitor NF-e | Status igual ao monitor do Linx, motivo da rejeição (Fiscal Flow ou log de processos), XML autorizado; atualiza a cada minuto | idem (`listarNotasFat`, `fetchXmlNota`) |

**Validação da gravação** (transação desfeita, nada persistido): NFs reais 1560, 1559, 1549,
1556 (NERD) e 4493, 4474 (AKS) reproduzidas pelo gravador e comparadas coluna a coluna em
FATURAMENTO, FATURAMENTO_PROD, FATURAMENTO_ITEM, FATURAMENTO_IMPOSTO, FATURAMENTO_OBSERVACAO,
VENDAS e VENDAS_PRODUTO — iguais, exceto campos que o próprio Linx grava de forma inconsistente
entre NFs gêmeas (`BASE_IMPOSTO_CALC`, taxa 100 do imposto 72 em 2 NFs RS) e a ordem dos itens.
Chave NF-e com DV conferido. Pedido #1711 pela API: total 204,14, CFOP 6108, CSOSN 102, exceção 1271.

Regras do form reproduzidas (não estão em proc do banco): rateio de desconto/frete por item com
sobra no último, imposto 73 = trunc((item − desc + frete) × alíquota interna da UF destino
— `UNIDADES_FEDERACAO_ICMS`), DICMS (11) só interestadual, `VALOR_IMPOSTO_CALCULADO` = valor,
`CST_IBS_CBS`/`CCLASSTRIB` da exceção, `TIMESTAMP` = preço codificado por `FX_PRODUCAO_PRECO`,
OBS tipo 7 (DIFAL zerado) quando a UF do cliente ≠ UF da filial. Tipos 4/6 pela proc oficial
`LX_INFORMACAO_COMPLEMENTAR_NOTA_FISCAL`. `LX_GERA_IMPOSTOS_SAIDA` **não** é usada: ela rateia o
frete em `MPADRAO_VALOR_ENCARGOS`, diferente do que o form grava.

Pendente: envio à SEFAZ pelo dashboard (depende do contrato da API Fiscal Flow — §5) e DANFE PDF.

### Fluxo contínuo + importação do Shopify (17/11/2026)

- **Avançar para faturamento**: botão em cada cliente da busca, no detalhe e logo após cadastrar —
  abre a aba Faturamento já com o cliente. Faturar direto (buscando o cliente lá) continua possível.
- **Importar pedido** (`lib/repositories/faturamentoEcommerce/shopify.ts`, rotas `/shopify/pedidos` e
  `/shopify/pedido`; nada grava no Linx): lista pedidos pagos da loja da empresa com a NF já emitida
  (nº na OBS; "provável" = mesmo CPF + mesmo valor, para NF antiga sem o nº). Ao importar:
  - cliente: CPF (`TAX_CREDENTIAL_BR`), nome, e-mail, DDD/telefone, endereço separado em
    rua/número (1ª linha) e complemento/bairro (2ª linha + bairro do CEP), IBGE pelo CEP;
    caracteres invisíveis do checkout (U+2060) removidos;
  - clientes parecidos no Linx: mesmo CPF (forte; o da própria empresa primeiro) e nome parecido,
    marcando endereço diferente → "Usar e avançar", "Atualizar endereço e avançar" ou cadastrar novo
    já preenchido;
  - NF: itens por `shopify_variant_map` (vinculado/sugerido), depois SKU e código de barras em
    `PRODUTOS_BARRA`; preço = preço do site; desconto em R$ = soma das alocações dos itens; frete =
    frete cobrado; OBS = `#pedido`. Embalagem de presente fica fora; brinde (preço 0) vai a R$ 0,01;
    código sem estoque troca por lote anterior (`shopify_variant_linx_extra`) com estoque; aviso
    quando o preço do site ≠ tabela 01 do Linx.
  - Na aba Faturamento, "Importar pedido" já seleciona o cliente quando o CPF bate com um único
    cadastro (da empresa) com o mesmo endereço; senão leva para a aba Clientes.
- **Validação** (só leitura): pedidos já faturados importados e montados → prévia comparada com a NF
  real do operador. NERD 15/15 iguais (valor e itens); Scarf Me 22/24 — #66295 o operador usou o
  preço do Linx (R$ 598) em vez do pago no site (R$ 698) e #66310 o operador faturou outro lote
  (07.A1.00B3) que o mapeamento não liga ao código do site (07.A1.00A7).
