import { NextResponse } from 'next/server';
import { withRequest } from '@/lib/db/connection';

/**
 * Busca TODOS os usuários da tabela USERS do banco Linx (mesma lógica de gerenciar_usuarios.py).
 * Permite selecionar qualquer usuário cadastrado como responsável, inclusive recém-criados.
 */
export async function GET() {
  try {
    const responsaveis = await withRequest(async (req) => {
      const query = `
        SELECT LTRIM(RTRIM(ISNULL(USUARIO, ''))) AS RESPONSAVEL
        FROM USERS WITH (NOLOCK)
        WHERE USUARIO IS NOT NULL
          AND LTRIM(RTRIM(USUARIO)) <> ''
        ORDER BY USUARIO
      `;

      const result = await req.query<{ RESPONSAVEL: string }>(query);

      return result.recordset.map((row) => ({
        responsavel: row.RESPONSAVEL?.toString().trim() || '',
        qtd: 0,
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
