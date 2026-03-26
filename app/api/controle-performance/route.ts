import { NextResponse } from 'next/server';
import { fetchPerformanceData } from '@/lib/repositories/performance';
import { readGoals } from '@/lib/utils/goals-storage';
import { resolveCompany, type CompanyKey } from '@/lib/config/company';

export const maxDuration = 300;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyKey = searchParams.get('company') as CompanyKey;
  const monthParam = searchParams.get('month');
  const yearParam = searchParams.get('year');

  if (!companyKey || monthParam === null || yearParam === null) {
    return NextResponse.json({ error: 'Parâmetros obrigatórios faltando' }, { status: 400 });
  }

  const month = parseInt(monthParam, 10);
  const year = parseInt(yearParam, 10);

  const company = resolveCompany(companyKey);
  if (!company) {
    return NextResponse.json({ error: 'Empresa não encontrada' }, { status: 404 });
  }

  try {
    const [performanceData, allGoals] = await Promise.all([
      fetchPerformanceData(companyKey, month, year),
      readGoals(),
    ]);

    const monthGoals: Record<string, number> = allGoals[companyKey]?.[String(year)]?.[String(month)] ?? {};

    const ecommerceFilials = new Set(company.ecommerceFilials ?? []);

    // Filiais que são depósito/matriz (não vendem ao público)
    const matrizFiliais: Record<string, string[]> = {
      scarfme: ['SCARF ME - MATRIZ'],
      nerd: ['NERD'],
    };
    const matrizSet = new Set(matrizFiliais[companyKey] ?? []);

    // Filiais de venda: excluir apenas matriz (ecommerce incluído para aparecer na tabela)
    const filiais = company.filialFilters.sales.filter(
      f => !matrizSet.has(f)
    );

    // Handle filial groups (e.g., PAULISTA for SCARFME)
    const filialGroups = company.filialGroups ?? {};
    const nonCanonicalFilials = new Set<string>();
    const canonicalToMembers = new Map<string, string[]>();

    for (const [canonical, members] of Object.entries(filialGroups)) {
      canonicalToMembers.set(canonical, members);
      members.forEach(m => { if (m !== canonical) nonCanonicalFilials.add(m); });
    }

    // Agrupar filiais de ecommerce sob a primeira como canônica
    const ecommerceList = filiais.filter(f => ecommerceFilials.has(f));
    let ecommerceCanonical: string | null = null;
    if (ecommerceList.length > 0) {
      ecommerceCanonical = ecommerceList[0];
      canonicalToMembers.set(ecommerceCanonical, ecommerceList);
      ecommerceList.slice(1).forEach(f => nonCanonicalFilials.add(f));
    }

    const regularFiliais = filiais.filter(f => !nonCanonicalFilials.has(f) && !ecommerceFilials.has(f));
    const displayFiliais = [
      ...(ecommerceCanonical ? [ecommerceCanonical] : []),
      ...regularFiliais,
    ];

    // Aggregate data by canonical filial
    const currentByFilial = new Map<string, Map<string, { vendas: number; qtde: number }>>();
    const previousByFilial = new Map<string, Map<string, { vendas: number; qtde: number }>>();

    const processRows = (
      rows: Array<{ filial: string; categoria: string; vendas: number; qtde: number }>,
      target: Map<string, Map<string, { vendas: number; qtde: number }>>
    ) => {
      rows.forEach(row => {
        let canonicalFilial = row.filial;
        for (const [canonical, members] of canonicalToMembers) {
          if (members.includes(row.filial)) { canonicalFilial = canonical; break; }
        }
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

    // Get ordered categories by total sales
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

    // Date calculations for projection
    const today = new Date();
    const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
    const totalDaysInMonth = new Date(year, month + 1, 0).getDate();
    const daysElapsed = isCurrentMonth ? today.getDate() : totalDaysInMonth;

    // Build rows
    const filialRows = displayFiliais.map(filial => {
      const currentData = currentByFilial.get(filial) ?? new Map();
      const previousData = previousByFilial.get(filial) ?? new Map();

      const vendas = Array.from(currentData.values()).reduce((s, d) => s + d.vendas, 0);
      const vendasPrevious = Array.from(previousData.values()).reduce((s, d) => s + d.vendas, 0);
      const qtde = Array.from(currentData.values()).reduce((s, d) => s + d.qtde, 0);

      // Sum goals for all members of the group
      const groupMembers = canonicalToMembers.get(filial) ?? [filial];
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

    const totalVendas = filialRows.reduce((s, f) => s + f.vendas, 0);
    const totalVendasPrevious = filialRows.reduce((s, f) => s + f.vendasPrevious, 0);
    const totalQtde = filialRows.reduce((s, f) => s + f.qtde, 0);

    return NextResponse.json({
      filiais: filialRows,
      categories,
      daysElapsed,
      totalDaysInMonth,
      month,
      year,
      totals: {
        vendas: totalVendas,
        vendasPrevious: totalVendasPrevious,
        qtde: totalQtde,
      },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Erro ao carregar dados de performance:', error);
    return NextResponse.json({ error: 'Erro ao carregar dados de performance' }, { status: 500 });
  }
}
