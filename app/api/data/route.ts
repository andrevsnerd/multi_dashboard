import { NextResponse } from 'next/server';

import { processAllData } from '@/lib/services/dataPipeline';

export async function GET() {
  try {
    const data = await processAllData();
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Erro ao processar dados completos', error);
    return NextResponse.json(
      { error: 'Erro ao processar dados completos' },
      { status: 500 }
    );
  }
}



