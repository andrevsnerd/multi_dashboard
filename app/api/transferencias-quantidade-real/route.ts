import { NextResponse } from 'next/server';
import {
  readQuantidadesReais,
  writeQuantidadesReais,
} from '@/lib/utils/transferencias-quantidade-real-storage';
import { readOnlyBlock } from '@/lib/auth/route-guards';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyKey = searchParams.get('company')?.trim() ?? '';

  if (!companyKey) {
    return NextResponse.json(
      { error: 'Parâmetro company é obrigatório' },
      { status: 400 }
    );
  }

  try {
    const quantidadesReais = await readQuantidadesReais(companyKey);
    return NextResponse.json({ quantidadesReais });
  } catch (error) {
    console.error('[quantidade-real] API GET erro:', error);
    return NextResponse.json(
      { error: 'Erro ao carregar quantidades reais' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const readOnly = await readOnlyBlock(request.headers.get('x-auth-username'));
    if (readOnly) return readOnly;
    const body = await request.json();
    const companyKey = typeof body.companyKey === 'string' ? body.companyKey.trim() : '';
    const updates = body.updates && typeof body.updates === 'object' ? body.updates as Record<string, number | null> : null;

    if (!companyKey) {
      return NextResponse.json(
        { error: 'Parâmetro companyKey é obrigatório' },
        { status: 400 }
      );
    }
    if (!updates || typeof updates !== 'object') {
      return NextResponse.json(
        { error: 'Parâmetro updates (objeto item_key -> quantidade ou null) é obrigatório' },
        { status: 400 }
      );
    }

    await writeQuantidadesReais(companyKey, updates);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[quantidade-real] API POST erro:', error);
    return NextResponse.json(
      { error: 'Erro ao salvar quantidades reais' },
      { status: 500 }
    );
  }
}
