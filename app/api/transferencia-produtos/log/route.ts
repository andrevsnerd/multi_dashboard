import { NextResponse } from 'next/server';
import { withRequest } from '@/lib/db/connection';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || '50');

  try {
    const transferencias = await withRequest(async (req) => {
      const query = `
        SELECT TOP ${limit}
          e.ROMANEIO_PRODUTO,
          e.FILIAL AS FILIAL_DESTINO,
          e.FILIAL_ORIGEM,
          e.EMISSAO,
          e.TIPO_ROMANEIO,
          e.RESPONSAVEL,
          e.OBS,
          (
            SELECT COUNT(DISTINCT ep.PRODUTO)
            FROM ESTOQUE_PROD1_ENT ep WITH (NOLOCK)
            WHERE ep.ROMANEIO_PRODUTO = e.ROMANEIO_PRODUTO
          ) AS QTD_PRODUTOS,
          (
            SELECT SUM(ep.QTDE)
            FROM ESTOQUE_PROD1_ENT ep WITH (NOLOCK)
            WHERE ep.ROMANEIO_PRODUTO = e.ROMANEIO_PRODUTO
          ) AS QTD_ITENS
        FROM ESTOQUE_PROD_ENT e WITH (NOLOCK)
        WHERE (
          -- Incluir transferências (com FILIAL_ORIGEM preenchido)
          (e.FILIAL_ORIGEM IS NOT NULL AND LTRIM(RTRIM(ISNULL(e.FILIAL_ORIGEM, ''))) != '')
          OR
          -- Incluir entradas isoladas (FILIAL_ORIGEM vazio ou NULL)
          (e.FILIAL_ORIGEM IS NULL OR LTRIM(RTRIM(ISNULL(e.FILIAL_ORIGEM, ''))) = '')
        )
          AND e.EMISSAO >= DATEADD(DAY, -30, GETDATE())
        ORDER BY e.EMISSAO DESC
      `;

      const result = await req.query<{
        ROMANEIO_PRODUTO: string;
        FILIAL_DESTINO: string;
        FILIAL_ORIGEM: string | null;
        EMISSAO: Date;
        TIPO_ROMANEIO: string | null;
        RESPONSAVEL: string | null;
        OBS: string | null;
        QTD_PRODUTOS: number;
        QTD_ITENS: number | null;
      }>(query);

      return result.recordset.map(row => ({
        romaneio: row.ROMANEIO_PRODUTO?.toString().trim() || '',
        filialOrigem: row.FILIAL_ORIGEM?.toString().trim() || '',
        filialDestino: row.FILIAL_DESTINO?.toString().trim() || '',
        dataEmissao: row.EMISSAO ? new Date(row.EMISSAO).toISOString() : '',
        tipoRomaneio: row.TIPO_ROMANEIO?.toString().trim() || '',
        responsavel: row.RESPONSAVEL?.toString().trim() || '',
        observacao: row.OBS?.toString().trim() || '',
        qtdProdutos: row.QTD_PRODUTOS || 0,
        qtdItens: row.QTD_ITENS || 0,
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
