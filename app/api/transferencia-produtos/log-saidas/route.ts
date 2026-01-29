import { NextResponse } from 'next/server';
import { withRequest } from '@/lib/db/connection';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || '50');

  try {
    const saidas = await withRequest(async (req) => {
      const query = `
        SELECT TOP ${limit}
          s.ROMANEIO_PRODUTO,
          s.FILIAL AS FILIAL_ORIGEM,
          s.FILIAL_DESTINO,
          s.EMISSAO,
          s.RESPONSAVEL,
          (
            SELECT COUNT(DISTINCT sp.PRODUTO)
            FROM LOJA_SAIDAS_PRODUTO sp WITH (NOLOCK)
            WHERE sp.ROMANEIO_PRODUTO = s.ROMANEIO_PRODUTO AND sp.FILIAL = s.FILIAL
          ) AS QTD_PRODUTOS,
          (
            SELECT ISNULL(SUM(sp.QTDE_SAIDA), 0)
            FROM LOJA_SAIDAS_PRODUTO sp WITH (NOLOCK)
            WHERE sp.ROMANEIO_PRODUTO = s.ROMANEIO_PRODUTO AND sp.FILIAL = s.FILIAL
          ) AS QTD_ITENS
        FROM LOJA_SAIDAS s WITH (NOLOCK)
        WHERE s.FILIAL_DESTINO IS NOT NULL
          AND LTRIM(RTRIM(ISNULL(s.FILIAL_DESTINO, ''))) != ''
          AND (s.SAIDA_CANCELADA = 0 OR s.SAIDA_CANCELADA IS NULL)
          AND s.EMISSAO >= DATEADD(DAY, -30, GETDATE())
        ORDER BY s.EMISSAO DESC
      `;

      const result = await req.query<{
        ROMANEIO_PRODUTO: string;
        FILIAL_ORIGEM: string;
        FILIAL_DESTINO: string | null;
        EMISSAO: Date;
        RESPONSAVEL: string | null;
        QTD_PRODUTOS: number;
        QTD_ITENS: number;
      }>(query);

      return result.recordset.map(row => ({
        romaneio: row.ROMANEIO_PRODUTO?.toString().trim() || '',
        filialOrigem: row.FILIAL_ORIGEM?.toString().trim() || '',
        filialDestino: row.FILIAL_DESTINO?.toString().trim() || '',
        dataEmissao: row.EMISSAO ? new Date(row.EMISSAO).toISOString() : '',
        responsavel: row.RESPONSAVEL?.toString().trim() || '',
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
