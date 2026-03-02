import { NextResponse } from 'next/server';

import {
  fetchEstoqueKPIs,
  fetchEstoquePorCategoria,
  fetchEvolucaoEstoque,
  fetchVendasPorCategoria,
  fetchPrevisoesEstoque,
  fetchDetalhesEntradasSemana,
  fetchDetalhesVendasSemana,
  fetchDetalhesEcommerceSemana,
  fetchProjecaoMensal,
  fetchCategoriasComGiro,
} from '@/lib/repositories/controleEstoque';
import { hasPostgres } from '@/lib/db/neon';
import { saveProjecaoSnapshot, fetchSnapshotDates, fetchSnapshotRealPorMes } from '@/lib/repositories/projecaoEstoqueHistorico';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') ?? undefined;
  const filial = searchParams.get('filial') || null;
  const periodType = (searchParams.get('periodType') as 'semanal' | 'mensal') || 'semanal';
  const dataType = searchParams.get('dataType'); // 'kpis', 'categorias', 'evolucao', 'vendas', 'previsoes', 'detalhes-entradas', 'giro'

  const startParam = searchParams.get('start');
  const endParam = searchParams.get('end');

  const range = startParam && endParam
    ? { start: startParam, end: endParam }
    : undefined;

  // Extrair filtros múltiplos
  const grupos = searchParams.getAll('grupos').filter(Boolean);
  const linhas = searchParams.getAll('linhas').filter(Boolean);
  const colecoes = searchParams.getAll('colecoes').filter(Boolean);
  const subgrupos = searchParams.getAll('subgrupos').filter(Boolean);
  const grades = searchParams.getAll('grades').filter(Boolean);

  const filters = {
    grupos: grupos.length > 0 ? grupos : null,
    linhas: linhas.length > 0 ? linhas : null,
    colecoes: colecoes.length > 0 ? colecoes : null,
    subgrupos: subgrupos.length > 0 ? subgrupos : null,
    grades: grades.length > 0 ? grades : null,
  };

  try {
    switch (dataType) {
      case 'kpis': {
        const kpis = await fetchEstoqueKPIs({ company, filial, range, ...filters });
        return NextResponse.json({ data: kpis });
      }
      case 'categorias': {
        const filtrarEstoquePorGiro = searchParams.get('filtrarEstoquePorGiro') === '1' || searchParams.get('filtrarEstoquePorGiro') === 'true';
        const giroDiasParam = searchParams.get('giroDias');
        const giroDias = giroDiasParam ? parseInt(giroDiasParam, 10) : undefined;
        const categorias = await fetchEstoquePorCategoria({
          company,
          filial,
          range,
          periodType,
          ...filters,
          filtrarEstoquePorGiro,
          giroDias: Number.isFinite(giroDias) ? giroDias : undefined,
        });
        return NextResponse.json({ data: categorias });
      }
      case 'evolucao': {
        const evolucao = await fetchEvolucaoEstoque({ company, filial, range, periodType, ...filters });
        return NextResponse.json({ data: evolucao });
      }
      case 'vendas': {
        const vendas = await fetchVendasPorCategoria({ company, filial, range, ...filters });
        return NextResponse.json({ data: vendas });
      }
      case 'previsoes': {
        const previsoes = await fetchPrevisoesEstoque({ company, filial, range, ...filters });
        return NextResponse.json({ data: previsoes });
      }
      case 'detalhes-entradas': {
        const categoria = searchParams.get('categoria');
        const linha = searchParams.get('linha') || undefined;
        const subgrupo = searchParams.get('subgrupo') || undefined;
        const grade = searchParams.get('grade') || undefined;
        const colecao = searchParams.get('colecao') || undefined;
        
        if (!categoria) {
          return NextResponse.json(
            { error: 'Categoria é obrigatória para detalhes de entradas' },
            { status: 400 }
          );
        }
        
        const detalhes = await fetchDetalhesEntradasSemana({
          company,
          filial,
          categoria,
          linha,
          subgrupo,
          grade,
          colecao,
          range,
          grupos: filters.grupos ?? undefined,
          linhas: filters.linhas ?? undefined,
          colecoes: filters.colecoes ?? undefined,
          subgrupos: filters.subgrupos ?? undefined,
          grades: filters.grades ?? undefined,
        });
        return NextResponse.json({ data: detalhes });
      }
      case 'detalhes-vendas': {
        const categoria = searchParams.get('categoria');
        const linha = searchParams.get('linha') || undefined;
        const subgrupo = searchParams.get('subgrupo') || undefined;
        const grade = searchParams.get('grade') || undefined;
        const colecao = searchParams.get('colecao') || undefined;
        
        if (!categoria) {
          return NextResponse.json(
            { error: 'Categoria é obrigatória para detalhes de vendas' },
            { status: 400 }
          );
        }
        
        const detalhes = await fetchDetalhesVendasSemana({
          company,
          filial,
          categoria,
          linha,
          subgrupo,
          grade,
          colecao,
          range,
          grupos: filters.grupos ?? undefined,
          linhas: filters.linhas ?? undefined,
          colecoes: filters.colecoes ?? undefined,
          subgrupos: filters.subgrupos ?? undefined,
          grades: filters.grades ?? undefined,
        });
        return NextResponse.json({ data: detalhes });
      }
      case 'detalhes-ecommerce': {
        const categoria = searchParams.get('categoria');
        const linha = searchParams.get('linha') || undefined;
        const subgrupo = searchParams.get('subgrupo') || undefined;
        const grade = searchParams.get('grade') || undefined;
        const colecao = searchParams.get('colecao') || undefined;
        
        if (!categoria) {
          return NextResponse.json(
            { error: 'Categoria é obrigatória para detalhes de e-commerce' },
            { status: 400 }
          );
        }
        
        const detalhes = await fetchDetalhesEcommerceSemana({
          company,
          filial,
          categoria,
          linha,
          subgrupo,
          grade,
          colecao,
          range,
          grupos: filters.grupos ?? undefined,
          linhas: filters.linhas ?? undefined,
          colecoes: filters.colecoes ?? undefined,
          subgrupos: filters.subgrupos ?? undefined,
          grades: filters.grades ?? undefined,
        });
        return NextResponse.json({ data: detalhes });
      }
      case 'projecao-mensal': {
        const projecao = await fetchProjecaoMensal({
          company,
          filial,
          ...filters,
        });
        let snapshotOk = false;
        let snapshotDate: string | null = null;
        // Auto-save histórico: apenas 1x por mês — na primeira carga da projeção no mês (ex.: dia 1 ou primeiro dia que abrir)
        // Assim o mês anterior fica fixo no histórico e o atual só grava quando “fechar” no próximo mês.
        if (company && hasPostgres() && projecao.length > 0) {
          try {
            const dates = await fetchSnapshotDates(company, filial);
            const now = new Date();
            const year = now.getFullYear();
            const mesAtual = now.getMonth() + 1;
            const month = String(mesAtual).padStart(2, '0');
            const currentMonthPrefix = `${year}-${month}`;
            const existingThisMonth =
              dates.find((x) => String(x.snapshot_date).startsWith(currentMonthPrefix))?.snapshot_date ?? null;
            if (existingThisMonth) {
              snapshotOk = true;
              snapshotDate = existingThisMonth;
            } else {
              await saveProjecaoSnapshot(now, company, filial, projecao);
              snapshotOk = true;
              snapshotDate = now.toISOString().slice(0, 10);
            }
          } catch (autoErr) {
            console.error('Auto-save projeção histórico:', autoErr);
          }
          // Preencher estoque/duração real de meses passados a partir do snapshot (aparece ao virar o mês)
          try {
            const now = new Date();
            const year = now.getFullYear();
            const mesAtual = now.getMonth() + 1;
            for (let mesNumero = 1; mesNumero < mesAtual; mesNumero++) {
              const snapshotMap = await fetchSnapshotRealPorMes(company, filial, year, mesNumero);
              for (const cat of projecao) {
                const key = `${cat.categoria}|${cat.linha ?? ''}|${cat.subgrupo ?? ''}|${cat.grade ?? ''}|${cat.colecao ?? ''}`;
                const snap = snapshotMap.get(key);
                const mesEntry = cat.meses.find((m) => m.mesNumero === mesNumero && m.ano === year);
                if (mesEntry && snap) {
                  if (snap.estoque_real != null) mesEntry.estoqueRealSnapshot = snap.estoque_real;
                  if (snap.duracao_real != null) mesEntry.duracaoRealSnapshot = snap.duracao_real;
                }
              }
            }
          } catch (snapErr) {
            console.error('Carregar snapshot real por mês:', snapErr);
          }
        }
        return NextResponse.json({ data: projecao, snapshot: { ok: snapshotOk, snapshot_date: snapshotDate } });
      }
      case 'giro': {
        const diasGiroParam = searchParams.get('diasGiro');
        const diasGiro = diasGiroParam ? parseInt(diasGiroParam, 10) : NaN;
        if (!Number.isFinite(diasGiro) || diasGiro < 0) {
          return NextResponse.json(
            { error: 'diasGiro é obrigatório e deve ser 0 (obsoleto) ou um número positivo' },
            { status: 400 }
          );
        }
        const { chaves, produtosPorChave } = await fetchCategoriasComGiro({
          company,
          filial,
          ...filters,
          diasGiro,
        });
        // Converter Map para objeto JSON serializável
        const produtosPorChaveObj: Record<string, string[]> = {};
        produtosPorChave.forEach((produtos, chave) => {
          produtosPorChaveObj[chave] = produtos;
        });
        return NextResponse.json({
          data: Array.from(chaves),
          produtosPorChave: produtosPorChaveObj,
        });
      }
      default:
        return NextResponse.json(
          { error: 'Tipo de dados inválido. Use: kpis, categorias, evolucao, vendas, previsoes, detalhes-entradas, detalhes-vendas, detalhes-ecommerce, projecao-mensal ou giro' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Erro ao carregar dados de controle de estoque:', error);
    return NextResponse.json(
      { error: 'Erro ao carregar dados de controle de estoque' },
      { status: 500 }
    );
  }
}