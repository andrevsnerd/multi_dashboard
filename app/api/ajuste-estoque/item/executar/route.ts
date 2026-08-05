import { NextResponse } from 'next/server';

import { getConnectionPool } from '@/lib/db/connection';
import { shouldUseProxy, ProxyPool } from '@/lib/db/proxy';
import { findUserByUsername } from '@/lib/auth/users-store';
import { isReadOnlyRole } from '@/lib/auth/permissions';
import { resolveCompany } from '@/lib/config/company';
import { resolveResponsavelLinx } from '@/lib/server/responsavel-linx';
import { resolverFilialAlvo } from '@/lib/repositories/ajusteEstoque';
import {
  executarAjusteContagem,
  encontrarNomeContagemLivre,
} from '@/lib/ajuste-estoque-executor';

export const dynamic = 'force-dynamic';

interface AjustarItemRequest {
  company: string;
  /** COD_FILIAL onde o saldo será definido. */
  filialCod: string;
  itens: Array<{ produto: string; cor: string; quantidade: number }>;
  dataContagem: string; // 'YYYY-MM-DD'
  obs?: string | null;
}

const QTDE_MAX = 999999;

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00`).getTime());
}

function compactar(nome: string): string {
  return (nome || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Define o saldo de itens (produto×cor) numa filial para a quantidade escolhida
 * (zerar = quantidade 0, não tem rota separada). O delta é recalculado no executor
 * contra o saldo ATUAL (corrida-seguro) e a escrita é uma contagem nativa do Linx
 * — aparece no extrato e dá pra desfazer.
 */
export async function POST(request: Request) {
  try {
    const username = request.headers.get('x-auth-username')?.trim();
    if (!username) {
      return NextResponse.json(
        { error: 'Usuário não identificado. Faça login novamente.' },
        { status: 401 }
      );
    }
    const user = await findUserByUsername(username);
    if (!user) {
      return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 403 });
    }
    if (isReadOnlyRole(user.role)) {
      return NextResponse.json(
        { error: 'Acesso somente leitura: esta função não pode executar ajustes.' },
        { status: 403 }
      );
    }

    const body = (await request.json()) as AjustarItemRequest;
    const company = resolveCompany(body?.company ?? '');
    if (!company) {
      return NextResponse.json({ error: 'Empresa inválida.' }, { status: 400 });
    }
    if (!isValidDate(body?.dataContagem ?? '')) {
      return NextResponse.json({ error: 'Data da contagem inválida.' }, { status: 400 });
    }
    if (!Array.isArray(body?.itens) || body.itens.length === 0) {
      return NextResponse.json({ error: 'Nenhum item para ajustar.' }, { status: 400 });
    }

    const itens: Array<{ produto: string; cor: string; contagem: number }> = [];
    for (const raw of body.itens) {
      const produto = (raw?.produto ?? '').trim();
      if (!produto) continue;
      const qtde = Number(raw?.quantidade);
      if (!Number.isInteger(qtde) || qtde < 0 || qtde > QTDE_MAX) {
        return NextResponse.json(
          {
            error: `Quantidade inválida para o produto ${produto}: use um número inteiro entre 0 e ${QTDE_MAX}.`,
          },
          { status: 400 }
        );
      }
      itens.push({ produto, cor: (raw?.cor ?? '').trim(), contagem: qtde });
    }
    if (itens.length === 0) {
      return NextResponse.json({ error: 'Nenhum item válido.' }, { status: 400 });
    }

    const filial = await resolverFilialAlvo(body?.filialCod ?? '', company.key);
    if (!filial) {
      return NextResponse.json(
        { error: 'Filial não encontrada ou fora do escopo desta empresa.' },
        { status: 404 }
      );
    }

    const pool = shouldUseProxy() ? new ProxyPool() : await getConnectionPool();
    const poolLike = pool as unknown as { request: () => unknown };

    const [, mm, dd] = body.dataContagem.split('-');
    const codCompact = compactar(filial.cod).slice(0, 8);
    // Descrição no extrato: AJ<filial><ddmm> (+ sufixo se a PK já existir).
    const nomeContagem = await encontrarNomeContagemLivre(
      poolLike,
      `AJ${codCompact}${dd ?? ''}${mm ?? ''}`
    );

    const resultado = await executarAjusteContagem(poolLike, {
      filialNome: filial.nome,
      nomeContagem,
      emissao: `${body.dataContagem} 00:00:00`,
      responsavel: await resolveResponsavelLinx(username),
      obs: body.obs?.trim() || `AJUSTE ITEM (${itens.length} SKU)`,
      itens,
    });

    return NextResponse.json({
      cod: filial.cod,
      filial: filial.nome,
      nomeContagem: resultado.nomeContagem,
      itensAjustados: resultado.itensAjustados,
      somaDelta: resultado.somaDelta,
      semDiferenca: resultado.semDiferenca,
    });
  } catch (error) {
    console.error('[ajuste-estoque/item/executar] erro', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao ajustar o item.' },
      { status: 500 }
    );
  }
}
