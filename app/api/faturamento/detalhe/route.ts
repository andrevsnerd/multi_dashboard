import { NextResponse } from 'next/server';

import { fetchNotaFiscalDetalhe } from '@/lib/repositories/faturamento';

export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const nf = searchParams.get('nf');
  const serie = searchParams.get('serie');
  const filial = searchParams.get('filial');

  if (!nf) {
    return NextResponse.json({ error: 'Informe o parâmetro `nf`.' }, { status: 400 });
  }

  try {
    const data = await fetchNotaFiscalDetalhe({ nfSaida: nf, serie, filial });
    if (!data.header) {
      return NextResponse.json({ error: 'NF não encontrada.' }, { status: 404 });
    }
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Erro ao carregar detalhe da NF', error);
    return NextResponse.json({ error: 'Erro ao carregar detalhe da NF' }, { status: 500 });
  }
}
