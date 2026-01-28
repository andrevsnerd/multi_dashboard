import { NextResponse } from 'next/server';
import { withRequest } from '@/lib/db/connection';

export async function GET() {
  try {
    const filiais = await withRequest(async (req) => {
      const query = `
        SELECT DISTINCT
          COD_FILIAL,
          FILIAL
        FROM FILIAIS WITH (NOLOCK)
        WHERE FILIAL LIKE '%NERD%' 
           OR FILIAL LIKE '%SCARF%'
           OR FILIAL LIKE '%SCARFME%'
        ORDER BY FILIAL
      `;
      
      const result = await req.query<{
        COD_FILIAL: string;
        FILIAL: string;
      }>(query);
      
      return result.recordset.map(row => ({
        codFilial: row.COD_FILIAL?.toString().trim() || '',
        filial: row.FILIAL?.toString().trim() || '',
      }));
    });

    return NextResponse.json({ data: filiais });
  } catch (error) {
    console.error('Erro ao buscar filiais', error);
    return NextResponse.json(
      { error: 'Erro ao buscar filiais' },
      { status: 500 }
    );
  }
}
