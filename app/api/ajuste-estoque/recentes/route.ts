import { NextResponse } from 'next/server';

import { listarAjustesRecentes } from '@/lib/repositories/ajusteEstoque';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const username = request.headers.get('x-auth-username')?.trim();
    if (!username) {
      return NextResponse.json({ recentes: [] });
    }
    const recentes = await listarAjustesRecentes(username);
    return NextResponse.json({ recentes });
  } catch (error) {
    console.error('[ajuste-estoque/recentes] erro', error);
    return NextResponse.json({ recentes: [] });
  }
}
