import { NextRequest, NextResponse } from 'next/server';

import { findUserByUsername } from '@/lib/auth/users-store';
import { updateProductColorRegistration } from '@/lib/repositories/productDetail';

async function isAdmin(username: string): Promise<boolean> {
  const user = await findUserByUsername(username);
  return user?.role === 'admin';
}

export async function PATCH(request: NextRequest) {
  try {
    const username = request.headers.get('x-auth-username')?.trim();
    if (!username || !(await isAdmin(username))) {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 });
    }

    const body = (await request.json()) as {
      productId?: string;
      currentCode?: string;
      code?: string;
      description?: string;
    };

    const productId = String(body.productId ?? '').trim();
    const currentCode = String(body.currentCode ?? '').trim();
    const code = String(body.code ?? '').trim().toUpperCase();
    const description = String(body.description ?? '').trim().toUpperCase();

    if (!productId) {
      return NextResponse.json({ error: 'Produto e obrigatorio.' }, { status: 400 });
    }
    if (!code) {
      return NextResponse.json({ error: 'Codigo da cor e obrigatorio.' }, { status: 400 });
    }
    if (code.length > 10) {
      return NextResponse.json({ error: 'Codigo da cor deve ter no maximo 10 caracteres.' }, { status: 400 });
    }
    if (!description) {
      return NextResponse.json({ error: 'Descricao da cor e obrigatoria.' }, { status: 400 });
    }
    if (description.length > 25) {
      return NextResponse.json({ error: 'Descricao da cor deve ter no maximo 25 caracteres.' }, { status: 400 });
    }

    const result = await updateProductColorRegistration({
      productId,
      currentCode,
      newCode: code,
      description,
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('Erro ao atualizar cadastro da cor', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao atualizar cadastro da cor' },
      { status: 500 }
    );
  }
}
