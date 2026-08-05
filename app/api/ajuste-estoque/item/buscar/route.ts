import { NextResponse } from 'next/server';

import { buscarItensParaAjuste } from '@/lib/repositories/ajusteEstoque';
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

    // Zerados incluídos: a aba de ajuste também sobe quantidade, então item sem
    // saldo tem que aparecer na busca.
    const itens = await buscarItensParaAjuste(company.key, termo, { incluirZerados: true });
    return NextResponse.json({ itens });
  } catch (error) {
    console.error('[ajuste-estoque/item/buscar] erro', error);
    return NextResponse.json({ error: 'Erro ao buscar itens.' }, { status: 500 });
  }
}
