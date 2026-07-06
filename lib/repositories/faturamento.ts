import 'server-only';

import sql from 'mssql';

import { withRequest } from '@/lib/db/connection';
import { RequestLike } from '@/lib/db/proxy';
import { normalizeRangeForQuery, getCurrentMonthRange } from '@/lib/utils/date';

/**
 * Módulo FISCAL (NFs / faturamento).
 *
 * Diferente do resto do dashboard, que lê VENDAS (LOJA_VENDA / LOJA_VENDA_PRODUTO)
 * das filiais de VAREJO, este repositório lê o FATURAMENTO fiscal do ERP:
 *
 *   FATURAMENTO             → cabeçalho da NF (1 linha por NF): número, série, filial,
 *                             cliente (NOME_CLIFOR), natureza de operação, emissão,
 *                             valor total, impostos, chave NFe, status, transportadora…
 *   W_FATURAMENTO_PROD_02   → itens da NF (produto, cor, qtde, preço, valor, custo…)
 *   NATUREZAS_SAIDAS        → dimensão da natureza de operação (código → descrição)
 *
 * É AQUI que aparece o faturamento da MATRIZ ScarfMe (vendas corporativas / private /
 * revenda), que NÃO passa por LOJA_VENDA e portanto não aparece nas telas de vendas.
 * Por padrão lemos TODAS as filiais fiscais (sem distinção), que é o pedido do dono.
 */

/** Código da EMPRESA no ERP (FATURAMENTO.EMPRESA) por chave de negócio. */
const EMPRESA_CODES: Record<'nerd' | 'scarfme', number[]> = {
  // NERD fatura muito pouco por NF (uso residual), mas mantemos o filtro.
  nerd: [8],
  // ScarfME: MATRIZ (1), MATRIZ LLL (10), MATRIZ CMS (13), MSC COMERCIO (15) e
  // AKS COMERCIO (16). MSC↔AKS fazem o rodízio fiscal do e-commerce (~15 dias); a AKS
  // é a entidade fiscal mais nova — sem o 16 aqui, todo o faturamento dela some das
  // tools fiscais (notas_fiscais / faturamento_resumo / página /faturamento).
  scarfme: [1, 10, 13, 15, 16],
};

export type FaturamentoEmpresa = 'nerd' | 'scarfme';

export interface FaturamentoFiltro {
  /** Chave de negócio; mapeia para FATURAMENTO.EMPRESA. Omitir = todas as empresas. */
  empresa?: FaturamentoEmpresa | null;
  /** Nome exato da filial fiscal (FATURAMENTO.FILIAL). Omitir = todas. */
  filial?: string | null;
  /** Códigos de natureza de operação (ex.: "100.02"). Omitir = todas. */
  naturezas?: string[] | null;
  /** Trecho do nome do cliente (NOME_CLIFOR LIKE). */
  cliente?: string | null;
  /** Número da NF (NF_SAIDA) — casa com ou sem zeros à esquerda. */
  nfNumero?: string | null;
  /** Trecho da descrição / código de UM produto (filtra pelas NFs que o contêm). */
  produto?: string | null;
  /** Período por data de EMISSÃO. Padrão: mês corrente. */
  range?: { start?: Date | string; end?: Date | string };
  /** Inclui notas canceladas (NOTA_CANCELADA=1). Padrão: false. */
  incluirCanceladas?: boolean;
  /** Inclui devoluções (DEVOLUCAO=1). Padrão: true. */
  incluirDevolucoes?: boolean;
}

export interface NotaFiscalHeader {
  nfSaida: string;
  serie: string;
  filial: string;
  empresa: number | null;
  cliente: string;
  natureza: string;
  descNatureza: string | null;
  emissao: string | null;
  dataSaida: string | null;
  valorTotal: number;
  qtdeTotal: number;
  desconto: number;
  frete: number;
  icms: number;
  ipi: number;
  tipoFaturamento: string | null;
  cancelada: boolean;
  devolucao: boolean;
  chaveNfe: string | null;
  statusNfe: number | null;
  condicaoPgto: string | null;
  transportadora: string | null;
  representante: string | null;
  gerente: string | null;
  moeda: string | null;
}

export interface NotaFiscalItem {
  item: string | null;
  produto: string;
  descProduto: string | null;
  corProduto: string | null;
  descCorProduto: string | null;
  grade: string | null;
  colecao: string | null;
  descColecao: string | null;
  grupo: string | null;
  subgrupo: string | null;
  linha: string | null;
  qtde: number;
  preco: number;
  descontoItem: number;
  valor: number;
  valorLiquido: number;
  custoNaData: number;
  uf: string | null;
}

export interface FaturamentoTotais {
  nfs: number;
  valorTotal: number;
  qtde: number;
  desconto: number;
}

export interface NotasFiscaisResult {
  notas: NotaFiscalHeader[];
  totais: FaturamentoTotais;
  truncado: boolean;
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => String(v ?? '').trim();
const strOrNull = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return s.length > 0 ? s : null;
};
const dateOrNull = (v: unknown): string | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

function resolveRange(range?: FaturamentoFiltro['range']) {
  if (!range?.start && !range?.end) {
    const m = getCurrentMonthRange();
    return normalizeRangeForQuery({ start: m.start, end: m.end });
  }
  return normalizeRangeForQuery(range);
}

/**
 * Registra os filtros comuns (empresa/filial/natureza/cliente/nf/cancelada/devolução)
 * como parâmetros na request e devolve o trecho de WHERE correspondente. `alias` é o
 * alias da tabela FATURAMENTO (ex.: 'f'). Os filtros de produto exigem EXISTS no
 * item e ficam fora daqui (tratados por quem monta a query).
 */
function buildHeaderFilters(
  request: sql.Request | RequestLike,
  filtro: FaturamentoFiltro,
  alias: string,
): string {
  const where: string[] = [];

  const empresa = filtro.empresa;
  if (empresa && EMPRESA_CODES[empresa]) {
    const codes = EMPRESA_CODES[empresa];
    codes.forEach((c, i) => request.input(`emp${i}`, sql.Int, c));
    where.push(`${alias}.EMPRESA IN (${codes.map((_, i) => `@emp${i}`).join(', ')})`);
  }

  if (filtro.filial && filtro.filial.trim()) {
    request.input('filialFat', sql.VarChar, filtro.filial.trim());
    where.push(`LTRIM(RTRIM(${alias}.FILIAL)) = LTRIM(RTRIM(@filialFat))`);
  }

  const naturezas = (filtro.naturezas ?? []).map((n) => n.trim()).filter(Boolean);
  if (naturezas.length > 0) {
    naturezas.forEach((n, i) => request.input(`nat${i}`, sql.VarChar, n));
    where.push(
      `LTRIM(RTRIM(${alias}.NATUREZA_SAIDA)) IN (${naturezas.map((_, i) => `@nat${i}`).join(', ')})`,
    );
  }

  if (filtro.cliente && filtro.cliente.trim().length >= 2) {
    request.input('cliente', sql.VarChar, `%${filtro.cliente.trim()}%`);
    where.push(`${alias}.NOME_CLIFOR LIKE @cliente`);
  }

  if (filtro.nfNumero && filtro.nfNumero.trim()) {
    const raw = filtro.nfNumero.trim();
    request.input('nfNum', sql.VarChar, raw);
    // Casa com ou sem zeros à esquerda (NF_SAIDA é char(15) preenchido com zeros/espaços).
    where.push(
      `(LTRIM(RTRIM(${alias}.NF_SAIDA)) = @nfNum ` +
        `OR LTRIM(RTRIM(${alias}.NF_SAIDA)) = RIGHT(REPLICATE('0', 15) + @nfNum, 15) ` +
        `OR CAST(TRY_CONVERT(BIGINT, LTRIM(RTRIM(${alias}.NF_SAIDA))) AS VARCHAR) = @nfNum)`,
    );
  }

  if (!filtro.incluirCanceladas) {
    where.push(`ISNULL(${alias}.NOTA_CANCELADA, 0) = 0`);
  }
  if (filtro.incluirDevolucoes === false) {
    where.push(`ISNULL(${alias}.DEVOLUCAO, 0) = 0`);
  }

  return where.length > 0 ? `AND ${where.join('\n          AND ')}` : '';
}

/** Filtro EXISTS no item (produto por código OU trecho da descrição). */
function buildProdutoExists(
  request: sql.Request | RequestLike,
  filtro: FaturamentoFiltro,
  alias: string,
): string {
  const produto = filtro.produto?.trim();
  if (!produto) return '';
  request.input('prodBusca', sql.VarChar, `%${produto}%`);
  request.input('prodCod', sql.VarChar, produto);
  return `AND EXISTS (
            SELECT 1 FROM W_FATURAMENTO_PROD_02 pex WITH (NOLOCK)
            WHERE LTRIM(RTRIM(pex.NF_SAIDA)) = LTRIM(RTRIM(${alias}.NF_SAIDA))
              AND LTRIM(RTRIM(pex.SERIE_NF)) = LTRIM(RTRIM(${alias}.SERIE_NF))
              AND LTRIM(RTRIM(pex.FILIAL)) = LTRIM(RTRIM(${alias}.FILIAL))
              AND (LTRIM(RTRIM(pex.PRODUTO)) = @prodCod OR pex.DESC_PRODUTO LIKE @prodBusca)
          )`;
}

const HEADER_MAX = 1000;

/**
 * Lista as NFs (cabeçalho) do período com os filtros informados, mais os totais
 * agregados de TODAS as NFs que casam o filtro (não só as retornadas).
 */
export async function fetchNotasFiscais(filtro: FaturamentoFiltro): Promise<NotasFiscaisResult> {
  return withRequest(async (request) => {
    const { start, end } = resolveRange(filtro.range);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);
    request.input('limit', sql.Int, HEADER_MAX + 1);

    const headerFilters = buildHeaderFilters(request, filtro, 'f');
    const produtoExists = buildProdutoExists(request, filtro, 'f');

    const baseWhere = `
        WHERE f.EMISSAO >= @startDate AND f.EMISSAO < @endDate
          ${headerFilters}
          ${produtoExists}`;

    const listQuery = `
      SELECT TOP (@limit)
        LTRIM(RTRIM(f.NF_SAIDA)) AS nfSaida,
        LTRIM(RTRIM(f.SERIE_NF)) AS serie,
        LTRIM(RTRIM(f.FILIAL)) AS filial,
        f.EMPRESA AS empresa,
        LTRIM(RTRIM(f.NOME_CLIFOR)) AS cliente,
        LTRIM(RTRIM(f.NATUREZA_SAIDA)) AS natureza,
        LTRIM(RTRIM(ns.DESC_NATUREZA)) AS descNatureza,
        f.EMISSAO AS emissao,
        f.DATA_SAIDA AS dataSaida,
        f.VALOR_TOTAL AS valorTotal,
        f.QTDE_TOTAL AS qtdeTotal,
        f.DESCONTO AS desconto,
        f.FRETE AS frete,
        f.ICMS AS icms,
        f.IPI_VALOR AS ipi,
        LTRIM(RTRIM(f.TIPO_FATURAMENTO)) AS tipoFaturamento,
        ISNULL(f.NOTA_CANCELADA, 0) AS cancelada,
        ISNULL(f.DEVOLUCAO, 0) AS devolucao,
        LTRIM(RTRIM(f.CHAVE_NFE)) AS chaveNfe,
        f.STATUS_NFE AS statusNfe,
        LTRIM(RTRIM(f.CONDICAO_PGTO)) AS condicaoPgto,
        LTRIM(RTRIM(f.TRANSPORTADORA)) AS transportadora,
        LTRIM(RTRIM(f.REPRESENTANTE)) AS representante,
        LTRIM(RTRIM(f.GERENTE)) AS gerente,
        LTRIM(RTRIM(f.MOEDA)) AS moeda
      FROM FATURAMENTO f WITH (NOLOCK)
      LEFT JOIN NATUREZAS_SAIDAS ns WITH (NOLOCK)
        ON LTRIM(RTRIM(ns.NATUREZA_SAIDA)) = LTRIM(RTRIM(f.NATUREZA_SAIDA))
      ${baseWhere}
      ORDER BY f.EMISSAO DESC, f.NF_SAIDA DESC`;

    const totalsQuery = `
      SELECT
        COUNT(*) AS nfs,
        SUM(f.VALOR_TOTAL) AS valorTotal,
        SUM(f.QTDE_TOTAL) AS qtde,
        SUM(f.DESCONTO) AS desconto
      FROM FATURAMENTO f WITH (NOLOCK)
      ${baseWhere}`;

    // Sequencial: um sql.Request executa uma query por vez (Promise.all no mesmo
    // request quebra na conexão direta). Os params já estão registrados.
    const listResult = await request.query<Record<string, unknown>>(listQuery);
    const totalsResult = await request.query<Record<string, unknown>>(totalsQuery);

    const rows = listResult.recordset ?? [];
    const truncado = rows.length > HEADER_MAX;
    const notas: NotaFiscalHeader[] = rows.slice(0, HEADER_MAX).map((r) => ({
      nfSaida: str(r.nfSaida),
      serie: str(r.serie),
      filial: str(r.filial),
      empresa: r.empresa != null ? num(r.empresa) : null,
      cliente: str(r.cliente),
      natureza: str(r.natureza),
      descNatureza: strOrNull(r.descNatureza),
      emissao: dateOrNull(r.emissao),
      dataSaida: dateOrNull(r.dataSaida),
      valorTotal: num(r.valorTotal),
      qtdeTotal: num(r.qtdeTotal),
      desconto: num(r.desconto),
      frete: num(r.frete),
      icms: num(r.icms),
      ipi: num(r.ipi),
      tipoFaturamento: strOrNull(r.tipoFaturamento),
      cancelada: num(r.cancelada) === 1,
      devolucao: num(r.devolucao) === 1,
      chaveNfe: strOrNull(r.chaveNfe),
      statusNfe: r.statusNfe != null ? num(r.statusNfe) : null,
      condicaoPgto: strOrNull(r.condicaoPgto),
      transportadora: strOrNull(r.transportadora),
      representante: strOrNull(r.representante),
      gerente: strOrNull(r.gerente),
      moeda: strOrNull(r.moeda),
    }));

    const t = totalsResult.recordset?.[0] ?? {};
    return {
      notas,
      totais: {
        nfs: num(t.nfs),
        valorTotal: num(t.valorTotal),
        qtde: num(t.qtde),
        desconto: num(t.desconto),
      },
      truncado,
    };
  });
}

export interface NotaFiscalDetalhe {
  header: NotaFiscalHeader | null;
  itens: NotaFiscalItem[];
}

/** Detalhe de UMA NF: cabeçalho + itens (produtos). */
export async function fetchNotaFiscalDetalhe(params: {
  nfSaida: string;
  serie?: string | null;
  filial?: string | null;
}): Promise<NotaFiscalDetalhe> {
  return withRequest(async (request) => {
    request.input('nf', sql.VarChar, params.nfSaida.trim());
    let extra = '';
    if (params.serie && params.serie.trim()) {
      request.input('serie', sql.VarChar, params.serie.trim());
      extra += ' AND LTRIM(RTRIM(f.SERIE_NF)) = LTRIM(RTRIM(@serie))';
    }
    if (params.filial && params.filial.trim()) {
      request.input('filialFat', sql.VarChar, params.filial.trim());
      extra += ' AND LTRIM(RTRIM(f.FILIAL)) = LTRIM(RTRIM(@filialFat))';
    }

    const nfMatch =
      `(LTRIM(RTRIM(f.NF_SAIDA)) = @nf ` +
      `OR LTRIM(RTRIM(f.NF_SAIDA)) = RIGHT(REPLICATE('0', 15) + @nf, 15) ` +
      `OR CAST(TRY_CONVERT(BIGINT, LTRIM(RTRIM(f.NF_SAIDA))) AS VARCHAR) = @nf)`;

    const headerQuery = `
      SELECT TOP 1
        LTRIM(RTRIM(f.NF_SAIDA)) AS nfSaida, LTRIM(RTRIM(f.SERIE_NF)) AS serie,
        LTRIM(RTRIM(f.FILIAL)) AS filial, f.EMPRESA AS empresa,
        LTRIM(RTRIM(f.NOME_CLIFOR)) AS cliente, LTRIM(RTRIM(f.NATUREZA_SAIDA)) AS natureza,
        LTRIM(RTRIM(ns.DESC_NATUREZA)) AS descNatureza,
        f.EMISSAO AS emissao, f.DATA_SAIDA AS dataSaida, f.VALOR_TOTAL AS valorTotal,
        f.QTDE_TOTAL AS qtdeTotal, f.DESCONTO AS desconto, f.FRETE AS frete,
        f.ICMS AS icms, f.IPI_VALOR AS ipi, LTRIM(RTRIM(f.TIPO_FATURAMENTO)) AS tipoFaturamento,
        ISNULL(f.NOTA_CANCELADA, 0) AS cancelada, ISNULL(f.DEVOLUCAO, 0) AS devolucao,
        LTRIM(RTRIM(f.CHAVE_NFE)) AS chaveNfe, f.STATUS_NFE AS statusNfe,
        LTRIM(RTRIM(f.CONDICAO_PGTO)) AS condicaoPgto, LTRIM(RTRIM(f.TRANSPORTADORA)) AS transportadora,
        LTRIM(RTRIM(f.REPRESENTANTE)) AS representante, LTRIM(RTRIM(f.GERENTE)) AS gerente,
        LTRIM(RTRIM(f.MOEDA)) AS moeda
      FROM FATURAMENTO f WITH (NOLOCK)
      LEFT JOIN NATUREZAS_SAIDAS ns WITH (NOLOCK)
        ON LTRIM(RTRIM(ns.NATUREZA_SAIDA)) = LTRIM(RTRIM(f.NATUREZA_SAIDA))
      WHERE ${nfMatch} ${extra}
      ORDER BY f.EMISSAO DESC`;

    const headerResult = await request.query<Record<string, unknown>>(headerQuery);
    const hr = headerResult.recordset?.[0];
    if (!hr) return { header: null, itens: [] };

    const header: NotaFiscalHeader = {
      nfSaida: str(hr.nfSaida),
      serie: str(hr.serie),
      filial: str(hr.filial),
      empresa: hr.empresa != null ? num(hr.empresa) : null,
      cliente: str(hr.cliente),
      natureza: str(hr.natureza),
      descNatureza: strOrNull(hr.descNatureza),
      emissao: dateOrNull(hr.emissao),
      dataSaida: dateOrNull(hr.dataSaida),
      valorTotal: num(hr.valorTotal),
      qtdeTotal: num(hr.qtdeTotal),
      desconto: num(hr.desconto),
      frete: num(hr.frete),
      icms: num(hr.icms),
      ipi: num(hr.ipi),
      tipoFaturamento: strOrNull(hr.tipoFaturamento),
      cancelada: num(hr.cancelada) === 1,
      devolucao: num(hr.devolucao) === 1,
      chaveNfe: strOrNull(hr.chaveNfe),
      statusNfe: hr.statusNfe != null ? num(hr.statusNfe) : null,
      condicaoPgto: strOrNull(hr.condicaoPgto),
      transportadora: strOrNull(hr.transportadora),
      representante: strOrNull(hr.representante),
      gerente: strOrNull(hr.gerente),
      moeda: strOrNull(hr.moeda),
    };

    // Itens: casa pela NF/série/filial exatas já resolvidas no cabeçalho. Reusa o
    // mesmo request (sequencial, após o cabeçalho); reatribui os params NF/série/filial.
    request.input('nfExata', sql.VarChar, header.nfSaida);
    request.input('serieExata', sql.VarChar, header.serie);
    request.input('filialExata', sql.VarChar, header.filial);
    const itensQuery = `
        SELECT
          LTRIM(RTRIM(p.ITEM)) AS item, LTRIM(RTRIM(p.PRODUTO)) AS produto,
          LTRIM(RTRIM(p.DESC_PRODUTO)) AS descProduto, LTRIM(RTRIM(p.COR_PRODUTO)) AS corProduto,
          LTRIM(RTRIM(p.DESC_COR_PRODUTO)) AS descCorProduto, LTRIM(RTRIM(p.GRADE)) AS grade,
          LTRIM(RTRIM(p.COLECAO)) AS colecao, LTRIM(RTRIM(p.DESC_COLECAO)) AS descColecao,
          LTRIM(RTRIM(p.GRUPO_PRODUTO)) AS grupo, LTRIM(RTRIM(p.SUBGRUPO_PRODUTO)) AS subgrupo,
          LTRIM(RTRIM(p.LINHA)) AS linha, p.QTDE AS qtde, p.PRECO AS preco,
          p.DESCONTO_ITEM AS descontoItem, p.VALOR AS valor, p.VALOR_LIQUIDO AS valorLiquido,
          p.CUSTO_NA_DATA AS custoNaData, LTRIM(RTRIM(p.UF)) AS uf
        FROM W_FATURAMENTO_PROD_02 p WITH (NOLOCK)
        WHERE LTRIM(RTRIM(p.NF_SAIDA)) = LTRIM(RTRIM(@nfExata))
          AND LTRIM(RTRIM(p.SERIE_NF)) = LTRIM(RTRIM(@serieExata))
          AND LTRIM(RTRIM(p.FILIAL)) = LTRIM(RTRIM(@filialExata))
        ORDER BY p.ITEM`;
    const itemReq = await request.query<Record<string, unknown>>(itensQuery);

    const itens: NotaFiscalItem[] = (itemReq.recordset ?? []).map((r) => ({
      item: strOrNull(r.item),
      produto: str(r.produto),
      descProduto: strOrNull(r.descProduto),
      corProduto: strOrNull(r.corProduto),
      descCorProduto: strOrNull(r.descCorProduto),
      grade: strOrNull(r.grade),
      colecao: strOrNull(r.colecao),
      descColecao: strOrNull(r.descColecao),
      grupo: strOrNull(r.grupo),
      subgrupo: strOrNull(r.subgrupo),
      linha: strOrNull(r.linha),
      qtde: num(r.qtde),
      preco: num(r.preco),
      descontoItem: num(r.descontoItem),
      valor: num(r.valor),
      valorLiquido: num(r.valorLiquido),
      custoNaData: num(r.custoNaData),
      uf: strOrNull(r.uf),
    }));

    return { header, itens };
  });
}

export interface FaturamentoResumo {
  totais: FaturamentoTotais;
  porNatureza: Array<{ natureza: string; descNatureza: string | null; nfs: number; valorTotal: number; qtde: number }>;
  porFilial: Array<{ filial: string; empresa: number | null; nfs: number; valorTotal: number; qtde: number }>;
  porMes: Array<{ mes: string; nfs: number; valorTotal: number; qtde: number }>;
  porCliente: Array<{ cliente: string; nfs: number; valorTotal: number; qtde: number }>;
}

/**
 * Resumo agregado do faturamento no período/filtro: totais, e quebras por natureza,
 * por filial, por mês e por cliente (top). Responde "quanto a matriz faturou no mês",
 * "faturamento por natureza de operação", etc.
 */
export async function fetchFaturamentoResumo(filtro: FaturamentoFiltro): Promise<FaturamentoResumo> {
  return withRequest(async (request) => {
    const { start, end } = resolveRange(filtro.range);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);
    const headerFilters = buildHeaderFilters(request, filtro, 'f');
    const produtoExists = buildProdutoExists(request, filtro, 'f');
    const baseWhere = `
        WHERE f.EMISSAO >= @startDate AND f.EMISSAO < @endDate
          ${headerFilters}
          ${produtoExists}`;

    // O driver (mssql direto) devolveria múltiplos recordsets num batch, mas o proxy
    // só retorna o primeiro. Rodamos consultas separadas p/ portabilidade.
    // Sequencial no mesmo request (um sql.Request executa uma query por vez).
    const totRes = await request.query<Record<string, unknown>>(`
        SELECT COUNT(*) AS nfs, SUM(f.VALOR_TOTAL) AS valorTotal, SUM(f.QTDE_TOTAL) AS qtde
        FROM FATURAMENTO f WITH (NOLOCK) ${baseWhere}`);
    const natRes = await request.query<Record<string, unknown>>(`
        SELECT LTRIM(RTRIM(f.NATUREZA_SAIDA)) AS natureza, LTRIM(RTRIM(ns.DESC_NATUREZA)) AS descNatureza,
               COUNT(*) AS nfs, SUM(f.VALOR_TOTAL) AS valorTotal, SUM(f.QTDE_TOTAL) AS qtde
        FROM FATURAMENTO f WITH (NOLOCK)
        LEFT JOIN NATUREZAS_SAIDAS ns WITH (NOLOCK)
          ON LTRIM(RTRIM(ns.NATUREZA_SAIDA)) = LTRIM(RTRIM(f.NATUREZA_SAIDA))
        ${baseWhere}
        GROUP BY LTRIM(RTRIM(f.NATUREZA_SAIDA)), LTRIM(RTRIM(ns.DESC_NATUREZA))
        ORDER BY valorTotal DESC`);
    const filRes = await request.query<Record<string, unknown>>(`
        SELECT LTRIM(RTRIM(f.FILIAL)) AS filial, MAX(f.EMPRESA) AS empresa,
               COUNT(*) AS nfs, SUM(f.VALOR_TOTAL) AS valorTotal, SUM(f.QTDE_TOTAL) AS qtde
        FROM FATURAMENTO f WITH (NOLOCK) ${baseWhere}
        GROUP BY LTRIM(RTRIM(f.FILIAL)) ORDER BY valorTotal DESC`);
    const mesRes = await request.query<Record<string, unknown>>(`
        SELECT CONVERT(char(7), f.EMISSAO, 126) AS mes,
               COUNT(*) AS nfs, SUM(f.VALOR_TOTAL) AS valorTotal, SUM(f.QTDE_TOTAL) AS qtde
        FROM FATURAMENTO f WITH (NOLOCK) ${baseWhere}
        GROUP BY CONVERT(char(7), f.EMISSAO, 126) ORDER BY mes`);
    const cliRes = await request.query<Record<string, unknown>>(`
        SELECT TOP 50 LTRIM(RTRIM(f.NOME_CLIFOR)) AS cliente,
               COUNT(*) AS nfs, SUM(f.VALOR_TOTAL) AS valorTotal, SUM(f.QTDE_TOTAL) AS qtde
        FROM FATURAMENTO f WITH (NOLOCK) ${baseWhere}
        GROUP BY LTRIM(RTRIM(f.NOME_CLIFOR)) ORDER BY valorTotal DESC`);

    const t = totRes.recordset?.[0] ?? {};
    return {
      totais: { nfs: num(t.nfs), valorTotal: num(t.valorTotal), qtde: num(t.qtde), desconto: 0 },
      porNatureza: (natRes.recordset ?? []).map((r) => ({
        natureza: str(r.natureza), descNatureza: strOrNull(r.descNatureza),
        nfs: num(r.nfs), valorTotal: num(r.valorTotal), qtde: num(r.qtde),
      })),
      porFilial: (filRes.recordset ?? []).map((r) => ({
        filial: str(r.filial), empresa: r.empresa != null ? num(r.empresa) : null,
        nfs: num(r.nfs), valorTotal: num(r.valorTotal), qtde: num(r.qtde),
      })),
      porMes: (mesRes.recordset ?? []).map((r) => ({
        mes: str(r.mes), nfs: num(r.nfs), valorTotal: num(r.valorTotal), qtde: num(r.qtde),
      })),
      porCliente: (cliRes.recordset ?? []).map((r) => ({
        cliente: str(r.cliente), nfs: num(r.nfs), valorTotal: num(r.valorTotal), qtde: num(r.qtde),
      })),
    };
  });
}

export interface FaturamentoDimensoes {
  filiais: Array<{ filial: string; empresa: number | null; nfs: number }>;
  naturezas: Array<{ codigo: string; descricao: string | null }>;
}

/**
 * Dimensões p/ montar filtros: filiais fiscais que emitiram NF (últimos ~12 meses)
 * e a lista de naturezas de operação de saída ativas.
 */
export async function fetchFaturamentoDimensoes(): Promise<FaturamentoDimensoes> {
  return withRequest(async (request) => {
    const filiaisRes = await request.query<Record<string, unknown>>(`
      SELECT LTRIM(RTRIM(f.FILIAL)) AS filial, MAX(f.EMPRESA) AS empresa, COUNT(*) AS nfs
      FROM FATURAMENTO f WITH (NOLOCK)
      WHERE f.EMISSAO >= DATEADD(month, -12, GETDATE())
      GROUP BY LTRIM(RTRIM(f.FILIAL))
      ORDER BY nfs DESC`);

    const naturezasRes = await request.query<Record<string, unknown>>(`
        SELECT LTRIM(RTRIM(NATUREZA_SAIDA)) AS codigo, LTRIM(RTRIM(DESC_NATUREZA)) AS descricao
        FROM NATUREZAS_SAIDAS WITH (NOLOCK)
        WHERE ISNULL(INATIVO, 0) = 0
        ORDER BY NATUREZA_SAIDA`);

    return {
      filiais: (filiaisRes.recordset ?? []).map((r) => ({
        filial: str(r.filial), empresa: r.empresa != null ? num(r.empresa) : null, nfs: num(r.nfs),
      })),
      naturezas: (naturezasRes.recordset ?? []).map((r) => ({
        codigo: str(r.codigo), descricao: strOrNull(r.descricao),
      })),
    };
  });
}
