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

export interface ProductEntryRow {
  romaneio: string;
  filialOrigem: string;
  filialDestino: string;
  dataEmissao: string;
  tipoRomaneio: string;
  responsavel: string;
  /** Quantidade DESTE produto recebida no romaneio (somada entre cores/grades). */
  qtde: number;
  /** Custo unitário médio do produto nessa entrada (0 quando indisponível). */
  custoUnitario: number;
  /** Origem do registro: 'estoque' (ESTOQUE_PROD_ENT) ou 'loja' (LOJA_ENTRADAS). */
  fonte: "estoque" | "loja";
}

/**
 * Lista as entradas (romaneios de recebimento) de UM produto específico, unindo
 * as duas fontes — ESTOQUE_PROD_ENT/ESTOQUE_PROD1_ENT e LOJA_ENTRADAS/
 * LOJA_ENTRADAS_PRODUTO (esta última só quando o romaneio não existe na primeira,
 * igual à listagem geral) — agregadas por documento (romaneio + filial). Cada
 * linha traz o nº do romaneio, filiais, data, tipo, responsável, quantidade
 * recebida do produto e custo unitário médio. Ordenado da entrada mais recente
 * para a mais antiga.
 */
export async function fetchProductEntries(
  productId: string,
  limit = 50,
  filiais: string[] = [],
  dias?: number
): Promise<ProductEntryRow[]> {
  const produto = (productId || "").trim();
  if (!produto) return [];

  const limitClamp = Math.min(Math.max(limit || 50, 1), 1000);

  const filiaisNorm = Array.from(
    new Set((filiais || []).map((f) => (f || "").trim().toUpperCase()).filter(Boolean))
  );
  const hasFilialFilter = filiaisNorm.length > 0;
  const filialParams = filiaisNorm.map((_, i) => `@pfil${i}`).join(", ");
  const filialFilterEstoque = hasFilialFilter
    ? `AND UPPER(LTRIM(RTRIM(ISNULL(e.FILIAL, '')))) IN (${filialParams})`
    : "";
  const filialFilterLoja = hasFilialFilter
    ? `AND UPPER(LTRIM(RTRIM(ISNULL(le.FILIAL, '')))) IN (${filialParams})`
    : "";

  const useDateFilter = typeof dias === "number" && dias > 0;
  const diasClamp = useDateFilter ? Math.min(Math.max(dias as number, 1), 365) : 0;
  const dateFilterEstoque = useDateFilter
    ? `AND e.EMISSAO >= DATEADD(DAY, -${diasClamp}, GETDATE())`
    : "";
  const dateFilterLoja = useDateFilter
    ? `AND le.EMISSAO >= DATEADD(DAY, -${diasClamp}, GETDATE())`
    : "";

  return withRequest(async (req) => {
    req.input("produtoId", sql.VarChar, produto);
    if (hasFilialFilter) {
      filiaisNorm.forEach((f, i) => req.input(`pfil${i}`, sql.VarChar, f));
    }

    const query = `
      SELECT TOP (${limitClamp}) * FROM (
        SELECT
          e.ROMANEIO_PRODUTO,
          e.FILIAL AS FILIAL_DESTINO,
          LTRIM(RTRIM(ISNULL(e.FILIAL_ORIGEM, ''))) AS FILIAL_ORIGEM,
          MAX(e.EMISSAO) AS EMISSAO,
          (CONVERT(VARCHAR(10), MAX(e.EMISSAO), 120) + 'T' + CONVERT(VARCHAR(8), MAX(e.EMISSAO), 108)) AS EMISSAO_STR,
          MAX(ISNULL(e.TIPO_ROMANEIO, '')) AS TIPO,
          MAX(ISNULL(e.RESPONSAVEL, '')) AS RESPONSAVEL,
          SUM(ISNULL(p.QTDE, 0)) AS QTDE,
          AVG(NULLIF(p.CUSTO1, 0)) AS CUSTO_UNIT,
          'estoque' AS FONTE
        FROM ESTOQUE_PROD_ENT e WITH (NOLOCK)
        JOIN ESTOQUE_PROD1_ENT p WITH (NOLOCK)
          ON e.ROMANEIO_PRODUTO = p.ROMANEIO_PRODUTO
        WHERE p.PRODUTO = @produtoId
          ${dateFilterEstoque}
          ${filialFilterEstoque}
        GROUP BY e.ROMANEIO_PRODUTO, e.FILIAL, LTRIM(RTRIM(ISNULL(e.FILIAL_ORIGEM, '')))

        UNION ALL

        SELECT
          le.ROMANEIO_PRODUTO,
          le.FILIAL AS FILIAL_DESTINO,
          LTRIM(RTRIM(ISNULL(le.FILIAL_ORIGEM, ''))) AS FILIAL_ORIGEM,
          MAX(le.EMISSAO) AS EMISSAO,
          (CONVERT(VARCHAR(10), MAX(le.EMISSAO), 120) + 'T' + CONVERT(VARCHAR(8), MAX(le.EMISSAO), 108)) AS EMISSAO_STR,
          MAX(ISNULL(t.DESC_TIPO_ENTRADA_SAIDA, ISNULL(le.TIPO_ENTRADA_SAIDA, ''))) AS TIPO,
          MAX(ISNULL(le.RESPONSAVEL, '')) AS RESPONSAVEL,
          SUM(ISNULL(lep.QTDE_ENTRADA, 0)) AS QTDE,
          AVG(NULLIF(lep.PRECO1, 0)) AS CUSTO_UNIT,
          'loja' AS FONTE
        FROM LOJA_ENTRADAS le WITH (NOLOCK)
        JOIN LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
          ON le.FILIAL = lep.FILIAL AND le.ROMANEIO_PRODUTO = lep.ROMANEIO_PRODUTO
        LEFT JOIN LOJA_TIPOS_ENTRADA_SAIDA t WITH (NOLOCK)
          ON t.TIPO_ENTRADA_SAIDA = le.TIPO_ENTRADA_SAIDA
        WHERE lep.PRODUTO = @produtoId
          AND (le.ENTRADA_CANCELADA = 0 OR le.ENTRADA_CANCELADA IS NULL)
          AND NOT EXISTS (
            SELECT 1 FROM ESTOQUE_PROD_ENT ee WITH (NOLOCK)
            WHERE ee.ROMANEIO_PRODUTO = le.ROMANEIO_PRODUTO
              AND LTRIM(RTRIM(ISNULL(ee.FILIAL, ''))) = LTRIM(RTRIM(ISNULL(le.FILIAL, '')))
          )
          ${dateFilterLoja}
          ${filialFilterLoja}
        GROUP BY le.ROMANEIO_PRODUTO, le.FILIAL, LTRIM(RTRIM(ISNULL(le.FILIAL_ORIGEM, '')))
      ) AS unificado
      ORDER BY EMISSAO DESC, ROMANEIO_PRODUTO DESC
    `;

    const result = await req.query<{
      ROMANEIO_PRODUTO: string;
      FILIAL_DESTINO: string;
      FILIAL_ORIGEM: string | null;
      EMISSAO: Date;
      EMISSAO_STR: string;
      TIPO: string | null;
      RESPONSAVEL: string | null;
      QTDE: number | null;
      CUSTO_UNIT: number | null;
      FONTE: "estoque" | "loja";
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
      tipoRomaneio: row.TIPO?.toString().trim() || "",
      responsavel: row.RESPONSAVEL?.toString().trim() || "",
      qtde: Number(row.QTDE ?? 0),
      custoUnitario: Number(row.CUSTO_UNIT ?? 0),
      fonte: row.FONTE,
    }));
  });
}

export async function fetchLogEntradas(
  limit = 200,
  dias = 90,
  searchTerm = "",
  filiais: string[] = []
): Promise<LogEntradaRow[]> {
  const limitClamp = Math.min(Math.max(limit || 200, 1), 1000);
  const diasClamp = Math.min(Math.max(dias || 30, 1), 365);
  const searchConfig = buildSearchConfig(searchTerm);

  // Filtro de filiais (destino) aplicado DENTRO do SQL, antes do TOP — evita teto de
  // linhas compartilhado entre empresas. Match por nome (trim + upper), igual à rota.
  const filiaisNorm = Array.from(
    new Set((filiais || []).map((f) => (f || "").trim().toUpperCase()).filter(Boolean))
  );
  const hasFilialFilter = filiaisNorm.length > 0;
  const filialParams = filiaisNorm.map((_, i) => `@fil${i}`).join(", ");
  const filialFilterEstoque = hasFilialFilter
    ? `AND UPPER(LTRIM(RTRIM(ISNULL(e.FILIAL, '')))) IN (${filialParams})`
    : "";
  const filialFilterLoja = hasFilialFilter
    ? `AND UPPER(LTRIM(RTRIM(ISNULL(le.FILIAL, '')))) IN (${filialParams})`
    : "";
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
    if (hasFilialFilter) {
      filiaisNorm.forEach((f, i) => req.input(`fil${i}`, sql.VarChar, f));
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
          ${filialFilterEstoque}

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
        ${filialFilterLoja}
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
