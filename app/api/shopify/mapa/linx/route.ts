import { NextResponse } from "next/server";

import { buscarProdutosParaEtiqueta } from "@/lib/repositories/etiquetas";
import { autorizarShopify } from "@/lib/shopify/auth";
import { isShopifyCompany } from "@/lib/shopify/config";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Busca de produto do Linx para o vínculo manual (nome palavra a palavra, código ou
 * código de barras, com as cores). Reaproveita a busca do Imprimir Etiquetas.
 */
export async function POST(request: Request) {
  const autorizacao = await autorizarShopify(request, { somenteAdmin: true });
  if ("erro" in autorizacao) return autorizacao.erro;
  let body: { company?: string; termo?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body JSON inválido." }, { status: 400 });
  }
  if (!isShopifyCompany(body.company)) return NextResponse.json({ error: "Empresa inválida." }, { status: 400 });
  const termo = (body.termo ?? "").trim();
  if (termo.length < 2) return NextResponse.json({ data: [] });
  try {
    const produtos = await buscarProdutosParaEtiqueta(body.company, termo, { limite: 25, incluirInativos: true });
    return NextResponse.json({
      data: produtos.map((p) => ({
        produto: p.produto,
        descProduto: p.descProduto,
        linha: p.linha,
        inativo: p.inativo,
        cores: p.cores.map((c) => ({ cor: c.cor, descCor: c.descCor, codigoBarra: c.codigoBarra, estoque: c.estoque })),
      })),
    });
  } catch (error) {
    console.error("[shopify/mapa/linx]", error);
    return NextResponse.json({ error: "Erro ao buscar no Linx." }, { status: 500 });
  }
}
