import { NextResponse } from 'next/server';

import { parseCadastroCompany } from '@/lib/auth/cadastro-guard';
import { canRenomearProduto, normalizeRole } from '@/lib/auth/permissions';
import { findUserByUsername } from '@/lib/auth/users-store';
import { executarAlteracaoCadastro } from '@/lib/repositories/cadastro';

export const dynamic = 'force-dynamic';

/** DESC_PRODUTO e VARCHAR(40) no Linx — mesmo limite do registro de campos do cadastro. */
const MAX_NOME = 40;

/**
 * Renomeia o produto (PRODUTOS.DESC_PRODUTO) direto da tela Produto Detalhado.
 *
 * Nao existe SQL de rename aqui de proposito: passa pelo executor canonico do
 * cadastro (`executarAlteracaoCadastro`), que le -> grava -> RELE para confirmar
 * -> registra no historico. Assim o rename feito aqui aparece e pode ser
 * estornado no Alterar Cadastro, igual ao feito por la.
 */
export async function PATCH(request: Request) {
  try {
    const username = request.headers.get('x-auth-username')?.trim();
    if (!username) {
      return NextResponse.json(
        { error: 'Usuario nao identificado. Faca login novamente.' },
        { status: 401 }
      );
    }

    const user = await findUserByUsername(username);
    if (!user) {
      return NextResponse.json({ error: 'Usuario nao encontrado.' }, { status: 403 });
    }
    if (!canRenomearProduto(normalizeRole(user.role))) {
      return NextResponse.json(
        { error: 'Esta funcao nao pode renomear produtos.' },
        { status: 403 }
      );
    }

    const body = (await request.json()) as {
      productId?: string;
      company?: string;
      nome?: string;
      obs?: string | null;
    };

    const company = parseCadastroCompany(body.company);
    if (!company) {
      return NextResponse.json({ error: 'Empresa invalida.' }, { status: 400 });
    }

    const productId = String(body.productId ?? '').trim();
    if (!productId) {
      return NextResponse.json({ error: 'Produto e obrigatorio.' }, { status: 400 });
    }

    // Espaco duplo em DESC_PRODUTO quebra a busca por nome (o cadastro do Linx ja
    // tem centenas assim) — colapsa aqui para nao criar mais um.
    const nome = String(body.nome ?? '')
      .trim()
      .replace(/\s+/g, ' ')
      .toUpperCase();

    if (!nome) {
      return NextResponse.json({ error: 'Informe o novo nome do produto.' }, { status: 400 });
    }
    if (nome.length > MAX_NOME) {
      return NextResponse.json(
        { error: `Nome do produto deve ter no maximo ${MAX_NOME} caracteres.` },
        { status: 400 }
      );
    }

    const obs = typeof body.obs === 'string' ? body.obs.trim() : '';

    const resultado = await executarAlteracaoCadastro({
      company,
      usuario: username,
      alteracoes: [{ produto: productId, campo: 'DESC_PRODUTO', valor: nome }],
      obs: obs || 'Renomeado no Produto Detalhado',
    });

    if (resultado.aplicados === 0 && resultado.semMudanca === 0) {
      const motivo =
        resultado.erros.length > 0
          ? resultado.erros.join(' ')
          : 'O Linx nao confirmou a gravacao do novo nome.';
      return NextResponse.json({ error: motivo }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      data: {
        productId,
        productName: nome,
        semMudanca: resultado.aplicados === 0 && resultado.semMudanca > 0,
        lote: resultado.lote,
      },
    });
  } catch (error) {
    console.error('[product-detail/rename] erro', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao renomear o produto.' },
      { status: 500 }
    );
  }
}
