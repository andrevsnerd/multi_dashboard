import { NextResponse } from "next/server";

import { type CompanyKey } from "@/lib/config/company";
import { resolveCompanyLive } from "@/lib/server/company-live";
import { formatDateForQuery, normalizeRangeForQuery } from "@/lib/utils/date";
import { fetchFilialProdutoSales } from "@/lib/repositories/performance";
import {
  buildCurvaPorProdutoKey,
  type CurvaPorProdutoApiResponse,
  type CurvaPorProdutoClassificacao,
  type CurvaPorProdutoSelectedItem,
} from "@/lib/performance/curvaPorProduto";

export const maxDuration = 300;

interface CurvaRankedRow {
  produto: string;
  descricao: string;
  categoria: string;
  linha?: string;
  subgrupo?: string;
  tipoProduto?: string;
  colecao?: string;
  descColecao?: string;
  grade?: string;
  codigoBarra?: string;
  cor?: string;
  corDescricao?: string;
  vendas: number;
  qtde: number;
  custo: number;
  vendasPrevious: number;
  curva: CurvaPorProdutoClassificacao;
  percParticipacao: number;
  percCumulativa: number;
}

function normalizeFilialKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
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
      if ((norm.includes(memberNorm) || memberNorm.includes(norm)) && memberNorm.length > bestLen) {
        bestLen = memberNorm.length;
        bestCanonical = entry.canonical;
      }
    }
  }
  return bestCanonical ?? rawFilial;
}

function parseYmd(value: string | undefined): Date | null {
  if (!value) return null;
  const parts = value.trim().split("-");
  if (parts.length !== 3) return null;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function calcularCurvas(produtos: Array<{
  produto: string;
  descricao: string;
  categoria: string;
  linha?: string;
  subgrupo?: string;
  tipoProduto?: string;
  colecao?: string;
  descColecao?: string;
  grade?: string;
  codigoBarra?: string;
  cor?: string;
  corDescricao?: string;
  vendas: number;
  qtde: number;
  custo: number;
  vendasPrevious: number;
}>): CurvaRankedRow[] {
  const totalGeral = produtos.reduce((sum, item) => sum + item.vendas, 0);
  let cumulative = 0;

  return produtos.map((item) => {
    cumulative += item.vendas;
    const percCumulativa = totalGeral > 0 ? cumulative / totalGeral : 1;
    const curva: CurvaPorProdutoClassificacao = percCumulativa <= 0.8 ? "A" : percCumulativa <= 0.95 ? "B" : "C";
    return {
      ...item,
      curva,
      percParticipacao: totalGeral > 0 ? (item.vendas / totalGeral) * 100 : 0,
      percCumulativa: percCumulativa * 100,
    };
  });
}

type RequestBody = {
  company?: CompanyKey;
  filial?: string | null;
  start?: string;
  end?: string;
  compare?: "month" | "year";
  items?: CurvaPorProdutoSelectedItem[];
};

export async function POST(request: Request) {
  let body: RequestBody;

  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Body JSON invalido" }, { status: 400 });
  }

  const companyKey = body.company;
  const items = (body.items ?? []).filter((item) => (item.produto ?? "").trim() !== "");

  if (!companyKey || items.length === 0) {
    return NextResponse.json({ error: "Parametros obrigatorios faltando" }, { status: 400 });
  }

  const rangeStart = parseYmd(body.start);
  const rangeEnd = parseYmd(body.end);
  if (!rangeStart || !rangeEnd) {
    return NextResponse.json({ error: "Periodo invalido" }, { status: 400 });
  }

  const company = await resolveCompanyLive(companyKey);
  if (!company) {
    return NextResponse.json({ error: "Empresa nao encontrada" }, { status: 404 });
  }

  const comparisonMode: "month" | "year" = body.compare === "year" ? "year" : "month";
  const resolvedRange = normalizeRangeForQuery({ start: rangeStart, end: rangeEnd });

  try {
    const matrizFiliais: Record<string, string[]> = {
      scarfme: ["SCARF ME - MATRIZ"],
      nerd: ["NERD"],
    };
    const matrizSet = new Set(matrizFiliais[companyKey] ?? []);
    const filiais = company.filialFilters.sales.filter((filial) => !matrizSet.has(filial));
    const ecommerceFilials = new Set(company.ecommerceFilials ?? []);

    const filialGroups = company.filialGroups ?? {};
    const nonCanonicalFilials = new Set<string>();
    const canonicalToMembers = new Map<string, string[]>();
    for (const [canonical, members] of Object.entries(filialGroups)) {
      canonicalToMembers.set(canonical, members);
      members.forEach((member) => {
        if (member !== canonical) nonCanonicalFilials.add(member);
      });
    }

    const ecommerceList = filiais.filter((filial) => ecommerceFilials.has(filial));
    let ecommerceCanonical: string | null = null;
    if (ecommerceList.length > 0) {
      ecommerceCanonical = ecommerceList[0];
      canonicalToMembers.set(ecommerceCanonical, ecommerceList);
      ecommerceList.slice(1).forEach((filial) => nonCanonicalFilials.add(filial));
    }

    const memberToCanonical = new Map<string, string>();
    for (const [canonical, members] of canonicalToMembers.entries()) {
      members.forEach((member) => {
        memberToCanonical.set(normalizeFilialKey(member), canonical);
      });
      memberToCanonical.set(normalizeFilialKey(canonical), canonical);
    }
    const canonicalToMemberNorms = Array.from(canonicalToMembers.entries()).map(([canonical, members]) => ({
      canonical,
      members: Array.from(new Set([canonical, ...members])).map(normalizeFilialKey),
    }));

    const filialParam = body.filial?.trim() ? body.filial.trim() : null;
    const isAllMode = !filialParam;
    const allPosMembers = filiais.filter((filial) => !ecommerceFilials.has(filial));
    const allEcomMembers = filiais.filter((filial) => ecommerceFilials.has(filial));

    let posMembers: string[] = [];
    let ecomMembers: string[] = [];
    let displayName = "Visao Geral";

    if (isAllMode) {
      posMembers = allPosMembers;
      ecomMembers = allEcomMembers;
    } else {
      const canonicalFilial = resolveCanonicalFilial(filialParam, memberToCanonical, canonicalToMemberNorms);
      const groupMembers = canonicalToMembers.get(canonicalFilial) ?? [canonicalFilial];
      const isEcommerceFilial = canonicalFilial === ecommerceCanonical;
      posMembers = isEcommerceFilial ? [] : groupMembers.filter((filial) => !ecommerceFilials.has(filial));
      ecomMembers = isEcommerceFilial ? groupMembers : [];
      displayName = company.filialDisplayNames?.[canonicalFilial] ?? canonicalFilial;
    }

    const produtos = await fetchFilialProdutoSales(
      companyKey,
      posMembers,
      ecomMembers,
      resolvedRange,
      comparisonMode,
      { groupByCor: true, limit: 0 }
    );

    const ranked = calcularCurvas(produtos);
    const rankedMap = new Map(ranked.map((item) => [buildCurvaPorProdutoKey(item.produto, item.cor ?? null), item]));
    const totalScopeRevenue = produtos.reduce((sum, item) => sum + item.vendas, 0);

    const response: CurvaPorProdutoApiResponse = {
      filial: filialParam,
      displayName,
      comparisonMode,
      totalScopeRevenue,
      range: {
        start: formatDateForQuery(rangeStart),
        end: formatDateForQuery(rangeEnd),
      },
      rows: items.map((item) => {
        const matched = rankedMap.get(buildCurvaPorProdutoKey(item.produto, item.corProduto ?? null));
        if (!matched) {
          return {
            ...item,
            categoria: item.linha ?? "",
            tipoProduto: item.tipoProduto ?? null,
            colecao: item.colecao ?? null,
            descColecao: item.descColecao ?? null,
            vendas: 0,
            qtde: 0,
            custo: 0,
            vendasPrevious: 0,
            represented: false,
            curva: null,
            percParticipacao: 0,
            percCumulativa: 0,
          };
        }

        return {
          produto: matched.produto,
          descricao: matched.descricao || item.descricao,
          codigoBarra: matched.codigoBarra || item.codigoBarra || null,
          corProduto: matched.cor || item.corProduto || null,
          corDescricao: matched.corDescricao || item.corDescricao || null,
          grade: matched.grade || item.grade || null,
          linha: matched.linha || item.linha || null,
          subgrupo: matched.subgrupo || item.subgrupo || null,
          tipoProduto: matched.tipoProduto || item.tipoProduto || null,
          colecao: matched.colecao || item.colecao || null,
          descColecao: matched.descColecao || item.descColecao || null,
          categoria: matched.categoria,
          vendas: matched.vendas,
          qtde: matched.qtde,
          custo: matched.custo,
          vendasPrevious: matched.vendasPrevious,
          represented: true,
          curva: matched.curva,
          percParticipacao: matched.percParticipacao,
          percCumulativa: matched.percCumulativa,
        };
      }),
    };

    return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Erro ao carregar curva por produto", error);
    return NextResponse.json({ error: "Erro ao carregar dados" }, { status: 500 });
  }
}
