import { NextResponse } from 'next/server';

import { buscarItensParaZerar } from '@/lib/repositories/ajusteEstoque';
import { resolveCompany } from '@/lib/config/company';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const companySlug = searchParams.get('company') ?? '';
    const termo = (searchParams.get('q') ?? '').trim();

    const company = resolveCompany(companySlug);
    if (!company) {
      return NextResponse.json({ error: 'Empresa inválida.' }, { status: 400 });
    }
    if (termo.length < 2) {
      return NextResponse.json({ itens: [] });
    }

    const itens = await buscarItensParaZerar(company.key, termo);
    return NextResponse.json({ itens });
  } catch (error) {
    console.error('[ajuste-estoque/zerar-item/buscar] erro', error);
    return NextResponse.json({ error: 'Erro ao buscar itens.' }, { status: 500 });
  }
}
