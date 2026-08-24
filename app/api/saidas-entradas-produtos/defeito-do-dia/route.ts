import { NextResponse } from 'next/server';
import { buscarDefeitoDoDia, mensagemTravaDefeito } from '@/lib/server/trava-defeito';

/**
 * Consulta da TRAVA DE DEFEITO (ver `lib/server/trava-defeito.ts`): a tela usa
 * isto para AVISAR e desabilitar o botão antes do gerente montar o romaneio.
 * Quem realmente bloqueia é a rota `executar` — aqui é só leitura.
 *
 * GET /api/saidas-entradas-produtos/defeito-do-dia?company=nerd&filial=000107
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyKey = (searchParams.get('company') || '').trim();
  const filial = (searchParams.get('filial') || '').trim();

  if (!filial) {
    return NextResponse.json({ error: 'Parâmetro "filial" é obrigatório.' }, { status: 400 });
  }

  try {
    const existente = await buscarDefeitoDoDia(companyKey, filial);
    return NextResponse.json({
      data: existente,
      travado: !!existente,
      mensagem: existente ? mensagemTravaDefeito(existente) : null,
    });
  } catch (error) {
    console.error('Erro ao consultar romaneio de defeito do dia', error);
    return NextResponse.json(
      { error: 'Erro ao consultar romaneio de defeito do dia' },
      { status: 500 }
    );
  }
}
