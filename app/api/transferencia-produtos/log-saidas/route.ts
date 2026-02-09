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
          s.OBS,
          -- Contar produtos: primeiro tenta LOJA_SAIDAS_PRODUTO, se não houver usa ESTOQUE_PROD1_SAI
          ISNULL((
            SELECT COUNT(DISTINCT sp.PRODUTO)
            FROM LOJA_SAIDAS_PRODUTO sp WITH (NOLOCK)
            WHERE sp.ROMANEIO_PRODUTO = s.ROMANEIO_PRODUTO AND sp.FILIAL = s.FILIAL
          ), (
            SELECT COUNT(DISTINCT ep.PRODUTO)
            FROM ESTOQUE_PROD1_SAI ep WITH (NOLOCK)
            WHERE ep.ROMANEIO_PRODUTO = s.ROMANEIO_PRODUTO AND ep.FILIAL = s.FILIAL
          )) AS QTD_PRODUTOS,
          -- Contar itens: primeiro tenta LOJA_SAIDAS_PRODUTO, se não houver usa ESTOQUE_PROD1_SAI
          ISNULL((
            SELECT ISNULL(SUM(sp.QTDE_SAIDA), 0)
            FROM LOJA_SAIDAS_PRODUTO sp WITH (NOLOCK)
            WHERE sp.ROMANEIO_PRODUTO = s.ROMANEIO_PRODUTO AND sp.FILIAL = s.FILIAL
          ), (
            SELECT ISNULL(SUM(ep.QTDE), 0)
            FROM ESTOQUE_PROD1_SAI ep WITH (NOLOCK)
            WHERE ep.ROMANEIO_PRODUTO = s.ROMANEIO_PRODUTO AND ep.FILIAL = s.FILIAL
          )) AS QTD_ITENS
        FROM LOJA_SAIDAS s WITH (NOLOCK)
        WHERE (
          -- Incluir transferências (com FILIAL_DESTINO preenchido)
          (s.FILIAL_DESTINO IS NOT NULL AND LTRIM(RTRIM(ISNULL(s.FILIAL_DESTINO, ''))) != '')
          OR
          -- Incluir saídas isoladas (FILIAL_DESTINO vazio ou NULL)
          (s.FILIAL_DESTINO IS NULL OR LTRIM(RTRIM(ISNULL(s.FILIAL_DESTINO, ''))) = '')
        )
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
        OBS: string | null;
        QTD_PRODUTOS: number;
        QTD_ITENS: number;
      }>(query);

      return result.recordset.map(row => ({
        romaneio: row.ROMANEIO_PRODUTO?.toString().trim() || '',
        filialOrigem: row.FILIAL_ORIGEM?.toString().trim() || '',
        filialDestino: row.FILIAL_DESTINO?.toString().trim() || '—', // Mostrar '—' para saídas isoladas
        dataEmissao: row.EMISSAO ? new Date(row.EMISSAO).toISOString() : '',
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
