import { NextResponse } from 'next/server';

import { getConnectionPool } from '@/lib/db/connection';
import { shouldUseProxy, ProxyPool } from '@/lib/db/proxy';
import { resolverNomeFilial } from '@/lib/repositories/ajusteEstoque';
import { calcularDiferencasBipagem, type LinhaBipada } from '@/lib/repositories/inventarioBipagem';
import { encontrarNomeContagemLivre } from '@/lib/ajuste-estoque-executor';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface PreviewRequest {
  filialCod: string;
  itens: LinhaBipada[];
  nomeContagem?: string;
  /** A descrição é a sugerida pela tela (não digitada) — pode trocar por uma livre. */
  nomeAutomatico?: boolean;
}

/**
 * POST /api/inventario/preview — confere a lista bipada contra o saldo ATUAL da
 * filial antes de subir (a tela calcula em tempo real sobre o saldo carregado ao
 * abrir a filial; aqui é a foto de agora, a que vai para a confirmação).
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PreviewRequest;
    const filialCod = (body.filialCod || '').trim();
    if (!filialCod || !Array.isArray(body.itens)) {
      return NextResponse.json({ error: 'Parâmetros inválidos.' }, { status: 400 });
    }
    const filialNome = await resolverNomeFilial(filialCod);
    if (!filialNome) {
      return NextResponse.json({ error: 'Filial não encontrada.' }, { status: 404 });
    }

    const resultado = await calcularDiferencasBipagem({
      filialNome,
      linhas: body.itens,
      // Inventário é sempre completo (regra do dono): não existe parcial.
      zerarNaoContados: true,
    });

    // Segundo inventário da filial no mesmo dia: a sugestão já existe no Linx
    // (NOME_CONTAGEM é PK). Só troca a sugestão automática — nome digitado é do usuário.
    let nomeSugerido: string | null = null;
    const nome = (body.nomeContagem || '').trim();
    if (body.nomeAutomatico && nome) {
      const pool = shouldUseProxy() ? new ProxyPool() : await getConnectionPool();
      const livre = await encontrarNomeContagemLivre(pool as unknown as { request: () => unknown }, nome);
      if (livre !== nome) nomeSugerido = livre;
    }

    return NextResponse.json({
      filialNome,
      totais: resultado.totais,
      naoBipados: resultado.naoBipados,
      pendenciasTamanho: resultado.pendenciasTamanho,
      nomeSugerido,
    });
  } catch (error) {
    console.error('[inventario/preview] erro', error);
    return NextResponse.json({ error: 'Erro ao calcular as diferenças.' }, { status: 500 });
  }
}
