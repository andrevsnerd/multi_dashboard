import { createHmac, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { companyForShopDomain, getShopifyCredentials } from "@/lib/shopify/config";
import { removeShopifyOrder, syncShopifyOrderById } from "@/lib/shopify/sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/shopify/webhook — recebe os webhooks das duas lojas (tempo real).
 *
 * Autenticidade: HMAC-SHA256 do corpo CRU com o Client Secret do app da loja
 * (X-Shopify-Hmac-Sha256, base64). Sem assinatura válida → 401, nada é gravado.
 *
 * Em vez de mapear o JSON REST do webhook, relemos o pedido pela GraphQL
 * (`syncShopifyOrderById`): um único mapeamento para webhook e varredura.
 * Erro → 500, e o Shopify reenvia (até 8 vezes em 4 h).
 */
export async function POST(request: Request) {
  const raw = await request.text();
  const shopDomain = request.headers.get("x-shopify-shop-domain");
  const topic = request.headers.get("x-shopify-topic") ?? "";
  const hmacHeader = request.headers.get("x-shopify-hmac-sha256") ?? "";

  const company = companyForShopDomain(shopDomain);
  const creds = company ? getShopifyCredentials(company) : null;
  if (!company || !creds) {
    return NextResponse.json({ error: "Loja desconhecida." }, { status: 401 });
  }

  const expected = createHmac("sha256", creds.clientSecret).update(raw, "utf8").digest();
  const received = Buffer.from(hmacHeader, "base64");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  }

  let payload: { id?: number | string; order_id?: number | string; admin_graphql_api_id?: string };
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true, ignored: "corpo inválido" });
  }

  try {
    if (topic === "orders/delete") {
      if (payload.id != null) await removeShopifyOrder(company, payload.id);
    } else if (topic === "refunds/create") {
      if (payload.order_id != null) await syncShopifyOrderById(company, payload.order_id);
    } else if (topic.startsWith("orders/")) {
      const ref = payload.admin_graphql_api_id ?? payload.id;
      if (ref != null) await syncShopifyOrderById(company, ref);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`[shopify/webhook] ${company} ${topic} falhou`, error);
    return NextResponse.json({ error: "Falha ao processar." }, { status: 500 });
  }
}
