import { NextResponse } from 'next/server';
import {
  fetchPerformanceData,
  fetchFilialProdutoSales,
  fetchProdutoQtdePorFilial,
  fetchProdutoEstoquePorFilial,
} from '@/lib/repositories/performance';
import { readGoals } from '@/lib/utils/goals-storage';
import { resolveCompany, type CompanyKey } from '@/lib/config/company';
import { normalizeRangeForQuery, formatDateForQuery } from '@/lib/utils/date';

export const maxDuration = 300;

/** Chave para alinhar produto + breakdowns (vendas/estoque por filial) com ou sem cor */
function produtoAggKey(produto: string, cor: string | undefined, porCor: boolean): string {
  if (!porCor) return produto;
  return `${produto}||${(cor ?? '').trim()}`;
}

function normalizeFilialKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveCanonicalFilial(
  rawFilial: string,
  memberToCanonical: Map<string, string>,
  canonicalToMemberNorms: Array<{ canonical: string; members: string[] }>
): string {
  const norm = normalizeFilialKey(rawFilial);
  const direct = memberToCanonical.get(norm);
  if (direct) return direct;

  let bestCanonical: string | null = null;
  let bestLen = 0;
  for (const entry of canonicalToMemberNorms) {
    for (const memberNorm of entry.members) {
      if (!memberNorm) continue;
      if (norm.includes(memberNorm) || memberNorm.includes(norm)) {
        if (memberNorm.length > bestLen) {
          bestLen = memberNorm.length;
          bestCanonical = entry.canonical;
        }
      }
    }
  }
  return bestCanonical ?? rawFilial;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyKey = searchParams.get('company') as CompanyKey;
  const filialParam = searchParams.get('filial') || null;
  const startParam = searchParams.get('start');
  const endParam = searchParams.get('end');
  const monthParam = searchParams.get('month');
  const yearParam = searchParams.get('year');
  const compareParam = searchParams.get('compare');
  const porCor = searchParams.get('porCor') === '1';

  if (!companyKey) {
    return NextResponse.json({ error: 'Parâmetros obrigatórios faltando' }, { status: 400 });
  }

  const comparisonMode: 'month' | 'year' = compareParam === 'year' ? 'year' : 'month';

  const company = resolveCompany(companyKey);
  if (!company) {
    return NextResponse.json({ error: 'Empresa não encontrada' }, { status: 404 });
  }

  const parseYmd = (value: string | null): Date | null => {
    if (!value) return null;
    const parts = value.trim().split('-');
    if (parts.length !== 3) return null;
    const y = Number(parts[0]), m = Number(parts[1]), d = Number(parts[2]);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const dt = new Date(y, m - 1, d);
    return Number.isNaN(dt.getTime()) ? null : dt;
  };

  const resolvedRange = (() => {
    const startParsed = parseYmd(startParam);
    const endParsed = parseYmd(endParam);
    if (startParsed && endParsed) {
      return normalizeRangeForQuery({ start: startParsed, end: endParsed });
    }
    if (monthParam === null || yearParam === null) return null;
    const month = parseInt(monthParam, 10);
    const year = parseInt(yearParam, 10);
    if (!Number.isFinite(month) || !Number.isFinite(year)) return null;
    return normalizeRangeForQuery({ start: new Date(year, month, 1), end: new Date(year, month + 1, 0) });
  })();

  if (!resolvedRange) {
    return NextResponse.json({ error: 'Parâmetros obrigatórios faltando' }, { status: 400 });
  }

  try {
    const [performanceData, allGoals] = await Promise.all([
      fetchPerformanceData(companyKey, resolvedRange, comparisonMode),
      readGoals(),
    ]);

    const month = resolvedRange.start.getUTCMonth();
    const year = resolvedRange.start.getUTCFullYear();
    const monthGoals: Record<string, number> = allGoals[companyKey]?.[String(year)]?.[String(month)] ?? {};
    const ecommerceFilials = new Set(company.ecommerceFilials ?? []);
    const matrizFiliais: Record<string, string[]> = {
      scarfme: ['SCARF ME - MATRIZ'],
      nerd: ['NERD'],
    };
    const matrizSet = new Set(matrizFiliais[companyKey] ?? []);
    const filiais = company.filialFilters.sales.filter(f => !matrizSet.has(f));

    // Resolve canonical filial groups
    const filialGroups = company.filialGroups ?? {};
    const nonCanonicalFilials = new Set<string>();
    const canonicalToMembers = new Map<string, string[]>();
    for (const [canonical, members] of Object.entries(filialGroups)) {
      canonicalToMembers.set(canonical, members);
      members.forEach(m => { if (m !== canonical) nonCanonicalFilials.add(m); });
    }

    const ecommerceList = filiais.filter(f => ecommerceFilials.has(f));
    let ecommerceCanonical: string | null = null;
    if (ecommerceList.length > 0) {
      ecommerceCanonical = ecommerceList[0];
      canonicalToMembers.set(ecommerceCanonical, ecommerceList);
      ecommerceList.slice(1).forEach(f => nonCanonicalFilials.add(f));
    }

    const memberToCanonical = new Map<string, string>();
    for (const [canonical, members] of canonicalToMembers.entries()) {
      members.forEach(member => {
        memberToCanonical.set(normalizeFilialKey(member), canonical);
      });
      memberToCanonical.set(normalizeFilialKey(canonical), canonical);
    }
    const canonicalToMemberNorms = Array.from(canonicalToMembers.entries()).map(([canonical, members]) => ({
      canonical,
      members: Array.from(new Set([canonical, ...members])).map(normalizeFilialKey),
    }));

    const currentByFilial = new Map<string, Map<string, { vendas: number; qtde: number }>>();
    const previousByFilial = new Map<string, Map<string, { vendas: number; qtde: number }>>();

    const processRows = (
      rows: Array<{ filial: string; categoria: string; vendas: number; qtde: number }>,
      target: Map<string, Map<string, { vendas: number; qtde: number }>>
    ) => {
      rows.forEach(row => {
        const canonicalFilial = resolveCanonicalFilial(row.filial, memberToCanonical, canonicalToMemberNorms);
        if (!target.has(canonicalFilial)) target.set(canonicalFilial, new Map());
        const filialMap = target.get(canonicalFilial)!;
        if (!filialMap.has(row.categoria)) filialMap.set(row.categoria, { vendas: 0, qtde: 0 });
        const cat = filialMap.get(row.categoria)!;
        cat.vendas += row.vendas;
        cat.qtde += row.qtde;
      });
    };

    processRows(performanceData.current, currentByFilial);
    processRows(performanceData.previous, previousByFilial);

    const totalDaysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const endInclusiveUtc = new Date(resolvedRange.end.getTime() - 1);
    const isFromMonthStart =
      resolvedRange.start.getUTCFullYear() === year &&
      resolvedRange.start.getUTCMonth() === month &&
      resolvedRange.start.getUTCDate() === 1 &&
      endInclusiveUtc.getUTCFullYear() === year &&
      endInclusiveUtc.getUTCMonth() === month;
    const daysElapsed = isFromMonthStart
      ? endInclusiveUtc.getUTCDate()
      : Math.max(1, Math.ceil((resolvedRange.end.getTime() - resolvedRange.start.getTime()) / oneDayMs));

    const isAllMode = !filialParam;

    // ── Modo TODAS AS FILIAIS ──────────────────────────────────────────────────
    if (isAllMode) {
      const allPosMembers = filiais.filter(f => !ecommerceFilials.has(f));
      const allEcomMembers = filiais.filter(f => ecommerceFilials.has(f));

      // KPIs: soma de todas as filiais não-matriz
      let vendas = 0, vendasPrevious = 0, qtde = 0;
      currentByFilial.forEach((filialMap, canonical) => {
        if (matrizSet.has(canonical)) return;
        filialMap.forEach(d => { vendas += d.vendas; qtde += d.qtde; });
      });
      previousByFilial.forEach((filialMap, canonical) => {
        if (matrizSet.has(canonical)) return;
        filialMap.forEach(d => { vendasPrevious += d.vendas; });
      });

      // Categorias agregadas de todas as filiais
      const allCatCurrent = new Map<string, { vendas: number; qtde: number }>();
      const allCatPrevious = new Map<string, { vendas: number; qtde: number }>();
      currentByFilial.forEach((filialMap, canonical) => {
        if (matrizSet.has(canonical)) return;
        filialMap.forEach((data, cat) => {
          if (!allCatCurrent.has(cat)) allCatCurrent.set(cat, { vendas: 0, qtde: 0 });
          const c = allCatCurrent.get(cat)!;
          c.vendas += data.vendas;
          c.qtde += data.qtde;
        });
      });
      previousByFilial.forEach((filialMap, canonical) => {
        if (matrizSet.has(canonical)) return;
        filialMap.forEach((data, cat) => {
          if (!allCatPrevious.has(cat)) allCatPrevious.set(cat, { vendas: 0, qtde: 0 });
          const c = allCatPrevious.get(cat)!;
          c.vendas += data.vendas;
          c.qtde += data.qtde;
        });
      });

      const categories = Array.from(allCatCurrent.entries())
        .filter(([cat]) => cat !== '')
        .sort((a, b) => b[1].vendas - a[1].vendas)
        .map(([cat]) => cat);

      const categoryData: Record<string, { pct: number; deltaPct: number | null }> = {};
      categories.forEach(cat => {
        const cur = allCatCurrent.get(cat) ?? { vendas: 0, qtde: 0 };
        const prev = allCatPrevious.get(cat) ?? { vendas: 0, qtde: 0 };
        const deltaPct = prev.vendas > 0 ? ((cur.vendas - prev.vendas) / prev.vendas) * 100 : null;
        categoryData[cat] = {
          pct: vendas > 0 ? (cur.vendas / vendas) * 100 : 0,
          deltaPct,
        };
      });

      const meta = filiais.reduce((s, f) => s + (monthGoals[f] ?? 0), 0);
      const projecao = daysElapsed > 0 ? (vendas / daysElapsed) * totalDaysInMonth : vendas;
      const projecaoPct = meta > 0 ? (projecao / meta) * 100 : null;

      let produtos: Awaited<ReturnType<typeof fetchFilialProdutoSales>> = [];
      let qtdePorFilialRows: Awaited<ReturnType<typeof fetchProdutoQtdePorFilial>> = [];
      let estoquePorFilialRows: Awaited<ReturnType<typeof fetchProdutoEstoquePorFilial>> = [];
      try {
        [produtos, qtdePorFilialRows, estoquePorFilialRows] = await Promise.all([
          fetchFilialProdutoSales(companyKey, allPosMembers, allEcomMembers, resolvedRange, comparisonMode, {
            groupByCor: porCor,
          }),
          fetchProdutoQtdePorFilial(companyKey, allPosMembers, allEcomMembers, resolvedRange, {
            groupByCor: porCor,
          }),
          fetchProdutoEstoquePorFilial(companyKey, allPosMembers, allEcomMembers, { groupByCor: porCor }),
        ]);
      } catch (produtosError) {
        console.error('Erro ao carregar produtos (não-fatal):', produtosError);
      }

      // Montar mapa produto (+ cor) → filiais ordenadas por qtde desc
      const qtdePorFilialMap = new Map<string, { filial: string; displayName: string; qtde: number }[]>();
      qtdePorFilialRows.forEach(row => {
        const k = produtoAggKey(row.produto, row.cor, porCor);
        if (!qtdePorFilialMap.has(k)) qtdePorFilialMap.set(k, []);
        qtdePorFilialMap.get(k)!.push({
          filial: row.filial,
          displayName: company.filialDisplayNames?.[row.filial] ?? row.filial,
          qtde: row.qtde,
        });
      });
      qtdePorFilialMap.forEach(entries => entries.sort((a, b) => b.qtde - a.qtde));

      const estoquePorFilialMap = new Map<string, { filial: string; displayName: string; qtde: number }[]>();
      estoquePorFilialRows.forEach(row => {
        const k = produtoAggKey(row.produto, row.cor, porCor);
        if (!estoquePorFilialMap.has(k)) estoquePorFilialMap.set(k, []);
        estoquePorFilialMap.get(k)!.push({
          filial: row.filial,
          displayName: company.filialDisplayNames?.[row.filial] ?? row.filial,
          qtde: row.estoque,
        });
      });
      estoquePorFilialMap.forEach(entries => entries.sort((a, b) => b.qtde - a.qtde));

      const produtosComFilial = produtos.map(p => {
        const k = produtoAggKey(p.produto, p.cor, porCor);
        const porFilial = estoquePorFilialMap.get(k) ?? [];
        const estoque = porFilial.reduce((s, e) => s + Math.max(0, e.qtde), 0);
        return {
          ...p,
          qtdePorFilial: qtdePorFilialMap.get(k) ?? [],
          estoque,
          estoquePorFilial: porFilial,
        };
      });

      return NextResponse.json({
        filial: null,
        displayName: 'Visão Geral',
        vendas,
        vendasPrevious,
        qtde,
        meta,
        projecao,
        projecaoPct,
        categories: categoryData,
        categoryList: categories,
        daysElapsed,
        totalDaysInMonth,
        month,
        year,
        range: {
          start: formatDateForQuery(new Date(resolvedRange.start.getTime())),
          end: formatDateForQuery(new Date(endInclusiveUtc.getTime())),
        },
        produtos: produtosComFilial,
        porCor,
      }, { headers: { 'Cache-Control': 'no-store' } });
    }

    // ── Modo FILIAL ESPECÍFICA ──────────────────────────────────────────────────
    const groupMembers = canonicalToMembers.get(filialParam) ?? [filialParam];
    const isEcommerceFilial = filialParam === ecommerceCanonical;
    const posMembers = isEcommerceFilial ? [] : groupMembers.filter(f => !ecommerceFilials.has(f));
    const ecomMembers = isEcommerceFilial ? groupMembers : [];

    const categoryTotals = new Map<string, number>();
    currentByFilial.forEach(filialMap => {
      filialMap.forEach((data, cat) => {
        categoryTotals.set(cat, (categoryTotals.get(cat) ?? 0) + data.vendas);
      });
    });
    const categories = Array.from(categoryTotals.entries())
      .filter(([cat]) => cat !== '')
      .sort((a, b) => b[1] - a[1])
      .map(([cat]) => cat);

    const currentData = currentByFilial.get(filialParam) ?? new Map();
    const previousData = previousByFilial.get(filialParam) ?? new Map();

    const vendas = Array.from(currentData.values()).reduce((s, d) => s + d.vendas, 0);
    const vendasPrevious = Array.from(previousData.values()).reduce((s, d) => s + d.vendas, 0);
    const qtde = Array.from(currentData.values()).reduce((s, d) => s + d.qtde, 0);
    const meta = groupMembers.reduce((s, f) => s + (monthGoals[f] ?? 0), 0);
    const projecao = daysElapsed > 0 ? (vendas / daysElapsed) * totalDaysInMonth : vendas;
    const projecaoPct = meta > 0 ? (projecao / meta) * 100 : null;

    const categoryData: Record<string, { pct: number; deltaPct: number | null }> = {};
    categories.forEach(cat => {
      const cur = currentData.get(cat) ?? { vendas: 0, qtde: 0 };
      const prev = previousData.get(cat) ?? { vendas: 0, qtde: 0 };
      const deltaPct = prev.vendas > 0 ? ((cur.vendas - prev.vendas) / prev.vendas) * 100 : null;
      categoryData[cat] = {
        pct: vendas > 0 ? (cur.vendas / vendas) * 100 : 0,
        deltaPct,
      };
    });

    let produtos: Awaited<ReturnType<typeof fetchFilialProdutoSales>> = [];
    let estoquePorFilialRows: Awaited<ReturnType<typeof fetchProdutoEstoquePorFilial>> = [];
    try {
      [produtos, estoquePorFilialRows] = await Promise.all([
        fetchFilialProdutoSales(companyKey, posMembers, ecomMembers, resolvedRange, comparisonMode, {
          groupByCor: porCor,
        }),
        fetchProdutoEstoquePorFilial(companyKey, posMembers, ecomMembers, { groupByCor: porCor }),
      ]);
    } catch (produtosError) {
      console.error('Erro ao carregar produtos da filial (não-fatal):', produtosError);
    }

    const estoquePorFilialMap = new Map<string, { filial: string; displayName: string; qtde: number }[]>();
    estoquePorFilialRows.forEach(row => {
      const k = produtoAggKey(row.produto, row.cor, porCor);
      if (!estoquePorFilialMap.has(k)) estoquePorFilialMap.set(k, []);
      estoquePorFilialMap.get(k)!.push({
        filial: row.filial,
        displayName: company.filialDisplayNames?.[row.filial] ?? row.filial,
        qtde: row.estoque,
      });
    });
    estoquePorFilialMap.forEach(entries => entries.sort((a, b) => b.qtde - a.qtde));

    const produtosComEstoque = produtos.map(p => {
      const k = produtoAggKey(p.produto, p.cor, porCor);
      const porFilial = estoquePorFilialMap.get(k) ?? [];
      const estoque = porFilial.reduce((s, e) => s + Math.max(0, e.qtde), 0);
      return {
        ...p,
        estoque,
        estoquePorFilial: porFilial,
      };
    });

    return NextResponse.json({
      filial: filialParam,
      displayName: company.filialDisplayNames?.[filialParam] ?? filialParam,
      vendas,
      vendasPrevious,
      qtde,
      meta,
      projecao,
      projecaoPct,
      categories: categoryData,
      categoryList: categories,
      daysElapsed,
      totalDaysInMonth,
      month,
      year,
      range: {
        start: formatDateForQuery(new Date(resolvedRange.start.getTime())),
        end: formatDateForQuery(new Date(endInclusiveUtc.getTime())),
      },
      produtos: produtosComEstoque,
      porCor,
    }, { headers: { 'Cache-Control': 'no-store' } });

  } catch (error) {
    console.error('Erro ao carregar dados de curva ABC:', error);
    return NextResponse.json({ error: 'Erro ao carregar dados' }, { status: 500 });
  }
}
