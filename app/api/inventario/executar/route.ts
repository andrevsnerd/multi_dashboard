import { NextResponse } from 'next/server';

import { getConnectionPool } from '@/lib/db/connection';
import { shouldUseProxy, ProxyPool } from '@/lib/db/proxy';
import { findUserByUsername } from '@/lib/auth/users-store';
import { isReadOnlyRole } from '@/lib/auth/permissions';
import { resolverNomeFilial } from '@/lib/repositories/ajusteEstoque';
import { calcularDiferencasBipagem, type LinhaBipada } from '@/lib/repositories/inventarioBipagem';
import { executarAjusteContagem } from '@/lib/ajuste-estoque-executor';
import { resolveResponsavelLinx } from '@/lib/server/responsavel-linx';
import { salvarKpisAjuste } from '@/lib/utils/ajuste-estoque-kpis-store';
import { inventarioRascunhoId, removerInventarioRascunho } from '@/lib/utils/inventario-draft-store';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

interface ExecutarRequest {
  companyKey: string;
  filialCod: string;
  nomeContagem: string;
  dataContagem: string; // 'YYYY-MM-DD'
  obs?: string | null;
  itens: LinhaBipada[];
}

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00`).getTime());
}

/**
 * POST /api/inventario/executar — sobe o inventário bipado.
 *
 * Recalcula as diferenças contra o saldo de AGORA (nunca confia no que a tela
 * calculou) e grava pelo mesmo executor do Ajuste de Estoque: contagem nativa no
 * Linx, trigger move o estoque tamanho a tamanho, tudo-ou-nada. Aparece no
 * histórico de ajustes (Ajustes recentes) e pode ser desfeita por estorno.
 *
 * Dupla gravação: a descrição (NOME_CONTAGEM) é PK no Linx e o executor recusa
 * nome repetido — clique duplo ou "achou que falhou e mandou de novo" esbarra nela.
 */
export async function POST(request: Request) {
  try {
    const username = request.headers.get('x-auth-username')?.trim();
    if (!username) {
      return NextResponse.json({ error: 'Usuário não identificado. Faça login novamente.' }, { status: 401 });
    }
    const user = await findUserByUsername(username);
    if (!user) {
      return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 403 });
    }
    if (isReadOnlyRole(user.role)) {
      return NextResponse.json(
        { error: 'Acesso somente leitura: esta função não pode subir inventário.' },
        { status: 403 }
      );
    }

    const body = (await request.json()) as ExecutarRequest;
    const filialCod = (body.filialCod || '').trim();
    const nomeContagem = (body.nomeContagem || '').trim();
    // Inventário é sempre completo (regra do dono, evita erro humano): o que tem
    // saldo e não foi bipado vira 0. O parâmetro não é aceito do cliente.
    const zerarNaoContados = true;

    if (!filialCod || !Array.isArray(body.itens) || body.itens.length === 0) {
      return NextResponse.json({ error: 'Nenhum item bipado.' }, { status: 400 });
    }
    if (!nomeContagem) {
      return NextResponse.json({ error: 'Informe a descrição do inventário.' }, { status: 400 });
    }
    if (nomeContagem.length > 25) {
      return NextResponse.json({ error: 'A descrição deve ter no máximo 25 caracteres.' }, { status: 400 });
    }
    if (!isValidDate(body.dataContagem)) {
      return NextResponse.json({ error: 'Data do inventário inválida.' }, { status: 400 });
    }

    const filialNome = await resolverNomeFilial(filialCod);
    if (!filialNome) {
      return NextResponse.json({ error: 'Filial não encontrada.' }, { status: 404 });
    }

    const dif = await calcularDiferencasBipagem({ filialNome, linhas: body.itens, zerarNaoContados });
    if (dif.pendenciasTamanho.length > 0) {
      return NextResponse.json(
        {
          error: `Escolha o tamanho (P/M/G) de: ${dif.pendenciasTamanho.slice(0, 8).join(', ')}${
            dif.pendenciasTamanho.length > 8 ? '…' : ''
          }. Nada foi gravado.`,
        },
        { status: 400 }
      );
    }

    const itens = dif.linhas
      .filter((l) => l.delta !== 0 || l.ajustaTamanho)
      .map((l) => ({ produto: l.produto, cor: l.cor, contagem: l.contagem, tamanhos: l.contagemTamanhos }));
    if (itens.length === 0) {
      return NextResponse.json(
        { error: 'Nenhuma diferença: o que foi bipado já bate com o saldo da filial.' },
        { status: 400 }
      );
    }

    const pool = shouldUseProxy() ? new ProxyPool() : await getConnectionPool();
    let resultado;
    try {
      resultado = await executarAjusteContagem(pool as unknown as { request: () => unknown }, {
        filialNome,
        nomeContagem,
        emissao: `${body.dataContagem} 00:00:00`,
        responsavel: await resolveResponsavelLinx(username),
        obs: body.obs?.trim() || null,
        itens,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Erro ao subir o inventário.';
      // Nome repetido quase sempre é o mesmo inventário mandado duas vezes.
      const repetido = /Já existe uma contagem/i.test(msg);
      return NextResponse.json(
        {
          error: repetido
            ? `${msg} Se você já tinha clicado em subir, confira em "Histórico" antes de repetir — o inventário pode já ter sido aplicado.`
            : msg,
        },
        { status: repetido ? 409 : 500 }
      );
    }

    // Best-effort: o inventário já está no Linx; falhar aqui só tira os quadros do histórico.
    await salvarKpisAjuste({
      nomeContagem: resultado.nomeContagem,
      filialNome,
      modo: 'inventario',
      itens: dif.totais.itens,
      saldoFinalTotal: dif.totais.saldoFinalTotal,
      itensSaldoNegativo: dif.totais.itensSaldoNegativo,
      naoEncontrados: 0,
      ambiguos: 0,
      invalidas: 0,
      criadoEm: new Date().toISOString(),
    }).catch((err) => console.error('[inventario/executar] snapshot KPIs', err));

    if (body.companyKey) {
      await removerInventarioRascunho(inventarioRascunhoId(body.companyKey, username, filialCod)).catch((err) =>
        console.error('[inventario/executar] remover rascunho', err)
      );
    }

    return NextResponse.json({ ...resultado, filialNome, totais: dif.totais, naoBipados: dif.naoBipados });
  } catch (error) {
    console.error('[inventario/executar] erro', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao subir o inventário.' },
      { status: 500 }
    );
  }
}
