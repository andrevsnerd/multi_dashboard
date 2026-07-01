// TEMPORÁRIO — harness de verificação do batch de métricas (compra sugerida ABC).
// Compara getControleEstoqueMetricasItens (per-item, referência) vs
// getControleEstoqueMetricasItensBatched (novo) sobre dados reais, item × loja.
// Deve retornar mismatches: [] (resultado idêntico). Apagar depois.
import { fetchProductsWithDetails } from "@/lib/repositories/products";
import { resolveCompanyLive } from "@/lib/server/company-live";
import { getOperationalFilials } from "@/lib/config/company";
import {
  getControleEstoqueMetricasItens,
  getControleEstoqueMetricasItensBatched,
} from "@/lib/server/controle-estoque-metricas";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get("company") ?? "nerd";
  const n = Number(searchParams.get("n") ?? "60");
  const start = searchParams.get("start") ?? "2025-06-30";
  const end = searchParams.get("end") ?? "2026-06-30";

  const details = await fetchProductsWithDetails({
    company,
    range: { start, end },
    filial: null,
    groupByColor: true,
  });
  details.sort((a, b) => (b.totalRevenue ?? 0) - (a.totalRevenue ?? 0));
  const candidates = details.slice(0, n);
  const itens = candidates.map((d) => ({
    produto: String(d.productId ?? "").trim(),
    corProduto: d.corProduto ?? null,
  }));

  const live = await resolveCompanyLive(company);
  const lojas = live ? getOperationalFilials(live, "sales") : [];

  const mismatches: Array<{ loja: string; key: string; field: string; old: unknown; neu: unknown }> = [];
  let comparados = 0;
  let soOld = 0;
  let soNew = 0;

  for (const loja of lojas) {
    const [oldMap, newMap] = await Promise.all([
      getControleEstoqueMetricasItens({ company, filial: loja, includeHistorico: true, itens }),
      getControleEstoqueMetricasItensBatched({ company, filial: loja, includeHistorico: true, itens }),
    ]);
    const keys = new Set([...Object.keys(oldMap), ...Object.keys(newMap)]);
    for (const key of keys) {
      const o = oldMap[key];
      const nw = newMap[key];
      if (o && !nw) { soOld += 1; mismatches.push({ loja, key, field: "__presença__", old: "existe", neu: "ausente" }); continue; }
      if (!o && nw) { soNew += 1; mismatches.push({ loja, key, field: "__presença__", old: "ausente", neu: "existe" }); continue; }
      if (!o || !nw) continue;
      comparados += 1;
      // Compara resumo (alimenta a compra ideal), estoquePorFilial e vendasPorFilial.
      const partes: Array<"resumo" | "estoquePorFilial" | "vendasPorFilial"> = ["resumo", "estoquePorFilial", "vendasPorFilial"];
      for (const parte of partes) {
        const so = JSON.stringify(o[parte]);
        const sn = JSON.stringify(nw[parte]);
        if (so !== sn && mismatches.length < 50) {
          mismatches.push({ loja, key, field: parte, old: o[parte], neu: nw[parte] });
        }
      }
    }
  }

  return Response.json({
    company,
    range: { start, end },
    itens: itens.length,
    lojas: lojas.length,
    comparados,
    soOld,
    soNew,
    ok: mismatches.length === 0,
    totalMismatches: mismatches.length,
    mismatches: mismatches.slice(0, 30),
  });
}
