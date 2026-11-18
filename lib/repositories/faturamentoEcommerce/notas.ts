import "server-only";

import { randomInt } from "crypto";
import sql from "mssql";
import { withRequest } from "@/lib/db/connection";
import type { RequestLike } from "@/lib/db/proxy";
import { PADROES, statusNfeLabel, FILTROS_STATUS, type EmpresaFat } from "@/lib/faturamento-ecommerce/config";
import { filiaisNotaDaEmpresa, sqlUltimaNfEcommerce } from "./filiais-nota";
import type {
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
  produto: string;
  cor: string;
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
  /** FILIAIS.TIPO_TRIBUTACAO = SIMPLES NACIONAL. Falso = regime normal (Matriz da Scarf Me). */
  simples: boolean;
  /** ICMS da operação UF filial → UF cliente (regime normal, quando a exceção traz 0). */
  aliqIcmsOperacao: number;
  indFiscal: number;
  codFilial: string;
  empresaCodigo: number;
  ufFilial: string;
  cnpjFilial: string;
  cUf: string;
  serieSintegra: string;
  proximoNumero: string;
  natureza: string;
  naturezaDescricao: string;
  cliente: { codigo: string; nome: string; razao: string; uf: string; cidade: string; tabPreco: string };
  linhas: LinhaFiscal[];
  subtotal: number;
  porcDesconto: number;
  porcDigitado: boolean;
  desconto: number;
  frete: number;
  seguro: number;
  total: number;
  qtdeTotal: number;
  icmsDestinoAliq: number;
  input: NotaInput;
  bloqueios: string[];
  avisos: string[];
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
           LTRIM(RTRIM(S.SEQUENCIAL)) AS seq, LTRIM(RTRIM(N.COD_SERIE_SINTEGRA)) AS sintegra,
           ISNULL(LTRIM(RTRIM(FI.TIPO_TRIBUTACAO)), '') AS tributacao
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
  // Regime da filial: o Simples grava os impostos zerados; a Matriz (regime normal) calcula ICMS/PIS/COFINS.
  const simples = /SIMPLES/i.test(trim(fil.tributacao));
  const extra = padrao.nota.filiaisExtras.find((x) => x.codFilial === trim(fil.codFilial)) ?? null;

  // Cliente
  const clifor = trim(input.clienteCodigo).replace(/\D/g, "").padStart(6, "0").slice(-6);
  req.input("pClifor", sql.VarChar(15), clifor);
  const [cli] = await q(req, `
    SELECT LTRIM(RTRIM(cf.CLIFOR)) AS codigo, RTRIM(cf.NOME_CLIFOR) AS nome, LTRIM(RTRIM(cf.RAZAO_SOCIAL)) AS razao,
           LTRIM(RTRIM(cf.UF)) AS uf, LTRIM(RTRIM(cf.CIDADE)) AS cidade, cf.INDICADOR_FISCAL_TERCEIRO AS indFiscal,
           LTRIM(RTRIM(cf.COD_MUNICIPIO_IBGE)) AS ibge, LTRIM(RTRIM(ca.CODIGO_TAB_PRECO)) AS tab,
           CASE WHEN ca.CLIENTE_ATACADO IS NULL THEN 0 ELSE 1 END AS atacado, ISNULL(ca.INATIVO,0) AS inativo
      FROM CADASTRO_CLI_FOR cf WITH (NOLOCK)
      LEFT JOIN CLIENTES_ATACADO ca WITH (NOLOCK) ON ca.CLIENTE_ATACADO = cf.NOME_CLIFOR
     WHERE cf.CLIFOR = @pClifor`);
  if (!cli) throw new Error(`Cliente ${clifor} não encontrado.`);
  if (!Number(cli.atacado)) bloqueios.push("O cliente não tem cadastro de cliente (CLIENTES_ATACADO) — cadastre pela aba Clientes.");
  if (Number(cli.inativo)) bloqueios.push("O cliente está inativo no Linx.");
  if (!trim(cli.ibge)) bloqueios.push("O cliente está sem código IBGE do município — atualize o endereço na aba Clientes.");
  const ufCliente = trim(cli.uf);

  // Natureza
  const natureza = trim(input.natureza);
  req.input("pNat", sql.VarChar(7), natureza);
  const [nat] = await q(req, `
    SELECT LTRIM(RTRIM(DESC_NATUREZA)) AS descr, CTB_TIPO_OPERACAO AS tipoOp, ISNULL(INATIVO,0) AS inativo
      FROM NATUREZAS_SAIDAS WITH (NOLOCK) WHERE NATUREZA_SAIDA = @pNat`);
  if (!nat) throw new Error(`Natureza ${natureza} não existe.`);
  if (Number(nat.inativo)) bloqueios.push(`A natureza ${natureza} está inativa.`);
  const interestadual = ufCliente !== ufFilial;
  const indFiscal = Number(cli.indFiscal) || 8;
  const naturezaEsperada = extra
    ? indFiscal === 16 && extra.naturezaRevenda
      ? extra.naturezaRevenda
      : interestadual
        ? extra.naturezaForaUf
        : extra.naturezaDentroUf
    : interestadual
      ? padrao.nota.naturezaForaUf
      : padrao.nota.naturezaDentroUf;
  const naturezasUsuais = extra
    ? [extra.naturezaDentroUf, extra.naturezaForaUf, extra.naturezaRevenda].filter(Boolean)
    : [naturezaEsperada];
  if (!naturezasUsuais.includes(natureza)) {
    avisos.push(
      `Cliente em ${ufCliente} e filial em ${ufFilial}: a natureza usual é ${naturezaEsperada} (selecionada: ${natureza}).`
    );
  }
  if (!simples) {
    // Regime normal (Matriz): o gravador calcula ICMS/PIS/COFINS/IBS/CBS como o Linx, mas
    // não o DIFAL de venda a não contribuinte de outra UF — essa NF continua no Linx.
    if (interestadual && indFiscal !== 1 && indFiscal !== 16) {
      bloqueios.push(
        `${filial} é regime normal: NF para não contribuinte (indicador ${indFiscal}) em ${ufCliente} tem DIFAL, ` +
          `que esta página não calcula. Fature pelo Linx, ou por uma filial do e-commerce.`
      );
    }
  }

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
  if (!simples && !aliqIcmsOperacao) bloqueios.push(`Alíquota de ICMS ${ufFilial}→${ufCliente} não encontrada no Linx.`);

  // Itens (agrupa linhas repetidas do mesmo produto/cor/tamanho)
  const agrupados = new Map<string, { produto: string; cor: string; tamanho: number; qtde: number; preco: number }>();
  for (const it of input.itens ?? []) {
    const produto = trim(it.produto).toUpperCase();
    const cor = trim(it.cor).toUpperCase();
    const tamanho = Math.round(Number(it.tamanho) || 1);
    const qtde = Math.round(Number(it.qtde) || 0);
    const preco = round2(Number(it.preco) || 0);
    if (!produto) continue;
    if (qtde <= 0) bloqueios.push(`Quantidade inválida em ${produto} ${cor}.`);
    if (preco <= 0) bloqueios.push(`Preço inválido em ${produto} ${cor}.`);
    if (tamanho < 1 || tamanho > MAX_GRADE) bloqueios.push(`Tamanho inválido em ${produto} ${cor}.`);
    const k = `${produto}|${cor}|${tamanho}`;
    const atual = agrupados.get(k);
    if (atual) {
      if (atual.preco !== preco) bloqueios.push(`${produto} ${cor} aparece com preços diferentes.`);
      atual.qtde += qtde;
    } else {
      agrupados.set(k, { produto, cor, tamanho, qtde, preco });
    }
  }
  if (agrupados.size === 0) bloqueios.push("Inclua ao menos um produto.");

  // Um produto × cor tem um único PRECO em FATURAMENTO_PROD.
  const precoPorProdCor = new Map<string, number>();
  for (const a of agrupados.values()) {
    const k = `${a.produto}|${a.cor}`;
    const p = precoPorProdCor.get(k);
    if (p !== undefined && p !== a.preco) bloqueios.push(`${a.produto} ${a.cor}: tamanhos com preços diferentes na mesma NF.`);
    precoPorProdCor.set(k, a.preco);
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
    const [p] = await q(req, `
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
      bloqueios.push(`Produto ${a.produto} não existe no Linx.`);
      continue;
    }
    if (p.descCor === null || p.descCor === undefined) bloqueios.push(`A cor ${a.cor} não existe no produto ${a.produto}.`);
    const tamLabel = trim(p.tamLabel);
    if (!tamLabel) bloqueios.push(`O tamanho ${a.tamanho} não existe na grade do produto ${a.produto}.`);
    const codigoItem = `${a.produto}${a.cor}${tamLabel}`;
    const origem = trim(p.origem) || "0";
    const indCfop = Number(p.indCfop) || 11;

    req.input(`iCod${idx}`, sql.VarChar(50), codigoItem);
    req.input(`iOrig${idx}`, sql.Char(3), origem);
    req.input(`iInd${idx}`, sql.Int, indCfop);
    req.input(`iNcm${idx}`, sql.VarChar(10), trim(p.ncm).replace(/\D/g, ""));
    const [exc] = await q(req, `
      DECLARE @idExc INT = dbo.FX_ID_EXCECAO_IMPOSTO(@pTipoOp, @pClifor, @iInd${idx}, 'S', @pMatriz, @pFilial,
                          CAST(GETDATE() AS DATE), @iOrig${idx}, NULL, @iCod${idx}, @pNomeCli, 'P', @pNat, @pCodFilial);
      SELECT @idExc AS id, LTRIM(RTRIM(X.TRIBUT_ICMS)) AS csosn, LTRIM(RTRIM(X.CFOP_OBRIGATORIO)) AS cfopObrig,
             LTRIM(RTRIM(X.DESC_EXCECAO)) AS descr, LTRIM(RTRIM(X.CST_IBS_CBS)) AS cstIbs, LTRIM(RTRIM(X.CCLASSTRIB)) AS cclass,
             (SELECT TOP 1 LTRIM(RTRIM(CASE WHEN @pUfDest = (SELECT UF FROM CADASTRO_CLI_FOR WHERE NOME_CLIFOR = @pFilial)
                                            THEN CODIGO_FISCAL_OPERACAO ELSE CODIGO_FISCAL_INTERESTADUAL END))
                FROM CTB_LX_CARACTERISTICA_CFOP WITH (NOLOCK)
               WHERE CTB_TIPO_OPERACAO = @pTipoOp AND INDICADOR_CFOP = @iInd${idx} AND INDICADOR_FISCAL_TERCEIRO = @pIndFiscal) AS cfopCarac,
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
    const csosn = trim(exc?.csosn);
    const cfop = trim(exc?.cfopObrig) || trim(exc?.cfopCarac);
    const excDesc = trim(exc?.descr);
    if (idExc === null) {
      bloqueios.push(`${a.produto}: nenhuma exceção fiscal encontrada para ${ufCliente} — peça ao fiscal para cadastrar.`);
    } else if (csosn === "900" || /DEVOLU/i.test(excDesc)) {
      bloqueios.push(
        `${a.produto}: a exceção fiscal encontrada para ${ufCliente} é "${excDesc}" (${idExc}, CSOSN ${csosn}), que não é de venda. ` +
          `Falta cadastrar a exceção de venda para ${ufCliente} no Linx.`
      );
    }
    if (!cfop) bloqueios.push(`${a.produto}: CFOP não encontrado para a natureza ${natureza}.`);
    if (exc && (exc.ibptFed === null || exc.ibptFed === undefined)) {
      avisos.push(`${a.produto}: NCM ${trim(p.ncm)} sem tabela IBPT vigente — a NF sai sem os tributos aproximados.`);
    }

    let impostos: LinhaFiscal["impostos"] = [];
    if (idExc !== null) {
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
    } else if (estoque === null) {
      avisos.push(`${a.produto} ${a.cor} ${tamLabel}: sem registro de estoque na filial ${filial}.`);
    }

    const descNf = trim(p.descNf);
    const descCor = trim(p.descCor);
    linhas.push({
      produto: a.produto,
      cor: a.cor,
      descCor,
      tamanho: a.tamanho,
      tamanhoLabel: tamLabel,
      codigoItem,
      descricao: `${descNf} ${descCor} ${tamLabel}`.replace(/\s+/g, " ").trim().slice(0, 80),
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
      pct: 0,
      desconto: 0,
      frete: 0,
      seguro: 0,
    });
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
    porcDesconto = subtotal > 0 ? Math.round((desconto / subtotal) * 100 * 1e10) / 1e10 : 0;
  }
  if (desconto > subtotal) bloqueios.push("O desconto é maior que o valor dos produtos.");
  const total = round2(subtotal - desconto + frete + seguro);
  const qtdeTotal = linhas.reduce((s, l) => s + l.qtde, 0);

  // Rateio por item (a diferença de arredondamento vai para o último, como o form)
  ratear(linhas, desconto, "desconto", subtotal);
  ratear(linhas, frete, "frete", subtotal);
  ratear(linhas, seguro, "seguro", subtotal);

  // Pedido do site já faturado?
  const pedidoSite = trim(input.obs).match(/#\s*(\d{3,})/)?.[1];
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
  } else {
    avisos.push("OBS sem o nº do pedido do site (#1234) — fica mais difícil conferir depois.");
  }

  if (!simples && linhas.length > 0) {
    const tot = new Map<number, number>();
    for (const l of linhas) {
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
      tabPreco: trim(cli.tab) || "01",
    },
    linhas,
    subtotal,
    porcDesconto,
    porcDigitado,
    desconto,
    frete,
    seguro,
    total,
    qtdeTotal,
    icmsDestinoAliq: Number(aliqDest?.aliq) || 0,
    input,
    bloqueios: [...new Set(bloqueios)],
    avisos: [...new Set(avisos)],
  };
}

function ratear(linhas: LinhaFiscal[], totalValor: number, campo: "desconto" | "frete" | "seguro", subtotal: number) {
  if (linhas.length === 0) return;
  let acumulado = 0;
  linhas.forEach((l, i) => {
    l.pct = subtotal > 0 ? Math.round((l.valor / subtotal) * 100 * 1e10) / 1e10 : 0;
    if (i === linhas.length - 1) {
      l[campo] = round2(totalValor - acumulado);
    } else {
      l[campo] = round2((totalValor * l.pct) / 100);
      acumulado = round2(acumulado + l[campo]);
    }
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
    frete: p.frete,
    seguro: p.seguro,
    total: p.total,
    qtdeTotal: p.qtdeTotal,
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
 * que o Linx grava para ela (validado em 18/11/2026 contra NFs reais 100.05/100.08 de out–nov:
 * base 100%; ICMS 100% em NF de 1 item; PIS/COFINS 2.329 de 2.330 linhas; IBS/CBS ~98,6%.
 * Em NF de VÁRIOS itens o Linx reparte o ICMS do total e ~metade das NFs tem alguma linha
 * com ±R$ 0,01 de diferença para este cálculo — dentro da tolerância da SEFAZ):
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
  // Linhas de FATURAMENTO_PROD (produto × cor) com grade
  const prods = new Map<string, { produto: string; cor: string; preco: number; qtde: number; custo: number; cfop: string; grade: Map<number, number>; item: string }>();
  for (const l of p.linhas) {
    const k = `${l.produto}|${l.cor}`;
    let g = prods.get(k);
    if (!g) {
      g = { produto: l.produto, cor: l.cor, preco: l.preco, qtde: 0, custo: l.custo, cfop: l.cfop, grade: new Map(), item: String(prods.size + 1).padStart(4, "0") };
      prods.set(k, g);
    }
    g.qtde += l.qtde;
    g.grade.set(l.tamanho, (g.grade.get(l.tamanho) ?? 0) + l.qtde);
  }

  const tsExpr = (preco: number) =>
    `REPLICATE(NCHAR(198), 17 - LEN(dbo.FX_PRODUCAO_PRECO(CAST(${num(preco)} AS NUMERIC(14,2)),'T'))) + dbo.FX_PRODUCAO_PRECO(CAST(${num(preco)} AS NUMERIC(14,2)),'T') + '111'`;

  const vendasProd: string[] = [];
  const fatProd: string[] = [];
  let seqItem = 0;
  for (const g of prods.values()) {
    seqItem += 1;
    const voCols = [...g.grade.keys()].flatMap((n) => [`VO${n}`]);
    const voVals = [...g.grade.values()].map((v) => String(v));
    const fCols = [...g.grade.keys()].map((n) => `F${n}`);
    const valor = round2(g.preco * g.qtde);
    vendasProd.push(`
  INSERT INTO VENDAS_PRODUTO (PEDIDO, PRODUTO, COR_PRODUTO, ENTREGA, ITEM_PEDIDO, QTDE_ORIGINAL, QTDE_ENTREGAR, QTDE_ENTREGUE,
    PRECO1, VALOR_ORIGINAL, VALOR_ENTREGAR, VALOR_ENTREGUE, ENTREGUE_MOEDA_PADRAO, DATA_PARA_TRANSFERENCIA, ${voCols.join(", ")})
  VALUES (@PEDIDO, ${lit(g.produto)}, ${lit(g.cor)}, @HOJE, '0000', ${g.qtde}, 0, ${g.qtde},
    ${num(g.preco)}, ${num(valor)}, 0, ${num(valor)}, ${num(valor)}, @AGORA, ${voVals.join(", ")});`);
    fatProd.push(`
  INSERT INTO FATURAMENTO_PROD (FILIAL, NF_SAIDA, SERIE_NF, PRODUTO, COR_PRODUTO, ITEM, PEDIDO, PEDIDO_PRODUTO, PEDIDO_COR, ENTREGA,
    IPI, ICMS, DESCONTO_ITEM, QTDE, PRECO, VALOR, MATA_SALDO, ${fCols.join(", ")}, FAIXA, ORIGEM, CUSTO_NA_DATA, TIMESTAMP,
    MOEDA, CAMBIO_NA_DATA, DATA_PARA_TRANSFERENCIA, CODIGO_FISCAL_OPERACAO, COD_FILIAL_ESTOQUE,
    CUSTO_NA_DATA_2, CUSTO_NA_DATA_3, CUSTO_NA_DATA_4, ITEM_IMPRESSAO, ITEM_IMPRESSAO_FATURA, ITEM_PEDIDO,
    PRECO_2, PRECO_3, PRECO_4, VALOR_DIFERENCA_GUIA_FATURA_ITEM, LICENCIADO_ROYALTIES)
  VALUES (@FILIAL, @NF, @SERIE, ${lit(g.produto)}, ${lit(g.cor)}, ${lit(String(seqItem).padStart(6, "0"))}, @PEDIDO, ${lit(g.produto)}, ${lit(g.cor)}, @HOJE,
    0, 0, 0, ${g.qtde}, ${num(g.preco)}, ${num(valor)}, 0, ${[...g.grade.values()].join(", ")}, '1', 'S', ${num(g.custo)}, ${tsExpr(g.preco)},
    'R$', 1, @AGORA, ${lit(g.cfop)}, @COD_FILIAL,
    0, 0, 0, ${lit(g.item)}, ${lit(g.item)}, '0000',
    0, 0, 0, 0, 0);`);
  }

  const fatItem: string[] = [];
  const fatImp: string[] = [];
  p.linhas.forEach((l, i) => {
    const g = prods.get(`${l.produto}|${l.cor}`)!;
    // Tributos aproximados (IBPT) só vão para consumidor final — a Matriz grava 0 para empresa.
    const fatorIbpt = consumidorFinal(p) ? 1 : 0;
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
    CST_IBS_CBS, CCLASSTRIB)
  VALUES (@FILIAL, @NF, @SERIE, ${lit(g.item)}, ${l.tamanho}, ${lit(l.ncm)}, ${lit(l.cfop)},
    ${lit(l.codigoItem)}, 'P', 0, 0, ${lit(l.contaContabil || null)}, 0, ${lit(l.descricao)}, '1',
    ${l.excecao ?? "NULL"}, ${l.indicadorCfop}, 0, ${num(l.preco)}, ${num(l.valor)}, 0,
    ${num(l.pct, 10)}, ${num(l.preco)}, 0, ${l.qtde}, 0, ${lit(l.csosn)}, ${lit(l.origem)},
    ${lit(l.unidade)}, ${num(l.valor)}, ${lit(l.produto)}, ${lit(l.cor)}, ${tsExpr(l.preco)}, ${num(l.desconto)}, 0, 0,
    ${i + 1}, ${num(l.seguro)}, ${num(l.frete)}, 0, ${num(ibptFed)}, 'P', @COD_FILIAL,
    @CENTRO_CUSTO, 0, ${num(l.preco)}, ${num(ibptMun)}, ${num(ibptEst)}, ${l.idCest ?? "NULL"},
    ${lit(l.cstIbsCbs || null)}, ${lit(l.cClassTrib || null)});`);
    if (p.simples) {
      for (const t of l.impostos) {
        // DICMS (11) o Linx só grava em operação interestadual.
        if (t.id === 11 && p.cliente.uf === p.ufFilial) continue;
        const v = valorImposto(l, t, p.icmsDestinoAliq);
        fatImp.push(`
  INSERT INTO FATURAMENTO_IMPOSTO (FILIAL, NF_SAIDA, SERIE_NF, ITEM_IMPRESSAO, SUB_ITEM_TAMANHO, ID_IMPOSTO, TAXA_IMPOSTO,
    BASE_IMPOSTO, VALOR_IMPOSTO, VALOR_IMPOSTO_CALCULADO, INCIDENCIA, AGREGA_APOS_ENCARGO, AGREGA_APOS_DESCONTO)
  VALUES (@FILIAL, @NF, @SERIE, ${lit(g.item)}, ${l.tamanho}, ${t.id}, ${num(v.taxa)}, ${num(v.base)}, ${num(v.valor)}, ${num(v.valor)},
    ${t.incidencia}, ${t.agregaEncargo ? 1 : 0}, ${t.agregaDesconto ? 1 : 0});`);
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
  VALUES (@FILIAL, @NF, @SERIE, ${lit(g.item)}, ${l.tamanho}, ${t.id}, ${num(v.taxa)}, ${num(v.base)}, ${num(v.valor)}, ${num(v.valor)},
    ${num(v.base)}, ${t.incidencia}, ${t.agregaEncargo ? 1 : 0}, ${t.agregaDesconto ? 1 : 0});`);
      });
    }
  });

  // OBS tipo 7 (DIFAL zerado) é do Simples; no regime normal a Matriz não grava (e o
  // caso com DIFAL de verdade — não contribuinte de outra UF — é bloqueado no plano).
  const interestadual = p.cliente.uf !== p.ufFilial && p.simples;
  const valorEntregue = round2(p.subtotal - p.desconto);

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

  -- Nº do pedido "NF SEM PEDIDO"
  DECLARE @novoPed INT;
  UPDATE SEQUENCIAIS WITH (UPDLOCK, HOLDLOCK)
     SET @novoPed = CAST(SEQUENCIA AS INT) + 1, SEQUENCIA = CAST(CAST(SEQUENCIA AS INT) + 1 AS VARCHAR(12))
   WHERE TABELA_COLUNA = 'VENDAS.PEDIDO';
  IF @novoPed IS NULL BEGIN ;THROW 51100, 'Sequencial VENDAS.PEDIDO não encontrado.', 1; END
  DECLARE @PEDIDO CHAR(12) = CAST(@novoPed AS VARCHAR(12));

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

  INSERT INTO VENDAS (PEDIDO, COLECAO, CODIGO_TAB_PRECO, TIPO, CONDICAO_PGTO, FILIAL, CLIENTE_ATACADO, TRANSPORTADORA, MOEDA,
    REPRESENTANTE, GERENTE, EMISSAO, CADASTRAMENTO, TOT_QTDE_ORIGINAL, TOT_QTDE_ENTREGUE, TOT_QTDE_ENTREGAR,
    TOT_VALOR_ORIGINAL, TOT_VALOR_ENTREGUE, TOT_VALOR_ENTREGAR, APROVADO_POR, TABELA_FILHA, TOT_BRUTO_ENTREGUE,
    ACEITA_PECAS_PEQUENAS, ACEITA_PECAS_COM_CORTE, DATA_PARA_TRANSFERENCIA, TOT_ENTREGUE_MOEDA_PADRAO,
    NOME_CLIFOR_ENTREGA, TIPO_RATEIO, TRANSP_REDESPACHO, VALOR_SUB_ITENS, INDICADOR_VENDA)
  VALUES (@PEDIDO, '${COLECAO_PEDIDO}', @TAB_PRECO, 'VENDA ATACADO', @COND_PGTO, @FILIAL, @CLIENTE, @TRANSP, 'R$',
    @REPRESENTANTE, @REPRESENTANTE, @HOJE, @HOJE, ${p.qtdeTotal}, ${p.qtdeTotal}, 0,
    ${num(p.subtotal)}, ${num(valorEntregue)}, 0, 'NF SEM PEDIDO', 'VENDAS_PRODUTO', ${num(p.subtotal)},
    100, 100, @AGORA, ${num(valorEntregue)},
    @CLIENTE, 0, @TRANSP_REDESP, ${num(p.subtotal)}, 'V');
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
    USA_VALOR_MEDIO, TP_NF_CREDITO, TP_NF_DEBITO, TP_ENTE_GOVERNO, REDUTOR_COMPRA_GOVERNO, TP_OPER_GOVERNO, PREVISAO_ENTREGA)
  VALUES (@FILIAL, @NF, @SERIE, 'PADRAO', @CLIENTE, @COND_PGTO, @NATUREZA,
    @TRANSP, @TRANSP_REDESP, @TIPO_FRETE, '${COD_TRANSACAO}', @HOJE, @HOJE, ${num(p.frete)}, ${num(p.seguro)}, ${num(p.desconto)},
    0, 0, 0, 0, ${num(p.total)}, ${p.qtdeTotal}, 1, 0, 0,
    'FATURAMENTO_PROD', NULLIF(@OBS, ''), @PESO_LIQ, @PESO_BRUTO, @VOLUMES, @TIPO_VOLUME, 0, @ENTREGA_CIF, 0, 0,
    0, 0, @REPRESENTANTE, 0, 0, @REPRESENTANTE, 0, 0,
    0, 0, 0, 'R$', 1, 1, 0,
    @AGORA, @CLIENTE, 0, 2, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0, @EMPRESA, 0, 0,
    ${num(p.desconto)}, 0, 0, ${num(p.frete)}, 0, ${num(p.seguro)},
    ${num(p.subtotal)}, ${num(p.total)}, 0, ${num(p.porcDesconto, 10)}, 0,
    0, ${p.porcDigitado ? 1 : 0}, 0, @CENTRO_CUSTO, @COD_FILIAL,
    0, 0, ${num(p.subtotal)}, 0,
    @CONS_FINAL, 0, 0, 0, 0,
    @CHAVE, 0, 1, 0, 0, 0, 0, '19000101',
    1, 1, 0, 0, 0,
    CAST(@AGORA AS SMALLDATETIME), 0, 3, 3, 0, @INFO_PGTO,
    0, 0, 0, 0, 0, 0, @HOJE);
${fatProd.join("\n")}
${fatItem.join("\n")}
${fatImp.join("\n")}
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
  req.input("COND_PGTO", sql.Char(3), trim(i.condicaoPgto) || padrao.condicaoPgto);
  req.input("NATUREZA", sql.Char(7), p.natureza);
  req.input("TRANSP", sql.VarChar(25), trim(i.transportadora) || padrao.transportadora);
  req.input("TRANSP_REDESP", sql.VarChar(25), trim(i.transpRedespacho) || trim(i.transportadora) || padrao.transpRedespacho);
  req.input("TIPO_FRETE", sql.Char(2), trim(i.tipoFrete) || padrao.tipoFrete);
  req.input("REPRESENTANTE", sql.VarChar(25), padrao.representante);
  req.input("CENTRO_CUSTO", sql.VarChar(6), padrao.centroCusto);
  req.input("OBS", sql.VarChar(sql.MAX), trim(i.obs));
  req.input("PESO_LIQ", sql.Numeric(9, 3), Number(i.pesoLiquido) || 0);
  req.input("PESO_BRUTO", sql.Numeric(9, 3), Number(i.pesoBruto) || 0);
  req.input("VOLUMES", sql.Int, Math.max(0, Math.round(Number(i.volumes) || 0)));
  req.input("TIPO_VOLUME", sql.VarChar(25), trim(i.tipoVolume).toUpperCase() || padrao.tipoVolume);
  req.input("INFO_PGTO", sql.Char(2), trim(i.infoPgto) || padrao.infoPgto);
  req.input("CONS_FINAL", sql.Bit, consumidorFinal(p) ? 1 : 0);
}

/**
 * Simples (e-commerce): sempre consumidor final, como o form grava. Regime normal (Matriz):
 * só o não contribuinte (indicador 8) — empresa (1) e revenda (16) não (medido nas NFs dela).
 */
function consumidorFinal(p: Plano): boolean {
  return p.simples || p.indFiscal === 8;
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
      WHERE F.FILIAL = @filial AND F.NF_SAIDA = @nf AND F.SERIE_NF = @serie`);
    const x = cab[0];
    if (!x) return null;
    const itens = await q(req, `
      SELECT LTRIM(RTRIM(I.REFERENCIA)) AS produto, LTRIM(RTRIM(I.REFERENCIA_ITEM)) AS cor, LTRIM(RTRIM(I.DESCRICAO_ITEM)) AS descricao,
             I.QTDE_ITEM AS qtde, I.PRECO_UNITARIO AS preco, I.VALOR_ITEM AS valor, LTRIM(RTRIM(I.CODIGO_FISCAL_OPERACAO)) AS cfop
        FROM FATURAMENTO_ITEM I WITH (NOLOCK)
       WHERE I.FILIAL = @filial AND I.NF_SAIDA = @nf AND I.SERIE_NF = @serie
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
