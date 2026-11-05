import { NextResponse } from "next/server";

import { autorizarPrecos, parsePrecoCompany } from "@/lib/auth/precos-guard";
import { getFilialLabelForDisplay, normalizeFilialLookupKey } from "@/lib/config/company";
import { resolveCompanyDynamic } from "@/lib/config/company-server";
import { fetchSalesTotals } from "@/lib/services/salesTotals";
import { normalizeRangeForQuery } from "@/lib/utils/date";
import { hojeBrasilia, isYmd, MATRIZ_FILIAIS, mapWithConcurrency } from "@/lib/blackfriday/datas";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CONCURRENCY = 6;

/**
 * Venda TOTAL de cada loja (todos os produtos) no período da Black, pela função canônica
 * `fetchSalesTotals` — é o denominador do "quanto da venda da loja veio da Black".
 *
 * Loja física: lista explícita dos CNPJs do grupo (vendas somam o grupo inteiro).
 * E-commerce: `filial` = um CNPJ do canal (aí a função delega ao resumo do e-commerce,
 * que já soma o canal inteiro).
 */
export async function GET(request: Request) {
  const autorizacao = await autorizarPrecos(request);
  if ("erro" in autorizacao) return autorizacao.erro;

  const { searchParams } = new URL(request.url);
  const companyKey = parsePrecoCompany(searchParams.get("company"));
  const inicio = searchParams.get("inicio");
  if (!companyKey || !isYmd(inicio)) {
    return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 });
  }

  try {
    const company = await resolveCompanyDynamic(companyKey);
    if (!company) return NextResponse.json({ error: "Empresa não encontrada." }, { status: 404 });

    const hoje = hojeBrasilia().ymd;
    const range = normalizeRangeForQuery({ start: inicio, end: hoje });

    const matriz = new Set((MATRIZ_FILIAIS[companyKey] ?? []).map(normalizeFilialLookupKey));
    const ecommerceSet = new Set((company.ecommerceFilials ?? []).map(normalizeFilialLookupKey));
    const vendaFiliais = (company.filialFilters.sales ?? []).filter((f) => !matriz.has(normalizeFilialLookupKey(f)));

    const buckets = new Map<string, { label: string; ecommerce: boolean; membros: string[] }>();
    for (const f of vendaFiliais) {
      const ecommerce = ecommerceSet.has(normalizeFilialLookupKey(f));
      const label = getFilialLabelForDisplay(company, f);
      const b = buckets.get(label) ?? { label, ecommerce, membros: [] };
      b.membros.push(f);
      buckets.set(label, b);
    }

    const lista = [...buckets.values()];
    const resultados = await mapWithConcurrency(lista, CONCURRENCY, async (b) => {
      // E-commerce: UMA chamada com qualquer CNPJ do canal — o resumo do e-commerce já
      // devolve o canal inteiro (somar por CNPJ multiplicava o total pelo nº de CNPJs;
      // medido em 05/11/2026: 4 CNPJs → 4×).
      const partes = b.ecommerce
        ? [await fetchSalesTotals({ company: companyKey, range, filial: b.membros[0] })]
        : [await fetchSalesTotals({ company: companyKey, range, filiais: b.membros })];
      return {
        label: b.label,
        ecommerce: b.ecommerce,
        vendas: partes.reduce((s, p) => s + Number(p.vendas ?? 0), 0),
        qtde: partes.reduce((s, p) => s + Number(p.qtde ?? 0), 0),
        tickets: partes.reduce((s, p) => s + Number(p.tickets ?? 0), 0),
      };
    });

    return NextResponse.json(
      {
        inicio,
        fim: hoje,
        lojas: resultados,
        total: {
          vendas: resultados.reduce((s, r) => s + r.vendas, 0),
          qtde: resultados.reduce((s, r) => s + r.qtde, 0),
          tickets: resultados.reduce((s, r) => s + r.tickets, 0),
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[black-friday/lojas] erro", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao buscar a venda total das lojas." },
      { status: 500 }
    );
  }
}
