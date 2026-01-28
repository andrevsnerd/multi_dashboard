import { NextResponse } from 'next/server';
import { withRequest } from '@/lib/db/connection';

export async function GET() {
  try {
    const responsaveis = await withRequest(async (req) => {
      const query = `
        SELECT TOP 50
          LTRIM(RTRIM(ISNULL(RESPONSAVEL, ''))) AS RESPONSAVEL,
          COUNT(*) AS QTD
        FROM ESTOQUE_PROD_ENT WITH (NOLOCK)
        WHERE RESPONSAVEL IS NOT NULL
          AND LTRIM(RTRIM(RESPONSAVEL)) <> ''
          AND (
            FILIAL LIKE 'NERD%' OR
            FILIAL LIKE 'SCARF%' OR
            FILIAL LIKE 'SCARFME%'
          )
        GROUP BY LTRIM(RTRIM(ISNULL(RESPONSAVEL, '')))
        ORDER BY QTD DESC, RESPONSAVEL
      `;

      const result = await req.query<{
        RESPONSAVEL: string;
        QTD: number;
      }>(query);

      return result.recordset.map(row => ({
        responsavel: row.RESPONSAVEL?.toString().trim() || '',
        qtd: row.QTD || 0,
      }));
    });

    return NextResponse.json({ data: responsaveis });
  } catch (error) {
    console.error('Erro ao buscar responsáveis', error);
    return NextResponse.json(
      { error: 'Erro ao buscar responsáveis' },
      { status: 500 }
    );
  }
}
