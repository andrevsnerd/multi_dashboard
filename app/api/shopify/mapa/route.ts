import { NextResponse } from "next/server";

import { autorizarShopify } from "@/lib/shopify/auth";
import {
  deleteVariantMaps,
  fetchMapaProdutos,
  fetchMapaResumo,
  listVariantMaps,
  saveVariantMaps,
  type ShopifyVariantMapRow,
} from "@/lib/shopify/catalog-store";
import { runShopifyCatalogSync } from "@/lib/shopify/catalog-sync";
import { getShopifyCredentials, isShopifyCompany, type ShopifyCompany } from "@/lib/shopify/config";
import { rematchShopifyVariants, vincularManual } from "@/lib/shopify/linx-match";
import { getShopifySyncState } from "@/lib/shopify/orders-store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Mapeamento variante Shopify → produto/cor/tamanho do Linx (tabela nossa no Neon;
 * NÃO altera o Shopify).
 *
 * GET  ?company&status&statusShopify&busca&pagina → resumo + produtos da página.
 * POST { company, acao, ... }:
 *   sincronizar  — varre o catálogo do Shopify (retomável); ao completar, recalcula o vínculo
 *   remapear     — recalcula o vínculo automático (não toca no manual)
 *   vincular     — { variantIds, produto, cor: string | "auto" | null } vínculo manual
 *   confirmar    — { variantIds } sugestão → vínculo manual com os mesmos valores
 *   nao_linx     — { variantIds } marca como "não é produto do Linx"
 *   limpar       — { variantIds } apaga o vínculo manual e recalcula o automático
 */

function companyOf(value: unknown): ShopifyCompany | null {
  return isShopifyCompany(value) && getShopifyCredentials(value) ? value : null;
}

export async function GET(request: Request) {
  const autorizacao = await autorizarShopify(request);
  if ("erro" in autorizacao) return autorizacao.erro;
  const params = new URL(request.url).searchParams;
  const company = companyOf(params.get("company"));
  if (!company) return NextResponse.json({ error: "Empresa inválida." }, { status: 400 });

  try {
    const [resumo, lista, catalogo] = await Promise.all([
      fetchMapaResumo(company),
      fetchMapaProdutos(company, {
        status: params.get("status") ?? undefined,
        statusShopify: params.get("statusShopify") ?? undefined,
        busca: params.get("busca") ?? undefined,
        pagina: Number(params.get("pagina") ?? 1) || 1,
      }),
      getShopifySyncState(`${company}#catalog`),
    ]);
    return NextResponse.json(
      {
        data: {
          resumo,
          ...lista,
          catalogo: {
            ultimaCompleta: catalogo?.last_complete_at ?? null,
            emAndamento: !!catalogo?.cursor,
            erro: catalogo?.last_error ?? null,
          },
          podeEditar: autorizacao.auth.podeEditar,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[shopify/mapa] GET", error);
    return NextResponse.json({ error: "Erro ao carregar o mapeamento." }, { status: 500 });
  }
}

interface Body {
  company?: string;
  acao?: string;
  variantIds?: string[];
  produto?: string;
  cor?: string | null;
  restart?: boolean;
}

export async function POST(request: Request) {
  const autorizacao = await autorizarShopify(request, { exigirEscrita: true });
  if ("erro" in autorizacao) return autorizacao.erro;
  const { username } = autorizacao.auth;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Body JSON inválido." }, { status: 400 });
  }
  const company = companyOf(body.company);
  if (!company) return NextResponse.json({ error: "Empresa inválida." }, { status: 400 });
  const ids = Array.isArray(body.variantIds) ? body.variantIds.map(String).filter(Boolean).slice(0, 2000) : [];

  try {
    switch (body.acao) {
      case "sincronizar": {
        const sync = await runShopifyCatalogSync(company, { budgetMs: 150_000, restart: !!body.restart });
        const rematch = sync.complete ? await rematchShopifyVariants(company) : null;
        return NextResponse.json({ data: { sync, rematch } });
      }
      case "remapear":
        return NextResponse.json({ data: { rematch: await rematchShopifyVariants(company) } });
      case "vincular": {
        if (ids.length === 0 || !body.produto?.trim()) {
          return NextResponse.json({ error: "Informe as variantes e o produto do Linx." }, { status: 400 });
        }
        const cor = body.cor === undefined ? "auto" : body.cor;
        return NextResponse.json({ data: await vincularManual(company, ids, body.produto, cor, username) });
      }
      case "confirmar": {
        const maps = await listVariantMaps(company);
        const rows: ShopifyVariantMapRow[] = ids
          .map((id) => maps.get(id))
          .filter((m): m is ShopifyVariantMapRow => !!m && !!m.produto)
          .map((m) => ({ ...m, status: "vinculado", origem: "manual", metodo: `confirmado (${m.metodo ?? "sugestão"})` }));
        await saveVariantMaps(company, rows, { onlyAuto: false, updatedBy: username });
        return NextResponse.json({ data: { gravadas: rows.length } });
      }
      case "nao_linx": {
        const rows: ShopifyVariantMapRow[] = ids.map((id) => ({
          variant_id: id,
          status: "nao_linx",
          origem: "manual",
          metodo: "marcado à mão",
          score: null,
          produto: null,
          cor_produto: null,
          tamanho: null,
          desc_produto: null,
          desc_cor: null,
          componentes: null,
        }));
        await saveVariantMaps(company, rows, { onlyAuto: false, updatedBy: username });
        return NextResponse.json({ data: { gravadas: rows.length } });
      }
      case "limpar": {
        await deleteVariantMaps(company, ids);
        return NextResponse.json({ data: { rematch: await rematchShopifyVariants(company, ids) } });
      }
      default:
        return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
    }
  } catch (error) {
    console.error("[shopify/mapa] POST", body.acao, error);
    const message = error instanceof Error ? error.message : "Erro ao gravar o mapeamento.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
