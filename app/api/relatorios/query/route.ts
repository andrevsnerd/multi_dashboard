import { NextResponse } from 'next/server';

import { executarQueryRelatorio, type RelatorioType } from '@/lib/repositories/relatorios';

export const maxDuration = 300; // 5 minutos para queries grandes

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tipo = searchParams.get('tipo') as RelatorioType;

  if (!tipo) {
    return NextResponse.json(
      { error: 'Parâmetro tipo é obrigatório' },
      { status: 400 }
    );
  }

  try {
    const data = await executarQueryRelatorio(tipo);
    
    return NextResponse.json({
      success: true,
      tipo,
      registros: data.length,
      data,
    });
  } catch (error) {
    console.error(`Erro ao executar query ${tipo}:`, error);
    
    return NextResponse.json(
      {
        error: `Erro ao executar query ${tipo}`,
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}







