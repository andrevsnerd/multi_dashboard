import { withRequest } from "@/lib/db/connection";
import sql from "mssql";

export interface LogTransitoRow {
  romaneio: string;
  filialOrigem: string;
  filialDestino: string;
  dataEmissao: string;
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

export async function fetchLogTransito(
  limit = 200,
  dias = 3650,
  searchTerm = ""
): Promise<LogTransitoRow[]> {
  const limitClamp = Math.min(Math.max(limit || 200, 1), 1000);
  const diasClamp = Math.min(Math.max(dias || 3650, 1), 3650);
  const searchConfig = buildSearchConfig(searchTerm);
  const useDateFilter = !searchConfig.isRomaneioSearch && diasClamp < 3650;
  const dateFilter = useDateFilter
    ? `AND le.EMISSAO >= DATEADD(DAY, -${diasClamp}, GETDATE())`
    : "";
  const searchFilter = searchConfig.hasSearch
    ? `
        AND (
          LTRIM(RTRIM(le.ROMANEIO_PRODUTO)) = @searchExactRomaneio
          OR LTRIM(RTRIM(le.ROMANEIO_PRODUTO)) LIKE @searchLike
          OR LTRIM(RTRIM(ISNULL(le.ROMANEIO_NF_SAIDA, ''))) = @searchExactRomaneio
          OR LTRIM(RTRIM(ISNULL(le.ROMANEIO_NF_SAIDA, ''))) LIKE @searchLike
          OR LTRIM(RTRIM(ISNULL(le.FILIAL, ''))) LIKE @searchLike
          OR LTRIM(RTRIM(ISNULL(le.FILIAL_ORIGEM, ''))) LIKE @searchLike
          OR LTRIM(RTRIM(ISNULL(fd.FILIAL, ''))) LIKE @searchLike
          OR LTRIM(RTRIM(ISNULL(fo.FILIAL, ''))) LIKE @searchLike
          OR LTRIM(RTRIM(ISNULL(le.RESPONSAVEL, ''))) LIKE @searchLike
          OR LTRIM(RTRIM(ISNULL(ls.RESPONSAVEL, ''))) LIKE @searchLike
          OR LTRIM(RTRIM(ISNULL(es.RESPONSAVEL, ''))) LIKE @searchLike
          OR LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR(MAX), le.OBS), ''))) LIKE @searchLike
        )
      `
    : "";

  const transitos = await withRequest(async (req) => {
    if (searchConfig.hasSearch) {
      req.input("searchLike", sql.VarChar, searchConfig.like);
      req.input("searchExactRomaneio", sql.VarChar, searchConfig.exactRomaneio);
    }

    const query = `
      SELECT TOP (${limitClamp})
        le.ROMANEIO_PRODUTO,
        LTRIM(RTRIM(ISNULL(le.FILIAL_ORIGEM, ''))) AS FILIAL_ORIGEM,
        LTRIM(RTRIM(ISNULL(le.FILIAL, ''))) AS FILIAL_DESTINO,
        le.EMISSAO,
        (CONVERT(VARCHAR(10), le.EMISSAO, 120) + 'T' + CONVERT(VARCHAR(8), le.EMISSAO, 108)) AS EMISSAO_STR,
        ISNULL(NULLIF(LTRIM(RTRIM(le.DESC_TIPO_ENTRADA_SAIDA)), ''), 'FATURAMENTO EM TRANSITO') AS TIPO_ROMANEIO,
        COALESCE(
          NULLIF(LTRIM(RTRIM(ISNULL(le.RESPONSAVEL, ''))), ''),
          NULLIF(LTRIM(RTRIM(ISNULL(ls.RESPONSAVEL, ''))), ''),
          NULLIF(LTRIM(RTRIM(ISNULL(es.RESPONSAVEL, ''))), ''),
          ''
        ) AS RESPONSAVEL,
        ISNULL(CONVERT(VARCHAR(MAX), le.OBS), '') AS OBS,
        (SELECT COUNT(*) FROM LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
         WHERE lep.ROMANEIO_PRODUTO = le.ROMANEIO_PRODUTO AND lep.FILIAL = le.FILIAL) AS QTD_PRODUTOS,
        (SELECT ISNULL(SUM(ISNULL(lep.QTDE_ENTRADA, 0)), 0) FROM LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
         WHERE lep.ROMANEIO_PRODUTO = le.ROMANEIO_PRODUTO AND lep.FILIAL = le.FILIAL) AS QTD_ITENS
      FROM LOJA_ENTRADAS le WITH (NOLOCK)
      LEFT JOIN FILIAIS fd WITH (NOLOCK)
        ON LTRIM(RTRIM(ISNULL(fd.COD_FILIAL, ''))) = LTRIM(RTRIM(ISNULL(le.FILIAL, '')))
        OR LTRIM(RTRIM(ISNULL(fd.FILIAL, ''))) = LTRIM(RTRIM(ISNULL(le.FILIAL, '')))
      LEFT JOIN FILIAIS fo WITH (NOLOCK)
        ON LTRIM(RTRIM(ISNULL(fo.COD_FILIAL, ''))) = LTRIM(RTRIM(ISNULL(le.FILIAL_ORIGEM, '')))
        OR LTRIM(RTRIM(ISNULL(fo.FILIAL, ''))) = LTRIM(RTRIM(ISNULL(le.FILIAL_ORIGEM, '')))
      LEFT JOIN LOJA_SAIDAS ls WITH (NOLOCK)
        ON LTRIM(RTRIM(ISNULL(ls.ROMANEIO_PRODUTO, ''))) = LTRIM(RTRIM(ISNULL(le.ROMANEIO_NF_SAIDA, '')))
       AND LTRIM(RTRIM(ISNULL(ls.FILIAL, ''))) = LTRIM(RTRIM(ISNULL(le.FILIAL_ORIGEM, '')))
      LEFT JOIN ESTOQUE_PROD_SAI es WITH (NOLOCK)
        ON LTRIM(RTRIM(ISNULL(es.ROMANEIO_PRODUTO, ''))) = LTRIM(RTRIM(ISNULL(le.ROMANEIO_NF_SAIDA, '')))
       AND LTRIM(RTRIM(ISNULL(es.FILIAL, ''))) = LTRIM(RTRIM(ISNULL(le.FILIAL_ORIGEM, '')))
      WHERE ISNULL(le.ENTRADA_CANCELADA, 0) = 0
        AND ISNULL(LTRIM(RTRIM(le.FILIAL_ORIGEM)), '') <> ''
        AND (
          ISNULL(LTRIM(RTRIM(le.ROMANEIO_NF_SAIDA)), '') <> ''
          OR EXISTS (
            SELECT 1 FROM LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
            WHERE lep.ROMANEIO_PRODUTO = le.ROMANEIO_PRODUTO
              AND lep.FILIAL = le.FILIAL
          )
        )
        AND (
          le.STATUS_TRANSITO IS NULL
          OR le.STATUS_TRANSITO < 4
          OR ISNULL(le.ENTRADA_ENCERRADA, 0) = 0
        )
        AND EXISTS (
          SELECT 1 FROM LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
          WHERE lep.ROMANEIO_PRODUTO = le.ROMANEIO_PRODUTO
            AND lep.FILIAL = le.FILIAL
        )
        ${dateFilter}
        ${searchFilter}
      ORDER BY le.EMISSAO DESC, le.ROMANEIO_PRODUTO DESC
    `;

    const result = await req.query<{
      ROMANEIO_PRODUTO: string;
      FILIAL_ORIGEM: string;
      FILIAL_DESTINO: string;
      EMISSAO: Date;
      EMISSAO_STR: string;
      TIPO_ROMANEIO: string;
      RESPONSAVEL: string | null;
      OBS: string | null;
      QTD_PRODUTOS: number;
      QTD_ITENS: number | null;
    }>(query);

    return result.recordset.map((row) => ({
      romaneio: row.ROMANEIO_PRODUTO?.toString().trim() || "",
      filialOrigem: row.FILIAL_ORIGEM?.toString().trim() || "",
      filialDestino: row.FILIAL_DESTINO?.toString().trim() || "",
      dataEmissao:
        row.EMISSAO_STR != null && String(row.EMISSAO_STR).trim() !== ""
          ? String(row.EMISSAO_STR).trim()
          : row.EMISSAO
            ? new Date(row.EMISSAO).toISOString()
            : "",
      tipoRomaneio: row.TIPO_ROMANEIO?.toString().trim() || "FATURAMENTO EM TRANSITO",
      responsavel: row.RESPONSAVEL?.toString().trim() || "",
      observacao: row.OBS?.toString().trim() || "",
      qtdProdutos: row.QTD_PRODUTOS || 0,
      qtdItens: row.QTD_ITENS ?? 0,
      status: "Em trânsito",
    }));
  });

  return transitos;
}
