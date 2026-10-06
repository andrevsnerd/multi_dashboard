import JSZip from "jszip";
import { NextResponse } from "next/server";

import { LOJAS_INVENTARIO } from "@/lib/reports/estoque-inventario";
import { buildInventarioXlsx, fetchEstoqueInventario } from "@/lib/repositories/reportEstoqueInventario";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * "Estoque inventário" do Gerador de Relatórios (mesmas regras do estoque_inventario.py).
 *
 * POST { lojas: string[] } (slugs de LOJAS_INVENTARIO)
 *  → 1 loja:  estoque-<slug>.xlsx
 *  → 2+ lojas: inventario-<data>.zip com um estoque-<slug>.xlsx por loja
 * O resumo por loja (filial ativa, linhas, com saldo, peças) vai no header
 * `X-Inventario-Resumo` (JSON url-encoded).
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { lojas?: unknown } | null;
    const pedidos = new Set(Array.isArray(body?.lojas) ? body!.lojas.map((s) => String(s)) : []);
    const lojas = LOJAS_INVENTARIO.filter((l) => pedidos.has(l.slug));

    if (lojas.length === 0) {
      return NextResponse.json({ error: "Selecione pelo menos uma loja." }, { status: 400 });
    }

    const inventarios = await fetchEstoqueInventario(lojas);
    const resumo = encodeURIComponent(JSON.stringify(inventarios.map((i) => i.resumo)));

    if (inventarios.length === 1) {
      const [inv] = inventarios;
      const buffer = await buildInventarioXlsx(inv.rows);
      return new Response(new Uint8Array(buffer), {
        headers: {
          "Content-Type": XLSX_TYPE,
          "Content-Disposition": `attachment; filename="estoque-${inv.loja.slug}.xlsx"`,
          "X-Inventario-Resumo": resumo,
        },
      });
    }

    const zip = new JSZip();
    for (const inv of inventarios) {
      zip.file(`estoque-${inv.loja.slug}.xlsx`, await buildInventarioXlsx(inv.rows));
    }
    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const hoje = new Date().toISOString().slice(0, 10);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="inventario-${hoje}.zip"`,
        "X-Inventario-Resumo": resumo,
      },
    });
  } catch (error) {
    console.error("Erro ao gerar o estoque inventário", error);
    const details = error instanceof Error ? error.message : "Erro desconhecido";
    return NextResponse.json({ error: "Erro ao gerar inventário", details }, { status: 500 });
  }
}
