import { NextResponse } from "next/server";

import { SHOPIFY_COMPANIES, getShopifyCredentials, isShopifyCompany } from "@/lib/shopify/config";
import { getShopifySyncState } from "@/lib/shopify/orders-store";
import { runShopifyIncrementalSync } from "@/lib/shopify/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/shopify/sync?company=nerd|scarfme  (sem company = as duas)
 *
 * Roda a varredura incremental por até ~45 s. É retomável: a carga inicial dos pedidos
 * anda chamando de novo até `complete: true`. Também serve de agendamento (QStash/cron)
 * como rede de segurança dos webhooks. GET devolve só o estado.
 */
function companiesFrom(request: Request) {
  const company = new URL(request.url).searchParams.get("company");
  if (company && !isShopifyCompany(company)) return null;
  const list = company && isShopifyCompany(company) ? [company] : [...SHOPIFY_COMPANIES];
  return list.filter((c) => getShopifyCredentials(c));
}

export async function POST(request: Request) {
  const companies = companiesFrom(request);
  if (!companies) return NextResponse.json({ error: "Parâmetro company inválido." }, { status: 400 });

  const budgetMs = Math.floor(45_000 / Math.max(companies.length, 1));
  const results = await Promise.all(
    companies.map(async (company) => {
      try {
        return { company, ...(await runShopifyIncrementalSync(company, { budgetMs, minIntervalSeconds: 0 })) };
      } catch (error) {
        return { company, ran: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),
  );
  return NextResponse.json({ results }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const companies = companiesFrom(request);
  if (!companies) return NextResponse.json({ error: "Parâmetro company inválido." }, { status: 400 });
  const states = await Promise.all(companies.map(async (company) => ({ company, state: await getShopifySyncState(company) })));
  return NextResponse.json({ states }, { headers: { "Cache-Control": "no-store" } });
}
