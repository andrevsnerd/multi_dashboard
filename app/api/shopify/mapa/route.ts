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
import { sincronizarEquivalentes } from "@/lib/shopify/cross-store";
import { parearLotesLinx } from "@/lib/shopify/linx-lotes";
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
 *
 * Decisão manual vale também na outra loja para a variante equivalente (mesma estampa +
 * mesmo modelo) — ver lib/shopify/cross-store.ts. Recalcular uma loja também puxa as
 * decisões da outra.
 */

const outraLoja = (c: ShopifyCompany): ShopifyCompany => (c === "nerd" ? "scarfme" : "nerd");

/** Repassa para a outra loja sem derrubar a resposta se falhar (fica para o próximo recálculo). */
async function repassar(destino: ShopifyCompany) {
  try {
    return await sincronizarEquivalentes(destino);
  } catch (error) {
    console.error("[shopify/mapa] repasse para", destino, "falhou", error);
    return null;
  }
}

function companyOf(value: unknown): ShopifyCompany | null {
  return isShopifyCompany(value) && getShopifyCredentials(value) ? value : null;
}

export async function GET(request: Request) {
  const autorizacao = await autorizarShopify(request, { somenteAdmin: true });
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
  const autorizacao = await autorizarShopify(request, { exigirEscrita: true, somenteAdmin: true });
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
        const outra = sync.complete ? await repassar(company) : null;
        return NextResponse.json({ data: { sync, rematch, outraLoja: outra } });
      }
      case "lotes":
        // Lotes anteriores do Linx (mesma peça, código de produto antigo) — ver linx-lotes.ts.
        return NextResponse.json({ data: { lotes: await parearLotesLinx(company) } });
      case "remapear": {
        const rematch = await rematchShopifyVariants(company);
        return NextResponse.json({ data: { rematch, outraLoja: await repassar(company) } });
      }
      case "vincular": {
        if (ids.length === 0 || !body.produto?.trim()) {
          return NextResponse.json({ error: "Informe as variantes e o produto do Linx." }, { status: 400 });
        }
        const cor = body.cor === undefined ? "auto" : body.cor;
        const r = await vincularManual(company, ids, body.produto, cor, username);
        return NextResponse.json({ data: { ...r, outraLoja: await repassar(outraLoja(company)) } });
      }
      case "confirmar": {
        const maps = await listVariantMaps(company);
        const rows: ShopifyVariantMapRow[] = ids
          .map((id) => maps.get(id))
          .filter((m): m is ShopifyVariantMapRow => !!m && !!m.produto)
          .map((m) => ({ ...m, status: "vinculado", origem: "manual", metodo: `confirmado (${m.metodo ?? "sugestão"})` }));
        await saveVariantMaps(company, rows, { onlyAuto: false, updatedBy: username });
        return NextResponse.json({ data: { gravadas: rows.length, outraLoja: await repassar(outraLoja(company)) } });
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
        return NextResponse.json({ data: { gravadas: rows.length, outraLoja: await repassar(outraLoja(company)) } });
      }
      case "limpar": {
        await deleteVariantMaps(company, ids);
        // O recálculo lê o Linx; se o Linx cair, o desfazer em si já valeu (variante fica
        // "sem vínculo" até o próximo Recalcular) e o repasse da outra loja ainda é tirado.
        let rematch = null;
        let aviso: string | null = null;
        try {
          rematch = await rematchShopifyVariants(company, ids);
        } catch (error) {
          aviso = `Desfeito, mas o recálculo automático falhou (${error instanceof Error ? error.message : "Linx"}). Use "Recalcular automático" depois.`;
        }
        // Pode ter apagado um repasse: puxa de novo da outra loja; e tira da outra o que veio daqui.
        await repassar(company);
        return NextResponse.json({ data: { rematch, aviso, outraLoja: await repassar(outraLoja(company)) } });
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
