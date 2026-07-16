import { NextResponse } from "next/server";

import { fetchCollectionReport } from "@/lib/repositories/collectionReport";
import { fetchStockSummary } from "@/lib/repositories/inventory";
import { VAREJO_VALUE } from "@/lib/config/company";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Detalhe expandido de uma coleção do Painel de Coleções (SCARFME).
 *
 * Alimenta o painel que abre ao clicar num card horizontal: destaques (top SKUs),
 * ranking de canais/lojas e os KPIs da coleção.
 *
 * TODA a venda/faturamento vem de `fetchCollectionReport` — a REGRA ÚNICA validada
 * "com trocas" (ver CLAUDE.md). O único dado fora de vendas é "estoque restante",
 * que vem de `fetchStockSummary` (soma só saldos positivos, ver
 * [[estoque-negativos-nunca-contam]]).
 */

export interface ColecaoDetalheDestaque {
  productName: string;
  colorDescription: string;
  grade: string;
  quantity: number;
  ticket: number;
  revenue: number;
  pctOfTotal: number;
}

export interface ColecaoDetalheCanal {
  origin: string;
  channel: "Varejo" | "E-commerce";
  revenue: number;
  quantity: number;
  pct: number;
}

export interface ColecaoDetalheResponse {
  destaques: ColecaoDetalheDestaque[];
  porLoja: ColecaoDetalheCanal[];
  totalRevenue: number;
  totalQuantity: number;
  kpis: {
    faturamento: number;
    pecasVendidas: number;
    skusVendidos: number;
    precoMedio: number;
    estoqueRestante: number;
    canaisAtivos: number;
  };
}

const ECOMMERCE_LABEL = "E-COMMERCE";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get("company") ?? undefined;
  const filialParam = searchParams.get("filial");
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  const codesParam = searchParams.get("codes");

  if (!start || !end) {
    return NextResponse.json(
      { error: "Parâmetros start e end são obrigatórios" },
      { status: 400 }
    );
  }

  if (company !== "scarfme") {
    return NextResponse.json(
      { error: "Detalhe de coleção disponível apenas para SCARF ME" },
      { status: 400 }
    );
  }

  const codes = (codesParam ?? "")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);

  if (codes.length === 0) {
    return NextResponse.json(
      { error: "Parâmetro codes é obrigatório" },
      { status: 400 }
    );
  }

  const filial = filialParam || null;

  try {
    const [report, stock] = await Promise.all([
      fetchCollectionReport({
        company,
        filial,
        colecoes: codes,
        range: { start, end },
      }),
      // "Estoque restante = peças na rede": só saldos positivos. VAREJO é um
      // sentinela (não é uma filial real) → cai no escopo de rede inteira.
      fetchStockSummary({
        company,
        filial: filial === VAREJO_VALUE ? null : filial,
        colecoes: codes,
      }).catch(() => ({ totalQuantity: 0, totalValue: 0 })),
    ]);

    const totalRevenue = report.summary.totalRevenue;
    const totalQuantity = report.summary.totalQuantity;

    // ── Destaques: SKU = produto × cor (colapsa a dimensão loja/canal) ─────────
    const skuMap = new Map<
      string,
      { productName: string; colorDescription: string; grade: string; quantity: number; revenue: number }
    >();
    for (const product of report.products) {
      for (const d of product.details) {
        const colorDescription = d.colorDescription?.trim() || "-";
        const key = `${d.productId}|${(d.colorCode || colorDescription).toUpperCase()}`;
        const cur = skuMap.get(key);
        if (cur) {
          cur.quantity += d.quantity;
          cur.revenue += d.revenue;
          if (cur.grade === "-" && d.grade && d.grade !== "-") cur.grade = d.grade;
        } else {
          skuMap.set(key, {
            productName: d.productName,
            colorDescription,
            grade: d.grade && d.grade !== "-" ? d.grade : "-",
            quantity: d.quantity,
            revenue: d.revenue,
          });
        }
      }
    }

    const skus = Array.from(skuMap.values()).filter((s) => s.quantity > 0 || s.revenue > 0);
    const destaques: ColecaoDetalheDestaque[] = skus
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)
      .map((s) => ({
        productName: s.productName,
        colorDescription: s.colorDescription,
        grade: s.grade,
        quantity: Math.round(s.quantity),
        ticket: s.quantity > 0 ? s.revenue / s.quantity : 0,
        revenue: s.revenue,
        pctOfTotal: totalRevenue > 0 ? (s.revenue / totalRevenue) * 100 : 0,
      }));

    // ── Vendas por loja: agrupa por canal/origem (e-commerce colapsa em 1 linha) ─
    const canalMap = new Map<
      string,
      { origin: string; channel: "Varejo" | "E-commerce"; revenue: number; quantity: number }
    >();
    for (const product of report.products) {
      for (const d of product.details) {
        const isEcom = d.channel === "E-commerce";
        const label = isEcom ? ECOMMERCE_LABEL : d.origin;
        const cur = canalMap.get(label);
        if (cur) {
          cur.revenue += d.revenue;
          cur.quantity += d.quantity;
        } else {
          canalMap.set(label, {
            origin: label,
            channel: d.channel,
            revenue: d.revenue,
            quantity: d.quantity,
          });
        }
      }
    }

    const porLoja: ColecaoDetalheCanal[] = Array.from(canalMap.values())
      .filter((c) => c.revenue > 0 || c.quantity > 0)
      .sort((a, b) => b.revenue - a.revenue)
      .map((c) => ({
        origin: c.origin,
        channel: c.channel,
        revenue: c.revenue,
        quantity: Math.round(c.quantity),
        pct: totalRevenue > 0 ? (c.revenue / totalRevenue) * 100 : 0,
      }));

    const response: ColecaoDetalheResponse = {
      destaques,
      porLoja,
      totalRevenue,
      totalQuantity,
      kpis: {
        faturamento: totalRevenue,
        pecasVendidas: Math.round(totalQuantity),
        skusVendidos: skus.length,
        precoMedio: totalQuantity > 0 ? totalRevenue / totalQuantity : 0,
        estoqueRestante: Math.round(stock.totalQuantity ?? 0),
        canaisAtivos: porLoja.length,
      },
    };

    return NextResponse.json({ data: response });
  } catch (error) {
    console.error("Erro ao carregar detalhe da coleção", error);
    return NextResponse.json(
      { error: "Erro ao carregar detalhe da coleção" },
      { status: 500 }
    );
  }
}
