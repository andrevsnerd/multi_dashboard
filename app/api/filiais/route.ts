import { NextResponse } from 'next/server';

import { fetchFiliaisDetalhadas } from '@/lib/repositories/filiais';
import { getPublicDatabaseErrorMessage } from '@/lib/db/connection';

export const maxDuration = 120;

export async function GET() {
  try {
    const data = await fetchFiliaisDetalhadas();
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Erro ao carregar filiais:', error);
    return NextResponse.json(
      { error: getPublicDatabaseErrorMessage(error) },
      { status: 500 }
    );
  }
}
