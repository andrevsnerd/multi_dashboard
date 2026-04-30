import { NextResponse } from 'next/server';
import sql from 'mssql';

import { withRequest } from '@/lib/db/connection';
import { resolveCompany } from '@/lib/config/company';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') ?? undefined;
  const searchTerm = searchParams.get('q');

  if (!searchTerm || searchTerm.trim().length < 2) {
    return NextResponse.json({ data: [] });
  }

  try {
    const results = await withRequest(async (req) => {
      const normalizedTerm = searchTerm.trim();
      const searchPattern = `%${normalizedTerm}%`;
      req.input('searchTerm', sql.VarChar, searchPattern);
      req.input('exactSearchTerm', sql.VarChar, normalizedTerm);

      // Buscar por nome, código do produto ou código de barras
      const query = `
        SELECT TOP 20
          p.PRODUTO AS productId,
          p.DESC_PRODUTO AS productName,
          ISNULL(pbMatch.COR_PRODUTO, '') AS matchedColorCode,
          ISNULL(c.DESC_COR, '') AS matchedColorName
        FROM PRODUTOS p WITH (NOLOCK)
        OUTER APPLY (
          SELECT TOP 1 pb.CODIGO_BARRA, pb.COR_PRODUTO
          FROM PRODUTOS_BARRA pb WITH (NOLOCK)
          WHERE pb.PRODUTO = p.PRODUTO
            AND pb.CODIGO_BARRA IS NOT NULL
            AND pb.CODIGO_BARRA <> ''
            AND pb.CODIGO_BARRA LIKE @searchTerm
          ORDER BY
            CASE
              WHEN LTRIM(RTRIM(pb.CODIGO_BARRA)) = LTRIM(RTRIM(@exactSearchTerm)) THEN 1
              ELSE 2
            END,
            pb.CODIGO_BARRA
        ) pbMatch
        LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON c.COR = pbMatch.COR_PRODUTO
        WHERE p.DESC_PRODUTO LIKE @searchTerm
          OR p.PRODUTO LIKE @searchTerm
          OR pbMatch.CODIGO_BARRA IS NOT NULL
        ORDER BY 
          CASE 
            WHEN pbMatch.CODIGO_BARRA IS NOT NULL
              AND LTRIM(RTRIM(pbMatch.CODIGO_BARRA)) = LTRIM(RTRIM(@exactSearchTerm)) THEN 0
            WHEN p.PRODUTO LIKE @searchTerm THEN 1
            ELSE 2
          END,
          p.DESC_PRODUTO
      `;

      const result = await req.query<{
        productId: string;
        productName: string | null;
        matchedColorCode: string | null;
        matchedColorName: string | null;
      }>(query);

      return result.recordset
        .filter((row) => row.productName)
        .map((row) => ({
          productId: row.productId,
          productName: row.productName || '',
          matchedColorCode: (row.matchedColorCode ?? '').trim() || null,
          matchedColorName: (row.matchedColorName ?? '').trim() || null,
        }));
    });

    return NextResponse.json({ data: results });
  } catch (error) {
    console.error('Erro ao buscar produtos', error);
    return NextResponse.json(
      { error: 'Erro ao buscar produtos' },
      { status: 500 }
    );
  }
}




