import { withRequest } from "@/lib/db/connection";
import sql from "mssql";

export interface LogEntradaRow {
  romaneio: string;
  filialOrigem: string;
  filialDestino: string;
  dataEmissao: string;
  dataDigitacao?: string;
  tipoRomaneio: string;
  responsavel: string;
  observacao: string;
  qtdProdutos: number;
  qtdItens: number;
  status: string;
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

export async function fetchLogEntradas(
  limit = 200,
  dias = 90,
  searchTerm = ""
): Promise<LogEntradaRow[]> {
  const limitClamp = Math.min(Math.max(limit || 200, 1), 1000);
  const diasClamp = Math.min(Math.max(dias || 30, 1), 365);
  const searchConfig = buildSearchConfig(searchTerm);
  const useDateFilter = !searchConfig.isRomaneioSearch;
  const dateFilterEstoque = useDateFilter
    ? `AND e.EMISSAO >= DATEADD(DAY, -${diasClamp}, GETDATE())`
    : "";
  const dateFilterLoja = useDateFilter
    ? `AND le.EMISSAO >= DATEADD(DAY, -${diasClamp}, GETDATE())`
    : "";

  const searchFilterEstoque = searchConfig.hasSearch
    ? `
          AND (
            LTRIM(RTRIM(e.ROMANEIO_PRODUTO)) = @searchExactRomaneio
            OR LTRIM(RTRIM(e.ROMANEIO_PRODUTO)) LIKE @searchLike
            OR LTRIM(RTRIM(ISNULL(e.ROMANEIO_ORIGEM, ''))) = @searchExactRomaneio
            OR LTRIM(RTRIM(ISNULL(e.ROMANEIO_ORIGEM, ''))) LIKE @searchLike
            OR LTRIM(RTRIM(ISNULL(e.FILIAL, ''))) LIKE @searchLike
            OR LTRIM(RTRIM(ISNULL(e.FILIAL_ORIGEM, ''))) LIKE @searchLike
            OR LTRIM(RTRIM(ISNULL(fd.FILIAL, ''))) LIKE @searchLike
            OR LTRIM(RTRIM(ISNULL(fo.FILIAL, ''))) LIKE @searchLike
            OR LTRIM(RTRIM(ISNULL(e.RESPONSAVEL, ''))) LIKE @searchLike
            OR LTRIM(RTRIM(ISNULL(e.TIPO_ROMANEIO, ''))) LIKE @searchLike
            OR LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR(MAX), e.OBS), ''))) LIKE @searchLike
          )
        `
    : "";

  const searchFilterLoja = searchConfig.hasSearch
    ? `
          AND (
            LTRIM(RTRIM(le.ROMANEIO_PRODUTO)) = @searchExactRomaneio
            OR LTRIM(RTRIM(le.ROMANEIO_PRODUTO)) LIKE @searchLike
            OR LTRIM(RTRIM(ISNULL(le.FILIAL, ''))) LIKE @searchLike
            OR LTRIM(RTRIM(ISNULL(le.FILIAL_ORIGEM, ''))) LIKE @searchLike
            OR LTRIM(RTRIM(ISNULL(le.ROMANEIO_NF_SAIDA, ''))) = @searchExactRomaneio
            OR LTRIM(RTRIM(ISNULL(le.ROMANEIO_NF_SAIDA, ''))) LIKE @searchLike
            OR LTRIM(RTRIM(ISNULL(fd2.FILIAL, ''))) LIKE @searchLike
            OR LTRIM(RTRIM(ISNULL(fo2.FILIAL, ''))) LIKE @searchLike
            OR LTRIM(RTRIM(ISNULL(le.RESPONSAVEL, ''))) LIKE @searchLike
            OR LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR(MAX), le.OBS), ''))) LIKE @searchLike
          )
        `
    : "";

  const entradas = await withRequest(async (req) => {
    if (searchConfig.hasSearch) {
      req.input("searchLike", sql.VarChar, searchConfig.like);
      req.input("searchExactRomaneio", sql.VarChar, searchConfig.exactRomaneio);
    }

    const query = `
      SELECT TOP (${limitClamp}) * FROM (
        SELECT
          e.ROMANEIO_PRODUTO,
          e.FILIAL AS FILIAL_DESTINO,
          LTRIM(RTRIM(ISNULL(e.FILIAL_ORIGEM, ''))) AS FILIAL_ORIGEM,
          e.EMISSAO,
          e.DATA_DIGITACAO,
          (CONVERT(VARCHAR(10), e.EMISSAO, 120) + 'T' + CONVERT(VARCHAR(8), e.EMISSAO, 108)) AS EMISSAO_STR,
          CASE
            WHEN e.DATA_DIGITACAO IS NOT NULL
            THEN (CONVERT(VARCHAR(10), e.DATA_DIGITACAO, 120) + 'T' + CONVERT(VARCHAR(8), e.DATA_DIGITACAO, 108))
            ELSE NULL
          END AS DATA_DIGITACAO_STR,
          e.TIPO_ROMANEIO,
          e.RESPONSAVEL,
          ISNULL(e.OBS, '') AS OBS,
          CAST(NULL AS INT) AS STATUS_TRANSITO,
          CAST('' AS VARCHAR(30)) AS ROMANEIO_NF_SAIDA,
          (SELECT COUNT(*) FROM ESTOQUE_PROD1_ENT ep WITH (NOLOCK)
           WHERE ep.ROMANEIO_PRODUTO = e.ROMANEIO_PRODUTO AND ep.FILIAL = e.FILIAL) AS QTD_PRODUTOS,
          (SELECT ISNULL(SUM(ep.QTDE), 0) FROM ESTOQUE_PROD1_ENT ep WITH (NOLOCK)
           WHERE ep.ROMANEIO_PRODUTO = e.ROMANEIO_PRODUTO AND ep.FILIAL = e.FILIAL) AS QTD_ITENS
        FROM ESTOQUE_PROD_ENT e WITH (NOLOCK)
        LEFT JOIN FILIAIS fd WITH (NOLOCK)
          ON LTRIM(RTRIM(ISNULL(fd.COD_FILIAL, ''))) = LTRIM(RTRIM(ISNULL(e.FILIAL, '')))
          OR LTRIM(RTRIM(ISNULL(fd.FILIAL, ''))) = LTRIM(RTRIM(ISNULL(e.FILIAL, '')))
        LEFT JOIN FILIAIS fo WITH (NOLOCK)
          ON LTRIM(RTRIM(ISNULL(fo.COD_FILIAL, ''))) = LTRIM(RTRIM(ISNULL(e.FILIAL_ORIGEM, '')))
          OR LTRIM(RTRIM(ISNULL(fo.FILIAL, ''))) = LTRIM(RTRIM(ISNULL(e.FILIAL_ORIGEM, '')))
        WHERE 1 = 1
          ${dateFilterEstoque}
          ${searchFilterEstoque}

        UNION ALL

        SELECT
          le.ROMANEIO_PRODUTO,
          le.FILIAL AS FILIAL_DESTINO,
          LTRIM(RTRIM(ISNULL(le.FILIAL_ORIGEM, ''))) AS FILIAL_ORIGEM,
          le.EMISSAO,
          NULL AS DATA_DIGITACAO,
          (CONVERT(VARCHAR(10), le.EMISSAO, 120) + 'T' + CONVERT(VARCHAR(8), le.EMISSAO, 108)) AS EMISSAO_STR,
          NULL AS DATA_DIGITACAO_STR,
          NULL AS TIPO_ROMANEIO,
          le.RESPONSAVEL,
          ISNULL(le.OBS, '') AS OBS,
          le.STATUS_TRANSITO,
          LTRIM(RTRIM(ISNULL(le.ROMANEIO_NF_SAIDA, ''))) AS ROMANEIO_NF_SAIDA,
          (SELECT COUNT(*) FROM LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
           WHERE lep.ROMANEIO_PRODUTO = le.ROMANEIO_PRODUTO AND lep.FILIAL = le.FILIAL) AS QTD_PRODUTOS,
          (SELECT ISNULL(SUM(ISNULL(lep.QTDE_ENTRADA, 0)), 0) FROM LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
           WHERE lep.ROMANEIO_PRODUTO = le.ROMANEIO_PRODUTO AND lep.FILIAL = le.FILIAL) AS QTD_ITENS
        FROM LOJA_ENTRADAS le WITH (NOLOCK)
        LEFT JOIN FILIAIS fd2 WITH (NOLOCK)
          ON LTRIM(RTRIM(ISNULL(fd2.COD_FILIAL, ''))) = LTRIM(RTRIM(ISNULL(le.FILIAL, '')))
          OR LTRIM(RTRIM(ISNULL(fd2.FILIAL, ''))) = LTRIM(RTRIM(ISNULL(le.FILIAL, '')))
        LEFT JOIN FILIAIS fo2 WITH (NOLOCK)
          ON LTRIM(RTRIM(ISNULL(fo2.COD_FILIAL, ''))) = LTRIM(RTRIM(ISNULL(le.FILIAL_ORIGEM, '')))
          OR LTRIM(RTRIM(ISNULL(fo2.FILIAL, ''))) = LTRIM(RTRIM(ISNULL(le.FILIAL_ORIGEM, '')))
        WHERE NOT EXISTS (
          SELECT 1 FROM ESTOQUE_PROD_ENT ee WITH (NOLOCK)
          WHERE ee.ROMANEIO_PRODUTO = le.ROMANEIO_PRODUTO
            AND LTRIM(RTRIM(ISNULL(ee.FILIAL, ''))) = LTRIM(RTRIM(ISNULL(le.FILIAL, '')))
        )
        AND (le.ENTRADA_CANCELADA = 0 OR le.ENTRADA_CANCELADA IS NULL)
        ${dateFilterLoja}
        ${searchFilterLoja}
      ) AS unificado
      ORDER BY EMISSAO DESC, ROMANEIO_PRODUTO DESC
    `;

    const result = await req.query<{
      ROMANEIO_PRODUTO: string;
      FILIAL_DESTINO: string;
      FILIAL_ORIGEM: string | null;
      EMISSAO: Date;
      DATA_DIGITACAO: Date | null;
      EMISSAO_STR: string;
      DATA_DIGITACAO_STR: string | null;
      TIPO_ROMANEIO: string | null;
      RESPONSAVEL: string | null;
      OBS: string | null;
      STATUS_TRANSITO: number | null;
      ROMANEIO_NF_SAIDA: string | null;
      QTD_PRODUTOS: number;
      QTD_ITENS: number | null;
    }>(query);

    return result.recordset.map((row) => {
      const possuiVinculoTransito =
        (row.FILIAL_ORIGEM?.toString().trim() || "") !== "" &&
        (row.ROMANEIO_NF_SAIDA?.toString().trim() || "") !== "";
      const statusTransito = row.STATUS_TRANSITO == null ? null : Number(row.STATUS_TRANSITO);

      return {
        romaneio: row.ROMANEIO_PRODUTO?.toString().trim() || "",
        filialOrigem: row.FILIAL_ORIGEM?.toString().trim() || "",
        filialDestino: row.FILIAL_DESTINO?.toString().trim() || "",
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
        tipoRomaneio: row.TIPO_ROMANEIO?.toString().trim() || "",
        responsavel: row.RESPONSAVEL?.toString().trim() || "",
        observacao: row.OBS?.toString().trim() || "",
        qtdProdutos: row.QTD_PRODUTOS || 0,
        qtdItens: row.QTD_ITENS ?? 0,
        status: possuiVinculoTransito && statusTransito === 4 ? "Transito liberado" : "Concluida",
      };
    });
  });

  return entradas;
}
