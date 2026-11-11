import { NextResponse } from 'next/server';

import {
  fetchSalesSummary,
  fetchFilialPerformance,
  fetchTopProducts,
  fetchTopCategories,
  fetchDailyRevenue,
} from '@/lib/repositories/sales';
import { fetchEstoqueKPIs } from '@/lib/repositories/controleEstoque';
import { fetchMultipleProductsStock } from '@/lib/repositories/inventory';
import {
  normalizeFilialLookupKey,
  resolveCompany,
  SHOPIFY_LABEL,
  SHOPIFY_VALUE,
  VAREJO_VALUE,
} from '@/lib/config/company';
import { getShopifyCredentials, isShopifyCompany } from '@/lib/shopify/config';
import { fetchParteShopifyDashboard, type ParteShopify } from '@/lib/shopify/dashboard-principal';
import { runShopifyIncrementalSync } from '@/lib/shopify/sync';
import { readGoals } from '@/lib/utils/goals-storage';
import type { FilialPerformance, MetricSummary, ProductRevenue, SalesSummary } from '@/types/dashboard';

export const maxDuration = 300;

const TOP = 5;

const metrica = (atual: number, anterior: number): MetricSummary => ({
  currentValue: atual,
  previousValue: anterior,
  changePercentage:
    anterior === 0 && atual === 0 ? 0 : anterior === 0 ? null : Number((((atual - anterior) / anterior) * 100).toFixed(1)),
});

/**
 * Tela principal (dashboard).
 *
 * SHOPIFY (desde 11/11/2026, só nesta tela): na Scarf Me a filial E-COMMERCE (notas do Linx)
 * sai e entra "SHOPIFY SCARFME"; na NERD entra "SHOPIFY NERD" como filial nova. As filiais
 * do Linx NÃO mudam: os números delas são exatamente os de antes (lojas físicas pelas
 * mesmas funções canônicas); a parte Shopify só é somada por cima.
 * `frete=0` tira o frete do Shopify (padrão: incluído).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') ?? undefined;
  const filialParam = searchParams.get('filial') || null;
  const linhasParam = searchParams.getAll('linha');
  const linhas = linhasParam.length > 0 ? linhasParam : null;
  const startParam = searchParams.get('start');
  const endParam = searchParams.get('end');
  const monthParam = searchParams.get('month');
  const yearParam = searchParams.get('year');
  const comFrete = searchParams.get('frete') !== '0';

  if (!startParam || !endParam) {
    return NextResponse.json(
      { error: 'Parâmetros start e end são obrigatórios' },
      { status: 400 },
    );
  }

  const range = { start: startParam, end: endParam };
  const month = monthParam !== null ? parseInt(monthParam, 10) : null;
  const year = yearParam !== null ? parseInt(yearParam, 10) : null;

  // ── Shopify ligado? (nerd/scarfme com credenciais) ──
  const shopifyCompany = isShopifyCompany(company) && getShopifyCredentials(company) ? company : null;
  const companyConfig = resolveCompany(company);
  const ecomSet = new Set((companyConfig?.ecommerceFilials ?? []).map(normalizeFilialLookupKey));
  const ehEcommerceLinx = (f: string | null) => !!f && ecomSet.has(normalizeFilialLookupKey(f));
  // Na Scarf Me, quem ainda manda o valor antigo do E-COMMERCE cai no Shopify.
  const filialShopify = !!shopifyCompany && (filialParam === SHOPIFY_VALUE || ehEcommerceLinx(filialParam));
  // Filial que vai para as funções do Linx: no "Todas" da Scarf Me = VAREJO (lojas físicas,
  // sem o e-commerce do Linx); na NERD "Todas" já é só loja física.
  const filialLinx: string | null =
    !shopifyCompany || filialShopify
      ? filialParam
      : filialParam === null && shopifyCompany === 'scarfme'
        ? VAREJO_VALUE
        : filialParam;
  const somaShopify = !!shopifyCompany && (filialShopify || filialParam === null);

  try {
    if (shopifyCompany && somaShopify) {
      // Puxa do Shopify o que mudou (máx. 1×/30 s), como a página Shopify.
      await runShopifyIncrementalSync(shopifyCompany, { budgetMs: 8_000, minIntervalSeconds: 30 }).catch(() => null);
    }

    const [
      filialPerformanceLinx,
      topProductsLinx,
      topCategoriesLinx,
      dailyRevenueLinx,
      salesSummaryResult,
      allGoals,
      parte,
      estoque,
    ] = await Promise.all([
      fetchFilialPerformance({ company, range, linhas }),
      filialShopify ? Promise.resolve([]) : fetchTopProducts({ company, range, filial: filialLinx, linhas, limit: somaShopify ? TOP * 4 : TOP }),
      filialShopify ? Promise.resolve([]) : fetchTopCategories({ company, range, filial: filialLinx, linhas, limit: somaShopify ? TOP * 4 : TOP }),
      filialShopify ? Promise.resolve([]) : fetchDailyRevenue({ company, range, filial: filialLinx, linhas }),
      fetchSalesSummary({ company, range, filial: filialShopify ? VAREJO_VALUE : filialLinx, linhas }),
      readGoals(),
      somaShopify && shopifyCompany
        ? fetchParteShopifyDashboard({ company: shopifyCompany, range, linhas, comFrete })
        : Promise.resolve(null as ParteShopify | null),
      // Estoque do card: Scarf Me "Todas" continua o estoque de TODAS as filiais (como antes);
      // filial Shopify da Scarf Me = estoque dos CNPJs de e-commerce. NERD não muda.
      shopifyCompany === 'scarfme' && (filialParam === null || filialShopify)
        ? fetchEstoqueKPIs({
            company,
            filial: filialShopify ? (companyConfig?.ecommerceFilials?.[0] ?? null) : null,
            linhas,
            range,
          })
        : Promise.resolve(null),
    ]);

    const monthGoals: Record<string, number> =
      company && month !== null && year !== null && !Number.isNaN(month) && !Number.isNaN(year)
        ? ((allGoals[company]?.[String(year)]?.[String(month)] as Record<string, number>) ?? {})
        : {};

    // Sem Shopify: exatamente como era.
    if (!shopifyCompany) {
      return NextResponse.json(
        {
          filialPerformance: filialPerformanceLinx,
          topProducts: topProductsLinx,
          topCategories: topCategoriesLinx,
          dailyRevenue: dailyRevenueLinx,
          summary: salesSummaryResult.summary,
          lastAvailableDate: salesSummaryResult.currentPeriodLastSaleDate?.toISOString() ?? null,
          availableRange: {
            start: salesSummaryResult.availableRange.start?.toISOString() ?? null,
            end: salesSummaryResult.availableRange.end?.toISOString() ?? null,
          },
          goals: monthGoals,
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    // ── Filiais: as do Linx como vieram, sem o E-COMMERCE do Linx, + a linha do Shopify ──
    // A linha do Shopify respeita o filtro de linha (Eletrônicos etc.), como as do Linx.
    const parteFilial =
      parte ?? (await fetchParteShopifyDashboard({ company: shopifyCompany, range, linhas, comFrete }));
    const linhaShopify: FilialPerformance = {
      filial: SHOPIFY_VALUE,
      filialDisplayName: SHOPIFY_LABEL[shopifyCompany],
      currentRevenue: parteFilial.receita.atual,
      previousRevenue: parteFilial.receita.anterior,
      changePercentage: metrica(parteFilial.receita.atual, parteFilial.receita.anterior).changePercentage,
    };
    const filialPerformance = [
      ...filialPerformanceLinx.filter((f) => !ehEcommerceLinx(f.filial)),
      linhaShopify,
    ].sort((a, b) => b.currentRevenue - a.currentRevenue);

    // Filial física (ou VAREJO) selecionada: tudo do Linx, intocado.
    if (!somaShopify || !parte) {
      return NextResponse.json(
        {
          filialPerformance,
          topProducts: topProductsLinx,
          topCategories: topCategoriesLinx,
          dailyRevenue: dailyRevenueLinx,
          summary: salesSummaryResult.summary,
          lastAvailableDate: salesSummaryResult.currentPeriodLastSaleDate?.toISOString() ?? null,
          availableRange: {
            start: salesSummaryResult.availableRange.start?.toISOString() ?? null,
            end: salesSummaryResult.availableRange.end?.toISOString() ?? null,
          },
          goals: monthGoals,
          shopify: { loja: SHOPIFY_LABEL[shopifyCompany], incluiFrete: comFrete, frete: null },
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    // ── Somar Linx (lojas físicas) + Shopify ──
    const L = salesSummaryResult.summary;
    const zero = { currentValue: 0, previousValue: 0, changePercentage: 0 };
    const base = filialShopify
      ? { totalRevenue: zero, totalQuantity: zero, totalTickets: zero }
      : { totalRevenue: L.totalRevenue, totalQuantity: L.totalQuantity, totalTickets: L.totalTickets };
    const receita = metrica(base.totalRevenue.currentValue + parte.receita.atual, base.totalRevenue.previousValue + parte.receita.anterior);
    const pecas = metrica(base.totalQuantity.currentValue + parte.pecas.atual, base.totalQuantity.previousValue + parte.pecas.anterior);
    const tickets = metrica(base.totalTickets.currentValue + parte.pedidos.atual, base.totalTickets.previousValue + parte.pedidos.anterior);
    const ticketAtual = tickets.currentValue > 0 ? Number((receita.currentValue / tickets.currentValue).toFixed(2)) : 0;
    const ticketAnterior = tickets.previousValue > 0 ? Number((receita.previousValue / tickets.previousValue).toFixed(2)) : 0;
    const estoqueQtd = estoque ? estoque.estoqueTotal : filialShopify ? 0 : L.totalStockQuantity.currentValue;
    const estoqueValor = estoque ? estoque.valorEmEstoque : filialShopify ? 0 : L.totalStockValue.currentValue;
    const summary: SalesSummary = {
      totalRevenue: receita,
      totalQuantity: pecas,
      totalTickets: tickets,
      averageTicket: metrica(ticketAtual, ticketAnterior),
      totalStockQuantity: { currentValue: estoqueQtd, previousValue: estoqueQtd, changePercentage: null },
      totalStockValue: { currentValue: estoqueValor, previousValue: estoqueValor, changePercentage: null },
    };

    // Produtos: soma por código (item vinculado ao Linx junta com a venda das lojas).
    const prodMap = new Map<string, ProductRevenue>();
    for (const p of topProductsLinx) prodMap.set(p.productId.trim().toUpperCase(), { ...p });
    for (const p of parte.produtos) {
      const k = p.productId.trim().toUpperCase();
      const ex = prodMap.get(k);
      if (ex) {
        ex.totalRevenue += p.totalRevenue;
        ex.totalQuantity += p.totalQuantity;
      } else prodMap.set(k, { ...p });
    }
    const topProducts = [...prodMap.values()].sort((a, b) => b.totalRevenue - a.totalRevenue).slice(0, TOP);
    // Estoque dos produtos do Linx que vieram só do Shopify (sem vínculo = sem estoque no Linx).
    const semEstoque = topProducts.filter((p) => !p.productId.startsWith('SHOPIFY:') && !topProductsLinx.some((l) => l.productId.trim().toUpperCase() === p.productId.trim().toUpperCase()));
    if (semEstoque.length > 0) {
      const mapa = await fetchMultipleProductsStock(semEstoque.map((p) => p.productId), { company, filial: null }).catch(() => new Map<string, number>());
      for (const p of semEstoque) p.stock = mapa.get(p.productId) ?? mapa.get(p.productId.trim()) ?? 0;
    }

    const catMap = new Map(topCategoriesLinx.map((c) => [String(c.categoryId).trim().toUpperCase(), { ...c }]));
    for (const c of parte.categorias) {
      const k = String(c.categoryId).trim().toUpperCase();
      const ex = catMap.get(k);
      if (ex) {
        ex.totalRevenue += c.totalRevenue;
        ex.totalQuantity += c.totalQuantity;
      } else catMap.set(k, { ...c });
    }
    const topCategories = [...catMap.values()].sort((a, b) => b.totalRevenue - a.totalRevenue).slice(0, TOP);

    const diaMap = new Map<string, number>();
    for (const d of dailyRevenueLinx) diaMap.set(d.date, (diaMap.get(d.date) ?? 0) + d.revenue);
    for (const [d, v] of parte.porDia) diaMap.set(d, (diaMap.get(d) ?? 0) + v);
    const dailyRevenue = [...diaMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, revenue]) => ({ date, revenue }));

    const ultLinx = filialShopify ? null : salesSummaryResult.currentPeriodLastSaleDate ?? null;
    const ultima =
      ultLinx && parte.ultimaVenda ? (ultLinx > parte.ultimaVenda ? ultLinx : parte.ultimaVenda) : ultLinx ?? parte.ultimaVenda;

    return NextResponse.json(
      {
        filialPerformance,
        topProducts,
        topCategories,
        dailyRevenue,
        summary,
        lastAvailableDate: ultima?.toISOString() ?? null,
        availableRange: {
          start: salesSummaryResult.availableRange.start?.toISOString() ?? null,
          end: salesSummaryResult.availableRange.end?.toISOString() ?? null,
        },
        goals: monthGoals,
        shopify: { loja: SHOPIFY_LABEL[shopifyCompany], incluiFrete: comFrete, frete: parte.frete },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Erro ao carregar dados do dashboard:', error);
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    return NextResponse.json(
      { error: 'Erro ao carregar dados do dashboard', details: message },
      { status: 500 },
    );
  }
}
