import "server-only";

import {
  deleteVariantMaps,
  listAllShopifyVariants,
  listVariantMaps,
  saveVariantMaps,
  type ShopifyVariantMapRow,
  type ShopifyVariantRow,
} from "@/lib/shopify/catalog-store";
import { getShopifyCredentials, type ShopifyCompany } from "@/lib/shopify/config";
import { coresBasicas, isPersonalizacao, padraoDaLoja, rematchShopifyVariants, tokens } from "@/lib/shopify/linx-match";

/**
 * "Confirmou numa loja, vale na outra" (pedido do dono, 10/11/2026).
 *
 * As duas lojas vendem as MESMAS capas/alças com o mesmo nome de estampa, só muda o
 * começo de vitrine ("Capa anti-impacto personalizada A Negra" × "Capa Estampada A Negra")
 * — 38 estampas ativas nas duas em 10/11/2026. A variante equivalente = mesmo nome sem as
 * palavras de vitrine da própria loja + mesmas opções (modelo), ignorando personalização.
 *
 * Fonte = decisão MANUAL de uma loja (não o automático). Na outra loja ela vira um vínculo
 * manual marcado "igual à outra loja", que nunca passa por cima de decisão própria daquela
 * loja. Se a fonte é desfeita, o repasse também sai (e a variante volta ao automático).
 * Mais de uma fonte com produtos/cores diferentes para a mesma variante → não repassa.
 */

export const PROPAGADO = "igual à outra loja";

const NOME_LOJA: Record<ShopifyCompany, string> = { nerd: "NERD", scarfme: "Scarf Me" };

const isPropagado = (m: ShopifyVariantMapRow | undefined) => !!m?.metodo?.startsWith(PROPAGADO);
const isDecisaoPropria = (m: ShopifyVariantMapRow | undefined) => m?.origem === "manual" && !isPropagado(m);

function chave(v: ShopifyVariantRow, padrao: Set<string>): string | null {
  const nome = tokens(v.product_title).filter((t) => !padrao.has(t));
  if (nome.length === 0) return null;
  const opcoes = v.options
    .filter((o) => !isPersonalizacao(o.name) && !/^(cor|title)$/i.test(o.name) && o.value !== "Default Title")
    .flatMap((o) => tokens(o.value));
  return `${nome.join(" ")}|${[...opcoes].sort().join(" ")}`;
}

const corDaVariante = (v: ShopifyVariantRow) => v.options.find((o) => /^cor$/i.test(o.name))?.value ?? null;

export interface EquivalentesResult {
  repassadas: number;
  removidas: number;
  ambiguas: number;
}

/** Traz para `destino` as decisões manuais da outra loja (idempotente). */
export async function sincronizarEquivalentes(destino: ShopifyCompany): Promise<EquivalentesResult> {
  const origem: ShopifyCompany = destino === "nerd" ? "scarfme" : "nerd";
  if (!getShopifyCredentials(origem)) return { repassadas: 0, removidas: 0, ambiguas: 0 };

  const [vOrigem, vDestino, mOrigem, mDestino] = await Promise.all([
    listAllShopifyVariants(origem),
    listAllShopifyVariants(destino),
    listVariantMaps(origem),
    listVariantMaps(destino),
  ]);
  const padOrigem = padraoDaLoja(vOrigem);
  const padDestino = padraoDaLoja(vDestino);

  const fontes = new Map<string, Array<{ v: ShopifyVariantRow; m: ShopifyVariantMapRow }>>();
  for (const v of vOrigem) {
    const m = mOrigem.get(v.variant_id);
    if (!isDecisaoPropria(m)) continue;
    const k = chave(v, padOrigem);
    if (!k) continue;
    const list = fontes.get(k);
    if (list) list.push({ v, m: m! });
    else fontes.set(k, [{ v, m: m! }]);
  }

  const salvar: ShopifyVariantMapRow[] = [];
  const remover: string[] = [];
  let ambiguas = 0;
  for (const v of vDestino) {
    const atual = mDestino.get(v.variant_id);
    if (isDecisaoPropria(atual)) continue;
    const k = chave(v, padDestino);
    const candidatas = k ? fontes.get(k) : undefined;
    if (!candidatas?.length) {
      if (isPropagado(atual)) remover.push(v.variant_id);
      continue;
    }
    // Uma decisão por (status, produto, cor); "Sim/Não" da personalização somem aqui.
    const distintas = [
      ...new Map(candidatas.map((c) => [`${c.m.status}|${c.m.produto}|${c.m.cor_produto}`, c])).values(),
    ];
    let escolhida = distintas.length === 1 ? distintas[0] : null;
    if (!escolhida) {
      const cor = coresBasicas(corDaVariante(v));
      const porCor = distintas.filter((c) => [...coresBasicas(corDaVariante(c.v))].some((t) => cor.has(t)));
      escolhida = porCor.length === 1 ? porCor[0] : null;
    }
    if (!escolhida) {
      ambiguas += 1;
      continue;
    }
    const m = escolhida.m;
    const metodo = `${PROPAGADO} (${NOME_LOJA[origem]})`;
    if (
      isPropagado(atual) &&
      atual!.status === m.status &&
      atual!.produto === m.produto &&
      atual!.cor_produto === m.cor_produto &&
      atual!.metodo === metodo
    ) {
      continue; // já está igual
    }
    salvar.push({
      ...m,
      variant_id: v.variant_id,
      origem: "manual",
      metodo,
      // Tamanho é da grade do Linx — o mesmo produto/cor, então vale igual.
      score: null,
    });
  }

  if (salvar.length) {
    // updated_by: quem decidiu na loja de origem (cada linha pode ter sido gente diferente).
    const porUsuario = new Map<string, ShopifyVariantMapRow[]>();
    for (const r of salvar) {
      const u = r.updated_by ?? "";
      const l = porUsuario.get(u);
      if (l) l.push(r);
      else porUsuario.set(u, [r]);
    }
    for (const [u, rows] of porUsuario) await saveVariantMaps(destino, rows, { onlyAuto: false, updatedBy: u || null });
  }
  if (remover.length) {
    await deleteVariantMaps(destino, remover);
    await rematchShopifyVariants(destino, remover);
  }
  return { repassadas: salvar.length, removidas: remover.length, ambiguas };
}
