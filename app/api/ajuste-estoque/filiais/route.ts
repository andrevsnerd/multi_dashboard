import { NextResponse } from 'next/server';

import { listarFiliaisParaAjuste } from '@/lib/repositories/ajusteEstoque';
import { resolveCompany } from '@/lib/config/company';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const companySlug = searchParams.get('company') ?? '';
    const company = resolveCompany(companySlug);
    if (!company) {
      return NextResponse.json({ error: 'Empresa inválida.' }, { status: 400 });
    }
    const { ativas, inativas } = await listarFiliaisParaAjuste(company.key);
    return NextResponse.json({ ativas, inativas });
  } catch (error) {
    console.error('[ajuste-estoque/filiais] erro', error);
    return NextResponse.json({ error: 'Erro ao listar filiais.' }, { status: 500 });
  }
}
