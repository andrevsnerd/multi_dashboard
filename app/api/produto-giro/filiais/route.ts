import { NextResponse } from "next/server";

import { fetchFilialProdutoSales } from "@/lib/repositories/performance";
import { type CompanyKey, VAREJO_VALUE } from "@/lib/config/company";
import { resolveCompanyDynamic } from "@/lib/config/company-server";
import { normalizeRangeForQuery } from "@/lib/utils/date";

export const maxDuration = 300;

const MATRIZ_FILIAIS: Record<string, string[]> = {
  scarfme: ["SCARF ME - MATRIZ"],
  nerd: ["NERD"],
};

const CONCURRENCY = 6;

function isValidYmd(value: string | null): value is string {
  if (!value) return false;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return !Number.isNaN(dt.getTime());
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      results[i] = await mapper(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

/**
 * Vendas POR FILIAL para a Produto Giro: quebra o faturamento total do período/escopo em cada
 * filial (grupos canônicos colapsados; e-commerce como uma linha só) + a % que representa.
 * Uma consulta por bucket reusando `fetchFilialProdutoSales` (lógica validada) → a soma dos
 * buckets bate com o total da tela. Sem SQL de venda nova (regra do CLAUDE.md).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyKey = searchParams.get("company") as CompanyKey;
  const filialParam = searchParams.get("filial") || null;
  const startParam = searchParams.get("start");
  const endParam = searchParams.get("end");
  const produtoIds = searchParams.getAll("produto").map((p) => p.trim()).filter(Boolean);

  if (!companyKey) {
    return NextResponse.json({ error: 'Parâmetro "company" obrigatório' }, { status: 400 });
  }
  if (!isValidYmd(startParam) || !isValidYmd(endParam)) {
    return NextResponse.json({ error: 'Parâmetros "start"/"end" (yyyy-MM-dd) inválidos' }, { status: 400 });
  }

  const company = await resolveCompanyDynamic(companyKey);
  if (!company) {
    return NextResponse.json({ error: "Empresa não encontrada" }, { status: 404 });
  }

  const ecommerceFilials = new Set(company.ecommerceFilials ?? []);
  const matrizSet = new Set(MATRIZ_FILIAIS[companyKey] ?? []);
  const todasFiliais = (company.filialFilters.sales ?? []).filter((f) => !matrizSet.has(f));
  const displayNames = company.filialDisplayNames ?? {};
  const filialGroups = company.filialGroups ?? {};

  // Se uma filial específica foi escolhida, restringe o universo a ela (ou ao grupo dela).
  let universo = todasFiliais;
  if (filialParam && filialParam !== VAREJO_VALUE) {
    const members = filialGroups[filialParam] ?? [filialParam];
    universo = todasFiliais.filter((f) => members.includes(f));
  } else if (filialParam === VAREJO_VALUE) {
    universo = todasFiliais.filter((f) => !ecommerceFilials.has(f));
  }

  // Monta os "buckets" de exibição: cada grupo canônico de loja física = 1 bucket;
  // todo o e-commerce = 1 bucket "E-commerce".
  const memberToCanonical = new Map<string, string>();
  for (const [canon, members] of Object.entries(filialGroups)) {
    for (const m of members) memberToCanonical.set(m, canon);
  }

  const posUniverso = universo.filter((f) => !ecommerceFilials.has(f));
  const ecomUniverso = universo.filter((f) => ecommerceFilials.has(f));

  type Bucket = { key: string; label: string; ecommerce: boolean; posMembers: string[]; ecomMembers: string[] };
  const posBuckets = new Map<string, Bucket>();
  for (const f of posUniverso) {
    const canon = memberToCanonical.get(f) ?? f;
    let b = posBuckets.get(canon);
    if (!b) {
      b = { key: canon, label: displayNames[canon] ?? canon, ecommerce: false, posMembers: [], ecomMembers: [] };
      posBuckets.set(canon, b);
    }
    b.posMembers.push(f);
  }
  const buckets: Bucket[] = Array.from(posBuckets.values());
  if (ecomUniverso.length > 0) {
    buckets.push({ key: "__ecommerce__", label: "E-commerce", ecommerce: true, posMembers: [], ecomMembers: ecomUniverso });
  }

  const range = normalizeRangeForQuery({ start: startParam, end: endParam });

  try {
    const raw = await mapWithConcurrency(buckets, CONCURRENCY, async (b) => {
      const rows = await fetchFilialProdutoSales(companyKey, b.posMembers, b.ecomMembers, range, "month", {
        groupByCor: false,
        produtoIds: produtoIds.length > 0 ? produtoIds : null,
        includePrevious: false,
        limit: 0,
      });
      let vendas = 0;
      let qtde = 0;
      for (const r of rows) {
        vendas += Number(r.vendas ?? 0);
        qtde += Number(r.qtde ?? 0);
      }
      // vendas EXATO (centavos) — arredondar só na exibição; qtde é inteiro.
      return { key: b.key, label: b.label, ecommerce: b.ecommerce, vendas, qtde: Math.round(qtde) };
    });

    // Total = soma dos valores EXATOS (não da soma dos arredondados) → bate com o KPI.
    const totalVendasExato = raw.reduce((s, b) => s + b.vendas, 0);
    const totalVendas = Math.round(totalVendasExato * 100) / 100;
    const totalQtde = raw.reduce((s, b) => s + b.qtde, 0);

    const filiais = raw
      .filter((b) => Math.round(b.vendas) !== 0 || b.qtde !== 0)
      .map((b) => ({
        key: b.key,
        label: b.label,
        ecommerce: b.ecommerce,
        vendas: Math.round(b.vendas * 100) / 100,
        qtde: b.qtde,
        pct: totalVendasExato > 0 ? (b.vendas / totalVendasExato) * 100 : 0,
      }))
      .sort((a, b) => b.vendas - a.vendas);

    return NextResponse.json(
      { totalVendas, totalQtde, filiais },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Erro em /api/produto-giro/filiais:", error);
    return NextResponse.json({ error: "Erro ao carregar vendas por filial" }, { status: 500 });
  }
}
