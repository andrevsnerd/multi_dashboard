import { NextResponse } from 'next/server';
import { readTransferenciasRealizadas } from '@/lib/utils/transferencias-realizadas-storage';

/**
 * API para exportar/backup dos dados de transferências realizadas
 * Retorna todos os dados salvos para uma empresa em formato JSON
 */
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
    const markedKeys = await readTransferenciasRealizadas(companyKey);
    
    return NextResponse.json({
      companyKey,
      exportDate: new Date().toISOString(),
      totalItems: markedKeys.length,
      markedKeys,
    }, {
      headers: {
        'Content-Disposition': `attachment; filename="transferencias-realizadas-${companyKey}-${new Date().toISOString().split('T')[0]}.json"`,
      },
    });
  } catch (error) {
    console.error('[tr-realizadas] API EXPORT ERRO:', error);
    return NextResponse.json(
      { error: 'Erro ao exportar dados' },
      { status: 500 }
    );
  }
}
