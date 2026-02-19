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
        const categorias = await fetchEstoquePorCategoria({
          company,
          filial,
          range,
          periodType,
          ...filters,
          filtrarEstoquePorGiro,
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
        return NextResponse.json({ data: projecao });
      }
      case 'giro': {
        const diasGiroParam = searchParams.get('diasGiro');
        const diasGiro = diasGiroParam ? parseInt(diasGiroParam, 10) : NaN;
        if (!Number.isFinite(diasGiro) || diasGiro <= 0) {
          return NextResponse.json(
            { error: 'diasGiro é obrigatório e deve ser um número positivo' },
            { status: 400 }
          );
        }
        const chaves = await fetchCategoriasComGiro({
          company,
          filial,
          ...filters,
          diasGiro,
        });
        return NextResponse.json({ data: Array.from(chaves) });
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
