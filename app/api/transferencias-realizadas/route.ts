import { NextResponse } from 'next/server';
import {
  readTransferenciasRealizadas,
  writeTransferenciasRealizadas,
} from '@/lib/utils/transferencias-realizadas-storage';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyKey = searchParams.get('company');

  if (!companyKey) {
    return NextResponse.json(
      { error: 'Parâmetro company é obrigatório' },
      { status: 400 }
    );
  }

  try {
    const markedKeys = await readTransferenciasRealizadas(companyKey);
    return NextResponse.json({ markedKeys });
  } catch (error) {
    console.error('[api/transferencias-realizadas] Erro ao ler', error);
    return NextResponse.json(
      { error: 'Erro ao carregar marcações' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { companyKey, markedKeys } = body;

    if (!companyKey || !Array.isArray(markedKeys)) {
      return NextResponse.json(
        { error: 'Parâmetros companyKey e markedKeys (array) são obrigatórios' },
        { status: 400 }
      );
    }

    await writeTransferenciasRealizadas(companyKey, markedKeys);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[api/transferencias-realizadas] Erro ao salvar', error);
    return NextResponse.json(
      { error: 'Erro ao salvar marcações' },
      { status: 500 }
    );
  }
}
