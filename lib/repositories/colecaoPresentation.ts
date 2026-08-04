import sql from "mssql";

import {
  getFilialLabelForDisplay,
  VAREJO_VALUE,
  type CompanyKey,
} from "@/lib/config/company";
import { resolveCompanyLive, liveNameForIncoming } from "@/lib/server/company-live";
import { withRequest } from "@/lib/db/connection";
import { canonicalKey } from "@/lib/reports/keys";
import { normalizeRangeForQuery } from "@/lib/utils/date";
import { fetchProductsWithDetails } from "@/lib/repositories/products";
import { fetchProdutoQtdePorFilial } from "@/lib/repositories/performance";

/**
 * Monta o payload do deck "Relatório Completo de Coleção" do Gerador de
 * Apresentações.
 *
 * VENDAS/FATURAMENTO usam a MESMA lógica VALIDADA da tela de Produtos e do
 * Gerador de Relatórios (`fetchProductsWithDetails` + `fetchProdutoQtdePorFilial`):
 * base LOJA_VENDA_PRODUTO com FATOR_DESCONTO_VENDA e dedução de trocas
 * (LOJA_VENDA_TROCA), mais e-commerce por faturamento (natureza 100.02/100.022).
 * Antes usava `fetchCollectionReport` (tabela contábil W_CTB, desconto absoluto e
 * SEM trocas), o que divergia do relatório de vendas/produtos por venda.
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
  /**
   * TODOS os SKUs (produto × cor) com id e quantidade — sem o corte de
   * PRODUCTS_LIMIT que `products` aplica. Existe para quem consome este payload no
   * servidor precisar da base completa (ex.: o comparativo entre coleções calcula
   * custo/markup a partir daqui em vez de refazer a consulta de produtos).
   */
  skus: Array<{ productId: string; qtd: number }>;
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

// Cores das barras: variáveis do tema do deck (ColecaoDeck.module.css), não hex
// fixo — assim as barras seguem a paleta escolhida no Gerador (paleta do Painel
// de Coleções ou manual) sem o payload saber qual é.
const ACCENT = "var(--accent)";
const ACCENT_DARK = "var(--accent-d)";
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

/** Estoque líquido da rede (SUM ESTOQUE, com negativos), por produto/cor. */
async function fetchNetStock(productIds: string[]): Promise<Map<string, number>> {
  const uniqueIds = Array.from(new Set(productIds.map((id) => id.trim()).filter(Boolean)));
  const stock = new Map<string, number>();
  if (uniqueIds.length === 0) return stock;

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
  });

  return stock;
}

interface SkuAgg {
  productId: string;
  nome: string;
  colorCode: string;
  colorDescription: string;
  grade: string;
  tipo: string;
  qtd: number;
  venda: number;
}

/**
 * Decide as listas de filiais POS/e-commerce a considerar no detalhamento por
 * loja, respeitando o filtro de filial selecionado — mesma semântica de escopo
 * que `fetchProductsWithDetails` aplica para os totais.
 */
function resolveFilialScope(
  ecommerceFilials: Set<string>,
  salesFiliais: string[],
  specific: string | null | undefined
): { posNames: string[]; ecomNames: string[] } {
  const allPos = salesFiliais.filter((f) => !ecommerceFilials.has(f));
  const allEcom = salesFiliais.filter((f) => ecommerceFilials.has(f));

  if (specific && specific !== VAREJO_VALUE) {
    if (ecommerceFilials.has(specific)) {
      return { posNames: [], ecomNames: [specific] };
    }
    return { posNames: [specific], ecomNames: [] };
  }

  if (specific === VAREJO_VALUE) {
    return { posNames: allPos, ecomNames: [] };
  }

  return { posNames: allPos, ecomNames: allEcom };
}

export async function fetchColecaoPresentation({
  company,
  filial,
  colecoes,
  range,
  collectionLabel,
}: ColecaoPresentationParams): Promise<ColecaoPresentationPayload> {
  const rangeInput = { start: range?.start, end: range?.end };

  // ---- Produtos × cor pela lógica VALIDADA (com trocas/descontos/cancelamentos) ----
  const products = await fetchProductsWithDetails({
    company,
    filial: filial ?? null,
    colecoes,
    range: rangeInput,
    groupByColor: true,
  });

  const skus: SkuAgg[] = products
    .map((d) => ({
      productId: String(d.productId ?? "").trim(),
      nome: d.productName ?? "",
      colorCode: d.corProduto ? String(d.corProduto).trim() : "",
      colorDescription:
        d.descCorProduto && d.descCorProduto !== "-" ? d.descCorProduto : "",
      grade: d.grade && d.grade !== "-" ? d.grade : "",
      tipo: (d.tipo ?? "").trim().toUpperCase(),
      qtd: d.totalQuantity ?? 0,
      venda: d.totalRevenue ?? 0,
    }))
    .filter((s) => s.productId && (s.venda !== 0 || s.qtd !== 0));

  const stock = await fetchNetStock(skus.map((s) => s.productId));

  const totalRevenue = skus.reduce((s, r) => s + r.venda, 0);
  const totalQuantity = skus.reduce((s, r) => s + r.qtd, 0);
  const maxRevenue = Math.max(...skus.map((s) => s.venda), 1);

  const sortedSkus = [...skus].sort((a, b) => b.venda - a.venda);

  const productRows: PresentationProductRow[] = sortedSkus.map((s, i) => {
    const estoque = stock.get(skuKey(s.productId, s.colorCode)) ?? 0;
    return {
      rank: i + 1,
      nome: s.nome,
      colorDescription: s.colorDescription,
      grade: s.grade,
      tipo: s.tipo,
      qtd: s.qtd,
      precoMedio: s.qtd > 0 ? s.venda / s.qtd : 0,
      venda: s.venda,
      estoque,
      barWidthPct: Math.round((s.venda / maxRevenue) * 100),
      participacaoPct: totalRevenue > 0 ? (s.venda / totalRevenue) * 100 : 0,
    };
  });

  // Top 3 (destaques da capa/visão geral).
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
  const pecasVendidas = totalQuantity;
  const precoMedio = pecasVendidas > 0 ? totalRevenue / pecasVendidas : 0;

  // ---- Lojas / canais: detalhamento por filial pela MESMA lógica validada ----
  // `fetchProdutoQtdePorFilial` traz a venda líquida (trocas/descontos abatidos)
  // por produto×cor×filial (POS) e por faturamento (e-commerce). Restringimos aos
  // SKUs desta coleção (já filtrados acima) via chave canônica produto×cor.
  const storeAgg = new Map<string, { venda: number; qtd: number }>();
  let ecommerceRevenue = 0;
  let retailRevenue = 0;

  const companyLive = await resolveCompanyLive(company);
  if (companyLive && skus.length > 0) {
    const ecommerceFilials = new Set(companyLive.ecommerceFilials ?? []);
    const salesFiliais = companyLive.filialFilters.sales ?? [];
    const specific =
      filial && filial !== VAREJO_VALUE ? await liveNameForIncoming(filial) : filial ?? null;
    const { posNames, ecomNames } = resolveFilialScope(
      ecommerceFilials,
      salesFiliais,
      specific
    );

    const colecaoKeys = new Set(skus.map((s) => canonicalKey(s.productId, s.colorCode)));
    const normalizedRange = normalizeRangeForQuery(rangeInput);

    const rows = await fetchProdutoQtdePorFilial(
      (company ?? "") as CompanyKey,
      posNames,
      ecomNames,
      normalizedRange,
      { groupByCor: true }
    ).catch(() => []);

    for (const r of rows) {
      if (!colecaoKeys.has(canonicalKey(r.produto, r.cor || null))) continue;
      const isEcom = ecommerceFilials.has(r.filial);
      const bucket = isEcom
        ? ECOMMERCE_BUCKET
        : (getFilialLabelForDisplay(companyLive, r.filial) || "OUTROS").toUpperCase().trim();
      const cur = storeAgg.get(bucket) ?? { venda: 0, qtd: 0 };
      cur.venda += r.vendas;
      cur.qtd += r.qtde;
      storeAgg.set(bucket, cur);
      if (isEcom) {
        ecommerceRevenue += r.vendas;
      } else {
        retailRevenue += r.vendas;
      }
    }
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
  const channelTotal = retailRevenue + ecommerceRevenue;
  const ecommerceShare = channelTotal > 0 ? (ecommerceRevenue / channelTotal) * 100 : 0;
  const retailShare = channelTotal > 0 ? (retailRevenue / channelTotal) * 100 : 0;
  const hasEcommerce = ecommerceRevenue > 0;
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

  const startLabelIso = range?.start ?? "";
  const endLabelIso = range?.end ?? "";
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
      ecommerceRevenue,
      retailRevenue,
    },
    topProducts,
    products: shown,
    skus: sortedSkus.map((s) => ({ productId: s.productId, qtd: s.qtd })),
    outros,
    insightProdutos,
    stores: storesSortedDesc,
    storesTotal: { venda: totalRevenue, qtd: pecasVendidas },
    storeChartSubtitle,
    storeBars,
    closing,
  };
}
