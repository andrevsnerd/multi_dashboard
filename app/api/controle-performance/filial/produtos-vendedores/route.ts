import { NextResponse } from 'next/server';
import { fetchFilialProdutoVendedorSales, fetchPerformanceData } from '@/lib/repositories/performance';
import { type CompanyKey } from '@/lib/config/company';
import { resolveCompanyLive } from '@/lib/server/company-live';
import { normalizeRangeForQuery } from '@/lib/utils/date';

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
    // Reusa mesma lógica de agrupamento de filiais para resolver membros POS/Ecom.
    const performanceData = await fetchPerformanceData(companyKey, resolvedRange, comparisonMode);

    const ecommerceFilials = new Set(company.ecommerceFilials ?? []);
    const matrizFiliais: Record<string, string[]> = {
      scarfme: ['SCARF ME - MATRIZ'],
      nerd: ['NERD'],
    };
    const matrizSet = new Set(matrizFiliais[companyKey] ?? []);
    const filiais = company.filialFilters.sales.filter(f => !matrizSet.has(f));

    const filialGroups = company.filialGroups ?? {};
    const canonicalToMembers = new Map<string, string[]>();
    const nonCanonicalFilials = new Set<string>();
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

    // Normalize requested filial to canonical (so the export matches the UI grouping)
    const canonicalRequested = resolveCanonicalFilial(filialParam, memberToCanonical, canonicalToMemberNorms);
    const groupMembers = canonicalToMembers.get(canonicalRequested) ?? [canonicalRequested];
    const isEcommerceFilial = canonicalRequested === ecommerceCanonical;
    const posMembers = isEcommerceFilial ? [] : groupMembers.filter(f => !ecommerceFilials.has(f));
    const ecomMembers = isEcommerceFilial ? groupMembers : [];

    void performanceData; // keeps parity with existing endpoint; can be used for future validations

    const rows = await fetchFilialProdutoVendedorSales(
      companyKey,
      posMembers,
      ecomMembers,
      resolvedRange,
      comparisonMode
    );

    return NextResponse.json({ filial: canonicalRequested, produtosVendedores: rows }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Erro ao carregar produto x vendedor:', error);
    return NextResponse.json({ error: 'Erro ao carregar produto x vendedor' }, { status: 500 });
  }
}

