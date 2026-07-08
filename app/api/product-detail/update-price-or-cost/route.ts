import { NextResponse } from 'next/server';
import { updateProductPrecoOrCusto } from '@/lib/repositories/productDetail';
import { readOnlyBlock } from '@/lib/auth/route-guards';

export async function PATCH(request: Request) {
  try {
    const readOnly = await readOnlyBlock(request.headers.get('x-auth-username'));
    if (readOnly) return readOnly;
    const body = (await request.json()) as {
      productId?: string;
      company?: string;
      codTabela?: string;
      origem?: 'PRODUTOS' | 'PRODUTOS_PRECOS';
      campo?: string;
      novoValor?: number;
    };

    const { productId, codTabela, origem, campo, novoValor } = body;

    if (!productId || codTabela === undefined || !origem || !campo || typeof novoValor !== 'number') {
      return NextResponse.json(
        { error: 'Campos obrigatórios: productId, codTabela, origem, campo, novoValor (número)' },
        { status: 400 }
      );
    }

    if (novoValor < 0) {
      return NextResponse.json(
        { error: 'Valor não pode ser negativo' },
        { status: 400 }
      );
    }

    const result = await updateProductPrecoOrCusto({
      productId,
      codTabela: String(codTabela),
      origem,
      campo,
      novoValor,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.message },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      rowsAffected: result.rowsAffected,
      message: result.message,
    });
  } catch (error) {
    console.error('Erro ao atualizar preço/custo', error);
    return NextResponse.json(
      { error: 'Erro ao atualizar preço ou custo' },
      { status: 500 }
    );
  }
}
