import { NextResponse } from 'next/server';
import {
  readTransferenciasRealizadas,
  writeTransferenciasRealizadas,
} from '@/lib/utils/transferencias-realizadas-storage';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyKey = searchParams.get('company')?.trim() ?? '';
  console.log('[tr-realizadas] API GET: company=', JSON.stringify(companyKey));

  if (!companyKey) {
    return NextResponse.json(
      { error: 'Parâmetro company é obrigatório' },
      { status: 400 }
    );
  }

  try {
    const markedKeys = await readTransferenciasRealizadas(companyKey);
    console.log('[tr-realizadas] API GET ok: company=', companyKey, 'markedKeys.length=', markedKeys?.length);
    return NextResponse.json({ markedKeys });
  } catch (error) {
    console.error('[tr-realizadas] API GET ERRO:', error);
    return NextResponse.json(
      { error: 'Erro ao carregar marcações' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  console.log('[tr-realizadas] API POST: chamado');
  try {
    const body = await request.json();
    const companyKey = typeof body.companyKey === 'string' ? body.companyKey.trim() : '';
    const markedKeys = Array.isArray(body.markedKeys) ? body.markedKeys : null;
    console.log('[tr-realizadas] API POST: companyKey=', JSON.stringify(companyKey), 'markedKeys length=', markedKeys?.length);

    if (!companyKey || !Array.isArray(markedKeys)) {
      console.log('[tr-realizadas] API POST: 400 bad request');
      return NextResponse.json(
        { error: 'Parâmetros companyKey e markedKeys (array) são obrigatórios' },
        { status: 400 }
      );
    }

    await writeTransferenciasRealizadas(companyKey, markedKeys);
    console.log('[tr-realizadas] API POST ok: company=', companyKey, 'saved');
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[tr-realizadas] API POST ERRO:', error);
    return NextResponse.json(
      { error: 'Erro ao salvar marcações' },
      { status: 500 }
    );
  }
}
