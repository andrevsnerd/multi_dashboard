import { NextResponse } from 'next/server';
import { fetchProjecaoMensal } from '@/lib/repositories/controleEstoque';
import {
  saveProjecaoSnapshot,
  fetchSnapshotDates,
  fetchHistoricoBySnapshot,
  fetchHistoricoByCategoria,
} from '@/lib/repositories/projecaoEstoqueHistorico';

/**
 * POST: Salva snapshot atual da projeção no histórico.
 * Body: { company, filial?, grupos?, linhas?, colecoes?, subgrupos?, grades? }
 * Rebusca os dados com os mesmos filtros e grava no banco (data do snapshot = hoje).
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const company = body.company ?? '';
    const filial = body.filial ?? null;
    const grupos = Array.isArray(body.grupos) ? body.grupos : [];
    const linhas = Array.isArray(body.linhas) ? body.linhas : [];
    const colecoes = Array.isArray(body.colecoes) ? body.colecoes : [];
    const subgrupos = Array.isArray(body.subgrupos) ? body.subgrupos : [];
    const grades = Array.isArray(body.grades) ? body.grades : [];

    if (!company) {
      return NextResponse.json(
        { error: 'company é obrigatório' },
        { status: 400 }
      );
    }

    const data = await fetchProjecaoMensal({
      company,
      filial,
      grupos: grupos.length ? grupos : undefined,
      linhas: linhas.length ? linhas : undefined,
      colecoes: colecoes.length ? colecoes : undefined,
      subgrupos: subgrupos.length ? subgrupos : undefined,
      grades: grades.length ? grades : undefined,
    });

    const snapshotDate = new Date();
    const { saved } = await saveProjecaoSnapshot(snapshotDate, company, filial, data);

    return NextResponse.json({
      success: true,
      saved,
      snapshot_date: snapshotDate.toISOString().slice(0, 10),
    });
  } catch (error) {
    console.error('Erro ao salvar snapshot da projeção:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao salvar snapshot' },
      { status: 500 }
    );
  }
}

/**
 * GET: Lista datas de snapshot ou retorna dados de um snapshot/categoria.
 * Query: company, filial?, snapshot_date?, categoria?
 * - Sem snapshot_date: lista snapshot_date disponíveis.
 * - Com snapshot_date: retorna todos os registros daquele snapshot.
 * - Com categoria (e opcional snapshot_date): histórico da categoria.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const company = searchParams.get('company') ?? '';
    const filial = searchParams.get('filial') || null;
    const snapshotDate = searchParams.get('snapshot_date') || null;
    const categoria = searchParams.get('categoria') || null;

    if (!company) {
      return NextResponse.json(
        { error: 'company é obrigatório' },
        { status: 400 }
      );
    }

    if (categoria) {
      const limit = Math.min(parseInt(searchParams.get('limit') || '24', 10), 100);
      const rows = await fetchHistoricoByCategoria(company, categoria, filial, limit);
      return NextResponse.json({ data: rows });
    }

    if (snapshotDate) {
      const rows = await fetchHistoricoBySnapshot(company, snapshotDate, filial);
      return NextResponse.json({ data: rows });
    }

    const dates = await fetchSnapshotDates(company, filial);
    return NextResponse.json({ data: dates });
  } catch (error) {
    console.error('Erro ao buscar histórico da projeção:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao buscar histórico' },
      { status: 500 }
    );
  }
}
