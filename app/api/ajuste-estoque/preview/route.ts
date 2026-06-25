import { NextResponse } from 'next/server';

import { calcularDiferencas, resolverNomeFilial } from '@/lib/repositories/ajusteEstoque';

export const dynamic = 'force-dynamic';

interface PreviewRequest {
  filialCod: string;
  modo: 'zerar' | 'inventario';
  arquivoTexto?: string;
  zerarNaoContados?: boolean;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PreviewRequest;
    const { filialCod, modo } = body;

    if (!filialCod || (modo !== 'zerar' && modo !== 'inventario')) {
      return NextResponse.json({ error: 'Parâmetros inválidos.' }, { status: 400 });
    }
    if (modo === 'inventario' && !body.arquivoTexto?.trim()) {
      return NextResponse.json({ error: 'Arquivo de inventário vazio.' }, { status: 400 });
    }

    const filialNome = await resolverNomeFilial(filialCod);
    if (!filialNome) {
      return NextResponse.json({ error: 'Filial não encontrada.' }, { status: 404 });
    }

    const resultado = await calcularDiferencas({
      filialNome,
      modo,
      arquivoTexto: body.arquivoTexto,
      zerarNaoContados: body.zerarNaoContados,
    });

    return NextResponse.json({ filialNome, ...resultado });
  } catch (error) {
    console.error('[ajuste-estoque/preview] erro', error);
    return NextResponse.json({ error: 'Erro ao calcular diferenças.' }, { status: 500 });
  }
}
