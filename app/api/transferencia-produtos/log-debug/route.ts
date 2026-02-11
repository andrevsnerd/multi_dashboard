import { NextResponse } from 'next/server';
import { withRequest } from '@/lib/db/connection';

/**
 * GET /api/transferencia-produtos/log-debug
 * Retorna contagens e amostra de romaneios para diagnosticar por que o log não mostra entradas/saídas.
 * Use ?dias=30 para janela em dias.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const dias = Math.min(parseInt(searchParams.get('dias') || '30', 10) || 30, 90);

  try {
    const debug = await withRequest(async (req) => {
      const q = `
        SELECT
          GETDATE() AS ServerNow,
          (SELECT COUNT(*) FROM ESTOQUE_PROD_ENT e WITH (NOLOCK) WHERE e.EMISSAO >= DATEADD(DAY, -${dias}, GETDATE())) AS TotalEntradas,
          (SELECT COUNT(*) FROM ESTOQUE_PROD_SAI s WITH (NOLOCK) WHERE s.EMISSAO >= DATEADD(DAY, -${dias}, GETDATE())) AS TotalSaidas,
          (SELECT TOP 1 e.ROMANEIO_PRODUTO FROM ESTOQUE_PROD_ENT e WITH (NOLOCK) WHERE e.EMISSAO >= DATEADD(DAY, -${dias}, GETDATE()) ORDER BY e.EMISSAO DESC) AS UltimoRomaneioEntrada,
          (SELECT TOP 1 s.ROMANEIO_PRODUTO FROM ESTOQUE_PROD_SAI s WITH (NOLOCK) WHERE s.EMISSAO >= DATEADD(DAY, -${dias}, GETDATE()) ORDER BY s.EMISSAO DESC) AS UltimoRomaneioSaida
      `;
      const result = await req.query<{
        ServerNow: Date;
        TotalEntradas: number;
        TotalSaidas: number;
        UltimoRomaneioEntrada: string;
        UltimoRomaneioSaida: string;
      }>(q);
      const r = result.recordset[0];
      return {
        serverNow: r?.ServerNow ? new Date(r.ServerNow).toISOString() : null,
        dias,
        totalEntradas: r?.TotalEntradas ?? 0,
        totalSaidas: r?.TotalSaidas ?? 0,
        ultimoRomaneioEntrada: r?.UltimoRomaneioEntrada != null ? String(r.UltimoRomaneioEntrada).trim() : null,
        ultimoRomaneioSaida: r?.UltimoRomaneioSaida != null ? String(r.UltimoRomaneioSaida).trim() : null,
      };
    });

    return NextResponse.json({ success: true, debug });
  } catch (error) {
    console.error('Erro log-debug', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Erro ao executar debug' },
      { status: 500 }
    );
  }
}
