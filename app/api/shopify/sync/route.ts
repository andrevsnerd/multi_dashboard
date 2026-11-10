import { NextResponse } from "next/server";

import { SHOPIFY_COMPANIES, getShopifyCredentials, isShopifyCompany } from "@/lib/shopify/config";
import { getShopifySyncState } from "@/lib/shopify/orders-store";
import { runShopifyBackfill, runShopifyIncrementalSync } from "@/lib/shopify/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/shopify/sync?company=nerd|scarfme  (sem company = as duas)
 *
 * Roda a varredura incremental por até ~45 s. É retomável: a carga inicial dos pedidos
 * anda chamando de novo até `complete: true`. Também serve de agendamento (QStash/cron)
 * como rede de segurança dos webhooks. GET devolve só o estado.
 *
 * `mode=backfill`: carga do histórico completo (read_all_orders), retomável; chamar de
 * novo até `complete: true`. `restart=1` recomeça do primeiro pedido.
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

  const params = new URL(request.url).searchParams;
  const backfill = params.get("mode") === "backfill";
  const restart = params.get("restart") === "1";
  const budgetMs = Math.floor(45_000 / Math.max(companies.length, 1));
  const results = await Promise.all(
    companies.map(async (company) => {
      try {
        const result = backfill
          ? await runShopifyBackfill(company, { budgetMs, restart })
          : await runShopifyIncrementalSync(company, { budgetMs, minIntervalSeconds: 0 });
        return { company, ...result };
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
  const states = await Promise.all(
    companies.map(async (company) => ({
      company,
      state: await getShopifySyncState(company),
      backfill: await getShopifySyncState(`${company}#backfill`),
    })),
  );
  return NextResponse.json({ states }, { headers: { "Cache-Control": "no-store" } });
}
