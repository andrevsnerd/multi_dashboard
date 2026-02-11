import { NextResponse } from 'next/server';
import { withRequest } from '@/lib/db/connection';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') || '200', 10) || 200, 500);
  const dias = Math.min(parseInt(searchParams.get('dias') || '30', 10) || 30, 90);

  try {
    const saidas = await withRequest(async (req) => {
      // Juntar ESTOQUE_PROD_SAI (estoques) + LOJA_SAIDAS (lojas) no mesmo log.
      const query = `
        SELECT TOP (${limit}) * FROM (
          SELECT
            es.ROMANEIO_PRODUTO,
            es.FILIAL AS FILIAL_ORIGEM,
            LTRIM(RTRIM(ISNULL(es.FILIAL_DESTINO, ''))) AS FILIAL_DESTINO,
            es.EMISSAO,
            (CONVERT(VARCHAR(10), es.EMISSAO, 120) + 'T' + CONVERT(VARCHAR(8), es.EMISSAO, 108)) AS EMISSAO_STR,
            es.RESPONSAVEL,
            ISNULL(es.OBS, '') AS OBS,
            (SELECT COUNT(DISTINCT ep.PRODUTO) FROM ESTOQUE_PROD1_SAI ep WITH (NOLOCK)
             WHERE ep.ROMANEIO_PRODUTO = es.ROMANEIO_PRODUTO AND ep.FILIAL = es.FILIAL) AS QTD_PRODUTOS,
            (SELECT ISNULL(SUM(ep.QTDE), 0) FROM ESTOQUE_PROD1_SAI ep WITH (NOLOCK)
             WHERE ep.ROMANEIO_PRODUTO = es.ROMANEIO_PRODUTO AND ep.FILIAL = es.FILIAL) AS QTD_ITENS
          FROM ESTOQUE_PROD_SAI es WITH (NOLOCK)
          WHERE es.EMISSAO >= DATEADD(DAY, -${dias}, GETDATE())

          UNION ALL

          SELECT
            s.ROMANEIO_PRODUTO,
            s.FILIAL AS FILIAL_ORIGEM,
            LTRIM(RTRIM(ISNULL(s.FILIAL_DESTINO, ''))) AS FILIAL_DESTINO,
            s.EMISSAO,
            (CONVERT(VARCHAR(10), s.EMISSAO, 120) + 'T' + CONVERT(VARCHAR(8), s.EMISSAO, 108)) AS EMISSAO_STR,
            s.RESPONSAVEL,
            ISNULL(s.OBS, '') AS OBS,
            ISNULL((
              SELECT COUNT(DISTINCT sp.PRODUTO) FROM LOJA_SAIDAS_PRODUTO sp WITH (NOLOCK)
              WHERE sp.ROMANEIO_PRODUTO = s.ROMANEIO_PRODUTO AND sp.FILIAL = s.FILIAL
            ), (
              SELECT COUNT(DISTINCT ep.PRODUTO) FROM ESTOQUE_PROD1_SAI ep WITH (NOLOCK)
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
          AND s.EMISSAO >= DATEADD(DAY, -${dias}, GETDATE())
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
      }>(query);

      const rows = result.recordset;
      return rows.map(row => ({
        romaneio: row.ROMANEIO_PRODUTO?.toString().trim() || '',
        filialOrigem: row.FILIAL_ORIGEM?.toString().trim() || '',
        filialDestino: row.FILIAL_DESTINO?.toString().trim() || '—',
        dataEmissao: (row.EMISSAO_STR != null && String(row.EMISSAO_STR).trim() !== '')
          ? String(row.EMISSAO_STR).trim()
          : (row.EMISSAO ? new Date(row.EMISSAO).toISOString() : ''),
        responsavel: row.RESPONSAVEL?.toString().trim() || '',
        observacao: row.OBS?.toString().trim() || '',
        qtdProdutos: row.QTD_PRODUTOS || 0,
        qtdItens: row.QTD_ITENS || 0,
        status: 'Concluída',
      }));
    });

    return NextResponse.json({ data: saidas });
  } catch (error) {
    console.error('Erro ao buscar log de saídas', error);
    return NextResponse.json(
      { error: 'Erro ao buscar log de saídas' },
      { status: 500 }
    );
  }
}
