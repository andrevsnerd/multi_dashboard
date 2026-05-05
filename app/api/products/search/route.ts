import { NextResponse } from 'next/server';
import sql from 'mssql';

import { withRequest } from '@/lib/db/connection';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const searchTerm = searchParams.get('q');

  if (!searchTerm || searchTerm.trim().length < 2) {
    return NextResponse.json({ data: [] });
  }

  try {
    const results = await withRequest(async (req) => {
      const normalizedTerm = searchTerm.trim();
      const searchPattern = `%${normalizedTerm}%`;
      const startsWithPattern = `${normalizedTerm}%`;
      const containsAfterSpacePattern = `% ${normalizedTerm}%`;

      req.input('searchTerm', sql.VarChar, searchPattern);
      req.input('exactSearchTerm', sql.VarChar, normalizedTerm);
      req.input('startsWithSearchTerm', sql.VarChar, startsWithPattern);
      req.input('containsAfterSpaceSearchTerm', sql.VarChar, containsAfterSpacePattern);

      const query = `
        SELECT TOP 100
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
            WHEN LTRIM(RTRIM(p.PRODUTO)) = LTRIM(RTRIM(@exactSearchTerm)) THEN 1
            WHEN LTRIM(RTRIM(p.DESC_PRODUTO)) = LTRIM(RTRIM(@exactSearchTerm)) THEN 2
            WHEN p.DESC_PRODUTO LIKE @startsWithSearchTerm THEN 3
            WHEN p.DESC_PRODUTO LIKE @containsAfterSpaceSearchTerm THEN 4
            WHEN p.PRODUTO LIKE @startsWithSearchTerm THEN 5
            WHEN p.DESC_PRODUTO LIKE @searchTerm THEN 6
            WHEN p.PRODUTO LIKE @searchTerm THEN 7
            WHEN pbMatch.CODIGO_BARRA IS NOT NULL THEN 8
            ELSE 9
          END,
          LEN(LTRIM(RTRIM(ISNULL(p.DESC_PRODUTO, '')))),
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
