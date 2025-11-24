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
      const searchPattern = `%${searchTerm.trim()}%`;
      req.input('searchTerm', sql.VarChar, searchPattern);

      // Buscar por nome ou código do produto
      const query = `
        SELECT TOP 20
          p.PRODUTO AS productId,
          p.DESC_PRODUTO AS productName
        FROM PRODUTOS p WITH (NOLOCK)
        WHERE p.DESC_PRODUTO LIKE @searchTerm
          OR p.PRODUTO LIKE @searchTerm
        ORDER BY 
          CASE 
            WHEN p.PRODUTO LIKE @searchTerm THEN 1
            ELSE 2
          END,
          p.DESC_PRODUTO
      `;

      const result = await req.query<{
        productId: string;
        productName: string | null;
      }>(query);

      return result.recordset
        .filter((row) => row.productName)
        .map((row) => ({
          productId: row.productId,
          productName: row.productName || '',
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




