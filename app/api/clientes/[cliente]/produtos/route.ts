import { NextResponse } from 'next/server';
import { fetchClienteProdutosList } from '@/lib/repositories/vendedores-v2';

export const maxDuration = 60;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ cliente: string }> }
) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') ?? undefined;
  const filial = searchParams.get('filial');
  const startParam = searchParams.get('start');
  const endParam = searchParams.get('end');
  const range = startParam && endParam ? { start: startParam, end: endParam } : undefined;

  const { cliente: clienteEncoded } = await params;
  const clienteNome = decodeURIComponent(clienteEncoded);

  if (!filial) {
    return NextResponse.json({ error: 'Filial é obrigatória' }, { status: 400 });
  }

  try {
    const data = await fetchClienteProdutosList({ company, clienteNome, filial, range });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Erro ao carregar produtos do cliente', error);
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ETIMEOUT') {
      return NextResponse.json({ error: 'Timeout: A consulta demorou muito.', code: 'ETIMEOUT' }, { status: 504 });
    }
    return NextResponse.json({ error: 'Erro ao carregar produtos do cliente' }, { status: 500 });
  }
}
