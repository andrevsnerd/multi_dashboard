import { NextResponse } from 'next/server';
import { fetchPerformanceData, fetchFilialProdutoSales } from '@/lib/repositories/performance';
import { readGoals } from '@/lib/utils/goals-storage';
import { type CompanyKey } from '@/lib/config/company';
import { resolveCompanyLive } from '@/lib/server/company-live';
import { normalizeRangeForQuery, formatDateForQuery } from '@/lib/utils/date';

export const maxDuration = 300;

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
  const filialParam = searchParams.get('filial');
  const monthParam = searchParams.get('month');
  const yearParam = searchParams.get('year');
  const startParam = searchParams.get('start');
  const endParam = searchParams.get('end');
  const compareParam = searchParams.get('compare');

  if (!companyKey || !filialParam) {
    return NextResponse.json({ error: 'Parâmetros obrigatórios faltando' }, { status: 400 });
  }

  const comparisonMode: 'month' | 'year' = compareParam === 'year' ? 'year' : 'month';

  const company = await resolveCompanyLive(companyKey);
  if (!company) {
    return NextResponse.json({ error: 'Empresa não encontrada' }, { status: 404 });
  }

  const parseYmd = (value: string | null): Date | null => {
    if (!value) return null;
    const trimmed = value.trim();
    const parts = trimmed.split('-');
    if (parts.length !== 3) return null;
    const y = Number(parts[0]);
    const m = Number(parts[1]);
    const d = Number(parts[2]);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
    if (m < 1 || m > 12) return null;
    if (d < 1 || d > 31) return null;
    const dt = new Date(y, m - 1, d);
    if (Number.isNaN(dt.getTime())) return null;
    return dt;
  };

  const resolvedRange = (() => {
    const startParsed = parseYmd(startParam);
    const endParsed = parseYmd(endParam);
    if (startParsed && endParsed) {
      return normalizeRangeForQuery({ start: startParsed, end: endParsed });
    }

    if (monthParam === null || yearParam === null) {
      return null;
    }
    const month = parseInt(monthParam, 10);
    const year = parseInt(yearParam, 10);
    if (!Number.isFinite(month) || !Number.isFinite(year)) return null;
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0);
    return normalizeRangeForQuery({ start, end });
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

    // Fast lookup: (normalized member) -> canonical
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

    const regularFiliais = filiais.filter(f => !nonCanonicalFilials.has(f) && !ecommerceFilials.has(f));
    const displayFiliais = [
      ...(ecommerceCanonical ? [ecommerceCanonical] : []),
      ...regularFiliais,
    ];

    // Resolve the requested filial to canonical key used in KPI aggregation.
    const requestedCanonical = resolveCanonicalFilial(
      filialParam,
      memberToCanonical,
      canonicalToMemberNorms
    );
    const selectedFilialKey = displayFiliais.includes(requestedCanonical) ? requestedCanonical : filialParam;

    // Resolve the requested filial's members
    const groupMembers = canonicalToMembers.get(selectedFilialKey) ?? [selectedFilialKey];
    const isEcommerceFilial = selectedFilialKey === ecommerceCanonical;

    const posMembers = isEcommerceFilial ? [] : groupMembers.filter(f => !ecommerceFilials.has(f));
    const ecomMembers = isEcommerceFilial ? groupMembers : [];

    // Get KPI data for this filial from performance data
    const currentByFilial = new Map<string, Map<string, { vendas: number; qtde: number }>>();
    const previousByFilial = new Map<string, Map<string, { vendas: number; qtde: number }>>();

    const processRows = (
      rows: Array<{ filial: string; categoria: string; vendas: number; qtde: number }>,
      target: Map<string, Map<string, { vendas: number; qtde: number }>>
    ) => {
      rows.forEach(row => {
        const canonicalFilial = resolveCanonicalFilial(
          row.filial,
          memberToCanonical,
          canonicalToMemberNorms
        );
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

    // Build filial rows using the same logic as the main endpoint,
    // then select the requested filial to ensure exact consistency.
    const filialRows = displayFiliais.map(filial => {
      const currentData = currentByFilial.get(filial) ?? new Map();
      const previousData = previousByFilial.get(filial) ?? new Map();

      const vendas = Array.from(currentData.values()).reduce((s, d) => s + d.vendas, 0);
      const vendasPrevious = Array.from(previousData.values()).reduce((s, d) => s + d.vendas, 0);
      const qtde = Array.from(currentData.values()).reduce((s, d) => s + d.qtde, 0);

      const rowGroupMembers = canonicalToMembers.get(filial) ?? [filial];
      const meta = rowGroupMembers.reduce((s, f) => s + (monthGoals[f] ?? 0), 0);

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

      return {
        filial,
        displayName: company.filialDisplayNames?.[filial] ?? filial,
        meta,
        vendas,
        vendasPrevious,
        qtde,
        projecao,
        projecaoPct,
        categories: categoryData,
      };
    });

    const selectedFilialRow = filialRows.find(row => row.filial === selectedFilialKey) ?? {
      filial: selectedFilialKey,
      displayName: company.filialDisplayNames?.[selectedFilialKey] ?? selectedFilialKey,
      meta: groupMembers.reduce((s, f) => s + (monthGoals[f] ?? 0), 0),
      vendas: 0,
      vendasPrevious: 0,
      qtde: 0,
      projecao: 0,
      projecaoPct: null,
      categories: categories.reduce<Record<string, { pct: number; deltaPct: number | null }>>((acc, cat) => {
        acc[cat] = { pct: 0, deltaPct: null };
        return acc;
      }, {}),
    };

    // Fetch product-level sales for ABC (non-fatal: if this fails, return KPIs without products)
    let produtos: Awaited<ReturnType<typeof fetchFilialProdutoSales>> = [];
    try {
      produtos = await fetchFilialProdutoSales(companyKey, posMembers, ecomMembers, resolvedRange, comparisonMode);
    } catch (produtosError) {
      console.error('Erro ao carregar produtos da filial (não-fatal):', produtosError);
    }

    return NextResponse.json({
      filial: selectedFilialRow.filial,
      displayName: selectedFilialRow.displayName,
      vendas: selectedFilialRow.vendas,
      vendasPrevious: selectedFilialRow.vendasPrevious,
      qtde: selectedFilialRow.qtde,
      meta: selectedFilialRow.meta,
      projecao: selectedFilialRow.projecao,
      projecaoPct: selectedFilialRow.projecaoPct,
      categories: selectedFilialRow.categories,
      categoryList: categories,
      daysElapsed,
      totalDaysInMonth,
      month,
      year,
      range: {
        start: formatDateForQuery(new Date(resolvedRange.start.getTime())),
        end: formatDateForQuery(new Date(endInclusiveUtc.getTime())),
      },
      produtos,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Erro ao carregar dados de filial:', error);
    return NextResponse.json({ error: 'Erro ao carregar dados de filial' }, { status: 500 });
  }
}
