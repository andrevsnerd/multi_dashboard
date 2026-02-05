import { NextRequest, NextResponse } from 'next/server';
import { getPermissaoByUsername } from '@/lib/utils/transferencia-permissoes-store';
import { findUserByUsername } from '@/lib/auth/users-store';

/**
 * GET /api/transferencia-produtos/permissoes
 * Retorna as permissões do usuário logado
 * Usa o header x-auth-username para identificar o usuário
 */
export async function GET(request: NextRequest) {
  try {
    const username = request.headers.get('x-auth-username');
    if (!username) {
      return NextResponse.json(
        { error: 'Não autenticado' },
        { status: 401 }
      );
    }

    // Verificar se o usuário existe
    const user = await findUserByUsername(username);
    if (!user) {
      return NextResponse.json(
        { error: 'Usuário não encontrado' },
        { status: 404 }
      );
    }

    const permissao = await getPermissaoByUsername(user.username);
    
    // Se não tiver permissão configurada, retorna null (sem restrições)
    return NextResponse.json({ data: permissao });
  } catch (error) {
    console.error('Erro ao buscar permissões', error);
    return NextResponse.json(
      { error: 'Erro ao buscar permissões' },
      { status: 500 }
    );
  }
}
