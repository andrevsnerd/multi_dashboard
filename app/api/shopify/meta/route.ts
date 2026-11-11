import { NextResponse } from "next/server";

import { findUserByUsername } from "@/lib/auth/users-store";
import { canEditarMetaPainel, normalizeRole } from "@/lib/auth/permissions";
import { getShopifyCredentials, isShopifyCompany } from "@/lib/shopify/config";
import { fetchShopifySerieMes, todayBrt } from "@/lib/shopify/dashboard";
import { getMetaPainel, saveMetaPainel } from "@/lib/utils/metas-paineis-store";

export const dynamic = "force-dynamic";

const mesValido = (v: unknown): v is string => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

/**
 * Meta do mês da loja Shopify (separada das metas por filial do dashboard) + venda dia a dia
 * do mês, para o quadro "Venda por dia" da página Shopify.
 * GET ?company=&mes=YYYY-MM → { meta, dias } · POST { company, mes, valor } (valor 0 apaga).
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const company = params.get("company");
  if (!isShopifyCompany(company)) {
    return NextResponse.json({ error: "Parâmetro company inválido." }, { status: 400 });
  }
  if (!getShopifyCredentials(company)) {
    return NextResponse.json({ error: "Shopify não configurado para esta empresa." }, { status: 503 });
  }
  const mesParam = params.get("mes");
  const mes = mesValido(mesParam) ? mesParam : todayBrt().slice(0, 7);

  try {
    const [meta, dias] = await Promise.all([
      getMetaPainel(company, "shopify", mes),
      fetchShopifySerieMes(company, mes),
    ]);
    return NextResponse.json(
      { data: { mes, meta: meta?.valor ?? 0, atualizadaPor: meta?.usuario ?? null, dias } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[shopify/meta] leitura falhou", error);
    return NextResponse.json({ error: "Erro ao carregar a meta do Shopify." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const username = request.headers.get("x-auth-username")?.trim();
  const user = username ? await findUserByUsername(username) : null;
  if (!user) {
    return NextResponse.json({ error: "Usuário não identificado. Faça login novamente." }, { status: 401 });
  }
  if (!canEditarMetaPainel(normalizeRole(user.role))) {
    return NextResponse.json({ error: "Esta função não pode alterar a meta." }, { status: 403 });
  }

  let body: { company?: string; mes?: string; valor?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Body JSON inválido." }, { status: 400 });
  }
  if (!isShopifyCompany(body.company ?? null) || !mesValido(body.mes)) {
    return NextResponse.json({ error: "Empresa ou mês inválido." }, { status: 400 });
  }
  const valor = Number(body.valor);
  if (!Number.isFinite(valor) || valor < 0) {
    return NextResponse.json({ error: "Meta inválida." }, { status: 400 });
  }

  try {
    const meta = await saveMetaPainel({
      company: body.company as string,
      escopo: "shopify",
      chave: body.mes,
      valor,
      usuario: user.username,
    });
    return NextResponse.json({ data: { meta: meta?.valor ?? 0 } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[shopify/meta] gravação falhou", error);
    const message = error instanceof Error ? error.message : "Erro ao salvar a meta.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
