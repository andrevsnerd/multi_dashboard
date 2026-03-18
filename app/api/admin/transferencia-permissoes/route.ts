import { NextRequest, NextResponse } from 'next/server';
import {
  listAllPermissoes,
  savePermissao,
  deletePermissao,
} from '@/lib/utils/transferencia-permissoes-store';
import { findUserByUsername } from '@/lib/auth/users-store';
import type { TransferenciaPermissao } from '@/lib/utils/transferencia-permissoes-store';

async function isAdmin(username: string): Promise<boolean> {
  const user = await findUserByUsername(username);
  return user?.role === 'admin';
}

/**
 * GET /api/admin/transferencia-permissoes
 * Lista todas as permissões (apenas admin)
 */
export async function GET(request: NextRequest) {
  try {
    const username = request.headers.get('x-auth-username');
    if (!username || !(await isAdmin(username))) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const permissoes = await listAllPermissoes();
    return NextResponse.json(
      { data: permissoes },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error) {
    console.error('Erro ao listar permissões', error);
    return NextResponse.json(
      { error: 'Erro ao listar permissões' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/transferencia-permissoes
 * Cria ou atualiza permissões de um usuário (apenas admin)
 */
export async function POST(request: NextRequest) {
  try {
    const username = request.headers.get('x-auth-username');
    if (!username || !(await isAdmin(username))) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const body = await request.json();
    const {
      username: targetUsername,
      filiaisOrigem,
      filiaisDestino,
      filiaisDestinoControle,
      tiposRomaneioPermitidos,
      responsavelPadrao,
      tipoRomaneioPadrao,
      responsavelFixo,
      tipoRomaneioFixo,
      podeVerOutrasFiliais,
      filialAtribuida,
    } = body;

    if (!targetUsername) {
      return NextResponse.json(
        { error: 'Username é obrigatório' },
        { status: 400 }
      );
    }

    // Verificar se o usuário existe
    const targetUser = await findUserByUsername(targetUsername);
    if (!targetUser) {
      return NextResponse.json(
        { error: 'Usuário não encontrado' },
        { status: 404 }
      );
    }

    const permissao: TransferenciaPermissao = {
      username: targetUsername.toLowerCase().trim(),
      filiaisOrigem: Array.isArray(filiaisOrigem) ? filiaisOrigem : [],
      filiaisDestino: Array.isArray(filiaisDestino) ? filiaisDestino : [],
      filiaisDestinoControle: Array.isArray(filiaisDestinoControle) ? filiaisDestinoControle : [],
      tiposRomaneioPermitidos: Array.isArray(tiposRomaneioPermitidos) ? tiposRomaneioPermitidos : [],
      responsavelPadrao: responsavelPadrao || undefined,
      tipoRomaneioPadrao: tipoRomaneioPadrao || undefined,
      responsavelFixo: responsavelFixo === true,
      tipoRomaneioFixo: tipoRomaneioFixo === true,
      podeVerOutrasFiliais: podeVerOutrasFiliais === true,
      filialAtribuida:
        typeof filialAtribuida === "string" && filialAtribuida.trim()
          ? filialAtribuida.trim()
          : null,
    };

    await savePermissao(permissao);
    return NextResponse.json({ data: permissao });
  } catch (error) {
    console.error('Erro ao salvar permissão', error);
    return NextResponse.json(
      { error: 'Erro ao salvar permissão' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/transferencia-permissoes?username=xxx
 * Remove permissões de um usuário (apenas admin)
 */
export async function DELETE(request: NextRequest) {
  try {
    const username = request.headers.get('x-auth-username');
    if (!username || !(await isAdmin(username))) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const targetUsername = searchParams.get('username');

    if (!targetUsername) {
      return NextResponse.json(
        { error: 'Username é obrigatório' },
        { status: 400 }
      );
    }

    await deletePermissao(targetUsername);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Erro ao deletar permissão', error);
    return NextResponse.json(
      { error: 'Erro ao deletar permissão' },
      { status: 500 }
    );
  }
}
