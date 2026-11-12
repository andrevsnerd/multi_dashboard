import { NextResponse } from 'next/server';

import { autorizarPrecos, parsePrecoCompany } from '@/lib/auth/precos-guard';
import {
  alterarLiquidoCor,
  fetchProdutoCor,
  ligarModoCor,
  type AlteracaoLiquidoCor,
} from '@/lib/repositories/precosCor';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Aba "Por cor": preço de cada cor de um produto numa tabela. */
export async function GET(request: Request) {
  const autorizacao = await autorizarPrecos(request);
  if ('erro' in autorizacao) return autorizacao.erro;

  const url = new URL(request.url);
  const codigo = url.searchParams.get('codigo')?.trim() ?? '';
  if (!codigo) return NextResponse.json({ error: 'Informe o código do produto.' }, { status: 400 });

  try {
    const produto = await fetchProdutoCor(codigo, url.searchParams.get('tabela'));
    if (!produto) return NextResponse.json({ error: `Produto ${codigo} não encontrado.` }, { status: 404 });
    return NextResponse.json({ produto, podeExecutar: autorizacao.auth.podeExecutar });
  } catch (error) {
    console.error('[precos/cor] GET', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao buscar o produto.' },
      { status: 500 }
    );
  }
}

interface Body {
  company?: string;
  acao?: 'ligar' | 'alterar';
  produto?: string;
  tabela?: string;
  alteracoes?: AlteracaoLiquidoCor[];
}

/** `ligar` = liga o modo cor do produto; `alterar` = grava o Preço Líquido (1) por cor. */
export async function POST(request: Request) {
  const autorizacao = await autorizarPrecos(request, { exigirEscrita: true });
  if ('erro' in autorizacao) return autorizacao.erro;

  try {
    const body = (await request.json()) as Body;
    const company = parsePrecoCompany(body.company);
    if (!company) return NextResponse.json({ error: 'Empresa inválida.' }, { status: 400 });
    const produto = body.produto?.trim() ?? '';
    if (!produto) return NextResponse.json({ error: 'Produto não informado.' }, { status: 400 });
    const usuario = autorizacao.auth.username;

    if (body.acao === 'ligar') {
      return NextResponse.json(await ligarModoCor({ produto, company, usuario }));
    }
    if (body.acao === 'alterar') {
      if (!Array.isArray(body.alteracoes) || body.alteracoes.length === 0) {
        return NextResponse.json({ error: 'Nenhuma alteração informada.' }, { status: 400 });
      }
      return NextResponse.json(
        await alterarLiquidoCor({ produto, tabela: body.tabela ?? '', alteracoes: body.alteracoes, company, usuario })
      );
    }
    return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
  } catch (error) {
    console.error('[precos/cor] POST', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao gravar.' },
      { status: 500 }
    );
  }
}
