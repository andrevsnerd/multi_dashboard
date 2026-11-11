import { NextResponse } from 'next/server';

import { autorizarCores, parseCorCompany } from '@/lib/auth/cores-guard';
import {
  completarCodigosDaCor,
  fetchUsoCodigoBarra,
  inativarCodigoBarra,
  removerCodigoBarraSemUso,
} from '@/lib/repositories/produtoCores';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

interface Body {
  company?: string;
  /** completar — gera só o código (interno/EAN) que falta na cor; remover — tira duplicado sem uso; uso — onde o código aparece. */
  acao?: 'completar' | 'remover' | 'inativar' | 'uso';
  produto?: string;
  cor?: string;
  codigo?: string;
  ensaio?: boolean;
  obs?: string | null;
}

/**
 * Manutenção dos códigos de barra de uma cor que já existe: o cadastro tem de
 * ficar completo (1 interno + 1 EAN por tamanho) e sem duplicado sem uso.
 */
export async function POST(request: Request) {
  const autorizacao = await autorizarCores(request, { exigirEscrita: true });
  if ('erro' in autorizacao) return autorizacao.erro;

  try {
    const body = (await request.json()) as Body;
    const company = parseCorCompany(body.company);
    if (!company) return NextResponse.json({ error: 'Empresa inválida.' }, { status: 400 });
    const obs = typeof body.obs === 'string' ? body.obs : null;

    if (body.acao === 'completar') {
      const resultado = await completarCodigosDaCor({
        company,
        usuario: autorizacao.auth.username,
        produto: body.produto ?? '',
        cor: body.cor ?? '',
        ensaio: Boolean(body.ensaio),
        obs,
      });
      return NextResponse.json(resultado);
    }
    if (body.acao === 'remover') {
      const resultado = await removerCodigoBarraSemUso({
        company,
        usuario: autorizacao.auth.username,
        codigo: body.codigo ?? '',
        obs,
      });
      return NextResponse.json(resultado);
    }
    if (body.acao === 'inativar') {
      const resultado = await inativarCodigoBarra({
        company,
        usuario: autorizacao.auth.username,
        codigo: body.codigo ?? '',
        obs,
      });
      return NextResponse.json(resultado);
    }
    if (body.acao === 'uso') {
      return NextResponse.json({ codigo: body.codigo, uso: await fetchUsoCodigoBarra(body.codigo ?? '') });
    }
    return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
  } catch (error) {
    console.error('[etiquetas/cores/codigos] erro', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro nos códigos de barra.' },
      { status: 500 }
    );
  }
}
