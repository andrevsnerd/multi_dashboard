import { NextResponse } from 'next/server';
import { withRequest } from '@/lib/db/connection';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') || '200', 10) || 200, 500);
  const dias = Math.min(parseInt(searchParams.get('dias') || '30', 10) || 30, 90);

  try {
    const transferencias = await withRequest(async (req) => {
      // Juntar ESTOQUE_PROD_ENT (estoques) + LOJA_ENTRADAS (lojas) no mesmo log.
      const query = `
        SELECT TOP (${limit}) * FROM (
          SELECT
            e.ROMANEIO_PRODUTO,
            e.FILIAL AS FILIAL_DESTINO,
            LTRIM(RTRIM(ISNULL(e.FILIAL_ORIGEM, ''))) AS FILIAL_ORIGEM,
            e.EMISSAO,
            (CONVERT(VARCHAR(10), e.EMISSAO, 120) + 'T' + CONVERT(VARCHAR(8), e.EMISSAO, 108)) AS EMISSAO_STR,
            e.TIPO_ROMANEIO,
            e.RESPONSAVEL,
            ISNULL(e.OBS, '') AS OBS,
            (SELECT COUNT(DISTINCT ep.PRODUTO) FROM ESTOQUE_PROD1_ENT ep WITH (NOLOCK)
             WHERE ep.ROMANEIO_PRODUTO = e.ROMANEIO_PRODUTO AND ep.FILIAL = e.FILIAL) AS QTD_PRODUTOS,
            (SELECT ISNULL(SUM(ep.QTDE), 0) FROM ESTOQUE_PROD1_ENT ep WITH (NOLOCK)
             WHERE ep.ROMANEIO_PRODUTO = e.ROMANEIO_PRODUTO AND ep.FILIAL = e.FILIAL) AS QTD_ITENS
          FROM ESTOQUE_PROD_ENT e WITH (NOLOCK)
          WHERE e.EMISSAO >= DATEADD(DAY, -${dias}, GETDATE())

          UNION ALL

          SELECT
            le.ROMANEIO_PRODUTO,
            le.FILIAL AS FILIAL_DESTINO,
            LTRIM(RTRIM(ISNULL(le.FILIAL_ORIGEM, ''))) AS FILIAL_ORIGEM,
            le.EMISSAO,
            (CONVERT(VARCHAR(10), le.EMISSAO, 120) + 'T' + CONVERT(VARCHAR(8), le.EMISSAO, 108)) AS EMISSAO_STR,
            NULL AS TIPO_ROMANEIO,
            le.RESPONSAVEL,
            ISNULL(le.OBS, '') AS OBS,
            (SELECT COUNT(DISTINCT lep.PRODUTO) FROM LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
             WHERE lep.ROMANEIO_PRODUTO = le.ROMANEIO_PRODUTO AND lep.FILIAL = le.FILIAL) AS QTD_PRODUTOS,
            (SELECT ISNULL(SUM(ISNULL(lep.QTDE_ENTRADA, 0)), 0) FROM LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
             WHERE lep.ROMANEIO_PRODUTO = le.ROMANEIO_PRODUTO AND lep.FILIAL = le.FILIAL) AS QTD_ITENS
          FROM LOJA_ENTRADAS le WITH (NOLOCK)
          WHERE NOT EXISTS (
            SELECT 1 FROM ESTOQUE_PROD_ENT ee WITH (NOLOCK)
            WHERE ee.ROMANEIO_PRODUTO = le.ROMANEIO_PRODUTO
              AND LTRIM(RTRIM(ISNULL(ee.FILIAL, ''))) = LTRIM(RTRIM(ISNULL(le.FILIAL, '')))
          )
          AND (le.ENTRADA_CANCELADA = 0 OR le.ENTRADA_CANCELADA IS NULL)
          AND le.EMISSAO >= DATEADD(DAY, -${dias}, GETDATE())
        ) AS unificado
        ORDER BY EMISSAO DESC
      `;

      const result = await req.query<{
        ROMANEIO_PRODUTO: string;
        FILIAL_DESTINO: string;
        FILIAL_ORIGEM: string | null;
        EMISSAO: Date;
        EMISSAO_STR: string;
        TIPO_ROMANEIO: string | null;
        RESPONSAVEL: string | null;
        OBS: string | null;
        QTD_PRODUTOS: number;
        QTD_ITENS: number | null;
      }>(query);

      const rows = result.recordset;
      return rows.map(row => ({
        romaneio: row.ROMANEIO_PRODUTO?.toString().trim() || '',
        filialOrigem: row.FILIAL_ORIGEM?.toString().trim() || '',
        filialDestino: row.FILIAL_DESTINO?.toString().trim() || '',
        dataEmissao: (row.EMISSAO_STR != null && String(row.EMISSAO_STR).trim() !== '')
          ? String(row.EMISSAO_STR).trim()
          : (row.EMISSAO ? new Date(row.EMISSAO).toISOString() : ''),
        tipoRomaneio: row.TIPO_ROMANEIO?.toString().trim() || '',
        responsavel: row.RESPONSAVEL?.toString().trim() || '',
        observacao: row.OBS?.toString().trim() || '',
        qtdProdutos: row.QTD_PRODUTOS || 0,
        qtdItens: row.QTD_ITENS ?? 0,
        status: 'Concluída',
      }));
    });

    return NextResponse.json({ data: transferencias });
  } catch (error) {
    console.error('Erro ao buscar log de transferências', error);
    return NextResponse.json(
      { error: 'Erro ao buscar log de transferências' },
      { status: 500 }
    );
  }
}
