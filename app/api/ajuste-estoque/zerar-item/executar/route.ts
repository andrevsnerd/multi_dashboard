import { NextResponse } from 'next/server';

import { getConnectionPool } from '@/lib/db/connection';
import { shouldUseProxy, ProxyPool } from '@/lib/db/proxy';
import { findUserByUsername } from '@/lib/auth/users-store';
import { isReadOnlyRole } from '@/lib/auth/permissions';
import { resolveCompany } from '@/lib/config/company';
import { resolveResponsavelLinx } from '@/lib/server/responsavel-linx';
import { estoqueDeItensPorFilial } from '@/lib/repositories/ajusteEstoque';
import {
  executarAjusteContagem,
  encontrarNomeContagemLivre,
} from '@/lib/ajuste-estoque-executor';

export const dynamic = 'force-dynamic';

interface ExecutarZerarItemRequest {
  company: string;
  itens: Array<{ produto: string; cor: string }>;
  /** COD_FILIAL específico, ou null/'ALL'/'' = todas as filiais onde o item existir. */
  filialCod?: string | null;
  dataContagem: string; // 'YYYY-MM-DD'
  obs?: string | null;
}

interface DetalheFilial {
  cod: string;
  filial: string;
  nomeContagem: string;
  itens: number;
  soma: number;
}

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

    const body = (await request.json()) as ExecutarZerarItemRequest;
    const company = resolveCompany(body.company);
    if (!company) {
      return NextResponse.json({ error: 'Empresa inválida.' }, { status: 400 });
    }
    if (!Array.isArray(body.itens) || body.itens.length === 0) {
      return NextResponse.json({ error: 'Selecione ao menos um item.' }, { status: 400 });
    }
    if (!isValidDate(body.dataContagem)) {
      return NextResponse.json({ error: 'Data da contagem inválida.' }, { status: 400 });
    }

    const itens = body.itens
      .map((i) => ({ produto: (i.produto ?? '').trim(), cor: (i.cor ?? '').trim() }))
      .filter((i) => i.produto);
    if (itens.length === 0) {
      return NextResponse.json({ error: 'Nenhum item válido.' }, { status: 400 });
    }

    const filialCodRaw = (body.filialCod ?? '').trim();
    const filialCod = !filialCodRaw || filialCodRaw.toUpperCase() === 'ALL' ? null : filialCodRaw;

    // Fonte autoritativa: saldo atual (≠ 0) por filial da empresa.
    const filiais = await estoqueDeItensPorFilial(itens, company.key, filialCod);
    if (filiais.length === 0) {
      return NextResponse.json(
        { error: 'Nenhum dos itens selecionados tem estoque nas filiais do escopo.' },
        { status: 400 }
      );
    }

    const pool = shouldUseProxy() ? new ProxyPool() : await getConnectionPool();
    const poolLike = pool as unknown as { request: () => unknown };
    const [, mm, dd] = body.dataContagem.split('-');
    const ddmm = `${dd ?? ''}${mm ?? ''}`;
    const obs = body.obs?.trim() || null;

    const detalhes: DetalheFilial[] = [];
    const falhas: Array<{ filial: string; erro: string }> = [];
    let itensZerados = 0;
    let somaDelta = 0;

    for (const f of filiais) {
      try {
        const codCompact = compactar(f.cod).slice(0, 8);
        const nomeContagem = await encontrarNomeContagemLivre(poolLike, `ZI${codCompact}${ddmm}`);
        const resultado = await executarAjusteContagem(poolLike, {
          filialNome: f.nome,
          nomeContagem,
          emissao: `${body.dataContagem} 00:00:00`,
          responsavel: await resolveResponsavelLinx(username),
          obs: obs ?? `ZERAR ITEM (${itens.length} SKU)`,
          itens: f.itens.map((it) => ({ produto: it.produto, cor: it.cor, contagem: 0 })),
        });
        detalhes.push({
          cod: f.cod,
          filial: f.nome,
          nomeContagem: resultado.nomeContagem,
          itens: resultado.itensAjustados,
          soma: resultado.somaDelta,
        });
        itensZerados += resultado.itensAjustados;
        somaDelta += resultado.somaDelta;
      } catch (e) {
        falhas.push({ filial: f.nome, erro: e instanceof Error ? e.message : 'Erro desconhecido.' });
      }
    }

    if (detalhes.length === 0) {
      return NextResponse.json(
        {
          error:
            falhas[0]?.erro ?? 'Não foi possível aplicar o ajuste em nenhuma filial.',
          falhas,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      filiaisAjustadas: detalhes.length,
      itensZerados,
      somaDelta,
      detalhes,
      falhas,
    });
  } catch (error) {
    console.error('[ajuste-estoque/zerar-item/executar] erro', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao zerar itens.' },
      { status: 500 }
    );
  }
}
