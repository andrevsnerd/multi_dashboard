import { withRequest } from "@/lib/db/connection";
import sql from "mssql";

export interface LogSaidaRow {
  romaneio: string;
  filialOrigem: string;
  filialDestino: string;
  filialOrigemCodigo?: string;
  filialDestinoCodigo?: string;
  dataEmissao: string;
  dataDigitacao?: string;
  responsavel: string;
  observacao: string;
  qtdProdutos: number;
  qtdItens: number;
  status: string;
  tipoRomaneio: string;
}

function buildSearchConfig(searchTerm = "") {
  const search = searchTerm.trim();
  if (!search) {
    return {
      hasSearch: false,
      isRomaneioSearch: false,
      like: "",
      exactRomaneio: "",
    };
  }

  const digits = search.replace(/\D/g, "");
  const exactRomaneio = digits ? digits.padStart(6, "0") : search;
  const isRomaneioSearch = digits.length >= 4 && /^[A-Za-z]?\d[\d\s.-]*$/.test(search);

  return {
    hasSearch: true,
    isRomaneioSearch,
    like: `%${search}%`,
    exactRomaneio,
  };
}

export async function fetchLogSaidas(
  limit = 200,
  dias = 90,
  searchTerm = "",
  filiais: string[] = []
): Promise<LogSaidaRow[]> {
  const limitClamp = Math.min(Math.max(limit || 200, 1), 1000);
  const diasClamp = Math.min(Math.max(dias || 30, 1), 365);
  const searchConfig = buildSearchConfig(searchTerm);

  // Filtro de filiais (origem) aplicado DENTRO do SQL, antes do TOP — evita que o teto
  // de linhas seja compartilhado entre empresas (NERD + SCARFME). Match por nome, igual
  // ao filtro da rota (trim + upper; sem colapsar espaço interno, pois config e DB já
  // estão padronizados — ex.: Galeão com 2 espaços).
  const filiaisNorm = Array.from(
    new Set((filiais || []).map((f) => (f || "").trim().toUpperCase()).filter(Boolean))
  );
  const hasFilialFilter = filiaisNorm.length > 0;
  const filialParams = filiaisNorm.map((_, i) => `@fil${i}`).join(", ");
  const filialFilterEstoque = hasFilialFilter
    ? `AND UPPER(LTRIM(RTRIM(ISNULL(es.FILIAL, '')))) IN (${filialParams})`
    : "";
  const filialFilterLoja = hasFilialFilter
    ? `AND UPPER(LTRIM(RTRIM(ISNULL(s.FILIAL, '')))) IN (${filialParams})`
    : "";
  const useDateFilter = !searchConfig.isRomaneioSearch;
  const dateFilterEstoque = useDateFilter
    ? `AND es.EMISSAO >= DATEADD(DAY, -${diasClamp}, GETDATE())`
    : "";
  const dateFilterLoja = useDateFilter
    ? `AND s.EMISSAO >= DATEADD(DAY, -${diasClamp}, GETDATE())`
    : "";
  const searchFilterEstoque = searchConfig.hasSearch
    ? `
          AND (
            LTRIM(RTRIM(es.ROMANEIO_PRODUTO)) = @searchExactRomaneio
            OR LTRIM(RTRIM(es.ROMANEIO_PRODUTO)) LIKE @searchLike
            OR LTRIM(RTRIM(ISNULL(es.FILIAL, ''))) LIKE @searchLike
            OR LTRIM(RTRIM(ISNULL(es.FILIAL_DESTINO, ''))) LIKE @searchLike
            OR LTRIM(RTRIM(ISNULL(fo.FILIAL, ''))) LIKE @searchLike
            OR LTRIM(RTRIM(ISNULL(fd.FILIAL, ''))) LIKE @searchLike
            OR LTRIM(RTRIM(ISNULL(es.RESPONSAVEL, ''))) LIKE @searchLike
            OR LTRIM(RTRIM(ISNULL(es.TIPO_ROMANEIO, ''))) LIKE @searchLike
            OR LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR(MAX), es.OBS), ''))) LIKE @searchLike
          )
        `
    : "";
  const searchFilterLoja = searchConfig.hasSearch
    ? `
          AND (
            LTRIM(RTRIM(s.ROMANEIO_PRODUTO)) = @searchExactRomaneio
            OR LTRIM(RTRIM(s.ROMANEIO_PRODUTO)) LIKE @searchLike
            OR LTRIM(RTRIM(ISNULL(s.FILIAL, ''))) LIKE @searchLike
            OR LTRIM(RTRIM(ISNULL(s.FILIAL_DESTINO, ''))) LIKE @searchLike
            OR LTRIM(RTRIM(ISNULL(fo2.FILIAL, ''))) LIKE @searchLike
            OR LTRIM(RTRIM(ISNULL(fd2.FILIAL, ''))) LIKE @searchLike
            OR LTRIM(RTRIM(ISNULL(s.RESPONSAVEL, ''))) LIKE @searchLike
            OR LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR(MAX), s.OBS), ''))) LIKE @searchLike
          )
        `
    : "";

  const saidas = await withRequest(async (req) => {
    if (searchConfig.hasSearch) {
      req.input("searchLike", sql.VarChar, searchConfig.like);
      req.input("searchExactRomaneio", sql.VarChar, searchConfig.exactRomaneio);
    }
    if (hasFilialFilter) {
      filiaisNorm.forEach((f, i) => req.input(`fil${i}`, sql.VarChar, f));
    }

    const query = `
      SELECT TOP (${limitClamp}) * FROM (
        SELECT
          es.ROMANEIO_PRODUTO,
          es.FILIAL AS FILIAL_ORIGEM,
          LTRIM(RTRIM(ISNULL(es.FILIAL_DESTINO, ''))) AS FILIAL_DESTINO,
          LTRIM(RTRIM(ISNULL(fo.COD_FILIAL, es.FILIAL))) AS FILIAL_ORIGEM_CODIGO,
          LTRIM(RTRIM(ISNULL(fd.COD_FILIAL, es.FILIAL_DESTINO))) AS FILIAL_DESTINO_CODIGO,
          es.EMISSAO,
          es.DATA_DIGITACAO,
          (CONVERT(VARCHAR(10), es.EMISSAO, 120) + 'T' + CONVERT(VARCHAR(8), es.EMISSAO, 108)) AS EMISSAO_STR,
          CASE
            WHEN es.DATA_DIGITACAO IS NOT NULL
            THEN (CONVERT(VARCHAR(10), es.DATA_DIGITACAO, 120) + 'T' + CONVERT(VARCHAR(8), es.DATA_DIGITACAO, 108))
            ELSE NULL
          END AS DATA_DIGITACAO_STR,
          es.RESPONSAVEL,
          ISNULL(es.OBS, '') AS OBS,
          ISNULL(es.TIPO_ROMANEIO, '') AS TIPO_ROMANEIO,
          (SELECT COUNT(*) FROM ESTOQUE_PROD1_SAI ep WITH (NOLOCK)
           WHERE ep.ROMANEIO_PRODUTO = es.ROMANEIO_PRODUTO AND ep.FILIAL = es.FILIAL) AS QTD_PRODUTOS,
          (SELECT ISNULL(SUM(ep.QTDE), 0) FROM ESTOQUE_PROD1_SAI ep WITH (NOLOCK)
           WHERE ep.ROMANEIO_PRODUTO = es.ROMANEIO_PRODUTO AND ep.FILIAL = es.FILIAL) AS QTD_ITENS
        FROM ESTOQUE_PROD_SAI es WITH (NOLOCK)
        LEFT JOIN FILIAIS fo WITH (NOLOCK)
          ON LTRIM(RTRIM(ISNULL(fo.COD_FILIAL, ''))) = LTRIM(RTRIM(ISNULL(es.FILIAL, '')))
          OR LTRIM(RTRIM(ISNULL(fo.FILIAL, ''))) = LTRIM(RTRIM(ISNULL(es.FILIAL, '')))
        LEFT JOIN FILIAIS fd WITH (NOLOCK)
          ON LTRIM(RTRIM(ISNULL(fd.COD_FILIAL, ''))) = LTRIM(RTRIM(ISNULL(es.FILIAL_DESTINO, '')))
          OR LTRIM(RTRIM(ISNULL(fd.FILIAL, ''))) = LTRIM(RTRIM(ISNULL(es.FILIAL_DESTINO, '')))
        WHERE 1 = 1
          ${dateFilterEstoque}
          ${searchFilterEstoque}
          ${filialFilterEstoque}

        UNION ALL

        SELECT
          s.ROMANEIO_PRODUTO,
          s.FILIAL AS FILIAL_ORIGEM,
          LTRIM(RTRIM(ISNULL(s.FILIAL_DESTINO, ''))) AS FILIAL_DESTINO,
          LTRIM(RTRIM(ISNULL(fo2.COD_FILIAL, s.FILIAL))) AS FILIAL_ORIGEM_CODIGO,
          LTRIM(RTRIM(ISNULL(fd2.COD_FILIAL, s.FILIAL_DESTINO))) AS FILIAL_DESTINO_CODIGO,
          s.EMISSAO,
          NULL AS DATA_DIGITACAO,
          (CONVERT(VARCHAR(10), s.EMISSAO, 120) + 'T' + CONVERT(VARCHAR(8), s.EMISSAO, 108)) AS EMISSAO_STR,
          NULL AS DATA_DIGITACAO_STR,
          s.RESPONSAVEL,
          ISNULL(s.OBS, '') AS OBS,
          '' AS TIPO_ROMANEIO,
          ISNULL((
            SELECT COUNT(*) FROM LOJA_SAIDAS_PRODUTO sp WITH (NOLOCK)
            WHERE sp.ROMANEIO_PRODUTO = s.ROMANEIO_PRODUTO AND sp.FILIAL = s.FILIAL
          ), (
            SELECT COUNT(*) FROM ESTOQUE_PROD1_SAI ep WITH (NOLOCK)
            WHERE ep.ROMANEIO_PRODUTO = s.ROMANEIO_PRODUTO AND ep.FILIAL = s.FILIAL
          )) AS QTD_PRODUTOS,
          ISNULL((
            SELECT ISNULL(SUM(sp.QTDE_SAIDA), 0) FROM LOJA_SAIDAS_PRODUTO sp WITH (NOLOCK)
            WHERE sp.ROMANEIO_PRODUTO = s.ROMANEIO_PRODUTO AND sp.FILIAL = s.FILIAL
          ), (
            SELECT ISNULL(SUM(ep.QTDE), 0) FROM ESTOQUE_PROD1_SAI ep WITH (NOLOCK)
            WHERE ep.ROMANEIO_PRODUTO = s.ROMANEIO_PRODUTO AND ep.FILIAL = s.FILIAL
          )) AS QTD_ITENS
        FROM LOJA_SAIDAS s WITH (NOLOCK)
        LEFT JOIN FILIAIS fo2 WITH (NOLOCK)
          ON LTRIM(RTRIM(ISNULL(fo2.COD_FILIAL, ''))) = LTRIM(RTRIM(ISNULL(s.FILIAL, '')))
          OR LTRIM(RTRIM(ISNULL(fo2.FILIAL, ''))) = LTRIM(RTRIM(ISNULL(s.FILIAL, '')))
        LEFT JOIN FILIAIS fd2 WITH (NOLOCK)
          ON LTRIM(RTRIM(ISNULL(fd2.COD_FILIAL, ''))) = LTRIM(RTRIM(ISNULL(s.FILIAL_DESTINO, '')))
          OR LTRIM(RTRIM(ISNULL(fd2.FILIAL, ''))) = LTRIM(RTRIM(ISNULL(s.FILIAL_DESTINO, '')))
        WHERE NOT EXISTS (
          SELECT 1 FROM ESTOQUE_PROD_SAI es2 WITH (NOLOCK)
          WHERE es2.ROMANEIO_PRODUTO = s.ROMANEIO_PRODUTO
            AND LTRIM(RTRIM(ISNULL(es2.FILIAL, ''))) = LTRIM(RTRIM(ISNULL(s.FILIAL, '')))
        )
        AND (s.SAIDA_CANCELADA = 0 OR s.SAIDA_CANCELADA IS NULL)
        ${dateFilterLoja}
        ${searchFilterLoja}
        ${filialFilterLoja}
      ) AS unificado
      ORDER BY EMISSAO DESC, ROMANEIO_PRODUTO DESC
    `;

    const result = await req.query<{
      ROMANEIO_PRODUTO: string;
      FILIAL_ORIGEM: string;
      FILIAL_DESTINO: string | null;
      FILIAL_ORIGEM_CODIGO: string | null;
      FILIAL_DESTINO_CODIGO: string | null;
      EMISSAO: Date;
      DATA_DIGITACAO: Date | null;
      EMISSAO_STR: string;
      DATA_DIGITACAO_STR: string | null;
      RESPONSAVEL: string | null;
      OBS: string | null;
      QTD_PRODUTOS: number;
      QTD_ITENS: number;
      TIPO_ROMANEIO: string | null;
    }>(query);

    const rows = result.recordset;
    return rows.map((row) => ({
      romaneio: row.ROMANEIO_PRODUTO?.toString().trim() || "",
      filialOrigem: row.FILIAL_ORIGEM?.toString().trim() || "",
      filialDestino: row.FILIAL_DESTINO?.toString().trim() || "—",
      filialOrigemCodigo: row.FILIAL_ORIGEM_CODIGO?.toString().trim() || "",
      filialDestinoCodigo: row.FILIAL_DESTINO_CODIGO?.toString().trim() || "",
      dataEmissao:
        row.EMISSAO_STR != null && String(row.EMISSAO_STR).trim() !== ""
          ? String(row.EMISSAO_STR).trim()
          : row.EMISSAO
            ? new Date(row.EMISSAO).toISOString()
            : "",
      dataDigitacao:
        row.DATA_DIGITACAO_STR != null && String(row.DATA_DIGITACAO_STR).trim() !== ""
          ? String(row.DATA_DIGITACAO_STR).trim()
          : row.DATA_DIGITACAO
            ? new Date(row.DATA_DIGITACAO).toISOString()
            : undefined,
      responsavel: row.RESPONSAVEL?.toString().trim() || "",
      observacao: row.OBS?.toString().trim() || "",
      qtdProdutos: row.QTD_PRODUTOS || 0,
      qtdItens: row.QTD_ITENS || 0,
      status: "Concluída",
      tipoRomaneio: row.TIPO_ROMANEIO?.toString().trim() || "",
    }));
  });

  return saidas;
}

export interface DefeitoItem {
  produto: string;
  descricao: string;
  cor?: string;
  corCodigo?: string;
  filialOrigem: string;
  quantidade: number;
  /** Preço de venda sugerido cadastrado (PRODUTOS.PRECO_REPOSICAO_1). */
  precoSugerido: number;
  /** quantidade × precoSugerido. */
  valorSugerido: number;
}

export interface DefeitosResult {
  itens: DefeitoItem[];
  totalQuantidade: number;
  totalValor: number;
  /** Linhas (produto×cor[×filial]) distintas com defeito — pode exceder os itens listados. */
  totalItens: number;
  itensListados: number;
}

export interface DefeitosParams {
  /** Filiais de ORIGEM válidas da empresa (escopo inventory) — evita vazar entre empresas. */
  filiaisOrigem: string[];
  /** Nome da filial de DESTINO de defeito (ex.: "NERD DEFEITOS", "BAZAR SCARF ME"). */
  defeitoFilialDestino: string;
  range: { start: Date; end: Date };
  /** Restringe a UMA filial de origem (loja). */
  filialOrigem?: string | null;
  /** Filtra pelo responsável do romaneio (quem registrou) — LIKE. */
  responsavel?: string;
  produtoId?: string;
  produtoSearchTerm?: string;
  /** Quebra por cor (padrão true → uma linha por produto×cor). */
  porCor?: boolean;
  limit?: number;
}

/**
 * Itens enviados para DEFEITO (ex.: filial "NERD DEFEITOS" / "BAZAR SCARF ME") —
 * romaneios de SAÍDA com tipo "DEFEITO" OU destino na filial de defeito. Agrega por
 * produto×cor (por padrão) trazendo quantidade, preço sugerido (PRECO_REPOSICAO_1) e
 * valor sugerido (qtd × preço). Devolve também os totais (quantidade e valor) do
 * recorte inteiro, sem o teto da lista. Filtros: filial de origem (loja), responsável,
 * produto/busca. Fonte: ESTOQUE_PROD_SAI + ESTOQUE_PROD1_SAI.
 */
export async function fetchDefeitos(params: DefeitosParams): Promise<DefeitosResult> {
  const {
    filiaisOrigem,
    defeitoFilialDestino,
    range,
    filialOrigem,
    responsavel,
    produtoId,
    produtoSearchTerm,
    porCor = true,
    limit = 200,
  } = params;

  const destino = (defeitoFilialDestino || "").trim().toUpperCase();
  const escopo = Array.from(
    new Set((filiaisOrigem || []).map((f) => (f || "").trim().toUpperCase()).filter(Boolean))
  );
  const topClamp = Math.min(Math.max(limit || 200, 1), 1000);

  return withRequest(async (req) => {
    req.input("startDate", sql.DateTime, range.start);
    req.input("endDate", sql.DateTime, range.end);
    req.input("defeitoDestino", sql.VarChar, destino);

    // Escopo de origem (empresa). Sem escopo, não filtra por empresa (evita resultado vazio indevido).
    let escopoFilter = "";
    if (escopo.length > 0) {
      escopo.forEach((f, i) => req.input(`org${i}`, sql.VarChar, f));
      escopoFilter = `AND UPPER(LTRIM(RTRIM(ISNULL(s.FILIAL, '')))) IN (${escopo.map((_, i) => `@org${i}`).join(", ")})`;
    }

    let filialOrigemFilter = "";
    if (filialOrigem && filialOrigem.trim()) {
      req.input("filialOrigem", sql.VarChar, filialOrigem.trim().toUpperCase());
      filialOrigemFilter = `AND UPPER(LTRIM(RTRIM(ISNULL(s.FILIAL, '')))) = @filialOrigem`;
    }

    let responsavelFilter = "";
    if (responsavel && responsavel.trim()) {
      req.input("responsavel", sql.VarChar, `%${responsavel.trim()}%`);
      responsavelFilter = `AND LTRIM(RTRIM(ISNULL(s.RESPONSAVEL, ''))) LIKE @responsavel`;
    }

    let produtoFilter = "";
    if (produtoId && produtoId.trim()) {
      req.input("produtoId", sql.VarChar, produtoId.trim());
      produtoFilter = "AND p.PRODUTO = @produtoId";
    } else if ((produtoSearchTerm?.trim() ?? "").length >= 2) {
      req.input("produtoSearch", sql.VarChar, `%${(produtoSearchTerm ?? "").trim()}%`);
      produtoFilter = "AND pr.DESC_PRODUTO LIKE @produtoSearch";
    }

    const defeitoCondicao = `
      AND (
        UPPER(LTRIM(RTRIM(ISNULL(s.TIPO_ROMANEIO, '')))) = 'DEFEITO'
        OR UPPER(LTRIM(RTRIM(ISNULL(s.FILIAL_DESTINO, '')))) = @defeitoDestino
      )`;

    const precoSugeridoExpr =
      "CASE WHEN pr.PRECO_REPOSICAO_1 IS NULL OR pr.PRECO_REPOSICAO_1 = 0 THEN 0 ELSE CAST(pr.PRECO_REPOSICAO_1 AS DECIMAL(18,2)) END";

    const whereCommon = `
      WHERE s.EMISSAO >= @startDate
        AND s.EMISSAO < @endDate
        ${defeitoCondicao}
        ${escopoFilter}
        ${filialOrigemFilter}
        ${responsavelFilter}
        ${produtoFilter}
    `;

    const fromCommon = `
      FROM ESTOQUE_PROD_SAI s WITH (NOLOCK)
      JOIN ESTOQUE_PROD1_SAI p WITH (NOLOCK)
        ON s.ROMANEIO_PRODUTO = p.ROMANEIO_PRODUTO
        AND LTRIM(RTRIM(ISNULL(s.FILIAL, ''))) = LTRIM(RTRIM(ISNULL(p.FILIAL, '')))
      LEFT JOIN PRODUTOS pr WITH (NOLOCK) ON pr.PRODUTO = p.PRODUTO
    `;

    // Totais do recorte inteiro (sem teto de linhas).
    const totalQuery = `
      SELECT
        SUM(ISNULL(p.QTDE, 0)) AS totalQuantidade,
        SUM(ISNULL(p.QTDE, 0) * (${precoSugeridoExpr})) AS totalValor,
        COUNT(*) AS linhas
      ${fromCommon}
      ${whereCommon}
    `;

    const corCodigoSelect = porCor ? "p.COR_PRODUTO AS corCodigo," : "'' AS corCodigo,";
    const corDescSelect = porCor ? "MAX(ISNULL(c.DESC_COR, '')) AS cor," : "'' AS cor,";
    const groupBy = porCor ? "p.PRODUTO, p.COR_PRODUTO" : "p.PRODUTO";

    const listQuery = `
      SELECT TOP (${topClamp})
        p.PRODUTO AS produto,
        MAX(ISNULL(pr.DESC_PRODUTO, '')) AS descricao,
        ${corCodigoSelect}
        ${corDescSelect}
        MAX(LTRIM(RTRIM(ISNULL(s.FILIAL, '')))) AS filialOrigem,
        SUM(ISNULL(p.QTDE, 0)) AS quantidade,
        MAX(${precoSugeridoExpr}) AS precoSugerido
      ${fromCommon}
      ${porCor ? `LEFT JOIN (
        SELECT PRODUTO, COR_PRODUTO, MAX(DESC_COR_PRODUTO) AS DESC_COR
        FROM PRODUTO_CORES WITH (NOLOCK)
        GROUP BY PRODUTO, COR_PRODUTO
      ) c ON RTRIM(LTRIM(c.PRODUTO)) = RTRIM(LTRIM(p.PRODUTO))
         AND (RTRIM(LTRIM(CAST(c.COR_PRODUTO AS VARCHAR(20)))) = RTRIM(LTRIM(CAST(p.COR_PRODUTO AS VARCHAR(20)))) OR TRY_CONVERT(INT, c.COR_PRODUTO) = TRY_CONVERT(INT, p.COR_PRODUTO))` : ""}
      ${whereCommon}
      GROUP BY ${groupBy}
      ORDER BY quantidade DESC
    `;

    const totalResult = await req.query<{
      totalQuantidade: number | null;
      totalValor: number | null;
      linhas: number | null;
    }>(totalQuery);

    const listResult = await req.query<{
      produto: string;
      descricao: string;
      corCodigo: string;
      cor: string;
      filialOrigem: string;
      quantidade: number | null;
      precoSugerido: number | null;
    }>(listQuery);

    const totalRow = totalResult.recordset[0];
    const itens: DefeitoItem[] = listResult.recordset.map((row) => {
      const quantidade = Number(row.quantidade ?? 0);
      const precoSugerido = Number(row.precoSugerido ?? 0);
      return {
        produto: (row.produto ?? "").trim(),
        descricao: row.descricao?.trim() || "SEM DESCRIÇÃO",
        cor: row.cor?.trim() || undefined,
        corCodigo: row.corCodigo?.trim() || undefined,
        filialOrigem: row.filialOrigem?.trim() || "",
        quantidade,
        precoSugerido,
        valorSugerido: Number((quantidade * precoSugerido).toFixed(2)),
      };
    });

    return {
      itens,
      totalQuantidade: Number(totalRow?.totalQuantidade ?? 0),
      totalValor: Number(totalRow?.totalValor ?? 0),
      totalItens: Number(totalRow?.linhas ?? 0),
      itensListados: itens.length,
    };
  });
}
