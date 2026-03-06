import { NextResponse } from 'next/server';
import { fetchLogEntradas } from '@/lib/repositories/logEntradas';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') || '200', 10) || 200, 500);
  const dias = Math.min(parseInt(searchParams.get('dias') || '30', 10) || 30, 90);

  try {
    const transferencias = await fetchLogEntradas(limit, dias);
    return NextResponse.json({ data: transferencias });
  } catch (error) {
    console.error('Erro ao buscar log de transferências', error);
    return NextResponse.json(
      { error: 'Erro ao buscar log de transferências' },
      { status: 500 }
    );
  }
}
