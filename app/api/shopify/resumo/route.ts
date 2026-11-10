import { NextResponse } from "next/server";

import { getShopifyCredentials, isShopifyCompany } from "@/lib/shopify/config";
import { fetchShopifyResumo, todayBrt } from "@/lib/shopify/dashboard";
import { runShopifyIncrementalSync } from "@/lib/shopify/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/shopify/resumo?company=nerd|scarfme&start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Antes de ler, puxa do Shopify o que mudou desde a última varredura (no máximo 1 vez a
 * cada 30 s, até ~8 s). Assim a página fica em dia mesmo se um webhook se perder.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get("company");
  if (!isShopifyCompany(company)) {
    return NextResponse.json({ error: "Parâmetro company inválido." }, { status: 400 });
  }
  if (!getShopifyCredentials(company)) {
    return NextResponse.json(
      { error: "Shopify não configurado para esta empresa (variáveis SHOPIFY_* ausentes)." },
      { status: 503 },
    );
  }

  const today = todayBrt();
  const start = searchParams.get("start") ?? today;
  const end = searchParams.get("end") ?? start;

  let syncError: string | null = null;
  try {
    const result = await runShopifyIncrementalSync(company, { budgetMs: 8_000, minIntervalSeconds: 30 });
    syncError = result.error ?? null;
  } catch (error) {
    syncError = error instanceof Error ? error.message : String(error);
    console.error("[shopify/resumo] sincronização falhou", error);
  }

  try {
    const data = await fetchShopifyResumo(company, start, end);
    if (syncError) data.sync.erro = syncError;
    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[shopify/resumo] leitura falhou", error);
    return NextResponse.json({ error: "Erro ao carregar os dados do Shopify." }, { status: 500 });
  }
}
