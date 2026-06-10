import { NextResponse } from 'next/server';

import { fetchAvailableCores } from '@/lib/repositories/controleEstoque';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') ?? undefined;
  const filial = searchParams.get('filial') || null;

  try {
    const data = await fetchAvailableCores({ company, filial });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Erro ao carregar cores', error);
    return NextResponse.json({ error: 'Erro ao carregar cores' }, { status: 500 });
  }
}
