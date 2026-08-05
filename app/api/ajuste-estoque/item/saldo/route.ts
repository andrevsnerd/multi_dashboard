import { NextResponse } from 'next/server';

import {
  listarFiliaisParaAjuste,
  saldoItensTodasFiliais,
} from '@/lib/repositories/ajusteEstoque';
import { resolveCompany } from '@/lib/config/company';

export const dynamic = 'force-dynamic';

interface SaldoRequest {
  company: string;
  itens: Array<{ produto: string; cor: string }>;
}

/**
 * Matriz de saldo ATUAL (item × filial) dos itens selecionados na aba "Ajustar
 * item". Devolve todas as filiais operacionais da empresa (mesmo onde o item está
 * zerado — a intenção pode ser subir) mais as filiais fora do escopo ativo onde
 * ainda existe saldo ≠ 0 (para zerar sobra antiga).
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SaldoRequest;
    const company = resolveCompany(body?.company ?? '');
    if (!company) {
      return NextResponse.json({ error: 'Empresa inválida.' }, { status: 400 });
    }
    const itens = (Array.isArray(body?.itens) ? body.itens : [])
      .map((i) => ({ produto: (i?.produto ?? '').trim(), cor: (i?.cor ?? '').trim() }))
      .filter((i) => i.produto);
    if (itens.length === 0) {
      return NextResponse.json({ filiais: [], saldos: [] });
    }

    const [{ ativas }, saldos] = await Promise.all([
      listarFiliaisParaAjuste(company.key),
      saldoItensTodasFiliais(itens, company.key),
    ]);

    const filiais = new Map<string, { cod: string; nome: string; ativa: boolean }>();
    for (const f of ativas) {
      if (f.cod) filiais.set(f.cod, { cod: f.cod, nome: f.nome, ativa: true });
    }
    // Filial fora do escopo ativo só entra se o item tiver saldo lá.
    for (const s of saldos) {
      if (!s.filialCod || filiais.has(s.filialCod) || s.estoque === 0) continue;
      filiais.set(s.filialCod, { cod: s.filialCod, nome: s.filialNome, ativa: false });
    }

    const lista = [...filiais.values()].sort(
      (a, b) => Number(b.ativa) - Number(a.ativa) || a.nome.localeCompare(b.nome)
    );
    const codsValidos = new Set(lista.map((f) => f.cod));

    return NextResponse.json({
      filiais: lista,
      saldos: saldos
        .filter((s) => codsValidos.has(s.filialCod))
        .map((s) => ({
          produto: s.produto,
          cor: s.cor,
          filialCod: s.filialCod,
          estoque: s.estoque,
        })),
    });
  } catch (error) {
    console.error('[ajuste-estoque/item/saldo] erro', error);
    return NextResponse.json({ error: 'Erro ao carregar saldos dos itens.' }, { status: 500 });
  }
}
