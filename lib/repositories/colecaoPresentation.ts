import sql from "mssql";

import { withRequest } from "@/lib/db/connection";
import {
  fetchCollectionReport,
  type CollectionReportDetailRow,
} from "@/lib/repositories/collectionReport";

/**
 * Monta o payload do deck "Relatório Completo de Coleção" do Gerador de
 * Apresentações. Reaproveita `fetchCollectionReport` (mesma lógica de vendas /
 * faturamento / e-commerce usada no Relatório Claude e no Painel de Coleções) e
 * enriquece com estoque líquido por SKU (produto × cor) + tipo do produto.
 *
 * Estoque aqui é o SALDO LÍQUIDO da rede (inclui negativos), espelhando o
 * protótipo aprovado (o PDF de referência mostra -8, -5 e total = soma bruta).
 * É intencionalmente diferente da regra "só positivos" de outras telas.
 */

export interface ColecaoPresentationParams {
  company?: string;
  filial?: string | null;
  colecoes?: string[];
  range?: { start?: string; end?: string };
  /** Descrição da coleção (label do multiselect) para o título/capa. */
  collectionLabel?: string;
}

export interface PresentationProductRow {
  rank: number;
  nome: string;
  colorDescription: string;
  grade: string;
  tipo: string;
  qtd: number;
  precoMedio: number;
  venda: number;
  estoque: number;
  barWidthPct: number;
  participacaoPct: number;
}

export interface PresentationStoreRow {
  nome: string;
  venda: number;
  qtd: number;
  participacaoPct: number;
}

export interface PresentationStoreBar {
  nome: string;
  venda: number;
  widthPct: number;
  pctLabel: string;
  showPctInside: boolean;
  color: string;
}

export interface ColecaoPresentationPayload {
  collection: { code: string; fullName: string };
  period: { start: string; end: string; label: string; short: string };
  kpis: {
    faturamento: number;
    pecasVendidas: number;
    nSkus: number;
    precoMedio: number;
    estoqueRestante: number;
    canaisAtivos: number;
  };
  channel: {
    hasEcommerce: boolean;
    ecommerceShare: number;
    retailShare: number;
    ecommerceRevenue: number;
    retailRevenue: number;
  };
  topProducts: PresentationProductRow[];
  products: PresentationProductRow[];
  outros: { count: number; qtd: number; venda: number; estoque: number } | null;
  insightProdutos: { titulo: string; texto: string };
  stores: PresentationStoreRow[];
  storesTotal: { venda: number; qtd: number };
  storeChartSubtitle: string;
  storeBars: PresentationStoreBar[];
  closing: {
    insightA: { titulo: string; texto: string };
    insightB: { titulo: string; texto: string };
    footKpis: Array<{ label: string; value: string; fontSize: string }>;
  };
}

const ACCENT = "#FF6F61";
const ACCENT_DARK = "#E8554A";
const ECOMMERCE_BUCKET = "E-COMMERCE";
const PRODUCTS_LIMIT = 12; // linhas antes de agrupar o restante em "Outros".

/** Normaliza cor para casar '06' com '6' (duas fontes divergem no formato). */
function normalizeCor(value: string): string {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") return "";
  const num = Number(trimmed);
  return Number.isFinite(num) && /^\d+$/.test(trimmed) ? String(num) : trimmed.toUpperCase();
}

function skuKey(productId: string, cor: string): string {
  return `${productId.trim()}||${normalizeCor(cor)}`;
}

function fmtDateShort(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

function fmtInt(value: number): string {
  return Math.round(value).toLocaleString("pt-BR");
}

function fmtCurrency(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function fmtPct(value: number): string {
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

interface SkuAgg {
  productId: string;
  nome: string;
  colorCode: string;
  colorDescription: string;
  grade: string;
  qtd: number;
  venda: number;
}

/** Estoque líquido (SUM ESTOQUE, com negativos) + tipo, por produto/cor. */
async function fetchStockAndTipo(
  productIds: string[]
): Promise<{ stock: Map<string, number>; tipo: Map<string, string> }> {
  const uniqueIds = Array.from(new Set(productIds.map((id) => id.trim()).filter(Boolean)));
  const stock = new Map<string, number>();
  const tipo = new Map<string, string>();
  if (uniqueIds.length === 0) return { stock, tipo };

  await withRequest(async (request) => {
    uniqueIds.forEach((id, index) => request.input(`pid${index}`, sql.VarChar, id));
    const placeholders = uniqueIds.map((_, i) => `@pid${i}`).join(", ");

    const stockRes = await request.query<{ PRODUTO: string; COR: string; NET_STOCK: number }>(`
      SELECT
        ISNULL(e.PRODUTO, '') AS PRODUTO,
        ISNULL(e.COR_PRODUTO, '') AS COR,
        CAST(SUM(ISNULL(e.ESTOQUE, 0)) AS FLOAT) AS NET_STOCK
      FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
      WHERE e.PRODUTO IN (${placeholders})
      GROUP BY ISNULL(e.PRODUTO, ''), ISNULL(e.COR_PRODUTO, '')
    `);
    for (const row of stockRes.recordset) {
      stock.set(skuKey(row.PRODUTO ?? "", row.COR ?? ""), Math.round(Number(row.NET_STOCK ?? 0)));
    }

    const tipoRes = await request.query<{ PRODUTO: string; TIPO: string }>(`
      SELECT p.PRODUTO AS PRODUTO, UPPER(LTRIM(RTRIM(ISNULL(p.TIPO_PRODUTO, '')))) AS TIPO
      FROM PRODUTOS p WITH (NOLOCK)
      WHERE p.PRODUTO IN (${placeholders})
    `);
    for (const row of tipoRes.recordset) {
      const t = (row.TIPO ?? "").trim();
      if (t) tipo.set((row.PRODUTO ?? "").trim(), t);
    }
  });

  return { stock, tipo };
}

/** Agrupa os details (produto×cor×loja×canal) em SKUs (produto×cor). */
function aggregateSkus(details: CollectionReportDetailRow[]): Map<string, SkuAgg> {
  const map = new Map<string, SkuAgg>();
  for (const d of details) {
    const key = skuKey(d.productId, d.colorCode);
    let agg = map.get(key);
    if (!agg) {
      agg = {
        productId: d.productId,
        nome: d.productName,
        colorCode: d.colorCode,
        colorDescription: d.colorDescription && d.colorDescription !== "-" ? d.colorDescription : "",
        grade: d.grade && d.grade !== "-" ? d.grade : "",
        qtd: 0,
        venda: 0,
      };
      map.set(key, agg);
    }
    agg.qtd += d.quantity;
    agg.venda += d.revenue;
    if (!agg.colorDescription && d.colorDescription && d.colorDescription !== "-") {
      agg.colorDescription = d.colorDescription;
    }
    if (!agg.grade && d.grade && d.grade !== "-") agg.grade = d.grade;
  }
  return map;
}

function buildProductMeta(color: string, grade: string, tipo: string, extra?: string): string {
  return [color || "-", grade, tipo, extra].filter((p) => p && p.trim()).join(" · ");
}

export async function fetchColecaoPresentation({
  company,
  filial,
  colecoes,
  range,
  collectionLabel,
}: ColecaoPresentationParams): Promise<ColecaoPresentationPayload> {
  const report = await fetchCollectionReport({ company, filial, range, colecoes });

  const allDetails = report.products.flatMap((p) => p.details);
  const skuMap = aggregateSkus(allDetails);
  const skus = Array.from(skuMap.values());

  const { stock, tipo } = await fetchStockAndTipo(skus.map((s) => s.productId));

  const totalRevenue = report.summary.totalRevenue;
  const maxRevenue = Math.max(...skus.map((s) => s.venda), 1);

  const sortedSkus = [...skus].sort((a, b) => b.venda - a.venda);

  const productRows: PresentationProductRow[] = sortedSkus.map((s, i) => {
    const estoque = stock.get(skuKey(s.productId, s.colorCode)) ?? 0;
    const t = tipo.get(s.productId.trim()) ?? "";
    return {
      rank: i + 1,
      nome: s.nome,
      colorDescription: s.colorDescription,
      grade: s.grade,
      tipo: t,
      qtd: s.qtd,
      precoMedio: s.qtd > 0 ? s.venda / s.qtd : 0,
      venda: s.venda,
      estoque,
      barWidthPct: Math.round((s.venda / maxRevenue) * 100),
      participacaoPct: totalRevenue > 0 ? (s.venda / totalRevenue) * 100 : 0,
    };
  });

  // Top 3 (destaques da capa/visão geral) com meta incluindo un + ticket.
  const topProducts: PresentationProductRow[] = productRows.slice(0, 3);

  // Tabela de produtos: até PRODUCTS_LIMIT linhas; o restante vira "Outros".
  const shown = productRows.slice(0, PRODUCTS_LIMIT);
  const tail = productRows.slice(PRODUCTS_LIMIT);
  const outros =
    tail.length > 0
      ? {
          count: tail.length,
          qtd: tail.reduce((s, r) => s + r.qtd, 0),
          venda: tail.reduce((s, r) => s + r.venda, 0),
          estoque: tail.reduce((s, r) => s + r.estoque, 0),
        }
      : null;

  const estoqueRestante = productRows.reduce((s, r) => s + r.estoque, 0);
  const pecasVendidas = report.summary.totalQuantity;
  const precoMedio = pecasVendidas > 0 ? totalRevenue / pecasVendidas : 0;

  // ---- Lojas / canais: e-commerce colapsa numa linha "E-COMMERCE" ----
  const storeAgg = new Map<string, { venda: number; qtd: number }>();
  for (const d of allDetails) {
    const bucket = d.channel === "E-commerce" ? ECOMMERCE_BUCKET : (d.origin || "").toUpperCase().trim() || "OUTROS";
    const cur = storeAgg.get(bucket) ?? { venda: 0, qtd: 0 };
    cur.venda += d.revenue;
    cur.qtd += d.quantity;
    storeAgg.set(bucket, cur);
  }
  const storesSortedDesc = Array.from(storeAgg.entries())
    .map(([nome, v]) => ({
      nome,
      venda: v.venda,
      qtd: v.qtd,
      participacaoPct: totalRevenue > 0 ? (v.venda / totalRevenue) * 100 : 0,
    }))
    .sort((a, b) => b.venda - a.venda);

  const canaisAtivos = storesSortedDesc.filter((s) => s.venda > 0 || s.qtd > 0).length;

  // Barras: ascendente (menor no topo), maior recebe 82% + destaque interno.
  const maxStore = Math.max(...storesSortedDesc.map((s) => s.venda), 1);
  const storeBars: PresentationStoreBar[] = [...storesSortedDesc]
    .sort((a, b) => a.venda - b.venda)
    .map((s) => {
      const isMax = s.venda === maxStore;
      return {
        nome: s.nome,
        venda: s.venda,
        widthPct: Math.max(1, Math.round((s.venda / maxStore) * 82)),
        pctLabel: fmtPct(s.participacaoPct),
        showPctInside: isMax,
        color: isMax ? ACCENT_DARK : ACCENT,
      };
    });

  const topStore = storesSortedDesc[0];
  const ecommerceShare = report.summary.ecommerceShare;
  const retailShare = report.summary.retailShare;
  const hasEcommerce = report.summary.ecommerceRevenue > 0;
  const storeChartSubtitle =
    topStore?.nome === ECOMMERCE_BUCKET
      ? `E-commerce concentra ${fmtPct(topStore.participacaoPct)} do faturamento da coleção`
      : topStore
        ? `${topStore.nome} lidera com ${fmtPct(topStore.participacaoPct)} do faturamento`
        : "Distribuição de faturamento por canal";

  // ---- Narrativas (geradas a partir dos números) ----
  const hero = productRows[0];
  const top4Share = productRows.slice(0, 4).reduce((s, r) => s + r.participacaoPct, 0);
  const insightProdutos = {
    titulo: "Leitura da curva",
    texto: hero
      ? `${hero.nome} lidera com ${fmtPct(hero.participacaoPct)} do faturamento da coleção. ` +
        `Os 4 principais SKUs concentram ${fmtPct(top4Share)} do total — ` +
        `${top4Share >= 80 ? "curva muito concentrada" : top4Share >= 60 ? "curva concentrada" : "distribuição equilibrada"}.`
      : "Sem produtos vendidos no período selecionado.",
  };

  const closing = {
    insightA: {
      titulo: hasEcommerce && ecommerceShare >= 50 ? "Volume puxado pelo digital" : "Onde a coleção performou",
      texto:
        `A coleção faturou ${fmtCurrency(totalRevenue)} em ${fmtInt(pecasVendidas)} peças` +
        (hasEcommerce ? `, com ${fmtPct(ecommerceShare)} das vendas no e-commerce.` : ".") +
        (hero ? ` ${hero.nome} foi o produto herói, com ${fmtCurrency(hero.venda)}.` : ""),
    },
    insightB: {
      titulo: "Atenção ao estoque",
      texto:
        `Restam ${fmtInt(estoqueRestante)} peças na rede` +
        (topStore ? `. ${topStore.nome} é o canal líder — priorize reposição/escoamento conforme o giro.` : "."),
    },
    footKpis: [
      { label: "Faturamento", value: fmtCurrency(totalRevenue), fontSize: "30px" },
      { label: "% E-commerce", value: `${Math.round(ecommerceShare)}%`, fontSize: "30px" },
      { label: "% Lojas físicas", value: `${Math.round(retailShare)}%`, fontSize: "30px" },
      {
        label: "Produto herói",
        value: hero?.nome ?? "-",
        fontSize: (hero?.nome ?? "").length > 16 ? "20px" : "30px",
      },
    ],
  };

  const startIso = report.summary.detectedStartDate?.slice(0, 10) ?? range?.start ?? "";
  const endIso = report.summary.detectedEndDate?.slice(0, 10) ?? range?.end ?? "";
  const startLabelIso = range?.start ?? startIso;
  const endLabelIso = range?.end ?? endIso;
  const year = endLabelIso ? new Date(`${endLabelIso}T00:00:00`).getFullYear() : new Date().getFullYear();
  const periodLabel =
    startLabelIso && endLabelIso
      ? `${fmtDateShort(startLabelIso)} a ${fmtDateShort(endLabelIso)} de ${year}`
      : "";
  const periodShort =
    startLabelIso && endLabelIso ? `${fmtDateShort(startLabelIso)}–${fmtDateShort(endLabelIso)}/${year}` : "";

  const code = (colecoes ?? []).map((c) => c.trim().toUpperCase()).filter(Boolean).join(", ");
  const fullName = collectionLabel?.trim() || code;

  return {
    collection: { code, fullName },
    period: { start: startLabelIso, end: endLabelIso, label: periodLabel, short: periodShort },
    kpis: {
      faturamento: totalRevenue,
      pecasVendidas,
      nSkus: productRows.length,
      precoMedio,
      estoqueRestante,
      canaisAtivos,
    },
    channel: {
      hasEcommerce,
      ecommerceShare,
      retailShare,
      ecommerceRevenue: report.summary.ecommerceRevenue,
      retailRevenue: report.summary.retailRevenue,
    },
    topProducts,
    products: shown,
    outros,
    insightProdutos,
    stores: storesSortedDesc,
    storesTotal: { venda: totalRevenue, qtd: pecasVendidas },
    storeChartSubtitle,
    storeBars,
    closing,
  };
}
