import { NextResponse } from 'next/server';
import { fetchLogSaidas } from '@/lib/repositories/logSaidas';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') || '200', 10) || 200, 500);
  const dias = Math.min(parseInt(searchParams.get('dias') || '30', 10) || 30, 90);

  try {
    const saidas = await fetchLogSaidas(limit, dias);
    return NextResponse.json({ data: saidas });
  } catch (error) {
    console.error('Erro ao buscar log de saídas', error);
    return NextResponse.json(
      { error: 'Erro ao buscar log de saídas' },
      { status: 500 }
    );
  }
}
