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
  searchTerm = ""
): Promise<LogSaidaRow[]> {
  const limitClamp = Math.min(Math.max(limit || 200, 1), 1000);
  const diasClamp = Math.min(Math.max(dias || 30, 1), 365);
  const searchConfig = buildSearchConfig(searchTerm);
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
