import "server-only";

import { randomInt } from "crypto";
import sql from "mssql";
import { withRequest } from "@/lib/db/connection";
import type { RequestLike } from "@/lib/db/proxy";
import { PADROES, statusNfeLabel, FILTROS_STATUS, naturezaSoNfAntiga, type EmpresaFat } from "@/lib/faturamento-ecommerce/config";
import { consumidorFinalPadrao, naturezaPadrao, naturezasDoDestino } from "@/lib/faturamento-ecommerce/catalogo";
import { fetchCatalogoNotas, fetchCostumeDescontoSobre4 } from "./catalogo";
import { filiaisNotaDaEmpresa, sqlUltimaNfEcommerce } from "./filiais-nota";
import type {
  DevolucaoPreviewItem,
  EntradaDevolvivel,
  ImpostoInformado,
  NotaCriada,
  NotaDetalhe,
  NotaInput,
  NotaListItem,
  NotaPreview,
  NotaPreviewItem,
  ProdutoFatOpcao,
} from "@/lib/faturamento-ecommerce/types";

/**
 * Faturamento E-commerce — NF de saída de produto acabado, igual ao form 100101SPK
 * do Linx. Mapeamento completo em docs/FATURAMENTO_SHOPIFY_LINX.md §4.
 *
 * Uma única transação grava:
 *   VENDAS + VENDAS_PRODUTO   pedido "NF SEM PEDIDO" (o form também cria; o trigger de
 *                              FATURAMENTO_PROD exige o item do pedido)
 *   FATURAMENTO               cabeçalho, STATUS_NFE = 1 (não enviada), chave NF-e calculada
 *   FATURAMENTO_PROD          produto × cor, grade F1..F48 → o trigger BAIXA O ESTOQUE aqui
 *   FATURAMENTO_ITEM          item fiscal (produto × cor × tamanho): NCM, CFOP, CSOSN, rateios, IBPT
 *   FATURAMENTO_IMPOSTO       uma linha por imposto da exceção fiscal (Simples: zerados)
 *   FATURAMENTO_OBSERVACAO    tipo 7 (DIFAL, interestadual) aqui + tipos 4/6 pela proc oficial
 *                              LX_INFORMACAO_COMPLEMENTAR_NOTA_FISCAL
 *
 * O envio à SEFAZ continua no Monitor de NF-e do Linx (é o Linx desktop que chama a
 * API Fiscal Flow; não há gatilho no banco). Contábil, contas a receber e FATURA
 * nascem na autorização, pelo próprio Linx.
 */

const COD_TRANSACAO = "FATURAMENTO_022";
const COLECAO_PEDIDO = "62";
const MAX_GRADE = 48;

const trim = (s: unknown) => String(s ?? "").trim();
const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const trunc2 = (n: number) => Math.floor(Number(n) * 100 + 1e-7) / 100;
const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);

/** Literal T-SQL seguro para texto (os itens vão inline para não estourar 2.100 parâmetros). */
const lit = (s: unknown) => (s === null || s === undefined ? "NULL" : `'${String(s).replace(/'/g, "''")}'`);
const num = (n: unknown, casas = 2) => {
  const v = Number(n);
  if (!Number.isFinite(v)) throw new Error(`Valor numérico inválido: ${String(n)}`);
  return v.toFixed(casas);
};

type Req = sql.Request;

// ── Produtos (busca para incluir item) ──────────────────────────────────────

/**
 * Busca por código de barras (exato), código do produto (exato) ou descrição.
 * Devolve uma opção por produto × cor × tamanho, com preço da tabela e estoque da filial.
 */
export async function buscarProdutosFat(params: {
  termo: string;
  filial: string;
  tabelaPreco: string;
}): Promise<ProdutoFatOpcao[]> {
  const termo = trim(params.termo).toUpperCase();
  if (termo.length < 2) return [];
  return withRequest(async (request: sql.Request | RequestLike) => {
    const req = request as Req;
    req.input("termo", sql.VarChar(50), termo);
    req.input("like", sql.VarChar(80), `%${termo}%`);
    req.input("filial", sql.VarChar(25), params.filial);
    req.input("tab", sql.VarChar(2), params.tabelaPreco || "01");
    const r = await req.query(`
      ;WITH alvo AS (
        SELECT DISTINCT TOP 60 P.PRODUTO
          FROM PRODUTOS P WITH (NOLOCK)
         WHERE P.PRODUTO = @termo
            OR P.PRODUTO IN (SELECT PRODUTO FROM PRODUTOS_BARRA WITH (NOLOCK) WHERE CODIGO_BARRA = @termo)
            OR (LEN(@termo) >= 3 AND P.DESC_PRODUTO COLLATE Latin1_General_CI_AI LIKE @like)
      )
      SELECT TOP 300
        LTRIM(RTRIM(P.PRODUTO)) AS produto, LTRIM(RTRIM(P.DESC_PRODUTO)) AS descricao,
        LTRIM(RTRIM(PC.COR_PRODUTO)) AS cor, LTRIM(RTRIM(PC.DESC_COR_PRODUTO)) AS descCor,
        T.n AS tamanho, LTRIM(RTRIM(T.rotulo)) AS tamanhoLabel,
        (SELECT TOP 1 LTRIM(RTRIM(B.CODIGO_BARRA)) FROM PRODUTOS_BARRA B WITH (NOLOCK)
          WHERE B.PRODUTO = P.PRODUTO AND B.COR_PRODUTO = PC.COR_PRODUTO AND B.TAMANHO = T.n) AS codigoBarra,
        ISNULL((SELECT TOP 1 PP.PRECO1 FROM PRODUTOS_PRECOS PP WITH (NOLOCK)
                 WHERE PP.PRODUTO = P.PRODUTO AND PP.CODIGO_TAB_PRECO = @tab), 0) AS preco,
        CASE T.n ${Array.from({ length: MAX_GRADE }, (_, i) => `WHEN ${i + 1} THEN E.ES${i + 1}`).join(" ")} END AS estoque,
        CASE WHEN EXISTS (SELECT 1 FROM PRODUTOS_BARRA B WITH (NOLOCK) WHERE B.CODIGO_BARRA = @termo
                           AND B.PRODUTO = P.PRODUTO AND B.COR_PRODUTO = PC.COR_PRODUTO AND B.TAMANHO = T.n) THEN 0 ELSE 1 END AS ordem
      FROM alvo A
      JOIN PRODUTOS P WITH (NOLOCK) ON P.PRODUTO = A.PRODUTO
      JOIN PRODUTO_CORES PC WITH (NOLOCK) ON PC.PRODUTO = P.PRODUTO
      JOIN PRODUTOS_TAMANHOS G WITH (NOLOCK) ON G.GRADE = P.GRADE
      CROSS APPLY (VALUES ${Array.from({ length: MAX_GRADE }, (_, i) => `(${i + 1}, G.TAMANHO_${i + 1})`).join(",")}) T(n, rotulo)
      LEFT JOIN ESTOQUE_PRODUTOS E WITH (NOLOCK) ON E.FILIAL = @filial AND E.PRODUTO = P.PRODUTO AND E.COR_PRODUTO = PC.COR_PRODUTO
      WHERE T.rotulo IS NOT NULL AND LTRIM(RTRIM(T.rotulo)) <> '' AND T.n <= ISNULL(G.NUMERO_TAMANHOS, ${MAX_GRADE})
      ORDER BY ordem, P.PRODUTO, PC.COR_PRODUTO, T.n`);
    return (r.recordset as Record<string, unknown>[]).map((x) => ({
      produto: String(x.produto),
      descricao: String(x.descricao ?? ""),
      cor: String(x.cor),
      descCor: String(x.descCor ?? ""),
      tamanho: Number(x.tamanho),
      tamanhoLabel: String(x.tamanhoLabel ?? ""),
      codigoBarra: (x.codigoBarra as string) || null,
      preco: Number(x.preco) || 0,
      estoque: x.estoque === null || x.estoque === undefined ? null : Number(x.estoque),
    }));
  });
}

// ── Planejamento (prévia + plano de gravação) ───────────────────────────────

interface LinhaFiscal {
  /** Linha da NF (FATURAMENTO_PROD / VENDAS_PRODUTO) a que este tamanho pertence. */
  linha: string;
  /** Ordem digitada da linha (ITEM_IMPRESSAO de FATURAMENTO_PROD), 1 = primeira. */
  ordemLinha: number;
  /** ITEM_IMPRESSAO do item fiscal (e da linha de FATURAMENTO_PROD que ele agrupa). */
  itemImpressao: string;
  /** SUB_ITEM_TAMANHO do item fiscal: o tamanho (agrupamento 2) ou 1 (agrupamentos 0 e 1). */
  subItem: number;
  /** FATURAMENTO_ITEM.REFERENCIA_ITEM: a cor; NULL no agrupamento 0 (um item por produto). */
  referenciaItem: string | null;
  /** FATURAMENTO_ITEM.OBS_ITEM (vazio = NULL). */
  obsItem: string;
  produto: string;
  cor: string;
  descNf: string;
  descCor: string;
  tamanho: number;
  tamanhoLabel: string;
  codigoItem: string;
  descricao: string;
  qtde: number;
  preco: number;
  valor: number;
  ncm: string;
  unidade: string;
  contaContabil: string;
  origem: string;
  indicadorCfop: number;
  idCest: number | null;
  cfop: string;
  /** CFOP da característica, antes da exceção — é o que o Linx grava em FATURAMENTO_PROD. */
  cfopProd: string;
  csosn: string;
  excecao: number | null;
  excecaoDescricao: string;
  cstIbsCbs: string;
  cClassTrib: string;
  estoque: number | null;
  custo: number;
  ibptFederal: number;
  ibptEstadual: number;
  ibptMunicipal: number;
  impostos: { id: number; taxa: number; incidencia: number; agregaDesconto: boolean; agregaEncargo: boolean; reducao: number; aliquotaTipo: number; fixa: boolean }[];
  /** Devolução: encargo (frete) rateado na NF de entrada, proporcional à quantidade devolvida. */
  encargoEntrada: number;
  /** Devolução: impostos que vão na NF (os da NF do fornecedor). Nulo nas demais NFs. */
  informados: ImpostoInformado[] | null;
  /** Rateios do cabeçalho (preenchidos depois). */
  pct: number;
  desconto: number;
  frete: number;
  seguro: number;
}

interface Plano {
  empresa: EmpresaFat;
  filial: string;
  serie: string;
  /** Dígitos do NF_SAIDA da filial (pernas do e-commerce 9, Matriz 7). A chave usa sempre 9. */
  larguraNf: number;
  /** Simples Nacional (pernas do e-commerce). Falso = regime normal (Matriz da Scarf Me, declarado no config). */
  simples: boolean;
  /** ICMS da operação UF filial → UF cliente (regime normal, quando a exceção traz 0). */
  aliqIcmsOperacao: number;
  indFiscal: number;
  /** FATURAMENTO.INDICA_CONSUMIDOR_FINAL (escolhido na tela; padrão = o mais comum no histórico). */
  consumidorFinal: boolean;
  /** COD_TRANSACAO mais comum da natureza nesta filial (FATURAMENTO_022, _026…). */
  codTransacao: string;
  /** FATURAMENTO.NF_FATURA: natureza de venda/devolução gera fatura; remessa/outras não. */
  nfFatura: boolean;
  /** NATUREZAS_SAIDAS.TIPO_OPERACAO: V venda, R remessa, O outras, E retorno, D devolução. */
  tipoNatureza: string;
  /** Exportação (cliente UF EX): UF e local de embarque; vazios nas demais. */
  ufEmbarque: string;
  localEmbarque: string;
  codFilial: string;
  empresaCodigo: number;
  ufFilial: string;
  cnpjFilial: string;
  cUf: string;
  serieSintegra: string;
  proximoNumero: string;
  natureza: string;
  naturezaDescricao: string;
  cliente: { codigo: string; nome: string; razao: string; uf: string; cidade: string; tabPreco: string; indicadorVenda: string; representante: string | null; condicaoPgto: string | null };
  /** Produto × cor × tamanho como digitado (FATURAMENTO_PROD / VENDAS_PRODUTO e a prévia). */
  linhas: LinhaFiscal[];
  /** FATURAMENTO.AGRUPAMENTO_ITENS: 0 por produto, 1 por produto × cor, 2 por produto × cor × tamanho. */
  agrupamento: 0 | 1 | 2 | 3 | 4 | 5;
  /** Itens fiscais (FATURAMENTO_ITEM/IMPOSTO), na ordem da NF; no agrupamento 2 são as próprias linhas. */
  fiscais: LinhaFiscal[];
  /** Devolução de compra (NF a partir da NF de entrada). Nulo nas demais NFs. */
  devolucao: PlanoDevolucao | null;
  /** NF de material (itens avulsos do cadastro de materiais, sem estoque). */
  material: boolean;
  /** Impostos que somam ao total da NF (IPI na devolução): FATURAMENTO.VALOR_IMPOSTO_AGREGAR. */
  impostoAgregar: number;
  /** FATURAMENTO.RESPONSAVEL do romaneio (usuário do Linx). */
  responsavel: string;
  subtotal: number;
  porcDesconto: number;
  porcDigitado: boolean;
  desconto: number;
  /** Desconto na condição de pagamento (2º desconto) e o % gravado. */
  descontoCond: number;
  porcDescontoCond: number;
  /** FATURAMENTO.DESCONTO_SOBRE_4 (onde o form registra o % digitado). */
  descontoSobre4: number;
  frete: number;
  seguro: number;
  total: number;
  qtdeTotal: number;
  icmsDestinoAliq: number;
  input: NotaInput;
  bloqueios: string[];
  avisos: string[];
}

interface PlanoDevolucao {
  fornecedor: string;
  nfEntrada: string;
  serieEntrada: string;
  /** Uma por item da entrada devolvido: a linha do plano, o item/sub da entrada e o item "de produto" da entrada. */
  itens: { linha: string; itemImpressaoEntrada: string; subItem: number; qtde: number; itemProdutoEntrada: string; preco: number }[];
}

async function q<T = Record<string, unknown>>(req: Req, text: string): Promise<T[]> {
  const r = await req.query(text);
  return r.recordset as T[];
}

async function montarPlano(request: sql.Request | RequestLike, input: NotaInput): Promise<Plano> {
  const req = request as Req;
  const bloqueios: string[] = [];
  const avisos: string[] = [];
  const padrao = PADROES[input.empresa];
  if (!padrao) throw new Error("Empresa inválida.");

  const filial = trim(input.filial);
  const filiaisEmpresa = await filiaisNotaDaEmpresa(input.empresa);
  if (!filiaisEmpresa.includes(filial)) {
    throw new Error(`A filial ${filial || "(vazia)"} não emite NF de e-commerce da ${padrao.nome}.`);
  }

  // Filial emissora, série e numeração. A série é a da última NF de e-commerce da
  // filial (as pernas do rodízio não usam a mesma); sem NF ainda, a padrão da empresa.
  req.input("pFilial", sql.VarChar(25), filial);
  req.input("pSerie", sql.VarChar(6), padrao.nota.serie);
  const [fil] = await q(req, `
    SELECT LTRIM(RTRIM(FI.COD_FILIAL)) AS codFilial, FI.EMPRESA AS empresa, LTRIM(RTRIM(S.SERIE_NF)) AS serie,
           LTRIM(RTRIM(C.UF)) AS uf, LTRIM(RTRIM(C.CGC_CPF)) AS cnpj, LTRIM(RTRIM(C.COD_MUNICIPIO_IBGE)) AS ibge,
           LTRIM(RTRIM(S.SEQUENCIAL)) AS seq, LTRIM(RTRIM(N.COD_SERIE_SINTEGRA)) AS sintegra
      FROM FILIAIS FI WITH (NOLOCK)
      JOIN CADASTRO_CLI_FOR C WITH (NOLOCK) ON C.NOME_CLIFOR = FI.FILIAL
      OUTER APPLY (${sqlUltimaNfEcommerce("FI.FILIAL")}) U
      JOIN FATURAMENTO_SEQUENCIAIS S WITH (NOLOCK) ON S.FILIAL = FI.FILIAL AND S.SERIE_NF = ISNULL(U.SERIE_NF, @pSerie)
      JOIN SERIES_NF N WITH (NOLOCK) ON N.SERIE_NF = S.SERIE_NF
     WHERE FI.FILIAL = @pFilial`);
  if (!fil) throw new Error(`Filial ${filial} sem série de NF cadastrada em FATURAMENTO_SEQUENCIAIS.`);
  const ufFilial = trim(fil.uf);
  // Largura do nº da NF = a do sequencial da filial (pernas do e-commerce: 9; Matriz: 7).
  const larguraNf = larguraDoSequencial(trim(fil.seq));
  const proximoNumero = String((Number(fil.seq) || 0) + 1).padStart(larguraNf, "0");
  // Regime da filial: o Simples grava os impostos zerados; a Matriz (regime normal) calcula
  // ICMS/PIS/COFINS. Declarado no config — FILIAIS.TIPO_TRIBUTACAO está vazio em pernas do
  // Simples (MSC, CMS), então as pernas do rodízio são sempre Simples, como sempre foram.
  const extra = padrao.nota.filiaisExtras.find((x) => x.codFilial === trim(fil.codFilial)) ?? null;
  const simples = extra ? extra.simplesNacional : true;

  // Cliente
  const clifor = trim(input.clienteCodigo).replace(/\D/g, "").padStart(6, "0").slice(-6);
  req.input("pClifor", sql.VarChar(15), clifor);
  const [cli] = await q(req, `
    SELECT LTRIM(RTRIM(cf.CLIFOR)) AS codigo, RTRIM(cf.NOME_CLIFOR) AS nome, LTRIM(RTRIM(cf.RAZAO_SOCIAL)) AS razao,
           LTRIM(RTRIM(cf.UF)) AS uf, LTRIM(RTRIM(cf.CIDADE)) AS cidade, cf.INDICADOR_FISCAL_TERCEIRO AS indFiscal,
           LTRIM(RTRIM(cf.COD_MUNICIPIO_IBGE)) AS ibge, LTRIM(RTRIM(ca.CODIGO_TAB_PRECO)) AS tab,
           CASE WHEN ca.CLIENTE_ATACADO IS NULL THEN 0 ELSE 1 END AS atacado, ISNULL(ca.INATIVO,0) AS inativo, ISNULL(ca.INDICADOR_VENDA, 'V') AS indicadorVenda, LTRIM(RTRIM(ca.CONDICAO_PGTO)) AS condCli,
           (SELECT TOP 1 RTRIM(CR.REPRESENTANTE) FROM CLIENTE_REPRE CR WITH (NOLOCK)
             WHERE CR.CLIENTE_ATACADO = cf.NOME_CLIFOR ORDER BY CR.REPRESENTANTE_PRINCIPAL DESC, CR.REPRESENTANTE) AS representante,
           CASE WHEN EXISTS (SELECT 1 FROM FILIAIS FX WITH (NOLOCK) WHERE FX.FILIAL = cf.NOME_CLIFOR) THEN 1 ELSE 0 END AS ehFilial
      FROM CADASTRO_CLI_FOR cf WITH (NOLOCK)
      LEFT JOIN CLIENTES_ATACADO ca WITH (NOLOCK) ON ca.CLIENTE_ATACADO = cf.NOME_CLIFOR
     WHERE cf.CLIFOR = @pClifor`);
  if (!cli) throw new Error(`Cliente ${clifor} não encontrado.`);
  if (!Number(cli.atacado) && !input.devolucao) bloqueios.push("O cliente não tem cadastro de cliente (CLIENTES_ATACADO) — cadastre pela aba Clientes.");
  if (Number(cli.inativo)) bloqueios.push("O cliente está inativo no Linx.");
  // NF para uma filial do grupo (abastecimento, 100.08 da Matriz) usa o catálogo "destino filial":
  // só as naturezas que a filial já usou para lojas, e só as validadas para esse destino.
  const destino: "cliente" | "filial" = Number(cli.ehFilial) ? "filial" : "cliente";
  if (!trim(cli.ibge)) bloqueios.push("O cliente está sem código IBGE do município — atualize o endereço na aba Clientes.");
  const ufCliente = trim(cli.uf);

  // Natureza
  const natureza = trim(input.natureza);
  req.input("pNat", sql.VarChar(7), natureza);
  const [nat] = await q(req, `
    SELECT LTRIM(RTRIM(DESC_NATUREZA)) AS descr, CTB_TIPO_OPERACAO AS tipoOp, LTRIM(RTRIM(TIPO_OPERACAO)) AS tipoNat, ISNULL(INATIVO,0) AS inativo
      FROM NATUREZAS_SAIDAS WITH (NOLOCK) WHERE NATUREZA_SAIDA = @pNat`);
  if (!nat) throw new Error(`Natureza ${natureza} não existe.`);
  if (Number(nat.inativo)) bloqueios.push(`A natureza ${natureza} está inativa.`);
  const interestadual = ufCliente !== ufFilial;
  const indFiscal = Number(cli.indFiscal) || 8;
  // Catálogo: só naturezas que esta filial já emitiu no Linx, e entre elas só as que o gravador
  // já reproduz centavo a centavo (NATUREZAS_VALIDADAS). A mais comum para o cliente é a sugerida.
  const catalogo = (await fetchCatalogoNotas(input.empresa))[filial] ?? [];
  const doDestino = naturezasDoDestino(catalogo, destino);
  const noCatalogo = doDestino.find((n) => n.natureza === natureza) ?? null;
  const naturezaSugerida = naturezaPadrao(catalogo, indFiscal, !interestadual, destino);
  if (!noCatalogo) {
    bloqueios.push(
      (destino === "filial"
        ? `${trim(cli.nome)} é filial do grupo e ${filial} nunca emitiu a natureza ${natureza} para loja (desde 2025). `
        : `${filial} nunca emitiu a natureza ${natureza} (desde 2025). `) +
        `As opções são as que ela já usa: ` + (doDestino.slice(0, 6).map((n) => n.natureza).join(", ") || "nenhuma") + "."
    );
  } else if (!noCatalogo.validada) {
    bloqueios.push(
      `A natureza ${natureza} (${noCatalogo.descricao}) ainda está em validação: o gravador só libera depois de ` +
        `reproduzir NFs reais dela centavo a centavo.`
    );
  } else if (naturezaSugerida && natureza !== naturezaSugerida) {
    avisos.push(
      `Para cliente indicador ${indFiscal} ${interestadual ? "de outra UF" : "da mesma UF"} o mais comum nesta filial é ` +
        `${naturezaSugerida} (selecionada: ${natureza}).`
    );
  }
  if (noCatalogo?.validada && naturezaSoNfAntiga(simples, natureza)) {
    avisos.push(
      `${natureza} (${noCatalogo.descricao}) não teve NF no Linx desde a atualização de 24/10/2026: a NF foi conferida ` +
        `com as antigas e os impostos seguem a exceção fiscal de hoje. Confira a NF no Linx antes de enviar à SEFAZ.`
    );
  }
  const consumidorFinal =
    typeof input.consumidorFinal === "boolean"
      ? input.consumidorFinal
      : (consumidorFinalPadrao(noCatalogo ?? undefined, indFiscal) ?? (simples || indFiscal === 8));
  const codTransacao = noCatalogo?.padroes.codTransacao || COD_TRANSACAO;
  // NF_FATURA (gera fatura/duplicata): venda e devolução sim; remessa, bonificação e outras
  // não (todas as NFs desde 06/2025, por NATUREZAS_SAIDAS.TIPO_OPERACAO).
  const tipoNatureza = trim(nat.tipoNat).toUpperCase();
  const nfFatura = tipoNatureza === "V" || tipoNatureza === "D";

  // Alíquota interna do ICMS na UF de destino (imposto 73 — ICMS-DESTINO informativo).
  req.input("pUfDest", sql.Char(2), ufCliente);
  const [aliqDest] = await q(req, `
    SELECT TOP 1 ICMS_SAIDA AS aliq FROM UNIDADES_FEDERACAO_ICMS WITH (NOLOCK)
     WHERE UF = @pUfDest AND UF_DESTINO = @pUfDest AND ISNULL(INATIVO,0) = 0`);
  // Alíquota de ICMS da operação (UF da filial → UF do cliente: SP→SP 18, SP→RJ/MG 12,
  // SP→CE/BA 7). Usada no regime normal quando a exceção fiscal traz taxa 0.
  req.input("pUfOrig", sql.Char(2), ufFilial);
  const [aliqOp] = await q(req, `
    SELECT TOP 1 ICMS_SAIDA AS aliq FROM UNIDADES_FEDERACAO_ICMS WITH (NOLOCK)
     WHERE UF = @pUfOrig AND UF_DESTINO = @pUfDest AND ISNULL(INATIVO,0) = 0`);
  const aliqIcmsOperacao = Number(aliqOp?.aliq) || 0;
  // Exportação (cliente UF "EX", 100.71): ICMS não incide (exceção CST 41, taxa 0) — não há
  // alíquota SP→EX; o CFOP é o "exterior" da característica (7101/7102).
  const exportacao = ufCliente === "EX";
  if (!simples && !aliqIcmsOperacao && !exportacao) bloqueios.push(`Alíquota de ICMS ${ufFilial}→${ufCliente} não encontrada no Linx.`);
  const ufEmbarque = exportacao ? trim(input.ufEmbarque).toUpperCase() || "SP" : "";
  const localEmbarque = exportacao ? trim(input.localEmbarque).toUpperCase() || "AEROPORTO INTERNACIONAL DE GUARULHOS" : "";
  if (exportacao && (ufEmbarque.length !== 2 || localEmbarque.length > 60)) bloqueios.push("Exportação: informe a UF (2 letras) e o local de embarque (até 60).");

  // Devolução de compra: os itens vêm da NF de entrada do fornecedor (o cliente desta NF).
  let devolucao: PlanoDevolucao | null = null;
  const encargoDaLinha = new Map<string, number>();
  let itensDigitados = input.itens ?? [];
  if (input.devolucao) {
    const dv = await carregarDevolucao(req, input, { filial, nomeCliente: String(cli.nome).trimEnd(), tipoNatureza, bloqueios });
    devolucao = dv.plano;
    itensDigitados = dv.itens;
    for (const [k, v] of dv.encargos) encargoDaLinha.set(k, v);
  } else if (tipoNatureza === "D") {
    bloqueios.push(`A natureza ${natureza} é de devolução: escolha a NF de entrada na aba Devolução.`);
  }
  // NF de material (remessa p/ industrialização 130.01, simples remessa…): itens avulsos do cadastro
  // de materiais (COD_TABELA_FILHA T), sem pedido, sem FATURAMENTO_PROD e SEM mexer em estoque — as
  // NFs reais não têm saída de material ligada (ESTOQUE_SAI_MAT vazio para elas).
  const ehMaterial = !input.devolucao && (input.materiais?.length ?? 0) > 0;
  const descricaoMaterial = new Map<string, string>();
  if (ehMaterial) {
    itensDigitados = (input.materiais ?? []).map((m, i) => {
      if (trim(m.descricao)) descricaoMaterial.set(`L${i}`, trim(m.descricao).replace(/\s+/g, " ").slice(0, 80));
      return { produto: trim(m.material), cor: "", tamanho: 0, qtde: Number(m.qtde) || 0, preco: Number(m.preco) || 0, linha: i };
    });
  }

  // Itens (agrupa linhas repetidas do mesmo produto/cor/tamanho)
  const agrupados = new Map<string, { produto: string; cor: string; tamanho: number; qtde: number; preco: number; linha: string; obs: string }>();
  for (const it of itensDigitados) {
    const produto = trim(it.produto).toUpperCase();
    const cor = trim(it.cor).toUpperCase();
    // Material: sem grade (SUB_ITEM_TAMANHO 0) e quantidade com até 3 casas (metros, quilos).
    const tamanho = ehMaterial ? 0 : Math.round(Number(it.tamanho) || 1);
    const qtde = ehMaterial ? Math.round((Number(it.qtde) || 0) * 1000) / 1000 : Math.round(Number(it.qtde) || 0);
    // Devolução: preço da NF de entrada, com até 5 casas (FATURAMENTO_ITEM.PRECO_UNITARIO é 15,5).
    const preco = input.devolucao || ehMaterial ? Math.round((Number(it.preco) || 0) * 1e5) / 1e5 : round2(Number(it.preco) || 0);
    const obsItem = trim(it.obs).replace(/\s+/g, " ");
    if (!produto) continue;
    if (obsItem.length > 80) bloqueios.push(`Observação do item ${produto} ${cor} passa de 80 caracteres.`);
    if (qtde <= 0) bloqueios.push(`Quantidade inválida em ${produto} ${cor}.`);
    if (preco <= 0) bloqueios.push(`Preço inválido em ${produto} ${cor}.`);
    if (!ehMaterial && (tamanho < 1 || tamanho > MAX_GRADE)) bloqueios.push(`Tamanho inválido em ${produto} ${cor}.`);
    // Linha da NF: a informada (estrutura digitada) ou uma por produto × cor.
    const linha = it.linha !== undefined && it.linha !== null ? `L${Number(it.linha)}` : `${produto}|${cor}`;
    const k = `${linha}|${tamanho}`;
    const atual = agrupados.get(k);
    if (atual) {
      if (atual.preco !== preco) bloqueios.push(`${produto} ${cor} aparece com preços diferentes.`);
      atual.qtde += qtde;
      if (!atual.obs) atual.obs = obsItem;
    } else {
      agrupados.set(k, { produto, cor, tamanho, qtde, preco, linha, obs: obsItem });
    }
  }
  if (agrupados.size === 0) bloqueios.push("Inclua ao menos um produto.");
  // Observação do item é da LINHA (produto × cor) no form do Linx: vai em FATURAMENTO_PROD.
  // DESC_VENDA_CLIENTE (80) e no OBS_ITEM de cada item fiscal dela (3 NFs desde 2025).
  const obsDaLinha = new Map<string, string>();
  for (const a of agrupados.values()) if (a.obs && !obsDaLinha.has(a.linha)) obsDaLinha.set(a.linha, a.obs);

  // Uma linha da NF tem um só produto × cor e um só PRECO em FATURAMENTO_PROD.
  const daLinha = new Map<string, { produto: string; cor: string; preco: number }>();
  for (const a of agrupados.values()) {
    const p = daLinha.get(a.linha);
    if (p && (p.produto !== a.produto || p.cor !== a.cor)) bloqueios.push(`A linha de ${p.produto} ${p.cor} tem outro produto/cor.`);
    if (p && p.preco !== a.preco) bloqueios.push(`${a.produto} ${a.cor}: tamanhos com preços diferentes na mesma linha da NF.`);
    if (!p) daLinha.set(a.linha, { produto: a.produto, cor: a.cor, preco: a.preco });
  }

  req.input("pMatriz", sql.VarChar(25), filial);
  req.input("pCodFilial", sql.Char(6), trim(fil.codFilial));
  req.input("pTipoOp", sql.Int, Number(nat.tipoOp) || 100);
  req.input("pIndFiscal", sql.Int, Number(cli.indFiscal) || 8);
  req.input("pNomeCli", sql.VarChar(25), String(cli.nome));

  const linhas: LinhaFiscal[] = [];
  let idx = 0;
  for (const a of agrupados.values()) {
    idx += 1;
    req.input(`iProd${idx}`, sql.VarChar(12), a.produto);
    req.input(`iCor${idx}`, sql.VarChar(10), a.cor);
    const [p] = ehMaterial
      ? await q(req, `
      SELECT LTRIM(RTRIM(M.MATERIAL)) AS produto, LTRIM(RTRIM(ISNULL(NULLIF(M.DESC_NF, ''), M.DESC_MATERIAL))) AS descNf,
             LTRIM(RTRIM(M.CLASSIF_FISCAL)) AS ncm, LTRIM(RTRIM(M.UNID_ESTOQUE)) AS unidade,
             LTRIM(RTRIM(M.CONTA_CONTABIL)) AS conta, LTRIM(RTRIM(M.TRIBUT_ORIGEM)) AS origem,
             M.ID_CEST_NCM AS cest, ISNULL(M.CUSTO_REPOSICAO, 0) AS custo, M.INDICADOR_CFOP AS indCfop,
             '' AS descCor, '' AS tamLabel, NULL AS estoque, ISNULL(M.INATIVO, 0) AS inativo
        FROM MATERIAIS M WITH (NOLOCK)
       WHERE M.MATERIAL = @iProd${idx}`)
      : await q(req, `
      SELECT LTRIM(RTRIM(P.PRODUTO)) AS produto, LTRIM(RTRIM(ISNULL(P.DESC_PROD_NF, P.DESC_PRODUTO))) AS descNf,
             LTRIM(RTRIM(P.CLASSIF_FISCAL)) AS ncm, LTRIM(RTRIM(P.UNIDADE)) AS unidade,
             LTRIM(RTRIM(P.CONTA_CONTABIL)) AS conta, LTRIM(RTRIM(P.TRIBUT_ORIGEM)) AS origem,
             P.ID_CEST_NCM AS cest, ISNULL(P.CUSTO_REPOSICAO1,0) AS custo,
             dbo.FX_INDICADOR_CFOP(@pFilial, P.PRODUTO, 'P') AS indCfop,
             LTRIM(RTRIM(PC.DESC_COR_PRODUTO)) AS descCor,
             G.TAMANHO_${a.tamanho} AS tamLabel,
             E.ES${a.tamanho} AS estoque
        FROM PRODUTOS P WITH (NOLOCK)
        LEFT JOIN PRODUTO_CORES PC WITH (NOLOCK) ON PC.PRODUTO = P.PRODUTO AND PC.COR_PRODUTO = @iCor${idx}
        LEFT JOIN PRODUTOS_TAMANHOS G WITH (NOLOCK) ON G.GRADE = P.GRADE
        LEFT JOIN ESTOQUE_PRODUTOS E WITH (NOLOCK) ON E.FILIAL = @pFilial AND E.PRODUTO = P.PRODUTO AND E.COR_PRODUTO = @iCor${idx}
       WHERE P.PRODUTO = @iProd${idx}`);
    if (!p) {
      bloqueios.push(`${ehMaterial ? "Material" : "Produto"} ${a.produto} não existe no Linx.`);
      continue;
    }
    if (ehMaterial && Number(p.inativo)) bloqueios.push(`O material ${a.produto} está inativo no Linx.`);
    if (!ehMaterial && (p.descCor === null || p.descCor === undefined)) bloqueios.push(`A cor ${a.cor} não existe no produto ${a.produto}.`);
    const tamLabel = trim(p.tamLabel);
    if (!ehMaterial && !tamLabel) bloqueios.push(`O tamanho ${a.tamanho} não existe na grade do produto ${a.produto}.`);
    const codigoItem = `${a.produto}${a.cor}${tamLabel}`;
    const origem = trim(p.origem) || "0";
    const indCfop = Number(p.indCfop) || 11;

    req.input(`iCod${idx}`, sql.VarChar(50), codigoItem);
    req.input(`iOrig${idx}`, sql.Char(3), origem);
    req.input(`iInd${idx}`, sql.Int, indCfop);
    req.input(`iNcm${idx}`, sql.VarChar(10), trim(p.ncm).replace(/\D/g, ""));
    // Exceção fiscal como a tela do Linx localiza (medido em 19/11/2026, NFs desde 24/10: 100% dos
    // itens em Matriz, pernas e NERD): FX_LOCALIZA_EXCECAO_IMPOSTO — que lê também o cadastro por
    // filtro (CTB_EXCECAO_IMPOSTO_FILTRO) — recebendo o CFOP da característica (tipo de operação ×
    // indicador CFOP × indicador fiscal do cliente), ainda antes da exceção. A FX_ID_EXCECAO_IMPOSTO
    // ignora os filtros: na Matriz acertava 14 de 57 itens (escolhia 1164/1174/1216 em vez de
    // 1131/1137/1122). O CFOP da característica vai em FATURAMENTO_PROD; o do item é o obrigatório
    // da exceção, quando houver.
    const [exc] = await q(req, `
      DECLARE @cfopCarac VARCHAR(4) = (
        SELECT TOP 1 LTRIM(RTRIM(CASE WHEN @pUfDest = 'EX' THEN CODIGO_FISCAL_EXTERIOR
                                      WHEN @pUfDest = (SELECT UF FROM CADASTRO_CLI_FOR WHERE NOME_CLIFOR = @pFilial)
                                      THEN CODIGO_FISCAL_OPERACAO ELSE CODIGO_FISCAL_INTERESTADUAL END))
          FROM CTB_LX_CARACTERISTICA_CFOP WITH (NOLOCK)
         WHERE CTB_TIPO_OPERACAO = @pTipoOp AND INDICADOR_CFOP = @iInd${idx} AND INDICADOR_FISCAL_TERCEIRO = @pIndFiscal);
      DECLARE @idExc INT = dbo.FX_LOCALIZA_EXCECAO_IMPOSTO(CONCAT(
        '{"CTB_TIPO_OPERACAO":"', @pTipoOp, '","CLIFOR":"', RTRIM(@pClifor), '","INDICADOR_CFOP":"', @iInd${idx},
        '","ENTRADA_SAIDA":"S","MATRIZ_FISCAL":"', RTRIM(@pMatriz), '","FILIAL":"', RTRIM(@pFilial),
        '","EMISSAO_RECEBIMENTO":"', CONVERT(VARCHAR(10), GETDATE(), 120), '","TRIBUT_ORIGEM":"', RTRIM(@iOrig${idx}),
        '","CODIGO_FISCAL_OPERACAO":"', @cfopCarac, '","REFERENCIA":"', RTRIM(@iCod${idx}),
        '","COD_FILHA":"${ehMaterial ? "M" : "P"}","NATUREZA":"', RTRIM(@pNat), '","COD_FILIAL":"', RTRIM(@pCodFilial), '"}'));
      SELECT @idExc AS id, LTRIM(RTRIM(X.TRIBUT_ICMS)) AS csosn, LTRIM(RTRIM(X.CFOP_OBRIGATORIO)) AS cfopObrig,
             LTRIM(RTRIM(X.DESC_EXCECAO)) AS descr, LTRIM(RTRIM(X.CST_IBS_CBS)) AS cstIbs, LTRIM(RTRIM(X.CCLASSTRIB)) AS cclass,
             @cfopCarac AS cfopCarac,
             (SELECT TOP 1 ALIQNAC_FEDERAL FROM TABELA_ALIQUOTA_IMPOSTO_ITEM WITH (NOLOCK)
               WHERE NCM_NBS = @iNcm${idx} AND UF = (SELECT UF FROM CADASTRO_CLI_FOR WHERE NOME_CLIFOR = @pFilial)
                 AND CONVERT(VARCHAR(8), GETDATE(), 112) BETWEEN CONVERT(VARCHAR(8), INICIO_VIGENCIA, 112) AND CONVERT(VARCHAR(8), FIM_VIGENCIA, 112)) AS ibptFed,
             (SELECT TOP 1 ALIQ_ESTADUAL FROM TABELA_ALIQUOTA_IMPOSTO_ITEM WITH (NOLOCK)
               WHERE NCM_NBS = @iNcm${idx} AND UF = (SELECT UF FROM CADASTRO_CLI_FOR WHERE NOME_CLIFOR = @pFilial)
                 AND CONVERT(VARCHAR(8), GETDATE(), 112) BETWEEN CONVERT(VARCHAR(8), INICIO_VIGENCIA, 112) AND CONVERT(VARCHAR(8), FIM_VIGENCIA, 112)) AS ibptEst,
             (SELECT TOP 1 ALIQ_MUNICIPAL FROM TABELA_ALIQUOTA_IMPOSTO_ITEM WITH (NOLOCK)
               WHERE NCM_NBS = @iNcm${idx} AND UF = (SELECT UF FROM CADASTRO_CLI_FOR WHERE NOME_CLIFOR = @pFilial)
                 AND CONVERT(VARCHAR(8), GETDATE(), 112) BETWEEN CONVERT(VARCHAR(8), INICIO_VIGENCIA, 112) AND CONVERT(VARCHAR(8), FIM_VIGENCIA, 112)) AS ibptMun
        FROM (SELECT 1 AS x) d
        LEFT JOIN CTB_EXCECAO_IMPOSTO X WITH (NOLOCK) ON X.ID_EXCECAO_IMPOSTO = @idExc`);
    const idExc = exc?.id === null || exc?.id === undefined ? null : Number(exc.id);
    // Sem exceção fiscal, o Linx da Matriz (regime normal) grava os impostos padrão: ICMS pela
    // alíquota da operação, IPI 0, PIS 1,65 e COFINS 7,6 (CTB_LX_IMPOSTO_TIPO), CST 00, sem IBS/CBS
    // (100.08/131.01 desde 24/10; 133.01/135.01/100.09 antes). Só para contribuinte ou mesma UF: a
    // não contribuinte de outra UF ele soma DIFAL (133.01 → RJ), que a página não calcula.
    const semExcecaoPadrao = idExc === null && !simples && !(interestadual && consumidorFinal);
    const csosn = semExcecaoPadrao ? "00" : trim(exc?.csosn);
    const cfop = trim(exc?.cfopObrig) || trim(exc?.cfopCarac);
    const excDesc = trim(exc?.descr);
    if (idExc === null && semExcecaoPadrao) {
      avisos.push(`${a.produto}: sem exceção fiscal para ${natureza} → ${ufCliente}; impostos padrão do Linx (ICMS da UF, PIS, COFINS).`);
    } else if (idExc === null && !simples) {
      bloqueios.push(
        `${a.produto}: sem exceção fiscal para ${natureza} a consumidor final em ${ufCliente} — o Linx calcula DIFAL, que esta página não faz.`
      );
    } else if (idExc === null) {
      bloqueios.push(`${a.produto}: nenhuma exceção fiscal encontrada para ${ufCliente} — peça ao fiscal para cadastrar.`);
    } else if (tipoNatureza !== "D" && (csosn === "900" || /DEVOLU/i.test(excDesc)) && simples && (indFiscal === 1 || indFiscal === 16)) {
      // Contribuinte (corporativo/revenda) com natureza de venda a NÃO contribuinte (100.02/022):
      // não há exceção de venda. No Linx esse cliente sai pela 100.01 nas próprias pernas, ou
      // pela Matriz (100.05) — as opções que o catálogo desta empresa tiver.
      const tem10001 = catalogo.some((n) => n.natureza === "100.01");
      const matriz = padrao.nota.filiaisExtras.length > 0;
      const opcoes = [
        tem10001 ? `a natureza 100.01 (venda de mercadoria) nesta filial` : null,
        matriz ? `a MATRIZ (100.05)` : null,
      ].filter(Boolean);
      bloqueios.push(
        `Cliente contribuinte (indicador ${indFiscal}): a natureza ${natureza} é de venda a não contribuinte e não tem ` +
          `exceção fiscal para ele. ` +
          (opcoes.length
            ? `No Linx esse cliente sai por ${opcoes.join(" ou por ")}.`
            : `Peça ao fiscal para cadastrar a exceção, ou cadastre o cliente como 8 - Não Contribuinte se ele compra para uso próprio.`)
      );
    } else if (tipoNatureza !== "D" && (csosn === "900" || /DEVOLU/i.test(excDesc))) {
      bloqueios.push(
        `${a.produto}: a exceção fiscal encontrada para ${ufCliente} é "${excDesc}" (${idExc}, CSOSN ${csosn}), que não é de venda. ` +
          `Falta cadastrar a exceção de venda para ${ufCliente} no Linx.`
      );
    } else if (!simples && csosn.length !== 2) {
      // Regime normal usa CST (2 dígitos: 00, 20…); CSOSN (3 dígitos) é do Simples — exceção errada.
      bloqueios.push(
        `${a.produto}: a exceção fiscal ${idExc} ("${excDesc}") traz ${csosn ? `CSOSN ${csosn}` : "tributação vazia"}, ` +
          `que é do Simples — não serve para ${filial} (regime normal). Fature pelo Linx.`
      );
    }
    if (!cfop) bloqueios.push(`${a.produto}: CFOP não encontrado para a natureza ${natureza}.`);
    if (exc && (exc.ibptFed === null || exc.ibptFed === undefined)) {
      avisos.push(`${a.produto}: NCM ${trim(p.ncm)} sem tabela IBPT vigente — a NF sai sem os tributos aproximados.`);
    }

    let impostos: LinhaFiscal["impostos"] = [];
    if (semExcecaoPadrao) {
      impostos = (
        await q(req, `
          SELECT ID_IMPOSTO AS id, CASE WHEN ISNULL(ALIQUOTA_FIXA,0) = 1 THEN ISNULL(ALIQUOTA,0) ELSE 0 END AS taxa,
                 INCIDENCIA AS inc, AGREGA_APOS_DESCONTO AS agDesc, AGREGA_APOS_ENCARGO AS agEnc,
                 ISNULL(ALIQUOTA,0) AS aliqTipo, ISNULL(ALIQUOTA_FIXA,0) AS fixa
            FROM CTB_LX_IMPOSTO_TIPO WITH (NOLOCK) WHERE ID_IMPOSTO IN (1, 2, 5, 6) ORDER BY ID_IMPOSTO`)
      ).map((t) => ({
        id: Number(t.id),
        taxa: Number(t.taxa) || 0,
        incidencia: Number(t.inc) || 0,
        agregaDesconto: Boolean(t.agDesc),
        agregaEncargo: Boolean(t.agEnc),
        reducao: 0,
        aliquotaTipo: Number(t.aliqTipo) || 0,
        fixa: Boolean(t.fixa),
      }));
    } else if (idExc !== null) {
      req.input(`iExc${idx}`, sql.Int, idExc);
      impostos = (
        await q(req, `
          SELECT EI.ID_IMPOSTO AS id, ISNULL(EI.TAXA_IMPOSTO,0) AS taxa, ISNULL(EI.INCIDENCIA, T.INCIDENCIA) AS inc,
                 ISNULL(EI.AGREGA_APOS_DESCONTO, T.AGREGA_APOS_DESCONTO) AS agDesc,
                 ISNULL(EI.AGREGA_APOS_ENCARGO, T.AGREGA_APOS_ENCARGO) AS agEnc,
                 ISNULL(EI.PORCENT_REDUCAO_DE_BASE,0) AS red, ISNULL(T.ALIQUOTA,0) AS aliqTipo, ISNULL(T.ALIQUOTA_FIXA,0) AS fixa
            FROM CTB_EXCECAO_IMPOSTO_ITEM EI WITH (NOLOCK)
            JOIN CTB_LX_IMPOSTO_TIPO T WITH (NOLOCK) ON T.ID_IMPOSTO = EI.ID_IMPOSTO
           WHERE EI.ID_EXCECAO_IMPOSTO = @iExc${idx}
           ORDER BY EI.ID_IMPOSTO`)
      ).map((t) => ({
        id: Number(t.id),
        taxa: Number(t.taxa) || 0,
        incidencia: Number(t.inc) || 0,
        agregaDesconto: Boolean(t.agDesc),
        agregaEncargo: Boolean(t.agEnc),
        reducao: Number(t.red) || 0,
        aliquotaTipo: Number(t.aliqTipo) || 0,
        fixa: Boolean(t.fixa),
      }));
      const fora = impostos.filter((t) => !IMPOSTOS_REGIME_NORMAL.has(t.id));
      // Regime normal: o Linx não grava DIFAL para contribuinte, e a exceção de bonificação a não
      // contribuinte de outra UF nem traz o imposto (128.01 → RJ: só ICMS 12%, NFs 43629/43687).
      // Só a exceção COM DIFAL para não contribuinte de outra UF a página não calcula.
      if (!simples && interestadual && indFiscal !== 1 && indFiscal !== 16 && impostos.some((t) => IMPOSTOS_DIFAL.has(t.id))) {
        bloqueios.push(
          `${filial} é regime normal: a exceção fiscal ${idExc} tem DIFAL para não contribuinte (indicador ${indFiscal}) ` +
            `em ${ufCliente}, que esta página não calcula. Fature por uma filial do e-commerce.`
        );
      }
      if (!simples && fora.length > 0) {
        bloqueios.push(
          `${a.produto}: a exceção fiscal ${idExc} tem imposto(s) ${fora.map((t) => t.id).join(", ")} que o cálculo do ` +
            `regime normal não conhece — fature pelo Linx.`
        );
      }
    }

    const estoque = p.estoque === null || p.estoque === undefined ? null : Number(p.estoque);
    if (estoque !== null && estoque < a.qtde) {
      avisos.push(`${a.produto} ${a.cor} ${tamLabel}: estoque da filial ${estoque}, NF com ${a.qtde}.`);
    } else if (estoque === null && !ehMaterial) {
      avisos.push(`${a.produto} ${a.cor} ${tamLabel}: sem registro de estoque na filial ${filial}.`);
    }

    const descNf = trim(p.descNf);
    const descCor = trim(p.descCor);
    linhas.push({
      linha: a.linha,
      ordemLinha: 0,
      itemImpressao: "",
      subItem: a.tamanho,
      referenciaItem: ehMaterial ? null : a.cor,
      obsItem: obsDaLinha.get(a.linha) ?? "",
      produto: a.produto,
      cor: a.cor,
      descNf,
      descCor,
      tamanho: a.tamanho,
      tamanhoLabel: tamLabel,
      codigoItem,
      // Material: a descrição da NF do cadastro, ou a digitada (o operador costuma completar, ex. "COD 040272").
      descricao: (descricaoMaterial.get(a.linha) ?? `${descNf} ${descCor} ${tamLabel}`).replace(/\s+/g, " ").trim().slice(0, 80),
      qtde: a.qtde,
      preco: a.preco,
      valor: round2(a.preco * a.qtde),
      ncm: trim(p.ncm),
      unidade: trim(p.unidade) || "PC",
      contaContabil: trim(p.conta),
      origem,
      indicadorCfop: indCfop,
      idCest: p.cest === null || p.cest === undefined ? null : Number(p.cest),
      cfop,
      cfopProd: trim(exc?.cfopCarac) || cfop,
      csosn,
      excecao: idExc,
      excecaoDescricao: excDesc,
      cstIbsCbs: trim(exc?.cstIbs),
      cClassTrib: trim(exc?.cclass),
      estoque,
      custo: Number(p.custo) || 0,
      ibptFederal: Number(exc?.ibptFed) || 0,
      ibptEstadual: Number(exc?.ibptEst) || 0,
      ibptMunicipal: Number(exc?.ibptMun) || 0,
      impostos,
      encargoEntrada: encargoDaLinha.get(a.linha) ?? 0,
      informados: null,
      pct: 0,
      desconto: 0,
      frete: 0,
      seguro: 0,
    });
  }

  // Ordem das linhas fiscais (ITEM_NFE), medida em 19/11/2026 nas NFs desde 24/10 (576 de 582
  // com mais de um item; as 6 de fora foram editadas no Linx e tiveram ITEM_IMPRESSAO renumerado):
  // código do produto (ordem de texto) → ordem digitada da linha → tamanho. O rateio do desconto
  // e do frete depende dela (o centavo de sobra vai a partir do 1º item).
  const ordemDigitada = new Map<string, number>();
  for (const l of linhas) if (!ordemDigitada.has(l.linha)) ordemDigitada.set(l.linha, ordemDigitada.size + 1);
  for (const l of linhas) l.ordemLinha = ordemDigitada.get(l.linha)!;
  const cmpTexto = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  // Material: na ordem digitada (NF 0043636: P11NL… antes de P11AC…).
  if (ehMaterial) linhas.sort((a, b) => a.ordemLinha - b.ordemLinha);
  else linhas.sort((a, b) => cmpTexto(a.produto, b.produto) || a.ordemLinha - b.ordemLinha || a.tamanho - b.tamanho);

  // Agrupamento dos itens fiscais (FATURAMENTO.AGRUPAMENTO_ITENS, opção do form). Medido em
  // 19/11/2026 nas 52 NFs com agrupamento 0/1 desde 2025 (52/52): 0 = um item por produto
  // (código = produto, descrição = a da NF sem cor, REFERENCIA_ITEM nulo); 1 = um item por
  // produto × cor (código = produto + cor, descrição com a cor, sem tamanho); nos dois o
  // SUB_ITEM_TAMANHO é 1 e a ordem é a do código. FATURAMENTO_PROD continua produto × cor com a
  // grade, apontando (ITEM_IMPRESSAO) para o item fiscal que a contém.
  // 3, 4 e 5 = 0, 1 e 2 "por pedido": o nº do pedido vai na frente do código e da descrição do
  // item (no agrupamento 5 a REFERENCIA_ITEM é cor + tamanho) — 60 NFs desde 2025, prefixo =
  // FATURAMENTO_PROD.PEDIDO em todas. O nº do pedido nasce no batch, então o prefixo é posto lá.
  const agrupamento: Plano["agrupamento"] = [0, 1, 2, 3, 4, 5].includes(Number(input.agrupamento))
    ? (Number(input.agrupamento) as Plano["agrupamento"])
    : 2;
  const base = ehMaterial ? 2 : agrupamento % 3;
  // ITEM_IMPRESSAO: agrupamentos 0/1 numeram os grupos em sequência; no 2 é o nº da 1ª linha do
  // produto × cor — linhas repetidas do mesmo produto × cor apontam para ela (NF 0043673 da Matriz).
  const chaveNumero = (l: LinhaFiscal) => (ehMaterial ? l.linha : base === 0 ? l.produto : `${l.produto}|${l.cor}`);
  const numeroFiscal = new Map<string, string>();
  for (const l of [...linhas].sort((a, b) => a.ordemLinha - b.ordemLinha)) {
    const k = chaveNumero(l);
    if (!numeroFiscal.has(k)) {
      numeroFiscal.set(k, String(base === 2 ? l.ordemLinha : numeroFiscal.size + 1).padStart(4, "0"));
    }
  }
  for (const l of linhas) l.itemImpressao = numeroFiscal.get(chaveNumero(l))!;
  // Item fiscal: 0 = produto; 1 = produto × cor; 2 = produto × cor × tamanho — linhas repetidas do
  // mesmo produto × cor × tamanho viram UM item fiscal (0043673: 1 + 4 peças → item de 5).
  const chaveFiscal = (l: LinhaFiscal) =>
    base === 0 ? l.produto : base === 1 ? `${l.produto}|${l.cor}` : `${l.produto}|${l.cor}|${l.tamanho}`;
  let fiscais: LinhaFiscal[] = linhas;
  if (agrupamento === 5) for (const l of linhas) l.referenciaItem = `${l.cor}${l.tamanhoLabel}`;
  const repetidos = !ehMaterial && base === 2 && new Set(linhas.map(chaveFiscal)).size !== linhas.length;
  if (base !== 2 || repetidos) {
    const porChave = new Map<string, LinhaFiscal>();
    for (const l of linhas) {
      const k = chaveFiscal(l);
      const f = porChave.get(k);
      if (!f) {
        porChave.set(
          k,
          base === 2
            ? { ...l }
            : {
                ...l,
                codigoItem: base === 0 ? l.produto : `${l.produto}${l.cor}`,
                descricao: (base === 0 ? l.descNf : `${l.descNf} ${l.descCor}`).replace(/\s+/g, " ").trim().slice(0, 80),
                referenciaItem: base === 0 ? null : l.cor,
                subItem: 1,
              }
        );
        continue;
      }
      if (f.preco !== l.preco) {
        bloqueios.push(`${l.produto}${base === 1 ? ` ${l.cor}` : ""}: preços diferentes não podem ser agrupados num item só — use o agrupamento por tamanho.`);
      }
      if (f.excecao !== l.excecao || f.cfop !== l.cfop) {
        bloqueios.push(`${l.produto}: itens com tributação diferente não podem ser agrupados num item só.`);
      }
      f.qtde += l.qtde;
      f.valor = round2(f.valor + l.valor);
      f.encargoEntrada = round2(f.encargoEntrada + l.encargoEntrada);
      if (!f.obsItem) f.obsItem = l.obsItem;
    }
    fiscais = [...porChave.values()];
    // 0/1: ordem do código; 2 (linhas repetidas fundidas): a mesma ordem de sempre (já ordenadas).
    if (base !== 2) fiscais.sort((a, b) => cmpTexto(a.codigoItem, b.codigoItem));
  }

  // Devolução: itens fiscais na ordem do código e numerados em sequência (ITEM_IMPRESSAO =
  // ITEM_NFE), nas 4 devoluções de produto da NERD desde 2025.
  if (devolucao) {
    fiscais = fiscais === linhas ? [...linhas] : fiscais;
    fiscais.sort((a, b) => cmpTexto(a.codigoItem, b.codigoItem));
    const numero = new Map(fiscais.map((f, i) => [chaveFiscal(f), String(i + 1).padStart(4, "0")]));
    for (const f of fiscais) f.itemImpressao = numero.get(chaveFiscal(f))!;
    for (const l of linhas) l.itemImpressao = numero.get(chaveFiscal(l))!;
  }

  // Totais e desconto (sempre no cabeçalho, como o Linx faz)
  const subtotal = round2(linhas.reduce((s, l) => s + l.valor, 0));
  const frete = round2(Math.max(0, Number(input.frete) || 0));
  const seguro = round2(Math.max(0, Number(input.seguro) || 0));
  let porcDesconto: number;
  let desconto: number;
  const porcDigitado = input.descontoModo === "percentual";
  if (porcDigitado) {
    porcDesconto = Math.max(0, Number(input.descontoPercentual) || 0);
    desconto = round2((subtotal * porcDesconto) / 100);
  } else {
    desconto = round2(Math.max(0, Number(input.descontoValor) || 0));
    // Desconto digitado em R$: o Linx grava o % com 4 casas (NFs de 100.022 desde 24/10).
    porcDesconto = subtotal > 0 ? Math.round((desconto / subtotal) * 100 * 1e4) / 1e4 : 0;
  }
  if (desconto > subtotal) bloqueios.push("O desconto é maior que o valor dos produtos.");
  // 2º desconto do form: "desconto na condição de pagamento", sobre o valor já com o 1º.
  // Medido nas 88 NFs desde 24/10: em % → base × % TRUNCADO; em R$ → % = valor ÷ base, arredondado.
  const baseCond = round2(subtotal - desconto);
  let porcDescontoCond = 0;
  let descontoCond = 0;
  if (input.descontoCondModo === "valor") {
    descontoCond = round2(Math.max(0, Number(input.descontoCondValor) || 0));
    porcDescontoCond = baseCond > 0 ? round2((descontoCond / baseCond) * 100) : 0;
  } else if (input.descontoCondModo === "percentual") {
    porcDescontoCond = Math.max(0, Number(input.descontoCondPercentual) || 0);
    descontoCond = trunc2((baseCond * porcDescontoCond) / 100);
  }
  if (descontoCond > baseCond) bloqueios.push("O desconto na condição de pagamento é maior que o valor a pagar.");
  const total = round2(subtotal - desconto - descontoCond + frete + seguro);
  const qtdeTotal = linhas.reduce((s, l) => s + l.qtde, 0);
  // "Desconto sobre 4" é onde o form registra o % digitado; o Linx só preenche sem desconto na
  // condição e conforme o costume da filial (pernas da Scarf Me sim, NERD não) — catálogo.
  const descontoSobre4 =
    porcDigitado && descontoCond === 0 && (await fetchCostumeDescontoSobre4(input.empresa))[filial] ? porcDesconto : 0;

  // Rateio por item: os dois descontos juntos (regra do centavo a partir do 1º, 88/88 NFs).
  ratear(fiscais, round2(desconto + descontoCond), "desconto", subtotal);
  ratear(fiscais, frete, "frete", subtotal);
  ratear(fiscais, seguro, "seguro", subtotal);

  // Devolução: impostos da NF do fornecedor, por item fiscal (informados, ou a sugestão do Linx);
  // o IPI (incidência 1) soma ao total da NF.
  let impostoAgregar = 0;
  if (devolucao) {
    for (const f of fiscais) {
      f.informados = impostosDevolucao(f, input.devolucao?.impostos?.[f.codigoItem], input.devolucao?.taxas);
      impostoAgregar = round2(impostoAgregar + f.informados.filter((t) => t.id === 2).reduce((s2, t) => s2 + t.valor, 0));
    }
  }
  const totalNf = round2(total + impostoAgregar);

  // Pedido do site já faturado?
  const pedidoSite = devolucao ? undefined : trim(input.obs).match(/#\s*(\d{3,})/)?.[1];
  if (pedidoSite) {
    filiaisEmpresa.forEach((f, i) => req.input(`dupF${i}`, sql.VarChar(25), f));
    req.input("dupObs", sql.VarChar(40), `%#${pedidoSite}%`);
    const dup = await q(req, `
      SELECT TOP 10 LTRIM(RTRIM(FILIAL)) AS filial, LTRIM(RTRIM(NF_SAIDA)) AS nf, CAST(OBS AS VARCHAR(500)) AS obs
        FROM FATURAMENTO WITH (NOLOCK)
       WHERE FILIAL IN (${filiaisEmpresa.map((_, i) => `@dupF${i}`).join(",")})
         AND NOTA_CANCELADA = 0 AND OBS LIKE @dupObs
       ORDER BY EMISSAO DESC`);
    // LIKE '%#1710%' também pega #17101 — confere o número exato.
    const exato = dup.filter((d) => new RegExp(`#\\s*${pedidoSite}(?!\\d)`).test(String(d.obs ?? "")));
    if (exato.length > 0) {
      const msg = `O pedido #${pedidoSite} já aparece na NF ${exato.map((d) => `${trim(d.nf)} (${trim(d.filial)})`).join(", ")}.`;
      if (input.confirmarDuplicidade) avisos.push(msg);
      else bloqueios.push(`${msg} Marque "faturar mesmo assim" se for outra NF do mesmo pedido.`);
    }
  } else if (!devolucao) {
    avisos.push("OBS sem o nº do pedido do site (#1234) — fica mais difícil conferir depois.");
  }

  if (!simples && fiscais.length > 0) {
    const tot = new Map<number, number>();
    for (const l of fiscais) {
      for (const v of impostosRegimeNormal(l, aliqIcmsOperacao)) if (v) tot.set(v.id, round2((tot.get(v.id) ?? 0) + v.valor));
    }
    const nome: Record<number, string> = { 1: "ICMS", 2: "IPI", 5: "PIS", 6: "COFINS", 92: "IBS-UF", 93: "CBS", 94: "IBS-MUN" };
    avisos.push(
      `${filial} é regime normal (não Simples): impostos calculados — ` +
        [...tot.entries()].filter(([, v]) => v > 0).map(([id, v]) => `${nome[id] ?? id} R$ ${v.toFixed(2)}`).join(", ") +
        ". Confira com o fiscal se for a primeira NF da filial por aqui."
    );
  }

  return {
    empresa: input.empresa,
    filial,
    serie: trim(fil.serie),
    larguraNf,
    simples,
    aliqIcmsOperacao,
    indFiscal,
    consumidorFinal,
    // NF de material usa o cód. de transação do form de material (130.01/199.10: FATURAMENTO_026).
    codTransacao: ehMaterial ? noCatalogo?.padroes.codTransacaoMaterial || "FATURAMENTO_026" : codTransacao,
    nfFatura,
    tipoNatureza,
    ufEmbarque,
    localEmbarque,
    codFilial: trim(fil.codFilial),
    empresaCodigo: Number(fil.empresa),
    ufFilial,
    cnpjFilial: trim(fil.cnpj).replace(/\D/g, ""),
    cUf: trim(fil.ibge).slice(0, 2),
    serieSintegra: trim(fil.sintegra) || "1",
    proximoNumero,
    natureza,
    naturezaDescricao: trim(nat.descr),
    cliente: {
      codigo: trim(cli.codigo),
      nome: String(cli.nome).trimEnd(),
      razao: trim(cli.razao),
      uf: ufCliente,
      cidade: trim(cli.cidade),
      tabPreco: trim(cli.tab) || noCatalogo?.padroes.tabPreco || "01",
      // VENDAS.INDICADOR_VENDA = o do cliente (CLIENTES_ATACADO): WEB 'V', corporativo ' '.
      indicadorVenda: String(cli.indicadorVenda ?? "V").slice(0, 1) || " ",
      // Representante (e gerente) da NF = o do cadastro do cliente, o principal primeiro; sem
      // cadastro, o padrão da empresa (100% das NFs desde 24/10/2026, medido em 19/11).
      representante: trim(cli.representante) || null,
      // Condição do cadastro do cliente (informativa). O pedido "NF SEM PEDIDO" leva a da NF:
      // 1.129 de 1.133 NFs desde 24/10/2026, em todas as naturezas (medido em 19/11).
      condicaoPgto: trim(cli.condCli) || null,
    },
    linhas,
    agrupamento,
    fiscais,
    devolucao,
    material: ehMaterial,
    impostoAgregar,
    responsavel: trim(input.responsavel) || "LOGISTICA",
    subtotal,
    porcDesconto,
    porcDigitado,
    descontoCond,
    porcDescontoCond,
    descontoSobre4,
    desconto,
    frete,
    seguro,
    total: totalNf,
    qtdeTotal,
    icmsDestinoAliq: Number(aliqDest?.aliq) || 0,
    input,
    bloqueios: [...new Set(bloqueios)],
    avisos: [...new Set(avisos)],
  };
}

/**
 * Rateio do cabeçalho pelos itens, como o form do Linx grava — regras medidas em 19/11/2026 nas
 * NFs reais (ordem = ITEM_NFE, a ordem das linhas):
 *  - % de rateio: cada item com 10 casas; a sobra para fechar 100 vai no PRIMEIRO item;
 *  - desconto: cada item = valor × desconto ÷ subtotal, arredondado; a sobra vai UM CENTAVO por
 *    item a partir do primeiro (385 de 385 NFs);
 *  - frete/seguro: cada item = encargo × % de rateio, arredondado; a sobra INTEIRA no primeiro
 *    item (235 de 235 NFs).
 */
function ratear(linhas: LinhaFiscal[], totalValor: number, campo: "desconto" | "frete" | "seguro", subtotal: number) {
  if (linhas.length === 0) return;
  const r10 = (n: number) => Math.round(n * 1e10) / 1e10;
  for (const l of linhas) l.pct = subtotal > 0 ? r10((l.valor / subtotal) * 100) : 0;
  if (subtotal > 0) linhas[0].pct = r10(linhas[0].pct + (100 - linhas.reduce((s, l) => s + l.pct, 0)));
  if (campo === "desconto") {
    for (const l of linhas) l.desconto = subtotal > 0 ? round2((totalValor * l.valor) / subtotal) : 0;
    let centavos = Math.round((totalValor - linhas.reduce((s, l) => s + l.desconto, 0)) * 100);
    for (let i = 0; centavos !== 0 && i < linhas.length; i++) {
      const passo = centavos > 0 ? 1 : -1;
      linhas[i].desconto = round2(linhas[i].desconto + passo / 100);
      centavos -= passo;
    }
  } else {
    for (const l of linhas) l[campo] = round2((totalValor * l.pct) / 100);
    linhas[0][campo] = round2(linhas[0][campo] + (totalValor - linhas.reduce((s, l) => s + l[campo], 0)));
  }
}

// ── Devolução de compra ─────────────────────────────────────────────────────
//
// Medido nas 4 devoluções de produto da NERD desde 2025 (117.11 e 150.01): a NF nasce de um romaneio
// "DEVOLUCAO ENTRADA" (ESTOQUE_PROD_SAI/PROD1_SAI — é ele que baixa o estoque, pelo trigger), sem
// pedido nem FATURAMENTO_PROD; finalidade NF-e 4; cada item fiscal se liga ao item da NF de entrada
// em FATURAMENTO_ENTRADA_DEVOLUCAO (o trigger dela soma ENTRADAS_ITEM.QTDE_DEVOLVIDA). Os impostos
// são os da NF do fornecedor — o Linx não guarda o XML dele (as tabelas de importação estão vazias)
// e a exceção de devolução zera tudo; o operador digita ICMS/IPI/PIS/COFINS da NF de compra.

const NOME_IMPOSTO: Record<number, string> = { 1: "ICMS", 2: "IPI", 5: "PIS", 6: "COFINS", 92: "IBS-UF", 93: "CBS", 94: "IBS-MUN" };

async function carregarDevolucao(
  req: Req,
  input: NotaInput,
  ctx: { filial: string; nomeCliente: string; tipoNatureza: string; bloqueios: string[] }
): Promise<{ plano: PlanoDevolucao; itens: NotaInput["itens"]; encargos: Map<string, number> }> {
  const dv = input.devolucao!;
  const { bloqueios } = ctx;
  if (ctx.tipoNatureza !== "D") {
    bloqueios.push(`A natureza ${trim(input.natureza)} não é de devolução — use 117.11 (devolução de compra) ou 150.01.`);
  }
  req.input("dvForn", sql.VarChar(25), trim(dv.fornecedor));
  req.input("dvNf", sql.VarChar(15), trim(dv.nfEntrada));
  req.input("dvSerie", sql.VarChar(6), trim(dv.serieEntrada));
  const [en] = await q(req, `
    SELECT LTRIM(RTRIM(FILIAL)) AS filial, RTRIM(NOME_CLIFOR) AS forn, LTRIM(RTRIM(NF_ENTRADA)) AS nf, LTRIM(RTRIM(SERIE_NF_ENTRADA)) AS serie
      FROM ENTRADAS WITH (NOLOCK)
     WHERE NOME_CLIFOR = @dvForn AND NF_ENTRADA = @dvNf AND SERIE_NF_ENTRADA = @dvSerie`);
  if (!en) throw new Error(`NF de entrada ${trim(dv.nfEntrada)}/${trim(dv.serieEntrada)} de ${trim(dv.fornecedor)} não encontrada.`);
  if (trim(en.filial) !== ctx.filial) bloqueios.push(`A NF de entrada ${trim(en.nf)} é da filial ${trim(en.filial)}, não de ${ctx.filial}.`);
  if (String(en.forn).trimEnd() !== ctx.nomeCliente) {
    bloqueios.push(`O destinatário da devolução tem de ser o fornecedor da NF de entrada (${String(en.forn).trim()}).`);
  }
  const ei = await q(req, `
    SELECT ITEM_IMPRESSAO AS item, SUB_ITEM_TAMANHO AS sub, LTRIM(RTRIM(REFERENCIA)) AS produto,
           LTRIM(RTRIM(REFERENCIA_ITEM)) AS cor, QTDE_ITEM AS qtde, ISNULL(QTDE_DEVOLVIDA, 0) AS devolvida,
           PRECO_UNITARIO AS preco, ISNULL(VALOR_ENCARGOS, 0) AS encargo, LTRIM(RTRIM(COD_TABELA_FILHA)) AS tf
      FROM ENTRADAS_ITEM WITH (NOLOCK)
     WHERE NOME_CLIFOR = @dvForn AND NF_ENTRADA = @dvNf AND SERIE_NF_ENTRADA = @dvSerie
     ORDER BY ITEM_IMPRESSAO, SUB_ITEM_TAMANHO`);
  // ESTOQUE_PROD1_SAI.ITEM_IMPRESSAO_ENTRADA aponta para o 1º item da entrada do mesmo produto (NF 1515).
  const primeiroDoProduto = new Map<string, string>();
  for (const e of ei) if (!primeiroDoProduto.has(String(e.produto))) primeiroDoProduto.set(String(e.produto), trim(e.item));
  const itens: NotaInput["itens"] = [];
  const encargos = new Map<string, number>();
  const planoItens: PlanoDevolucao["itens"] = [];
  (dv.itens ?? []).forEach((sel, i) => {
    const e = ei.find((x) => trim(x.item) === trim(sel.itemImpressaoEntrada) && Number(x.sub) === Number(sel.subItem));
    if (!e) {
      bloqueios.push(`O item ${trim(sel.itemImpressaoEntrada)} não existe na NF de entrada ${trim(en.nf)}.`);
      return;
    }
    if (trim(e.tf) !== "P") {
      bloqueios.push(`O item ${trim(e.item)} da entrada não é produto (material/item avulso) — devolução de material ainda não é feita aqui.`);
      return;
    }
    if (!trim(e.cor)) {
      // Entrada agrupada só por produto (sem cor no item): não dá para saber de qual cor sai o estoque.
      bloqueios.push(`A NF de entrada ${trim(en.nf)} está agrupada por produto (item ${trim(e.item)} sem cor) — devolva pelo Linx.`);
      return;
    }
    const qtde = Math.round(Number(sel.qtde) || 0);
    const saldo = Number(e.qtde) - Number(e.devolvida);
    if (qtde <= 0) bloqueios.push(`Quantidade inválida no item ${trim(e.item)}.`);
    if (qtde > saldo) bloqueios.push(`${e.produto} ${e.cor}: devolvendo ${qtde}, mas restam ${saldo} da NF de entrada.`);
    const linha = `L${i}`;
    itens.push({ produto: String(e.produto), cor: String(e.cor), tamanho: Number(e.sub) || 1, qtde, preco: Number(e.preco), linha: i });
    encargos.set(linha, Number(e.qtde) > 0 ? round2((Number(e.encargo) * qtde) / Number(e.qtde)) : 0);
    planoItens.push({
      linha,
      itemImpressaoEntrada: trim(e.item),
      subItem: Number(e.sub),
      qtde,
      itemProdutoEntrada: primeiroDoProduto.get(String(e.produto)) ?? trim(e.item),
      preco: Number(e.preco),
    });
  });
  if (planoItens.length === 0) bloqueios.push("Escolha ao menos um item da NF de entrada para devolver.");
  return { plano: { fornecedor: String(en.forn).trimEnd(), nfEntrada: trim(en.nf), serieEntrada: trim(en.serie), itens: planoItens }, itens, encargos };
}

/**
 * Impostos do item na devolução: os informados (da NF do fornecedor) ou a sugestão, com as bases
 * como o Linx grava (NF 1515): ICMS e IBS/CBS = item + frete rateado na entrada; IPI = item;
 * PIS/COFINS = base do ICMS + IPI. Taxa sugerida = a da exceção (a de devolução zera tudo — a
 * tela pede as alíquotas da NF de compra). Valor = base × taxa, truncado.
 */
function impostosDevolucao(f: LinhaFiscal, informados?: ImpostoInformado[], taxas?: Record<string, number>): ImpostoInformado[] {
  if (informados && informados.length > 0) {
    return informados.map((t) => ({ id: Number(t.id), base: round2(Number(t.base) || 0), taxa: Number(t.taxa) || 0, valor: round2(Number(t.valor) || 0) }));
  }
  // Alíquota: a informada (NF do fornecedor) ou a da exceção. Impostos = os da exceção + os informados > 0.
  const ids = [...new Set([...f.impostos.map((t) => t.id), ...Object.entries(taxas ?? {}).filter(([, v]) => Number(v) > 0).map(([k]) => Number(k))])].sort((a, b) => a - b);
  const taxaDe = (id: number) => {
    const inf = taxas?.[String(id)];
    if (inf !== undefined && inf !== null && Number.isFinite(Number(inf))) return Number(inf);
    const t = f.impostos.find((x) => x.id === id);
    return t && t.reducao < 100 ? t.taxa : 0;
  };
  const baseIcms = round2(f.valor + f.encargoEntrada);
  const ipi = ids.includes(2) ? trunc2((f.valor * taxaDe(2)) / 100) : 0;
  return ids.map((id) => {
    const taxa = taxaDe(id);
    // Sem alíquota o Linx grava base 0 (devolução 1505: PIS/COFINS).
    if (taxa === 0) return { id, base: 0, taxa: 0, valor: 0 };
    const base = id === 2 ? f.valor : id === 5 || id === 6 ? round2(baseIcms + ipi) : baseIcms;
    return { id, base, taxa, valor: id === 2 ? ipi : trunc2((base * taxa) / 100) };
  });
}

/** Romaneio "DEVOLUCAO ENTRADA" (baixa o estoque pelo trigger) + vínculo de cada item com a entrada. */
function sqlDevolucao(p: Plano): string {
  const dv = p.devolucao!;
  const rom: string[] = [];
  const vinc: string[] = [];
  for (const it of dv.itens) {
    const l = p.linhas.find((x) => x.linha === it.linha);
    if (!l) continue;
    const fiscal = p.fiscais.find((f) => f.itemImpressao === l.itemImpressao && (p.agrupamento % 3 !== 2 || f.tamanho === l.tamanho));
    // Grade (SA_n) junto com a QTDE — é por ela que o trigger move o estoque (regra do CLAUDE.md).
    const sa = Array.from({ length: MAX_GRADE }, (_, k) => `SA_${k + 1}`);
    const saVals = sa.map((_, k) => (k + 1 === l.tamanho ? it.qtde : 0));
    rom.push(`
  INSERT INTO ESTOQUE_PROD1_SAI (FILIAL, ROMANEIO_PRODUTO, PRODUTO, COR_PRODUTO, QTDE, ${sa.join(", ")},
    CUSTO1, CUSTO2, CUSTO3, CUSTO4, VALOR, ITEM_IMPRESSAO, ITEM_IMPRESSAO_ENTRADA, DATA_PARA_TRANSFERENCIA, DESCONTO_ITEM, PEDIDO)
  VALUES (@FILIAL, @ROMANEIO, ${lit(l.produto)}, ${lit(l.cor)}, ${it.qtde}, ${saVals.join(", ")},
    ${num(it.preco, 5)}, 0, 0, 0, ${num(l.valor)}, ${lit(l.itemImpressao)}, ${lit(it.itemProdutoEntrada)}, @AGORA, 0, '');`);
    vinc.push(`
  INSERT INTO FATURAMENTO_ENTRADA_DEVOLUCAO (QTDE_DEVOLVIDA, ITEM_IMPRESSAO_SAIDA, ORIGEM_ENTRADA_SAIDA, ITEM_IMPRESSAO_ENTRADA,
    SUB_ITEM_SAIDA, SUB_ITEM_ENTRADA, FILIAL, NF_SAIDA, SERIE_NF, NOME_CLIFOR, NF_ENTRADA, SERIE_NF_ENTRADA)
  VALUES (${it.qtde}, ${lit(l.itemImpressao)}, 'S', ${lit(it.itemImpressaoEntrada)},
    ${fiscal?.subItem ?? l.subItem}, ${it.subItem}, @FILIAL, @NF, @SERIE, @CLIENTE, @DEV_NF_ENTRADA, @DEV_SERIE_ENTRADA);`);
  }
  return `
  -- Romaneio de devolução: nº pela sequência do Linx, pulando um nº que já exista.
  DECLARE @romNum INT;
  UPDATE SEQUENCIAIS WITH (UPDLOCK, HOLDLOCK)
     SET @romNum = CAST(SEQUENCIA AS INT) + 1
   WHERE TABELA_COLUNA = 'ESTOQUE_PROD_SAI.ROMANEIO_PRODUTO';
  IF @romNum IS NULL BEGIN ;THROW 51110, 'Sequencial ESTOQUE_PROD_SAI.ROMANEIO_PRODUTO não encontrado.', 1; END
  WHILE EXISTS (SELECT 1 FROM ESTOQUE_PROD_SAI WITH (UPDLOCK, HOLDLOCK) WHERE ROMANEIO_PRODUTO = RIGHT('000000' + CAST(@romNum AS VARCHAR(6)), 6))
    SET @romNum = @romNum + 1;
  UPDATE SEQUENCIAIS SET SEQUENCIA = RIGHT('000000' + CAST(@romNum AS VARCHAR(6)), 6) WHERE TABELA_COLUNA = 'ESTOQUE_PROD_SAI.ROMANEIO_PRODUTO';
  DECLARE @ROMANEIO VARCHAR(8) = RIGHT('000000' + CAST(@romNum AS VARCHAR(6)), 6);
  INSERT INTO ESTOQUE_PROD_SAI (ROMANEIO_PRODUTO, FILIAL, EMISSAO, RESPONSAVEL, SEGUNDA_QUALIDADE, TIPO_ROMANEIO, DATA_DIGITACAO,
    NF_FILIAL, NF_SAIDA, SERIE_NF, NOME_CLIFOR, NF_ENTRADA, SERIE_NF_ENTRADA, NAO_VALIDAR_ENTRADA, CM_OPERACAO,
    DATA_PARA_TRANSFERENCIA, MOV_INTERNA)
  VALUES (@ROMANEIO, @FILIAL, @HOJE, @RESPONSAVEL, 0, 'DEVOLUCAO ENTRADA', @AGORA,
    @FILIAL, @NF, @SERIE, @CLIENTE, @DEV_NF_ENTRADA, @DEV_SERIE_ENTRADA, 0, '017',
    @AGORA, 0);
${rom.join("\n")}
${vinc.join("\n")}`;
}

/**
 * NFs de entrada da filial que ainda têm saldo a devolver (para a aba Devolução): por fornecedor
 * ou nº da NF. Só itens de produto (COD_TABELA_FILHA P).
 */
export async function listarEntradasDevolviveis(params: { empresa: EmpresaFat; filial: string; busca: string }): Promise<EntradaDevolvivel[]> {
  if (!(await filiaisNotaDaEmpresa(params.empresa)).includes(params.filial)) return [];
  const busca = trim(params.busca).toUpperCase();
  if (busca.length < 2) return [];
  return withRequest(async (request: sql.Request | RequestLike) => {
    const req = request as Req;
    req.input("fil", sql.VarChar(25), params.filial);
    req.input("like", sql.VarChar(40), `%${busca}%`);
    req.input("nfb", sql.VarChar(15), busca.replace(/\D/g, ""));
    const cab = await q(req, `
      SELECT TOP 20 RTRIM(E.NOME_CLIFOR) AS forn, LTRIM(RTRIM(C.CLIFOR)) AS clifor, LTRIM(RTRIM(E.NF_ENTRADA)) AS nf,
             LTRIM(RTRIM(E.SERIE_NF_ENTRADA)) AS serie, E.EMISSAO AS emissao, E.VALOR_TOTAL AS total
        FROM ENTRADAS E WITH (NOLOCK)
        JOIN CADASTRO_CLI_FOR C WITH (NOLOCK) ON C.NOME_CLIFOR = E.NOME_CLIFOR
       WHERE E.FILIAL = @fil
         AND (E.NOME_CLIFOR LIKE @like OR (LEN(@nfb) > 0 AND LTRIM(RTRIM(E.NF_ENTRADA)) LIKE '%' + @nfb))
         AND EXISTS (SELECT 1 FROM ENTRADAS_ITEM I WITH (NOLOCK)
                      WHERE I.NOME_CLIFOR = E.NOME_CLIFOR AND I.NF_ENTRADA = E.NF_ENTRADA AND I.SERIE_NF_ENTRADA = E.SERIE_NF_ENTRADA
                        AND I.COD_TABELA_FILHA = 'P' AND I.QTDE_ITEM > ISNULL(I.QTDE_DEVOLVIDA, 0))
       ORDER BY E.EMISSAO DESC`);
    const out: EntradaDevolvivel[] = [];
    for (const [k, c] of cab.entries()) {
      req.input(`f${k}`, sql.VarChar(25), String(c.forn));
      req.input(`n${k}`, sql.VarChar(15), String(c.nf));
      req.input(`s${k}`, sql.VarChar(6), String(c.serie));
      const itens = await q(req, `
        SELECT LTRIM(RTRIM(ITEM_IMPRESSAO)) AS item, SUB_ITEM_TAMANHO AS sub, LTRIM(RTRIM(REFERENCIA)) AS produto,
               LTRIM(RTRIM(REFERENCIA_ITEM)) AS cor, LTRIM(RTRIM(DESCRICAO_ITEM)) AS descr, QTDE_ITEM AS qtde,
               ISNULL(QTDE_DEVOLVIDA, 0) AS devolvida, PRECO_UNITARIO AS preco
          FROM ENTRADAS_ITEM WITH (NOLOCK)
         WHERE NOME_CLIFOR = @f${k} AND NF_ENTRADA = @n${k} AND SERIE_NF_ENTRADA = @s${k} AND COD_TABELA_FILHA = 'P'
         ORDER BY ITEM_IMPRESSAO, SUB_ITEM_TAMANHO`);
      out.push({
        fornecedor: String(c.forn).trimEnd(),
        clifor: trim(c.clifor),
        nfEntrada: trim(c.nf),
        serieEntrada: trim(c.serie),
        emissao: iso(c.emissao),
        valorTotal: Number(c.total) || 0,
        itens: itens.map((x) => ({
          itemImpressao: trim(x.item),
          subItem: Number(x.sub),
          produto: trim(x.produto),
          cor: trim(x.cor),
          descricao: trim(x.descr),
          qtde: Number(x.qtde) || 0,
          devolvida: Number(x.devolvida) || 0,
          preco: Number(x.preco) || 0,
        })),
      });
    }
    return out;
  });
}

function paraPreview(p: Plano): NotaPreview {
  return {
    filial: p.filial,
    serie: p.serie,
    proximoNumero: p.proximoNumero,
    natureza: p.natureza,
    naturezaDescricao: p.naturezaDescricao,
    cliente: { codigo: p.cliente.codigo, nome: p.cliente.nome, razao: p.cliente.razao, uf: p.cliente.uf, cidade: p.cliente.cidade },
    itens: p.linhas.map(
      (l): NotaPreviewItem => ({
        produto: l.produto,
        cor: l.cor,
        descCor: l.descCor,
        tamanho: l.tamanho,
        tamanhoLabel: l.tamanhoLabel,
        codigoItem: l.codigoItem,
        descricao: l.descricao,
        qtde: l.qtde,
        preco: l.preco,
        valor: l.valor,
        ncm: l.ncm,
        cfop: l.cfop,
        csosn: l.csosn,
        excecao: l.excecao,
        excecaoDescricao: l.excecaoDescricao,
        estoque: l.estoque,
      })
    ),
    subtotal: p.subtotal,
    descontoPercentual: p.porcDesconto,
    desconto: p.desconto,
    descontoCond: p.descontoCond,
    descontoCondPercentual: p.porcDescontoCond,
    frete: p.frete,
    seguro: p.seguro,
    total: p.total,
    qtdeTotal: p.qtdeTotal,
    devolucao: p.devolucao
      ? {
          itens: p.fiscais.map(
            (f): DevolucaoPreviewItem => ({
              codigoItem: f.codigoItem,
              descricao: f.descricao,
              qtde: f.qtde,
              valor: f.valor,
              impostos: (f.informados ?? []).map((t) => ({ ...t, nome: NOME_IMPOSTO[t.id] ?? String(t.id) })),
            })
          ),
          impostoAgregar: p.impostoAgregar,
          romaneio: null,
        }
      : undefined,
    bloqueios: p.bloqueios,
    avisos: p.avisos,
  };
}

export async function previaNota(input: NotaInput): Promise<NotaPreview> {
  return withRequest(async (request) => paraPreview(await montarPlano(request, input)));
}

// ── Gravação ────────────────────────────────────────────────────────────────

/** Valor do imposto da linha, reproduzindo o que o form grava (Simples Nacional). */
function valorImposto(l: LinhaFiscal, t: LinhaFiscal["impostos"][number], aliqDestino: number) {
  // 73 ICMS-DESTINO: informativo, base 0 / taxa 0 e valor = (item − desconto + encargos) × alíquota interna do destino, truncado.
  if (t.id === 73) {
    const base = l.valor - l.desconto + l.frete + l.seguro;
    return { taxa: 0, base: 0, valor: aliqDestino > 0 ? trunc2((base * aliqDestino) / 100) : 0 };
  }
  // IBS/CBS e afins com alíquota fixa e sem redução total: base = valor do item.
  if (t.reducao < 100 && t.fixa && t.aliquotaTipo > 0) {
    const base = round2((l.valor * (100 - t.reducao)) / 100);
    return { taxa: t.aliquotaTipo, base, valor: round2((base * t.aliquotaTipo) / 100) };
  }
  return { taxa: t.taxa, base: 0, valor: 0 };
}

/** Largura do NF_SAIDA = a do sequencial da filial (Matriz 7). Menos de 7 → 9 (padrão do e-commerce). */
function larguraDoSequencial(seq: string): number {
  const n = trim(seq).length;
  return n >= 7 && n <= 9 ? n : 9;
}

/**
 * Impostos que o cálculo do regime normal conhece: ICMS, IPI, PIS, COFINS, IBS-UF, CBS,
 * IBS-MUN + os de DIFAL (11 DICMS, 71/72 DICMS origem/destino, 73 ICMS-DESTINO), que o Linx
 * NÃO grava na Matriz para contribuinte (NF real 0043466 → RJ: sem linhas 71/72). O caso
 * com DIFAL de verdade (não contribuinte de outra UF) é bloqueado no plano.
 */
const IMPOSTOS_DIFAL = new Set([11, 71, 72, 73]);
const IMPOSTOS_REGIME_NORMAL = new Set([1, 2, 5, 6, 92, 93, 94, ...IMPOSTOS_DIFAL]);
const IMPOSTOS_REFORMA = new Set([92, 93, 94]);

/**
 * Impostos da linha numa filial de REGIME NORMAL (Matriz da Scarf Me), reproduzindo as NFs
 * que o Linx grava para ela. Validado em 19/11/2026: TODAS as NFs 100.05 (venda a cliente) da
 * Matriz gravadas desde a atualização do Linx de 24/10 — 24 NFs, 57 itens, com 1 e com vários
 * itens, com frete — batem centavo a centavo em ICMS, IPI, PIS, COFINS, IBS e CBS (base e valor).
 * (A 100.08, abastecimento das lojas do grupo, usa outra rotina do Linx que reparte base e ICMS
 * pelo total da NF — por isso a página bloqueia 100.08 e cliente que é filial do grupo.)
 *  - base do imposto = item − desconto (se agrega após desconto) + frete/seguro (se após encargo),
 *    com a redução da exceção (ICMS 33,33% dentro de SP); base arredondada, valor TRUNCADO
 *    calculado sobre a base sem arredondar;
 *  - taxa da exceção; se 0, o ICMS usa a alíquota da operação (UNIDADES_FEDERACAO_ICMS);
 *  - IBS/CBS: alíquota do tipo (0,1 / 0,9), base = item − ICMS − PIS − COFINS, valor arredondado.
 * O Simples Nacional continua em `valorImposto` (inalterado).
 */
type ImpostoCalculado = { id: number; taxa: number; base: number; valor: number };

function impostosRegimeNormal(l: LinhaFiscal, aliqIcmsOperacao: number): (ImpostoCalculado | null)[] {
  const baseBruta = (t: LinhaFiscal["impostos"][number]) =>
    l.valor - (t.agregaDesconto ? l.desconto : 0) + (t.agregaEncargo ? l.frete + l.seguro : 0);
  const calc = new Map<number, ImpostoCalculado>();
  for (const t of l.impostos) {
    if (IMPOSTOS_REFORMA.has(t.id) || IMPOSTOS_DIFAL.has(t.id)) continue;
    const taxa = t.taxa > 0 ? t.taxa : t.id === 1 ? aliqIcmsOperacao : 0;
    const baseExata = t.reducao >= 100 || taxa === 0 ? 0 : (baseBruta(t) * (100 - t.reducao)) / 100;
    // Valor sobre a base SEM arredondar, truncado (o Linx: 50,66 → base 33,78 mas ICMS 6,07).
    calc.set(t.id, { id: t.id, taxa: t.reducao >= 100 ? 0 : taxa, base: round2(baseExata), valor: trunc2((baseExata * taxa) / 100) });
  }
  const deduzir = [1, 5, 6].reduce((s, id) => s + (calc.get(id)?.valor ?? 0), 0);
  for (const t of l.impostos) {
    if (!IMPOSTOS_REFORMA.has(t.id)) continue;
    const taxa = t.taxa > 0 ? t.taxa : t.aliquotaTipo;
    const base = t.reducao >= 100 ? 0 : round2(((baseBruta(t) - deduzir) * (100 - t.reducao)) / 100);
    calc.set(t.id, { id: t.id, taxa, base, valor: round2((base * taxa) / 100) });
  }
  // DIFAL: sem linha (null), como o Linx faz na Matriz.
  return l.impostos.map((t) => calc.get(t.id) ?? null);
}

const OBS_DIFAL =
  "Valor do ICMS relativo ao Fundo de Combate à Pobreza (FCP) da UF de destino: 0.00.\r\n" +
  "Valor do ICMS Interestadual para a UF de destino: 0.00.\r\n" +
  "Valor da BC do ICMS na UF de destino: 0.00.";

/**
 * Monta o batch T-SQL da NF. Cabeçalho vai por parâmetro; itens/impostos inline
 * (números formatados e texto escapado) para não estourar o limite de parâmetros.
 * `final`: commit (grava), rollback (simula e desfaz), debug (simula e devolve as linhas).
 */
function montarBatch(p: Plano, cNF: string, final: "commit" | "rollback" | "debug" | "xml"): string {
  const dev = p.devolucao;
  // Devolução e NF de material não têm pedido "NF SEM PEDIDO" nem FATURAMENTO_PROD.
  const semPedido = Boolean(dev) || p.material;
  // Linhas de FATURAMENTO_PROD (produto × cor) com grade
  const prods = new Map<string, { produto: string; cor: string; preco: number; qtde: number; custo: number; cfop: string; grade: Map<number, number>; item: string; obs: string }>();
  // FATURAMENTO_PROD segue a ordem digitada (ITEM_IMPRESSAO); FATURAMENTO_ITEM, a ordem fiscal.
  for (const l of [...p.linhas].sort((a, b) => a.ordemLinha - b.ordemLinha)) {
    const k = l.linha;
    let g = prods.get(k);
    if (!g) {
      g = { produto: l.produto, cor: l.cor, preco: l.preco, qtde: 0, custo: l.custo, cfop: l.cfopProd, grade: new Map(), item: l.itemImpressao, obs: l.obsItem };
      prods.set(k, g);
    }
    g.qtde += l.qtde;
    g.grade.set(l.tamanho, (g.grade.get(l.tamanho) ?? 0) + l.qtde);
  }

  // TIMESTAMP = preço codificado pelo Linx com 5 casas, completado à esquerda até 20 (o "111" final
  // que se via nos preços de 2 casas é a codificação dos zeros; devolução 1505: 121,4371 → …54931).
  const tsExpr = (preco: number) =>
    `REPLICATE(NCHAR(198), 20 - LEN(dbo.FX_PRODUCAO_PRECO(CAST(${num(preco, 5)} AS NUMERIC(14,5)),'T'))) + dbo.FX_PRODUCAO_PRECO(CAST(${num(preco, 5)} AS NUMERIC(14,5)),'T')`;

  // VENDAS_PRODUTO: uma linha por produto × cor (é a chave dela) — linhas repetidas da NF somam
  // (NF 0043673 da Matriz: 2 linhas de 13.46.0129/10 → 1 item do pedido com 5 peças).
  const pedidoProds = new Map<string, { produto: string; cor: string; preco: number; qtde: number; grade: Map<number, number> }>();
  for (const g of prods.values()) {
    const k = `${g.produto}|${g.cor}`;
    const v = pedidoProds.get(k) ?? { produto: g.produto, cor: g.cor, preco: g.preco, qtde: 0, grade: new Map<number, number>() };
    v.qtde += g.qtde;
    for (const [t, q] of g.grade) v.grade.set(t, (v.grade.get(t) ?? 0) + q);
    pedidoProds.set(k, v);
  }
  const vendasProd: string[] = [];
  for (const v of pedidoProds.values()) {
    const valor = round2(v.preco * v.qtde);
    vendasProd.push(`
  INSERT INTO VENDAS_PRODUTO (PEDIDO, PRODUTO, COR_PRODUTO, ENTREGA, ITEM_PEDIDO, QTDE_ORIGINAL, QTDE_ENTREGAR, QTDE_ENTREGUE,
    PRECO1, VALOR_ORIGINAL, VALOR_ENTREGAR, VALOR_ENTREGUE, ENTREGUE_MOEDA_PADRAO, DATA_PARA_TRANSFERENCIA, ${[...v.grade.keys()].map((n) => `VO${n}`).join(", ")})
  VALUES (@PEDIDO, ${lit(v.produto)}, ${lit(v.cor)}, @HOJE, '0000', ${v.qtde}, 0, ${v.qtde},
    ${num(v.preco)}, ${num(valor)}, 0, ${num(valor)}, ${num(valor)}, @AGORA, ${[...v.grade.values()].join(", ")});`);
  }
  const fatProd: string[] = [];
  let seqItem = 0;
  for (const g of prods.values()) {
    seqItem += 1;
    const fCols = [...g.grade.keys()].map((n) => `F${n}`);
    const valor = round2(g.preco * g.qtde);
    fatProd.push(`
  INSERT INTO FATURAMENTO_PROD (FILIAL, NF_SAIDA, SERIE_NF, PRODUTO, COR_PRODUTO, ITEM, PEDIDO, PEDIDO_PRODUTO, PEDIDO_COR, ENTREGA,
    IPI, ICMS, DESCONTO_ITEM, QTDE, PRECO, VALOR, MATA_SALDO, ${fCols.join(", ")}, FAIXA, ORIGEM, CUSTO_NA_DATA, TIMESTAMP,
    MOEDA, CAMBIO_NA_DATA, DATA_PARA_TRANSFERENCIA, CODIGO_FISCAL_OPERACAO, COD_FILIAL_ESTOQUE,
    CUSTO_NA_DATA_2, CUSTO_NA_DATA_3, CUSTO_NA_DATA_4, ITEM_IMPRESSAO, ITEM_IMPRESSAO_FATURA, ITEM_PEDIDO,
    PRECO_2, PRECO_3, PRECO_4, VALOR_DIFERENCA_GUIA_FATURA_ITEM, LICENCIADO_ROYALTIES, DESC_VENDA_CLIENTE)
  VALUES (@FILIAL, @NF, @SERIE, ${lit(g.produto)}, ${lit(g.cor)}, ${lit(String(seqItem).padStart(6, "0"))}, @PEDIDO, ${lit(g.produto)}, ${lit(g.cor)}, @HOJE,
    0, 0, 0, ${g.qtde}, ${num(g.preco)}, ${num(valor)}, 0, ${[...g.grade.values()].join(", ")}, '1', 'S', ${num(g.custo)}, ${tsExpr(g.preco)},
    'R$', 1, @AGORA, ${lit(g.cfop)}, @COD_FILIAL,
    0, 0, 0, ${lit(g.item)}, ${lit(g.item)}, '0000',
    0, 0, 0, 0, 0, ${g.obs ? `LEFT(${lit(g.obs)} + SPACE(80), 80)` : "NULL"});`);
  }
  // Devolução não tem pedido nem FATURAMENTO_PROD: o estoque sai pelo romaneio (sqlDevolucao).
  if (semPedido) {
    vendasProd.length = 0;
    fatProd.length = 0;
  }
  // Preço unitário: devolução leva o da NF de entrada com até 5 casas; as demais, 2.
  const casasPreco = dev || p.material ? 5 : 2;

  // Remessa (tipo R: demonstração, consignação, conserto, simples remessa, troca) grava a quantidade
  // a retornar = a do item (QTDE_RETORNAR_BENEFICIAMENTO; todas as NFs desde 2025, menos 4 editadas).
  const qtdeRetornar = (l: LinhaFiscal) => (p.tipoNatureza === "R" ? l.qtde : 0);
  // Agrupamentos 3–5 ("por pedido"): nº do pedido (gerado aqui no batch) na frente do código e da descrição.
  const porPedido = p.agrupamento >= 3;
  const codigoItemSql = (l: LinhaFiscal) => (porPedido ? `RTRIM(@PEDIDO) + ${lit(l.codigoItem)}` : lit(l.codigoItem));
  const descricaoItemSql = (l: LinhaFiscal) =>
    porPedido ? `LEFT(RTRIM(@PEDIDO) + ' ' + ${lit(l.descricao)}, 80)` : lit(l.descricao);
  const fatItem: string[] = [];
  const fatImp: string[] = [];
  p.fiscais.forEach((l, i) => {
    // Tributos aproximados (IBPT) só vão para consumidor final — a Matriz grava 0 para empresa.
    const fatorIbpt = p.consumidorFinal ? 1 : 0;
    const ibptFed = round2((l.valor * l.ibptFederal * fatorIbpt) / 100);
    const ibptEst = round2((l.valor * l.ibptEstadual * fatorIbpt) / 100);
    const ibptMun = round2((l.valor * l.ibptMunicipal * fatorIbpt) / 100);
    fatItem.push(`
  INSERT INTO FATURAMENTO_ITEM (FILIAL, NF_SAIDA, SERIE_NF, ITEM_IMPRESSAO, SUB_ITEM_TAMANHO, CLASSIF_FISCAL, CODIGO_FISCAL_OPERACAO,
    CODIGO_ITEM, COD_TABELA_FILHA, COMISSAO_ITEM, COMISSAO_ITEM_GERENTE, CONTA_CONTABIL, DESCONTO_ITEM, DESCRICAO_ITEM, FAIXA,
    ID_EXCECAO_IMPOSTO, INDICADOR_CFOP, MPADRAO_DESCONTO_ITEM, MPADRAO_PRECO_UNITARIO, MPADRAO_VALOR_ITEM, PESO,
    PORCENTAGEM_ITEM_RATEIO, PRECO_UNITARIO, QTDE_DEVOLVIDA, QTDE_ITEM, QTDE_RETORNAR_BENEFICIAMENTO, TRIBUT_ICMS, TRIBUT_ORIGEM,
    UNIDADE, VALOR_ITEM, REFERENCIA, REFERENCIA_ITEM, TIMESTAMP, MPADRAO_VALOR_DESCONTOS, MPADRAO_VALOR_ENCARGOS, NAO_SOMA_VALOR,
    ITEM_NFE, MPADRAO_SEGURO_ITEM, MPADRAO_FRETE_ITEM, MPADRAO_ENCARGO_ITEM, VALOR_IMPOSTO_ITEM, ORIGEM_ITEM, RATEIO_FILIAL,
    RATEIO_CENTRO_CUSTO, INDICA_PRODUTO_PROCESSO, PRECO_UNITARIO_ORIGINAL, VALOR_IMPOSTO_ITEM_MUNICIPAL, VALOR_IMPOSTO_ITEM_ESTADUAL, ID_CEST_NCM,
    CST_IBS_CBS, CCLASSTRIB, OBS_ITEM, REFERENCIA_PEDIDO)
  VALUES (@FILIAL, @NF, @SERIE, ${lit(l.itemImpressao)}, ${l.subItem}, ${lit(l.ncm)}, ${lit(l.cfop)},
    ${codigoItemSql(l)}, ${p.material ? "'T'" : "'P'"}, 0, 0, ${lit(l.contaContabil || null)}, 0, ${descricaoItemSql(l)}, '1',
    ${l.excecao ?? "NULL"}, ${l.indicadorCfop}, 0, ${num(l.preco, casasPreco)}, ${num(l.valor)}, 0,
    ${num(l.pct, 10)}, ${num(l.preco, casasPreco)}, 0, ${l.qtde}, ${qtdeRetornar(l)}, ${lit(l.csosn)}, ${lit(l.origem)},
    ${lit(l.unidade)}, ${num(l.valor)}, ${p.material ? "NULL" : lit(l.produto)}, ${lit(l.referenciaItem)}, ${tsExpr(l.preco)}, ${num(l.desconto)}, 0, 0,
    ${i + 1}, ${num(l.seguro)}, ${num(l.frete)}, 0, ${num(ibptFed)}, ${p.material ? "'M'" : "'P'"}, @COD_FILIAL,
    ${p.material ? "NULL" : "@CENTRO_CUSTO"}, 0, ${num(l.preco, casasPreco)}, ${num(ibptMun)}, ${num(ibptEst)}, ${l.idCest ?? "NULL"},
    ${lit(l.cstIbsCbs || null)}, ${lit(l.cClassTrib || null)},
    ${l.obsItem ? `LEFT(${lit(l.obsItem)} + SPACE(254), 254)` : "NULL"}, ${dev ? "@DEV_NF_ENTRADA" : porPedido ? "@PEDIDO" : "NULL"});`);
    if (l.informados) {
      // Devolução: os impostos da NF do fornecedor, como informados; incidência/agrega da exceção
      // (ou do tipo do imposto). BASE_IMPOSTO_CALC: 0 no Simples (NERD), a base no regime normal.
      for (const t of l.informados) {
        const ex = l.impostos.find((x) => x.id === t.id);
        const inc = ex?.incidencia ?? (t.id === 2 ? 1 : 3);
        const agDesc = ex ? ex.agregaDesconto : t.id !== 2;
        const agEnc = ex ? ex.agregaEncargo : t.id !== 2;
        fatImp.push(`
  INSERT INTO FATURAMENTO_IMPOSTO (FILIAL, NF_SAIDA, SERIE_NF, ITEM_IMPRESSAO, SUB_ITEM_TAMANHO, ID_IMPOSTO, TAXA_IMPOSTO,
    BASE_IMPOSTO, VALOR_IMPOSTO, VALOR_IMPOSTO_CALCULADO, BASE_IMPOSTO_CALC, INCIDENCIA, AGREGA_APOS_ENCARGO, AGREGA_APOS_DESCONTO)
  VALUES (@FILIAL, @NF, @SERIE, ${lit(l.itemImpressao)}, ${l.subItem}, ${t.id}, ${num(t.taxa)}, ${num(t.base)}, ${num(t.valor)}, ${num(t.valor)},
    ${num(p.simples ? 0 : t.base)}, ${inc}, ${agEnc ? 1 : 0}, ${agDesc ? 1 : 0});`);
      }
    } else if (p.simples) {
      for (const t of l.impostos) {
        // DICMS (11) o Linx só grava em operação interestadual.
        if (t.id === 11 && p.cliente.uf === p.ufFilial) continue;
        // Partilha do DIFAL (71/72) e ICMS-DESTINO (73) só existem para consumidor final: na
        // 100.01 a contribuinte o Linx não grava essas linhas (NFs desde 24/10/2026).
        if ((t.id === 71 || t.id === 72 || t.id === 73) && !p.consumidorFinal) continue;
        // FECP-destino (70): desde a atualização de 24/10/2026 o Linx não grava a linha no Simples,
        // mesmo com a exceção trazendo o imposto (NERD 1542, 06/11; antes de 24/10 gravava).
        if (t.id === 70) continue;
        const v = valorImposto(l, t, p.icmsDestinoAliq);
        fatImp.push(`
  INSERT INTO FATURAMENTO_IMPOSTO (FILIAL, NF_SAIDA, SERIE_NF, ITEM_IMPRESSAO, SUB_ITEM_TAMANHO, ID_IMPOSTO, TAXA_IMPOSTO,
    BASE_IMPOSTO, VALOR_IMPOSTO, VALOR_IMPOSTO_CALCULADO, BASE_IMPOSTO_CALC, INCIDENCIA, AGREGA_APOS_ENCARGO, AGREGA_APOS_DESCONTO)
  VALUES (@FILIAL, @NF, @SERIE, ${lit(l.itemImpressao)}, ${l.subItem}, ${t.id}, ${num(v.taxa)}, ${num(v.base)}, ${num(v.valor)}, ${num(v.valor)},
    ${num(v.base)}, ${t.incidencia}, ${t.agregaEncargo ? 1 : 0}, ${t.agregaDesconto ? 1 : 0});`);
      }
    } else {
      // Regime normal (Matriz): impostos calculados; BASE_IMPOSTO_CALC = base, como o Linx grava.
      const calculados = impostosRegimeNormal(l, p.aliqIcmsOperacao);
      l.impostos.forEach((t, k) => {
        const v = calculados[k];
        if (!v) return; // DIFAL: o Linx não grava a linha para contribuinte
        fatImp.push(`
  INSERT INTO FATURAMENTO_IMPOSTO (FILIAL, NF_SAIDA, SERIE_NF, ITEM_IMPRESSAO, SUB_ITEM_TAMANHO, ID_IMPOSTO, TAXA_IMPOSTO,
    BASE_IMPOSTO, VALOR_IMPOSTO, VALOR_IMPOSTO_CALCULADO, BASE_IMPOSTO_CALC, INCIDENCIA, AGREGA_APOS_ENCARGO, AGREGA_APOS_DESCONTO)
  VALUES (@FILIAL, @NF, @SERIE, ${lit(l.itemImpressao)}, ${l.subItem}, ${t.id}, ${num(v.taxa)}, ${num(v.base)}, ${num(v.valor)}, ${num(v.valor)},
    ${num(v.base)}, ${t.incidencia}, ${t.agregaEncargo ? 1 : 0}, ${t.agregaDesconto ? 1 : 0});`);
      });
    }
  });

  // OBS tipo 7 (DIFAL zerado): só em operação interestadual COM consumidor final (Simples 100.022:
  // 2.557 de 2.561; Matriz 128.01 → RJ também grava). Venda a contribuinte de outra UF não tem.
  const interestadual = p.cliente.uf !== p.ufFilial && p.consumidorFinal;
  // VENDAS: valor entregue = Σ por linha de valor × (1 − desconto total ÷ subtotal), arredondado
  // (1.112 de 1.112 NFs "sem pedido" desde 24/10/2026 — com e sem desconto na condição).
  const fatorLiquido = p.subtotal > 0 ? 1 - (p.desconto + p.descontoCond) / p.subtotal : 1;
  const valorEntregue = round2([...pedidoProds.values()].reduce((s, g) => s + round2(round2(g.preco * g.qtde) * fatorLiquido), 0));

  const fim =
    final === "commit"
      ? "COMMIT;\n  SELECT LTRIM(RTRIM(@NF)) AS nf, @CHAVE AS chave, LTRIM(RTRIM(@PEDIDO)) AS pedido;"
      : final === "xml"
        ? // Gera o XML da NF-e com a MESMA procedure que o Linx usa no envio e desfaz tudo.
          // Testado: LX_GERA_NFE_SEFAZ_4_00 não faz COMMIT nem altera a NF. (Nunca usar
          // LX_EXECUTE_PROCESS aqui: ele faz COMMIT de qualquer transação aberta.)
          `EXEC LX_GERA_NFE_SEFAZ_4_00 @NFLX, @SERIE, @FILIAL;
  SELECT LTRIM(RTRIM(@NF)) AS nf, @CHAVE AS chave, LTRIM(RTRIM(@PEDIDO)) AS pedido;
  ROLLBACK;`
      : final === "rollback"
        ? "SELECT LTRIM(RTRIM(@NF)) AS nf, @CHAVE AS chave, LTRIM(RTRIM(@PEDIDO)) AS pedido;\n  ROLLBACK;"
        : `SELECT 'FATURAMENTO' AS t, * FROM FATURAMENTO WHERE FILIAL=@FILIAL AND NF_SAIDA=@NF AND SERIE_NF=@SERIE;
  SELECT 'FATURAMENTO_PROD' AS t, * FROM FATURAMENTO_PROD WHERE FILIAL=@FILIAL AND NF_SAIDA=@NF AND SERIE_NF=@SERIE;
  SELECT 'FATURAMENTO_ITEM' AS t, * FROM FATURAMENTO_ITEM WHERE FILIAL=@FILIAL AND NF_SAIDA=@NF AND SERIE_NF=@SERIE;
  SELECT 'FATURAMENTO_IMPOSTO' AS t, * FROM FATURAMENTO_IMPOSTO WHERE FILIAL=@FILIAL AND NF_SAIDA=@NF AND SERIE_NF=@SERIE ORDER BY ITEM_IMPRESSAO, ID_IMPOSTO;
  SELECT 'FATURAMENTO_OBSERVACAO' AS t, * FROM FATURAMENTO_OBSERVACAO WHERE FILIAL=@FILIAL AND NF_SAIDA=@NF AND SERIE_NF=@SERIE ORDER BY TIPO_OBS;
  SELECT 'VENDAS' AS t, * FROM VENDAS WHERE PEDIDO=@PEDIDO;
  SELECT 'VENDAS_PRODUTO' AS t, * FROM VENDAS_PRODUTO WHERE PEDIDO=@PEDIDO;
  SELECT 'ESTOQUE_PROD_SAI' AS t, * FROM ESTOQUE_PROD_SAI WHERE NF_FILIAL=@FILIAL AND NF_SAIDA=@NF AND SERIE_NF=@SERIE;
  SELECT 'ESTOQUE_PROD1_SAI' AS t, R1.* FROM ESTOQUE_PROD1_SAI R1 JOIN ESTOQUE_PROD_SAI R ON R.ROMANEIO_PRODUTO = R1.ROMANEIO_PRODUTO AND R.FILIAL = R1.FILIAL
    WHERE R.NF_FILIAL=@FILIAL AND R.NF_SAIDA=@NF AND R.SERIE_NF=@SERIE;
  SELECT 'FATURAMENTO_ENTRADA_DEVOLUCAO' AS t, * FROM FATURAMENTO_ENTRADA_DEVOLUCAO WHERE FILIAL=@FILIAL AND NF_SAIDA=@NF AND SERIE_NF=@SERIE;
  SELECT 'ESTOQUE' AS t, E.* FROM ESTOQUE_PRODUTOS E JOIN FATURAMENTO_PROD P ON P.PRODUTO=E.PRODUTO AND P.COR_PRODUTO=E.COR_PRODUTO
    WHERE E.FILIAL=@FILIAL AND P.FILIAL=@FILIAL AND P.NF_SAIDA=@NF AND P.SERIE_NF=@SERIE;
  ROLLBACK;`;

  return `
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
BEGIN TRY
  DECLARE @AGORA DATETIME = GETDATE();
  DECLARE @HOJE DATETIME = CAST(CAST(@AGORA AS DATE) AS DATETIME);

  -- Nº do pedido "NF SEM PEDIDO" (devolução não tem pedido)
  DECLARE @novoPed INT;
  ${semPedido ? "DECLARE @PEDIDO CHAR(12) = NULL;" : `
  UPDATE SEQUENCIAIS WITH (UPDLOCK, HOLDLOCK)
     SET @novoPed = CAST(SEQUENCIA AS INT) + 1, SEQUENCIA = CAST(CAST(SEQUENCIA AS INT) + 1 AS VARCHAR(12))
   WHERE TABELA_COLUNA = 'VENDAS.PEDIDO';
  IF @novoPed IS NULL BEGIN ;THROW 51100, 'Sequencial VENDAS.PEDIDO não encontrado.', 1; END
  DECLARE @PEDIDO CHAR(12) = CAST(@novoPed AS VARCHAR(12));`}

  -- Nº da NF (último usado + 1) na série da filial, com a largura do sequencial dela
  -- (pernas do e-commerce 9 dígitos, Matriz 7). A chave da NF-e usa sempre 9 (@NFNUM).
  DECLARE @novoNf INT;
  UPDATE FATURAMENTO_SEQUENCIAIS WITH (UPDLOCK, HOLDLOCK)
     SET @novoNf = CAST(SEQUENCIAL AS INT) + 1,
         SEQUENCIAL = RIGHT(REPLICATE('0', ${p.larguraNf}) + CAST(CAST(SEQUENCIAL AS INT) + 1 AS VARCHAR(9)), ${p.larguraNf})
   WHERE FILIAL = @FILIAL AND SERIE_NF = @SERIE;
  IF @novoNf IS NULL BEGIN ;THROW 51101, 'Série da NF não encontrada para a filial.', 1; END
  DECLARE @NFNUM VARCHAR(9) = RIGHT('000000000' + CAST(@novoNf AS VARCHAR(9)), 9);
  DECLARE @NFLX VARCHAR(9) = RIGHT(REPLICATE('0', ${p.larguraNf}) + CAST(@novoNf AS VARCHAR(9)), ${p.larguraNf});
  DECLARE @NF CHAR(15) = @NFLX;
  IF EXISTS (SELECT 1 FROM FATURAMENTO WITH (UPDLOCK, HOLDLOCK) WHERE FILIAL = @FILIAL AND NF_SAIDA = @NF AND SERIE_NF = @SERIE)
  BEGIN ;THROW 51102, 'O próximo número de NF já existe no Linx. Confira a numeração da série antes de continuar.', 1; END

  -- Chave da NF-e: cUF + AAMM + CNPJ + modelo 55 + série + nNF + tpEmis 1 + cNF + DV (módulo 11)
  DECLARE @cNF CHAR(8) = @CNF_SUGERIDO;
  IF @cNF = RIGHT(@NFNUM, 8) SET @cNF = RIGHT('00000000' + CAST((CAST(@cNF AS INT) + 1) % 100000000 AS VARCHAR(8)), 8);
  DECLARE @BASE VARCHAR(43) = @CUF + SUBSTRING(CONVERT(CHAR(8), @AGORA, 112), 3, 4) + @CNPJ + '55'
        + RIGHT('000' + @SERIE_SINTEGRA, 3) + @NFNUM + '1' + @cNF;
  DECLARE @soma INT = 0, @peso INT = 2, @k INT = 43;
  WHILE @k >= 1
  BEGIN
    SET @soma = @soma + CAST(SUBSTRING(@BASE, @k, 1) AS INT) * @peso;
    SET @peso = CASE WHEN @peso = 9 THEN 2 ELSE @peso + 1 END;
    SET @k = @k - 1;
  END
  DECLARE @CHAVE VARCHAR(44) = @BASE + CAST(CASE WHEN @soma % 11 < 2 THEN 0 ELSE 11 - @soma % 11 END AS VARCHAR(1));

  -- ENTREGA_CIF = TIPO_FRETE.FRETE_PAGO (conferido em todas as NFs desde 2025: '2'→0, '01'→1, '04'→9, '05'→3).
  DECLARE @ENTREGA_CIF INT = ISNULL((SELECT TOP 1 FRETE_PAGO FROM TIPO_FRETE WITH (NOLOCK) WHERE TIPO_FRETE = @TIPO_FRETE), 0);

${semPedido ? "" : `
  INSERT INTO VENDAS (PEDIDO, COLECAO, CODIGO_TAB_PRECO, TIPO, CONDICAO_PGTO, FILIAL, CLIENTE_ATACADO, TRANSPORTADORA, MOEDA,
    REPRESENTANTE, GERENTE, EMISSAO, CADASTRAMENTO, TOT_QTDE_ORIGINAL, TOT_QTDE_ENTREGUE, TOT_QTDE_ENTREGAR,
    TOT_VALOR_ORIGINAL, TOT_VALOR_ENTREGUE, TOT_VALOR_ENTREGAR, APROVADO_POR, TABELA_FILHA, TOT_BRUTO_ENTREGUE,
    ACEITA_PECAS_PEQUENAS, ACEITA_PECAS_COM_CORTE, DATA_PARA_TRANSFERENCIA, TOT_ENTREGUE_MOEDA_PADRAO,
    NOME_CLIFOR_ENTREGA, TIPO_RATEIO, TRANSP_REDESPACHO, VALOR_SUB_ITENS, INDICADOR_VENDA)
  VALUES (@PEDIDO, '${COLECAO_PEDIDO}', @TAB_PRECO, 'VENDA ATACADO', @COND_PGTO_PEDIDO, @FILIAL, @CLIENTE, @TRANSP, 'R$',
    @REPRESENTANTE, @REPRESENTANTE, @HOJE, @HOJE, ${p.qtdeTotal}, ${p.qtdeTotal}, 0,
    ${num(p.subtotal)}, ${num(valorEntregue)}, 0, 'NF SEM PEDIDO', 'VENDAS_PRODUTO', ${num(p.subtotal)},
    100, 100, @AGORA, ${num(valorEntregue)},
    @CLIENTE, 0, @TRANSP_REDESP, ${num(p.subtotal)}, @INDICADOR_VENDA);`}
${vendasProd.join("\n")}

  INSERT INTO FATURAMENTO (FILIAL, NF_SAIDA, SERIE_NF, TIPO_FATURAMENTO, NOME_CLIFOR, CONDICAO_PGTO, NATUREZA_SAIDA,
    TRANSPORTADORA, TRANSP_REDESPACHO, TIPO_FRETE, COD_TRANSACAO, EMISSAO, DATA_SAIDA, FRETE, SEGURO, DESCONTO,
    DESCONTO_COND_PGTO, ENCARGO, ICMS, IPI_VALOR, VALOR_TOTAL, QTDE_TOTAL, NF_FATURA, NOTA_IMPRESSA, ACERTO_CONTAS_P_R,
    TABELA_FILHA, OBS, PESO_LIQUIDO, PESO_BRUTO, VOLUMES, TIPO_VOLUME, CONFERIDO, ENTREGA_CIF, IRRF, IRRF_RET_FONTE,
    NOTA_CANCELADA, DEVOLUCAO, REPRESENTANTE, COMISSAO, PORCENTAGEM_ACERTO, GERENTE, COMISSAO_GERENTE, DESCONTO_BRUTO,
    ICMS_BASE, VALOR_CANCELADO, QTDE_CANCELADA, MOEDA, CAMBIO_NA_DATA, COBRAR_MOEDA_PADRAO, RECARGO,
    DATA_PARA_TRANSFERENCIA, NOME_CLIFOR_ENTREGA, VALOR_FRETE, AGRUPAMENTO_ITENS, COMISSAO_VALOR, COMISSAO_VALOR_GERENTE,
    DESCONTO_BRUTO_1, DESCONTO_BRUTO_2, DESCONTO_BRUTO_3, DESCONTO_BRUTO_4,
    DESCONTO_SOBRE_1, DESCONTO_SOBRE_2, DESCONTO_SOBRE_3, DESCONTO_SOBRE_4, EMPRESA, ICMS_ISENTO, ICMS_OUTROS,
    MPADRAO_DESCONTO, MPADRAO_DESCONTO_COND_PGTO, MPADRAO_ENCARGO, MPADRAO_FRETE, MPADRAO_IMPOSTO_AGREGAR, MPADRAO_SEGURO,
    MPADRAO_VALOR_SUB_ITENS, MPADRAO_VALOR_TOTAL, MULTI_DESCONTO_ACUMULAR, PORC_DESCONTO, PORC_DESCONTO_BRUTO,
    PORC_DESCONTO_COND_PGTO, PORC_DESCONTO_DIGITADO, PORC_ENCARGO, RATEIO_CENTRO_CUSTO, RATEIO_FILIAL,
    VALOR_DIFERENCA_GUIA_FATURA, VALOR_IMPOSTO_AGREGAR, VALOR_SUB_ITENS, IMPRIMIR_ENDERECO_COBRANCA,
    INDICA_CONSUMIDOR_FINAL, NOTA_COMPLEMENTAR, PORC_DESCONTO_SEFAZ, DESCONTO_SEFAZ, MPADRAO_DESCONTO_SEFAZ,
    CHAVE_NFE, GERAR_AUTOMATICO, STATUS_NFE, LOG_STATUS_NFE, ITEM_NFE, PRIORIZACAO, REGISTRO_DPEC, DATA_REGISTRO_DPEC,
    TIPO_EMISSAO_NFE, FIN_EMISSAO_NFE, VALOR_DESPACHO, VALOR_IMPOSTO_INCIDENCIA, MPADRAO_VALOR_IMPOSTO_INCIDENCIA,
    DATA_HORA_EMISSAO, INDICA_PRESENCA_COMPRADOR, UTC_DATA_SAIDA, UTC_EMISSAO, INDICA_ENDERECO_ENTREGA, INFO_PGTO,
    USA_VALOR_MEDIO, TP_NF_CREDITO, TP_NF_DEBITO, TP_ENTE_GOVERNO, REDUTOR_COMPRA_GOVERNO, TP_OPER_GOVERNO, PREVISAO_ENTREGA,
    UF_EMBARQUE_EXPORTACAO, LOCAL_EMBARQUE_EXPORTACAO)
  VALUES (@FILIAL, @NF, @SERIE, 'PADRAO', @CLIENTE, @COND_PGTO, @NATUREZA,
    @TRANSP, @TRANSP_REDESP, @TIPO_FRETE, @COD_TRANSACAO, @HOJE, @HOJE, ${num(p.frete)}, ${num(p.seguro)}, ${num(p.desconto)},
    ${num(p.descontoCond)}, 0, 0, 0, ${num(p.total)}, ${p.qtdeTotal}, ${p.nfFatura ? 1 : 0}, 0, 0,
    ${dev ? "'ESTOQUE_PROD_SAI'" : p.material ? "'ESTOQUE_SAI1_MAT'" : "'FATURAMENTO_PROD'"}, NULLIF(@OBS, ''), @PESO_LIQ, @PESO_BRUTO, @VOLUMES, @TIPO_VOLUME, 0, @ENTREGA_CIF, 0, 0,
    0, 0, ${dev ? "NULL" : "@REPRESENTANTE"}, 0, 0, ${dev ? "NULL" : "@REPRESENTANTE"}, 0, 0,
    0, 0, 0, 'R$', 1, ${dev ? 0 : 1}, 0,
    @AGORA, ${dev ? "NULL" : "@CLIENTE"}, 0, ${p.agrupamento}, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, ${num(p.descontoSobre4, 10)}, @EMPRESA, 0, 0,
    ${num(p.desconto)}, ${num(p.descontoCond)}, 0, ${num(p.frete)}, ${num(p.impostoAgregar)}, ${num(p.seguro)},
    ${num(p.subtotal)}, ${num(p.total)}, 0, ${num(p.porcDesconto, 10)}, 0,
    ${num(p.porcDescontoCond, 10)}, ${p.porcDigitado ? 1 : 0}, 0, @CENTRO_CUSTO, @COD_FILIAL,
    0, ${num(p.impostoAgregar)}, ${num(p.subtotal)}, 0,
    @CONS_FINAL, 0, 0, 0, 0,
    @CHAVE, 0, 1, 0, 0, 0, 0, '19000101',
    1, ${dev ? 4 : 1}, 0, 0, 0,
    CAST(@AGORA AS SMALLDATETIME), 0, 3, 3, 0, @INFO_PGTO,
    0, 0, 0, 0, 0, 0, ${dev ? "NULL" : "@HOJE"},
    NULLIF(@UF_EMBARQUE, ''), NULLIF(@LOCAL_EMBARQUE, ''));
${fatProd.join("\n")}
${fatItem.join("\n")}
${fatImp.join("\n")}
${dev ? sqlDevolucao(p) : ""}
${interestadual ? `
  INSERT INTO FATURAMENTO_OBSERVACAO (TIPO_OBS, NF_SAIDA, SERIE_NF, FILIAL, SEQUENCIA_OBS, OBS)
  VALUES (7, @NF, @SERIE, @FILIAL, 6, LEFT(${lit(OBS_DIFAL)} + SPACE(254), 254));` : ""}

  -- Tipos 4 (Simples Nacional) e 6 (tributos aproximados / IBPT): proc oficial do Linx.
  EXEC LX_INFORMACAO_COMPLEMENTAR_NOTA_FISCAL @CLIENTE, @NF, @SERIE, @FILIAL, 'FATURAMENTO';

  ${fim}
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  ;THROW;
END CATCH`;
}

function bindCabecalho(req: Req, p: Plano, cNF: string) {
  const i = p.input;
  const padrao = PADROES[p.empresa].nota;
  req.input("FILIAL", sql.VarChar(25), p.filial);
  req.input("SERIE", sql.VarChar(6), p.serie);
  req.input("COD_FILIAL", sql.Char(6), p.codFilial);
  req.input("EMPRESA", sql.Int, p.empresaCodigo);
  req.input("CUF", sql.Char(2), p.cUf);
  req.input("CNPJ", sql.Char(14), p.cnpjFilial);
  req.input("SERIE_SINTEGRA", sql.VarChar(3), p.serieSintegra);
  req.input("CNF_SUGERIDO", sql.Char(8), cNF);
  req.input("CLIENTE", sql.VarChar(25), p.cliente.nome);
  req.input("TAB_PRECO", sql.Char(2), p.cliente.tabPreco.slice(0, 2));
  req.input("INDICADOR_VENDA", sql.Char(1), p.cliente.indicadorVenda);
  req.input("COND_PGTO", sql.Char(3), trim(i.condicaoPgto) || padrao.condicaoPgto);
  req.input("COND_PGTO_PEDIDO", sql.Char(3), trim(i.condicaoPgto) || padrao.condicaoPgto);
  req.input("NATUREZA", sql.Char(7), p.natureza);
  req.input("TRANSP", sql.VarChar(25), trim(i.transportadora) || padrao.transportadora);
  req.input("TRANSP_REDESP", sql.VarChar(25), trim(i.transpRedespacho) || trim(i.transportadora) || padrao.transpRedespacho);
  req.input("TIPO_FRETE", sql.Char(2), trim(i.tipoFrete) || padrao.tipoFrete);
  req.input("REPRESENTANTE", sql.VarChar(25), p.cliente.representante ?? padrao.representante);
  req.input("CENTRO_CUSTO", sql.VarChar(6), padrao.centroCusto);
  // Devolução: o form do Linx escreve a NF de entrada na OBS (4/4 devoluções da NERD); o texto livre vem depois.
  const obsDevolucao = p.devolucao
    ? `Notas de devolução relacionada a(s) nota(s) de entrada:\r\rNF: ${p.devolucao.nfEntrada} Serie:${p.devolucao.serieEntrada}`
    : "";
  req.input("OBS", sql.VarChar(sql.MAX), [obsDevolucao, trim(i.obs)].filter(Boolean).join("\r\r"));
  req.input("DEV_NF_ENTRADA", sql.Char(15), p.devolucao?.nfEntrada ?? null);
  req.input("DEV_SERIE_ENTRADA", sql.Char(6), p.devolucao?.serieEntrada ?? null);
  req.input("RESPONSAVEL", sql.VarChar(25), p.responsavel.slice(0, 25));
  req.input("PESO_LIQ", sql.Numeric(9, 3), Number(i.pesoLiquido) || 0);
  req.input("PESO_BRUTO", sql.Numeric(9, 3), Number(i.pesoBruto) || 0);
  req.input("VOLUMES", sql.Int, Math.max(0, Math.round(Number(i.volumes) || 0)));
  req.input("TIPO_VOLUME", sql.VarChar(25), trim(i.tipoVolume).toUpperCase() || padrao.tipoVolume);
  req.input("INFO_PGTO", sql.Char(2), trim(i.infoPgto) || padrao.infoPgto);
  req.input("CONS_FINAL", sql.Bit, p.consumidorFinal ? 1 : 0);
  req.input("COD_TRANSACAO", sql.VarChar(20), p.codTransacao);
  req.input("UF_EMBARQUE", sql.Char(2), p.ufEmbarque);
  req.input("LOCAL_EMBARQUE", sql.VarChar(60), p.localEmbarque);
}


/**
 * Grava a NF (ou só simula, desfazendo tudo no fim). Recalcula o plano no servidor —
 * nunca confia nos valores que vieram da tela.
 */
export async function gravarNota(input: NotaInput, opts: { simular: boolean }): Promise<NotaCriada> {
  return withRequest(async (request) => {
    const plano = await montarPlano(request, input);
    if (plano.bloqueios.length > 0) {
      throw new Error(`Não é possível gravar: ${plano.bloqueios.join(" | ")}`);
    }
    const req = request as Req;
    const cNF = String(randomInt(10_000_000, 99_999_999));
    bindCabecalho(req, plano, cNF);
    let result;
    try {
      result = await req.query(montarBatch(plano, cNF, opts.simular ? "rollback" : "commit"));
    } catch (err) {
      throw new Error(`O Linx recusou a NF: ${err instanceof Error ? err.message : String(err)}`);
    }
    const row = (result.recordset as { nf: string; chave: string; pedido: string }[])[0];
    if (!row?.nf) throw new Error("A gravação não retornou o número da NF.");
    return {
      filial: plano.filial,
      nf: trim(row.nf),
      serie: plano.serie,
      chave: trim(row.chave),
      pedido: trim(row.pedido),
      total: plano.total,
      simulacao: opts.simular,
    };
  });
}

/**
 * Simula a NF inteira e gera o XML da NF-e pela procedure do Linx, na mesma transação,
 * e desfaz tudo. Nada fica no banco. Devolve o XML (sem assinatura) que seria enviado.
 */
export async function simularXmlNota(input: NotaInput): Promise<{ nf: string; chave: string; xml: string }> {
  return withRequest(async (request) => {
    const plano = await montarPlano(request, input);
    if (plano.bloqueios.length > 0) throw new Error(`Não é possível gravar: ${plano.bloqueios.join(" | ")}`);
    const req = request as Req;
    const cNF = String(randomInt(10_000_000, 99_999_999));
    bindCabecalho(req, plano, cNF);
    let r;
    try {
      r = await req.query(montarBatch(plano, cNF, "xml"));
    } catch (err) {
      throw new Error(`O Linx recusou a NF ou o XML: ${err instanceof Error ? err.message : String(err)}`);
    }
    const sets = (r as unknown as { recordsets: Record<string, unknown>[][] }).recordsets;
    const xml = sets.flat().map((row) => row.XML_NFE).find((x) => typeof x === "string") as string | undefined;
    const fim = sets.flat().find((row) => "chave" in row) as { nf: string; chave: string } | undefined;
    if (!xml) throw new Error("A procedure do Linx não devolveu o XML.");
    return { nf: trim(fim?.nf), chave: trim(fim?.chave), xml };
  });
}

/**
 * Só para conferência (script de validação): grava, devolve todas as linhas gravadas
 * e desfaz. Nada fica no banco.
 */
export async function depurarNota(input: NotaInput): Promise<Record<string, unknown>[][]> {
  return withRequest(async (request) => {
    const plano = await montarPlano(request, input);
    if (plano.bloqueios.length > 0) throw new Error(plano.bloqueios.join(" | "));
    const req = request as Req;
    bindCabecalho(req, plano, "03060792");
    const r = await req.query(montarBatch(plano, "03060792", "debug"));
    return (r as unknown as { recordsets: Record<string, unknown>[][] }).recordsets;
  });
}

// ── Consulta / monitor ──────────────────────────────────────────────────────

const MAX_LISTA = 300;

function mapNota(x: Record<string, unknown>): NotaListItem {
  const status = Number(x.status ?? 0);
  const log = Number(x.logStatus ?? 0);
  const st = statusNfeLabel(status, log);
  return {
    filial: trim(x.filial),
    nf: trim(x.nf),
    serie: trim(x.serie),
    emissao: iso(x.emissao),
    cliente: trim(x.cliente),
    natureza: trim(x.natureza),
    valor: Number(x.valor) || 0,
    qtde: Number(x.qtde) || 0,
    status,
    logStatus: log,
    statusLabel: st.label,
    tom: st.tom,
    chave: trim(x.chave),
    protocolo: trim(x.protocolo),
    dataAutorizacao: iso(x.dataAutorizacao),
    obs: trim(x.obs).replace(/\s+/g, " "),
    cancelada: Boolean(x.cancelada),
    mensagem: x.mensagem ? trim(x.mensagem) : null,
  };
}

/**
 * NFs das filiais de e-commerce da empresa. Usada pela busca da aba Faturamento e
 * pelo Monitor. Traz o motivo do último erro de envio (log do Fiscal Flow) quando a
 * NF não está autorizada.
 */
export async function listarNotasFat(params: {
  empresa: EmpresaFat;
  filial?: string;
  de?: string;
  ate?: string;
  busca?: string;
  statusGrupo?: string;
}): Promise<NotaListItem[]> {
  const filiaisEmpresa = await filiaisNotaDaEmpresa(params.empresa);
  const filiais = params.filial && filiaisEmpresa.includes(params.filial) ? [params.filial] : filiaisEmpresa;
  const grupo = FILTROS_STATUS.find((f) => f.value === params.statusGrupo);
  const busca = trim(params.busca);

  return withRequest(async (request) => {
    const req = request as Req;
    const fNames = filiais.map((f, i) => {
      req.input(`f${i}`, sql.VarChar(25), f);
      return `@f${i}`;
    });
    const conds: string[] = [`F.FILIAL IN (${fNames.join(",")})`];
    if (params.de) {
      req.input("de", sql.Date, params.de);
      conds.push("F.EMISSAO >= @de");
    }
    if (params.ate) {
      req.input("ate", sql.Date, params.ate);
      conds.push("F.EMISSAO < DATEADD(DAY, 1, @ate)");
    }
    if (grupo && grupo.status.length > 0) conds.push(`F.STATUS_NFE IN (${grupo.status.join(",")})`);
    if (busca) {
      const digits = busca.replace(/\D/g, "");
      req.input("bLike", sql.VarChar(80), `%${busca.toUpperCase()}%`);
      const ors = [
        "F.NOME_CLIFOR COLLATE Latin1_General_CI_AI LIKE @bLike",
        "F.OBS LIKE @bLike",
      ];
      if (digits) {
        req.input("bNf", sql.VarChar(15), digits.padStart(9, "0").slice(-9));
        // Matriz numera com 7 dígitos; pernas do e-commerce com 9.
        req.input("bNf7", sql.VarChar(15), digits.padStart(7, "0").slice(-7));
        req.input("bDig", sql.VarChar(50), `%${digits}%`);
        ors.push("F.NF_SAIDA IN (@bNf, @bNf7)", "F.CHAVE_NFE LIKE @bDig", "C.CGC_CPF = " + (digits.length >= 11 ? "@bDoc" : "'-'"));
        if (digits.length >= 11) req.input("bDoc", sql.VarChar(19), digits);
      }
      conds.push(`(${ors.join(" OR ")})`);
    }

    const r = await req.query(`
      SELECT TOP ${MAX_LISTA}
        F.FILIAL AS filial, F.NF_SAIDA AS nf, F.SERIE_NF AS serie, F.EMISSAO AS emissao, F.NOME_CLIFOR AS cliente,
        F.NATUREZA_SAIDA AS natureza, F.VALOR_TOTAL AS valor, F.QTDE_TOTAL AS qtde, F.STATUS_NFE AS status,
        F.LOG_STATUS_NFE AS logStatus, F.CHAVE_NFE AS chave, F.PROTOCOLO_AUTORIZACAO_NFE AS protocolo,
        F.DATA_AUTORIZACAO_NFE AS dataAutorizacao, CAST(F.OBS AS VARCHAR(200)) AS obs, F.NOTA_CANCELADA AS cancelada,
        CASE WHEN F.STATUS_NFE IN (2,3,4,42,52,70) THEN COALESCE((
          SELECT TOP 1 CAST(L.CONTEUDO AS NVARCHAR(1000)) FROM MIDE_NFE_LOG L WITH (NOLOCK)
           WHERE L.CHAVE_NFE = F.CHAVE_NFE AND L.CODIGO_LOG = 'ERP.015' ORDER BY L.ID DESC),
          (SELECT TOP 1 LEFT(PA.MENSAGEM, 1000) FROM EDI_ARQUIVO E WITH (NOLOCK)
            JOIN EDI_ARQUIVO_LOG EL WITH (NOLOCK) ON EL.ID_EDI_ARQUIVO = E.ID_EDI_ARQUIVO
            JOIN PROCESSOS_SISTEMA_ATIVIDADES PA WITH (NOLOCK) ON PA.ID_PROCESSO = EL.ID_PROCESSO AND PA.ITEM_PROCESSO = EL.ITEM_PROCESSO
           WHERE E.EDI_REFERENCIA_ARQUIVO = F.CHAVE_NFE AND PA.STATUS_PROCESSO = 3 ORDER BY EL.DATA_HORA DESC)) END AS mensagem
      FROM FATURAMENTO F WITH (NOLOCK)
      LEFT JOIN CADASTRO_CLI_FOR C WITH (NOLOCK) ON C.NOME_CLIFOR = F.NOME_CLIFOR
      WHERE ${conds.join(" AND ")}
      ORDER BY F.EMISSAO DESC, F.NF_SAIDA DESC`);
    return (r.recordset as Record<string, unknown>[]).map((x) => {
      const n = mapNota(x);
      n.mensagem = extrairMotivo(n.mensagem);
      return n;
    });
  });
}

/**
 * Motivo do último retorno. Fiscal Flow devolve JSON ({cStat, xMotivo, ...}); o log de
 * processos do Linx traz "STATUS: 696MOTIVO: Rejeição: ... Proc: ...". Fica "cStat - motivo".
 */
function extrairMotivo(conteudo: string | null): string | null {
  if (!conteudo) return null;
  const proc = /STATUS:\s*(\d+)\s*MOTIVO:\s*([\s\S]*?)(?:\s*Proc:|$)/i.exec(conteudo);
  if (proc) return `${proc[1]} - ${proc[2].trim()}`;
  const cStat = /"cStat"\s*:\s*"?([^",}]+)/.exec(conteudo)?.[1];
  const xMotivo = /"xMotivo"\s*:\s*"([^"]*)"/.exec(conteudo)?.[1];
  if (cStat || xMotivo) return [cStat, xMotivo].filter(Boolean).join(" - ");
  return conteudo.slice(0, 300);
}

export async function fetchNotaFat(params: { empresa: EmpresaFat; filial: string; nf: string; serie: string }): Promise<NotaDetalhe | null> {
  if (!(await filiaisNotaDaEmpresa(params.empresa)).includes(params.filial)) return null;
  return withRequest(async (request) => {
    const req = request as Req;
    req.input("filial", sql.VarChar(25), params.filial);
    req.input("nf", sql.VarChar(15), trim(params.nf).replace(/\D/g, "").padStart(9, "0").slice(-9));
    // Matriz numera com 7 dígitos; pernas do e-commerce com 9.
    req.input("nf7", sql.VarChar(15), trim(params.nf).replace(/\D/g, "").padStart(7, "0").slice(-7));
    req.input("serie", sql.VarChar(6), trim(params.serie));
    const cab = await q(req, `
      SELECT F.FILIAL AS filial, F.NF_SAIDA AS nf, F.SERIE_NF AS serie, F.EMISSAO AS emissao, F.NOME_CLIFOR AS cliente,
        F.NATUREZA_SAIDA AS natureza, F.VALOR_TOTAL AS valor, F.QTDE_TOTAL AS qtde, F.STATUS_NFE AS status,
        F.LOG_STATUS_NFE AS logStatus, F.CHAVE_NFE AS chave, F.PROTOCOLO_AUTORIZACAO_NFE AS protocolo,
        F.DATA_AUTORIZACAO_NFE AS dataAutorizacao, CAST(F.OBS AS VARCHAR(500)) AS obs, F.NOTA_CANCELADA AS cancelada,
        COALESCE((SELECT TOP 1 CAST(L.CONTEUDO AS NVARCHAR(1000)) FROM MIDE_NFE_LOG L WITH (NOLOCK)
          WHERE L.CHAVE_NFE = F.CHAVE_NFE AND L.CODIGO_LOG = 'ERP.015' ORDER BY L.ID DESC),
          (SELECT TOP 1 LEFT(PA.MENSAGEM, 1000) FROM EDI_ARQUIVO E WITH (NOLOCK)
            JOIN EDI_ARQUIVO_LOG EL WITH (NOLOCK) ON EL.ID_EDI_ARQUIVO = E.ID_EDI_ARQUIVO
            JOIN PROCESSOS_SISTEMA_ATIVIDADES PA WITH (NOLOCK) ON PA.ID_PROCESSO = EL.ID_PROCESSO AND PA.ITEM_PROCESSO = EL.ITEM_PROCESSO
           WHERE E.EDI_REFERENCIA_ARQUIVO = F.CHAVE_NFE AND PA.STATUS_PROCESSO = 3 ORDER BY EL.DATA_HORA DESC)) AS mensagem,
        LTRIM(RTRIM(C.CGC_CPF)) AS cpf, LTRIM(RTRIM(C.UF)) AS uf, LTRIM(RTRIM(C.CIDADE)) AS cidade,
        F.CONDICAO_PGTO AS cond, F.TRANSPORTADORA AS transp, F.TIPO_FRETE AS tipoFrete,
        F.VALOR_SUB_ITENS AS subtotal, F.DESCONTO AS desconto, F.FRETE AS frete, F.SEGURO AS seguro,
        F.PESO_LIQUIDO AS pesoLiq, F.PESO_BRUTO AS pesoBruto, F.VOLUMES AS volumes, F.TIPO_VOLUME AS tipoVolume,
        F.INFO_PGTO AS infoPgto,
        CASE WHEN EXISTS (SELECT 1 FROM DADOS_CADASTRO_XML_NFE X WITH (NOLOCK) WHERE X.CHAVE_NFE = F.CHAVE_NFE)
               OR EXISTS (SELECT 1 FROM MIDE_NFE_LOG L WITH (NOLOCK) WHERE L.CHAVE_NFE = F.CHAVE_NFE AND L.CODIGO_LOG = 'ERP.002')
             THEN 1 ELSE 0 END AS temXml
      FROM FATURAMENTO F WITH (NOLOCK)
      LEFT JOIN CADASTRO_CLI_FOR C WITH (NOLOCK) ON C.NOME_CLIFOR = F.NOME_CLIFOR
      WHERE F.FILIAL = @filial AND F.NF_SAIDA IN (@nf, @nf7) AND F.SERIE_NF = @serie`);
    const x = cab[0];
    if (!x) return null;
    const itens = await q(req, `
      SELECT LTRIM(RTRIM(I.REFERENCIA)) AS produto, LTRIM(RTRIM(I.REFERENCIA_ITEM)) AS cor, LTRIM(RTRIM(I.DESCRICAO_ITEM)) AS descricao,
             I.QTDE_ITEM AS qtde, I.PRECO_UNITARIO AS preco, I.VALOR_ITEM AS valor, LTRIM(RTRIM(I.CODIGO_FISCAL_OPERACAO)) AS cfop
        FROM FATURAMENTO_ITEM I WITH (NOLOCK)
       WHERE I.FILIAL = @filial AND I.NF_SAIDA IN (@nf, @nf7) AND I.SERIE_NF = @serie
       ORDER BY I.ITEM_NFE, I.ITEM_IMPRESSAO, I.SUB_ITEM_TAMANHO`);
    const base = mapNota(x);
    return {
      ...base,
      mensagem: extrairMotivo(base.mensagem),
      cpfCnpj: trim(x.cpf),
      uf: trim(x.uf),
      cidade: trim(x.cidade),
      condicaoPgto: trim(x.cond),
      transportadora: trim(x.transp),
      tipoFrete: trim(x.tipoFrete),
      subtotal: Number(x.subtotal) || 0,
      desconto: Number(x.desconto) || 0,
      frete: Number(x.frete) || 0,
      seguro: Number(x.seguro) || 0,
      pesoLiquido: Number(x.pesoLiq) || 0,
      pesoBruto: Number(x.pesoBruto) || 0,
      volumes: Number(x.volumes) || 0,
      tipoVolume: trim(x.tipoVolume),
      infoPgto: trim(x.infoPgto),
      temXml: Number(x.temXml) === 1,
      itens: itens.map((it) => ({
        produto: trim(it.produto),
        cor: trim(it.cor),
        descricao: trim(it.descricao),
        qtde: Number(it.qtde) || 0,
        preco: Number(it.preco) || 0,
        valor: Number(it.valor) || 0,
        cfop: trim(it.cfop),
      })),
    };
  });
}

/**
 * XML autorizado (nfeProc). Prefere o texto cru devolvido pelo Fiscal Flow
 * (MIDE_NFE_LOG ERP.002); cai para DADOS_CADASTRO_XML_NFE.
 */
export async function fetchXmlNota(params: { empresa: EmpresaFat; chave: string }): Promise<string | null> {
  const chave = trim(params.chave).replace(/\D/g, "");
  if (chave.length !== 44) return null;
  const filiais = await filiaisNotaDaEmpresa(params.empresa);
  return withRequest(async (request) => {
    const req = request as Req;
    req.input("chave", sql.VarChar(44), chave);
    filiais.forEach((f, i) => req.input(`f${i}`, sql.VarChar(25), f));
    const dono = await q(req, `SELECT TOP 1 1 AS ok FROM FATURAMENTO WITH (NOLOCK)
      WHERE CHAVE_NFE = @chave AND FILIAL IN (${filiais.map((_, i) => `@f${i}`).join(",")})`);
    if (!dono[0]) return null;
    const cru = await q<{ xml: string }>(req, `
      SELECT TOP 1 CAST(CONTEUDO AS NVARCHAR(MAX)) AS xml FROM MIDE_NFE_LOG WITH (NOLOCK)
       WHERE CHAVE_NFE = @chave AND CODIGO_LOG = 'ERP.002' AND CAST(CONTEUDO AS NVARCHAR(MAX)) LIKE '%<nfeProc%'
       ORDER BY ID DESC`);
    if (cru[0]?.xml) return cru[0].xml;
    const salvo = await q<{ xml: string }>(req, `
      SELECT TOP 1 CAST(XML_CONTEUDO AS NVARCHAR(MAX)) AS xml FROM DADOS_CADASTRO_XML_NFE WITH (NOLOCK)
       WHERE CHAVE_NFE = @chave ORDER BY ID DESC`);
    return salvo[0]?.xml ?? null;
  });
}
