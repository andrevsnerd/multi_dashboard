import { NextResponse } from 'next/server';

import { resolverNomeFilial, trazerSaldo } from '@/lib/repositories/ajusteEstoque';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/inventario/saldo?filialCod=000101
 *
 * Saldo atual da filial (itens com estoque ≠ 0, total + por tamanho) — a base com
 * que a tela de Inventário calcula as diferenças em tempo real enquanto bipa.
 * É a mesma leitura do "Calcular diferenças" do Ajuste de Estoque (trazerSaldo).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const filialCod = (searchParams.get('filialCod') || '').trim();
  if (!filialCod) {
    return NextResponse.json({ error: 'Informe a filial.' }, { status: 400 });
  }
  try {
    const filialNome = await resolverNomeFilial(filialCod);
    if (!filialNome) {
      return NextResponse.json({ error: 'Filial não encontrada.' }, { status: 404 });
    }
    const itens = await trazerSaldo(filialNome, false);
    return NextResponse.json({ filialNome, itens, carregadoEm: new Date().toISOString() });
  } catch (error) {
    console.error('[inventario/saldo] erro', error);
    return NextResponse.json({ error: 'Erro ao carregar o saldo da filial.' }, { status: 500 });
  }
}
