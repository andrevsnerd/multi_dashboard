import { withRequest } from "@/lib/db/connection";

export interface LogSaidaRow {
  romaneio: string;
  filialOrigem: string;
  filialDestino: string;
  dataEmissao: string;
  responsavel: string;
  observacao: string;
  qtdProdutos: number;
  qtdItens: number;
  status: string;
  tipoRomaneio: string;
}

export async function fetchLogSaidas(limit = 200, dias = 90): Promise<LogSaidaRow[]> {
  const limitClamp = Math.min(limit || 200, 500);
  const diasClamp = Math.min(dias || 30, 90);

  const saidas = await withRequest(async (req) => {
    const query = `
      SELECT TOP (${limitClamp}) * FROM (
        SELECT
          es.ROMANEIO_PRODUTO,
          es.FILIAL AS FILIAL_ORIGEM,
          LTRIM(RTRIM(ISNULL(es.FILIAL_DESTINO, ''))) AS FILIAL_DESTINO,
          es.EMISSAO,
          (CONVERT(VARCHAR(10), es.EMISSAO, 120) + 'T' + CONVERT(VARCHAR(8), es.EMISSAO, 108)) AS EMISSAO_STR,
          es.RESPONSAVEL,
          ISNULL(es.OBS, '') AS OBS,
          ISNULL(es.TIPO_ROMANEIO, '') AS TIPO_ROMANEIO,
          (SELECT COUNT(*) FROM ESTOQUE_PROD1_SAI ep WITH (NOLOCK)
           WHERE ep.ROMANEIO_PRODUTO = es.ROMANEIO_PRODUTO AND ep.FILIAL = es.FILIAL) AS QTD_PRODUTOS,
          (SELECT ISNULL(SUM(ep.QTDE), 0) FROM ESTOQUE_PROD1_SAI ep WITH (NOLOCK)
           WHERE ep.ROMANEIO_PRODUTO = es.ROMANEIO_PRODUTO AND ep.FILIAL = es.FILIAL) AS QTD_ITENS
        FROM ESTOQUE_PROD_SAI es WITH (NOLOCK)
        WHERE es.EMISSAO >= DATEADD(DAY, -${diasClamp}, GETDATE())

        UNION ALL

        SELECT
          s.ROMANEIO_PRODUTO,
          s.FILIAL AS FILIAL_ORIGEM,
          LTRIM(RTRIM(ISNULL(s.FILIAL_DESTINO, ''))) AS FILIAL_DESTINO,
          s.EMISSAO,
          (CONVERT(VARCHAR(10), s.EMISSAO, 120) + 'T' + CONVERT(VARCHAR(8), s.EMISSAO, 108)) AS EMISSAO_STR,
          s.RESPONSAVEL,
          ISNULL(s.OBS, '') AS OBS,
          ISNULL(s.TIPO_ROMANEIO, '') AS TIPO_ROMANEIO,
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
        WHERE NOT EXISTS (
          SELECT 1 FROM ESTOQUE_PROD_SAI es2 WITH (NOLOCK)
          WHERE es2.ROMANEIO_PRODUTO = s.ROMANEIO_PRODUTO
            AND LTRIM(RTRIM(ISNULL(es2.FILIAL, ''))) = LTRIM(RTRIM(ISNULL(s.FILIAL, '')))
        )
        AND (s.SAIDA_CANCELADA = 0 OR s.SAIDA_CANCELADA IS NULL)
        AND s.EMISSAO >= DATEADD(DAY, -${diasClamp}, GETDATE())
      ) AS unificado
      ORDER BY EMISSAO DESC
    `;

    const result = await req.query<{
      ROMANEIO_PRODUTO: string;
      FILIAL_ORIGEM: string;
      FILIAL_DESTINO: string | null;
      EMISSAO: Date;
      EMISSAO_STR: string;
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
      dataEmissao:
        row.EMISSAO_STR != null && String(row.EMISSAO_STR).trim() !== ""
          ? String(row.EMISSAO_STR).trim()
          : row.EMISSAO
            ? new Date(row.EMISSAO).toISOString()
            : "",
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
