"use client";

import { useState, useCallback } from "react";
import { useAuth } from "@/components/auth/AuthContext";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { format, startOfMonth, endOfMonth, eachDayOfInterval } from "date-fns";
import { ptBR } from "date-fns/locale";
import type {
  ProductDetailInfo,
  ProductSaleHistory,
  ProductStockByFilial,
  ProductPrecoItem,
  ProductCustoItem,
} from "@/lib/repositories/productDetail";
import { resolveCompany } from "@/lib/config/company";

import styles from "./ProductDetailKPIs.module.css";

export interface ProductDetailKPIsProps {
  detail: ProductDetailInfo;
  productId: string;
  companyKey: string;
  companyName: string;
  range: {
    startDate: Date;
    endDate: Date;
  };
  saleHistory: ProductSaleHistory[];
  stockByFilial: ProductStockByFilial[];
  onDetailUpdated?: () => void;
}

function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2,
  });
}

function formatInteger(value: number): string {
  return value.toLocaleString("pt-BR", {
    maximumFractionDigits: 0,
  });
}

export default function ProductDetailKPIs({
  detail,
  productId,
  companyKey,
  range,
  saleHistory,
  stockByFilial,
  onDetailUpdated,
}: ProductDetailKPIsProps) {
  const { user } = useAuth();
  const canSeeCusto = user?.role === "admin" || user?.role === "logistica";
  const [modalPrecoOpen, setModalPrecoOpen] = useState(false);
  const [modalCustoOpen, setModalCustoOpen] = useState(false);
  const [precos, setPrecos] = useState<ProductPrecoItem[]>([]);
  const [custos, setCustos] = useState<ProductCustoItem[]>([]);
  const [editedPrecos, setEditedPrecos] = useState<Record<string, string>>({});
  const [editedCustos, setEditedCustos] = useState<Record<string, string>>({});
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [confirmPayload, setConfirmPayload] = useState<{
    type: 'preco' | 'custo';
    codTabela: string;
    origem: 'PRODUTOS' | 'PRODUTOS_PRECOS';
    campo: string;
    valorAnterior: number;
    novoValor: number;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  const openPrecoModal = useCallback(() => {
    setModalError(null);
    setEditedPrecos({});
    setConfirmPayload(null);
    setModalPrecoOpen(true);
    setModalLoading(true);
    fetch(`/api/product-detail/precos?productId=${encodeURIComponent(productId)}&company=${encodeURIComponent(companyKey)}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error);
        setPrecos(json.data ?? []);
      })
      .catch((e) => setModalError(e instanceof Error ? e.message : 'Erro ao carregar preços'))
      .finally(() => setModalLoading(false));
  }, [productId, companyKey]);

  const openCustoModal = useCallback(() => {
    setModalError(null);
    setEditedCustos({});
    setConfirmPayload(null);
    setModalCustoOpen(true);
    setModalLoading(true);
    fetch(`/api/product-detail/custos?productId=${encodeURIComponent(productId)}&company=${encodeURIComponent(companyKey)}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error);
        setCustos(json.data ?? []);
      })
      .catch((e) => setModalError(e instanceof Error ? e.message : 'Erro ao carregar custos'))
      .finally(() => setModalLoading(false));
  }, [productId, companyKey]);

  const hasPrecoChange = precos.some((p) => {
    const key = `${p.codTabela}-${p.campo}`;
    const edited = editedPrecos[key];
    if (edited === undefined) return false;
    const raw = edited.replace(',', '.');
    const num = parseFloat(raw);
    return !Number.isNaN(num) && Math.abs(num - p.valor) > 1e-6;
  });
  const hasCustoChange = custos.some((c) => {
    const key = `${c.codTabela}-${c.campo}`;
    const edited = editedCustos[key];
    if (edited === undefined) return false;
    const raw = edited.replace(',', '.');
    const num = parseFloat(raw);
    return !Number.isNaN(num) && Math.abs(num - c.valor) > 1e-6;
  });

  const handleSavePreco = useCallback(() => {
    setModalError(null);
    const item = precos.find((p) => {
      const key = `${p.codTabela}-${p.campo}`;
      const edited = editedPrecos[key];
      if (edited === undefined) return false;
      const raw = edited.replace(',', '.');
      const num = parseFloat(raw);
      return !Number.isNaN(num) && Math.abs(num - p.valor) > 1e-6;
    });
    if (!item) return;
    const key = `${item.codTabela}-${item.campo}`;
    const raw = editedPrecos[key]?.replace(',', '.') ?? '';
    const novoValor = parseFloat(raw);
    if (Number.isNaN(novoValor) || novoValor < 0) {
      setModalError('Valor inválido.');
      return;
    }
    setConfirmPayload({
      type: 'preco',
      codTabela: item.codTabela,
      origem: item.origem,
      campo: item.campo,
      valorAnterior: item.valor,
      novoValor,
    });
  }, [editedPrecos, precos]);

  const handleSaveCusto = useCallback(() => {
    setModalError(null);
    const item = custos.find((c) => {
      const key = `${c.codTabela}-${c.campo}`;
      const edited = editedCustos[key];
      if (edited === undefined) return false;
      const raw = edited.replace(',', '.');
      const num = parseFloat(raw);
      return !Number.isNaN(num) && Math.abs(num - c.valor) > 1e-6;
    });
    if (!item) return;
    const key = `${item.codTabela}-${item.campo}`;
    const raw = editedCustos[key]?.replace(',', '.') ?? '';
    const novoValor = parseFloat(raw);
    if (Number.isNaN(novoValor) || novoValor < 0) {
      setModalError('Valor inválido.');
      return;
    }
    setConfirmPayload({
      type: 'custo',
      codTabela: item.codTabela,
      origem: item.origem,
      campo: item.campo,
      valorAnterior: item.valor,
      novoValor,
    });
  }, [editedCustos, custos]);

  const executeUpdate = useCallback(() => {
    if (!confirmPayload) return;
    setSaving(true);
    setModalError(null);
    fetch('/api/product-detail/update-price-or-cost', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productId,
        company: companyKey,
        codTabela: confirmPayload.codTabela,
        origem: confirmPayload.origem,
        campo: confirmPayload.campo,
        novoValor: confirmPayload.novoValor,
      }),
    })
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error);
        setConfirmPayload(null);
        setModalPrecoOpen(false);
        setModalCustoOpen(false);
        setEditedPrecos({});
        setEditedCustos({});
        onDetailUpdated?.();
      })
      .catch((e) => setModalError(e instanceof Error ? e.message : 'Erro ao salvar'))
      .finally(() => setSaving(false));
  }, [confirmPayload, productId, companyKey, onDetailUpdated]);

  const start = new Date(range.startDate);
  const end = new Date(range.endDate);
  const currentMonth = new Date(start.getFullYear(), start.getMonth(), 1);
  const lastDayOfMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  const totalDaysInMonth = lastDayOfMonth.getDate();
  const daysPassed = Math.min(
    Math.ceil((end.getTime() - currentMonth.getTime()) / (1000 * 60 * 60 * 24)),
    totalDaysInMonth
  );

  const monthlyProjection = (() => {
    if (daysPassed <= 0 || detail.totalRevenue === 0) return 0;
    const averageDaily = detail.totalRevenue / daysPassed;
    return averageDaily * totalDaysInMonth;
  })();

  const chartData = (() => {
    const monthStart = startOfMonth(start);
    const monthEnd = endOfMonth(start);
    const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
    const revenueByDay = new Map<string, number>();
    const salesByDay = new Map<string, { filial: string; filialDisplayName: string; quantity: number; revenue: number }[]>();
    
    saleHistory.forEach((sale) => {
      const d = sale.date instanceof Date ? sale.date : new Date(sale.date);
      const key = format(d, "yyyy-MM-dd");
      revenueByDay.set(key, (revenueByDay.get(key) ?? 0) + sale.revenue);
      
      if (!salesByDay.has(key)) {
        salesByDay.set(key, []);
      }
      const existing = salesByDay.get(key)!;
      const existingFilial = existing.find(s => s.filial === sale.filial);
      if (existingFilial) {
        existingFilial.quantity += sale.quantity;
        existingFilial.revenue += sale.revenue;
      } else {
        existing.push({
          filial: sale.filial,
          filialDisplayName: sale.filialDisplayName,
          quantity: sale.quantity,
          revenue: sale.revenue,
        });
      }
    });
    
    let cumulative = 0;
    let cumulativeQuantity = 0;
    const averageDaily = daysPassed > 0 && detail.totalRevenue > 0
      ? detail.totalRevenue / daysPassed
      : 0;
    const averageQuantityDaily = daysPassed > 0 && detail.totalQuantity > 0
      ? detail.totalQuantity / daysPassed
      : 0;
    return days.map((day) => {
      const key = format(day, "yyyy-MM-dd");
      const dayRevenue = revenueByDay.get(key) ?? 0;
      const dayQuantity = salesByDay.get(key)?.reduce((sum, s) => sum + s.quantity, 0) ?? 0;
      cumulative += dayRevenue;
      cumulativeQuantity += dayQuantity;
      const dayIndex = day.getDate();
      const projection = averageDaily * dayIndex;
      const quantityProjection = Math.round(averageQuantityDaily * dayIndex);
      const daySales = salesByDay.get(key) ?? [];
      return {
        day: format(day, "dd", { locale: ptBR }),
        vendasReais: Math.round(cumulative * 100) / 100,
        projecao: Math.round(projection * 100) / 100,
        quantityProjection,
        hasSales: daySales.length > 0,
        salesByFilial: daySales,
      };
    });
  })();

  const quantityVariance = detail.totalQuantity > 0 && detail.revenueVariance !== null
    ? detail.revenueVariance
    : null;

  const filialOrder = resolveCompany(companyKey)?.estoqueFilialOrder ?? [];
  const filialOrderMap = new Map(
    filialOrder.map((name, i) => [name.toUpperCase().trim(), i])
  );

  const sortedFiliaisByOrder = useCallback(
    <T extends { filial?: string; filialDisplayName?: string }>(items: T[]) => {
      return [...items].sort((a, b) => {
        const nameA = (a.filialDisplayName || a.filial || "").toUpperCase().trim();
        const nameB = (b.filialDisplayName || b.filial || "").toUpperCase().trim();
        const isMatrizA = nameA === "MATRIZ";
        const isMatrizB = nameB === "MATRIZ";
        if (isMatrizA !== isMatrizB) return isMatrizA ? 1 : -1;
        const idxA = filialOrderMap.get(nameA) ?? filialOrder.length;
        const idxB = filialOrderMap.get(nameB) ?? filialOrder.length;
        return idxA - idxB;
      });
    },
    [filialOrder, filialOrderMap]
  );

  const salesByColorInfo = (() => {
    const codes = new Set(
      saleHistory
        .map((s) => (s.color ?? "").trim())
        .filter(Boolean)
    );
    const hasSpecificColorSelected = codes.size === 1;

    const byColor = new Map<string, { label: string; quantity: number }>();
    saleHistory.forEach((sale) => {
      const label = (sale.colorDisplayName || sale.color || "Sem cor").trim() || "Sem cor";
      const current = byColor.get(label);
      if (current) current.quantity += sale.quantity ?? 0;
      else byColor.set(label, { label, quantity: sale.quantity ?? 0 });
    });

    const rows = Array.from(byColor.values())
      .filter((r) => r.quantity > 0)
      .sort((a, b) => b.quantity - a.quantity);
    const total = rows.reduce((sum, r) => sum + (r.quantity ?? 0), 0);
    const max = Math.max(1, ...rows.map((r) => r.quantity ?? 0));

    return { hasSpecificColorSelected, rows, total, max };
  })();

  return (
    <div className={styles.section}>
      {/* Primeira linha: 5 KPIs */}
      <div className={`${styles.kpiRow} ${canSeeCusto ? "" : styles.kpiRow3}`}>
        <article className={styles.card}>
          <header className={styles.cardHeader}>
            <span className={styles.cardLabel}>VALOR TOTAL DE VENDAS</span>
            <span className={styles.cardIconSvg} aria-hidden>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
            </span>
          </header>
          <div className={styles.valueRow}>
            <span className={styles.cardValue}>{formatCurrency(detail.totalRevenue)}</span>
            {detail.revenueVariance !== null && (
              <span
                className={`${styles.variance} ${
                  detail.revenueVariance > 0 ? styles.variancePositive : detail.revenueVariance < 0 ? styles.varianceNegative : ""
                }`}
              >
                {detail.revenueVariance > 0 ? "+" : detail.revenueVariance < 0 ? "-" : ""}
                {Math.abs(detail.revenueVariance).toFixed(1)}%
              </span>
            )}
          </div>
          <p className={styles.cardDescription}>
            Projeção Mês: {formatCurrency(monthlyProjection)}
          </p>
        </article>

        <article className={styles.card}>
          <header className={styles.cardHeader}>
            <span className={styles.cardLabel}>QUANTIDADE VENDIDA</span>
            <span className={styles.cardIconSvg} aria-hidden>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
            </span>
          </header>
          <div className={styles.valueRow}>
            <span className={styles.cardValue}>{formatInteger(detail.totalQuantity)}</span>
            {quantityVariance !== null && (
              <span
                className={`${styles.variance} ${
                  quantityVariance > 0 ? styles.variancePositive : quantityVariance < 0 ? styles.varianceNegative : ""
                }`}
              >
                {quantityVariance > 0 ? "+" : quantityVariance < 0 ? "-" : ""}
                {Math.abs(quantityVariance).toFixed(1)}%
              </span>
            )}
          </div>
          <p className={styles.cardDescription}>Unidades no período</p>
        </article>

        <article className={styles.card}>
          <header className={styles.cardHeader}>
            <span className={styles.cardLabel}>PREÇO DE VENDA</span>
            <button
              type="button"
              className={styles.cardEditButton}
              onClick={openPrecoModal}
              aria-label="Editar preços de venda"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          </header>
          <div className={styles.valueRow}>
            <span className={styles.cardValue}>{formatCurrency(detail.registeredPrice)}</span>
          </div>
          <p className={styles.cardDescription}>Preço de venda cadastrado</p>
        </article>

        {canSeeCusto && (
          <article className={styles.card}>
            <header className={styles.cardHeader}>
              <span className={styles.cardLabel}>CUSTO UNITÁRIO</span>
              <button
                type="button"
                className={styles.cardEditButton}
                onClick={openCustoModal}
                aria-label="Editar custos unitários"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
            </header>
            <div className={styles.valueRow}>
              <span className={styles.cardValue}>{formatCurrency(detail.registeredCost)}</span>
            </div>
            <p className={styles.cardDescription}>Custo cadastrado</p>
          </article>
        )}
      </div>

      <div className={styles.filialCardsRow}>
        {/* Estoque por Filial - ordem fixa por empresa */}
        <section className={styles.stockByFilialCard}>
          {(() => {
            const sorted = sortedFiliaisByOrder(stockByFilial);
            const total = sorted.reduce((sum, f) => sum + (f.stock ?? 0), 0);
            const max = Math.max(1, ...sorted.map((f) => f.stock ?? 0));

            return (
              <>
                <div className={styles.stockByFilialHeader}>
                  <h3 className={styles.stockByFilialTitle}>Estoque por Filial</h3>
                  <p className={styles.stockByFilialSubtitle}>
                    {sorted.length} filiais · {formatInteger(total)} unidades
                  </p>
                </div>

                <div className={styles.stockByFilialList}>
                  {sorted.map((filial) => {
                    const value = filial.stock ?? 0;
                    const pct = total > 0 ? (value / total) * 100 : 0;
                    const bar = (value / max) * 100;
                    return (
                      <div key={filial.filial} className={styles.stockByFilialRow}>
                        <div className={styles.stockByFilialName}>
                          {(filial.filialDisplayName || filial.filial || "").toUpperCase()}
                        </div>
                        <div className={styles.stockByFilialBarWrap} aria-hidden>
                          <div className={styles.stockByFilialBar} style={{ width: `${bar}%` }} />
                        </div>
                        <div className={styles.stockByFilialNumbers}>
                          <span className={styles.stockByFilialQty}>{formatInteger(value)}</span>
                          <span className={styles.stockByFilialPct}>{pct.toFixed(1)}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </section>

        {/* Vendas por Filial (quantidade) */}
        <section className={styles.stockByFilialCard}>
          {(() => {
            const byFilial = new Map<
              string,
              { filial: string; filialDisplayName: string; quantity: number }
            >();

            saleHistory.forEach((sale) => {
              const key = (sale.filialDisplayName || sale.filial || "").toUpperCase().trim();
              if (!key) return;
              const current = byFilial.get(key);
              if (current) {
                current.quantity += sale.quantity ?? 0;
              } else {
                byFilial.set(key, {
                  filial: sale.filial,
                  filialDisplayName: sale.filialDisplayName || sale.filial,
                  quantity: sale.quantity ?? 0,
                });
              }
            });

            const rows = sortedFiliaisByOrder(Array.from(byFilial.values()));
            const total = rows.reduce((sum, f) => sum + (f.quantity ?? 0), 0);
            const max = Math.max(1, ...rows.map((f) => f.quantity ?? 0));

            return (
              <>
                <div className={styles.stockByFilialHeader}>
                  <h3 className={styles.stockByFilialTitle}>Vendas por Filial</h3>
                  <p className={styles.stockByFilialSubtitle}>
                    {rows.length} filiais · {formatInteger(total)} unidades
                  </p>
                </div>

                <div className={styles.stockByFilialList}>
                  {rows.map((filial) => {
                    const value = filial.quantity ?? 0;
                    const pct = total > 0 ? (value / total) * 100 : 0;
                    const bar = (value / max) * 100;
                    return (
                      <div key={filial.filialDisplayName} className={styles.stockByFilialRow}>
                        <div className={styles.stockByFilialName}>
                          {(filial.filialDisplayName || filial.filial || "").toUpperCase()}
                        </div>
                        <div className={styles.stockByFilialBarWrap} aria-hidden>
                          <div className={styles.salesByFilialBar} style={{ width: `${bar}%` }} />
                        </div>
                        <div className={styles.stockByFilialNumbers}>
                          <span className={styles.stockByFilialQty}>{formatInteger(value)}</span>
                          <span className={styles.stockByFilialPct}>{pct.toFixed(1)}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </section>

        {/* Performance por Vendedor (quantidade) */}
        <section className={styles.stockByFilialCard}>
          {(() => {
            const byVendor = new Map<string, { vendor: string; quantity: number }>();
            saleHistory.forEach((sale) => {
              const vendor = (sale as { vendedor?: string | null }).vendedor ?? null;
              // E-commerce não tem vendedor: ignorar essas vendas aqui
              if (!vendor || !vendor.trim()) return;
              const key = vendor.toUpperCase().trim();
              const current = byVendor.get(key);
              if (current) current.quantity += sale.quantity ?? 0;
              else byVendor.set(key, { vendor: vendor.trim(), quantity: sale.quantity ?? 0 });
            });

            const rows = Array.from(byVendor.values())
              .filter((r) => r.quantity > 0)
              .sort((a, b) => b.quantity - a.quantity);

            const total = rows.reduce((sum, r) => sum + (r.quantity ?? 0), 0);
            const max = Math.max(1, ...rows.map((r) => r.quantity ?? 0));

            return (
              <>
                <div className={styles.stockByFilialHeader}>
                  <h3 className={styles.stockByFilialTitle}>Performance por Vendedor</h3>
                  <p className={styles.stockByFilialSubtitle}>
                    {rows.length} vendedor(es) · {formatInteger(total)} unidades
                  </p>
                </div>

                <div className={styles.stockByFilialList}>
                  {rows.map((row) => {
                    const value = row.quantity ?? 0;
                    const pct = total > 0 ? (value / total) * 100 : 0;
                    const bar = (value / max) * 100;
                    return (
                      <div key={row.vendor} className={styles.stockByFilialRow}>
                        <div className={styles.stockByFilialName}>{row.vendor.toUpperCase()}</div>
                        <div className={styles.stockByFilialBarWrap} aria-hidden>
                          <div className={styles.vendorPerformanceBar} style={{ width: `${bar}%` }} />
                        </div>
                        <div className={styles.stockByFilialNumbers}>
                          <span className={styles.stockByFilialQty}>{formatInteger(value)}</span>
                          <span className={styles.stockByFilialPct}>{pct.toFixed(1)}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </section>

        {/* Vendas por Cor (quantidade) */}
        {!salesByColorInfo.hasSpecificColorSelected && (
          <section className={styles.stockByFilialCard}>
            <div className={styles.stockByFilialHeader}>
              <h3 className={styles.stockByFilialTitle}>Vendas por Cor</h3>
              <p className={styles.stockByFilialSubtitle}>
                {salesByColorInfo.rows.length} cor(es) · {formatInteger(salesByColorInfo.total)} unidades
              </p>
            </div>

            <div className={styles.stockByFilialList}>
              {salesByColorInfo.rows.map((row) => {
                const value = row.quantity ?? 0;
                const pct = salesByColorInfo.total > 0 ? (value / salesByColorInfo.total) * 100 : 0;
                const bar = (value / salesByColorInfo.max) * 100;
                return (
                  <div key={row.label} className={styles.stockByFilialRow}>
                    <div className={styles.stockByFilialName}>{row.label.toUpperCase()}</div>
                    <div className={styles.stockByFilialBarWrap} aria-hidden>
                      <div className={styles.salesByColorBar} style={{ width: `${bar}%` }} />
                    </div>
                    <div className={styles.stockByFilialNumbers}>
                      <span className={styles.stockByFilialQty}>{formatInteger(value)}</span>
                      <span className={styles.stockByFilialPct}>{pct.toFixed(1)}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>

      {/* Performance de Vendas */}
      <div className={styles.chartRow}>
        <div className={styles.chartCard}>
          <h3 className={styles.chartTitle}>Performance de Vendas</h3>
          <p className={styles.chartSubtitle}>Acompanhamento mensal de vendas vs projeção</p>
          <div className={styles.chartLegend}>
            <span className={styles.chartLegendItem}>
              <span className={styles.chartLegendDotBlue} /> Vendas Reais
            </span>
            <span className={styles.chartLegendItem}>
              <span className={styles.chartLegendDotGray} /> Projeção
            </span>
          </div>
          <div className={styles.chartWrapper}>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="day"
                  stroke="#94a3b8"
                  style={{ fontSize: "12px" }}
                  tick={{ fill: "#64748b" }}
                />
                <YAxis
                  stroke="#94a3b8"
                  style={{ fontSize: "12px" }}
                  tick={{ fill: "#64748b" }}
                  tickFormatter={(v) => (v >= 1000 ? `R$ ${(v / 1000).toFixed(0)}k` : `R$ ${v}`)}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const data = payload[0]?.payload;
                    return (
                      <div style={{
                        backgroundColor: "#fff",
                        border: "1px solid #e2e8f0",
                        borderRadius: "8px",
                        padding: "8px 12px",
                        fontSize: "12px",
                      }}>
                        <p style={{ margin: "0 0 8px 0", color: "#64748b", fontWeight: 600 }}>Dia {label}</p>
                        {data.hasSales ? (
                          <>
                            <p style={{ margin: "0 0 8px 0", color: "#2563eb", fontWeight: 600 }}>
                              Vendas: {formatCurrency(data.vendasReais)} ({data.salesByFilial?.reduce((sum: number, s: { quantity: number }) => sum + s.quantity, 0) ?? 0} un.)
                            </p>
                            <p style={{ margin: "0 0 8px 0", color: "#94a3b8" }}>
                              Projeção: {formatCurrency(data.projecao)} ({data.quantityProjection} un.)
                            </p>
                            {data.salesByFilial && data.salesByFilial.length > 0 && (
                              <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: "8px" }}>
                                <p style={{ margin: "0 0 4px 0", fontWeight: 600 }}>Filiais:</p>
                                {data.salesByFilial.map((s: { filialDisplayName: string; quantity: number; revenue: number }, idx: number) => (
                                  <div key={idx} style={{ display: "flex", justifyContent: "space-between", gap: "16px", marginBottom: "2px" }}>
                                    <span style={{ color: "#475569" }}>{s.filialDisplayName}</span>
                                    <span style={{ color: "#475569", fontWeight: 500 }}>{s.quantity} un. ({formatCurrency(s.revenue)})</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </>
                        ) : (
                          <p style={{ margin: "0 0 8px 0", color: "#94a3b8" }}>
                            Projeção: {formatCurrency(data.projecao)} ({data.quantityProjection} un.)
                          </p>
                        )}
                      </div>
                    );
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="vendasReais"
                  name="Vendas Reais"
                  stroke="#2563eb"
                  strokeWidth={2}
                  dot={(props) => {
                    const { cx, cy, payload } = props;
                    if (!payload.hasSales || cy == null) return null;
                    return <circle cx={cx} cy={cy} r={3} fill="#2563eb" />;
                  }}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="projecao"
                  name="Projeção"
                  stroke="#94a3b8"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  dot={false}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Modal Preços de venda */}
      {modalPrecoOpen && (
        <div className={styles.modalOverlay} onClick={() => !confirmPayload && setModalPrecoOpen(false)} role="dialog" aria-modal="true" aria-labelledby="modal-preco-title">
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <h2 id="modal-preco-title" className={styles.modalTitle}>Editar preços de venda</h2>
            {modalError && <div className={styles.modalError}>{modalError}</div>}
            {modalLoading && <div className={styles.modalLoading}>Carregando…</div>}
            {!modalLoading && precos.length === 0 && !modalError && <div className={styles.modalEmpty}>Nenhum preço de venda encontrado para este produto.</div>}
            {!modalLoading && precos.length > 0 && (
              <>
                <div className={styles.modalList}>
                  {precos.map((item) => {
                    const key = `${item.codTabela}-${item.campo}`;
                    return (
                      <div key={key} className={styles.modalRow}>
                        <span className={styles.modalRowLabel}>{item.descTabela || item.codTabela}</span>
                        <input
                          type="text"
                          className={styles.modalInput}
                          value={editedPrecos[key] ?? item.valor.toFixed(2).replace('.', ',')}
                          onChange={(e) => setEditedPrecos((prev) => ({ ...prev, [key]: e.target.value }))}
                          inputMode="decimal"
                        />
                      </div>
                    );
                  })}
                </div>
                {confirmPayload && confirmPayload.type === 'preco' && (
                  <div className={styles.modalConfirmMessage}>
                    Confirmar alteração: <strong>{formatCurrency(confirmPayload.valorAnterior)}</strong> → <strong>{formatCurrency(confirmPayload.novoValor)}</strong>?
                  </div>
                )}
                <div className={styles.modalActions}>
                  {confirmPayload && confirmPayload.type === 'preco' ? (
                    <>
                      <button type="button" className={`${styles.modalButton} ${styles.modalButtonSecondary}`} onClick={() => setConfirmPayload(null)} disabled={saving}>Cancelar</button>
                      <button type="button" className={`${styles.modalButton} ${styles.modalButtonPrimary}`} onClick={executeUpdate} disabled={saving}>{saving ? 'Salvando…' : 'Confirmar'}</button>
                    </>
                  ) : (
                    <>
                      <button type="button" className={`${styles.modalButton} ${styles.modalButtonSecondary}`} onClick={() => setModalPrecoOpen(false)}>Fechar</button>
                      <button type="button" className={`${styles.modalButton} ${styles.modalButtonPrimary}`} onClick={handleSavePreco} disabled={!hasPrecoChange}>Salvar</button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Modal Custos unitários */}
      {canSeeCusto && modalCustoOpen && (
        <div className={styles.modalOverlay} onClick={() => !confirmPayload && setModalCustoOpen(false)} role="dialog" aria-modal="true" aria-labelledby="modal-custo-title">
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <h2 id="modal-custo-title" className={styles.modalTitle}>Editar custos unitários</h2>
            {modalError && <div className={styles.modalError}>{modalError}</div>}
            {modalLoading && <div className={styles.modalLoading}>Carregando…</div>}
            {!modalLoading && custos.length === 0 && !modalError && <div className={styles.modalEmpty}>Nenhum custo encontrado para este produto.</div>}
            {!modalLoading && custos.length > 0 && (
              <>
                <div className={styles.modalList}>
                  {custos.map((item) => {
                    const key = `${item.codTabela}-${item.campo}`;
                    return (
                      <div key={key} className={styles.modalRow}>
                        <span className={styles.modalRowLabel}>{item.descTabela || item.codTabela}</span>
                        <input
                          type="text"
                          className={styles.modalInput}
                          value={editedCustos[key] ?? item.valor.toFixed(2).replace('.', ',')}
                          onChange={(e) => setEditedCustos((prev) => ({ ...prev, [key]: e.target.value }))}
                          inputMode="decimal"
                        />
                      </div>
                    );
                  })}
                </div>
                {confirmPayload && confirmPayload.type === 'custo' && (
                  <div className={styles.modalConfirmMessage}>
                    Confirmar alteração: <strong>{formatCurrency(confirmPayload.valorAnterior)}</strong> → <strong>{formatCurrency(confirmPayload.novoValor)}</strong>?
                  </div>
                )}
                <div className={styles.modalActions}>
                  {confirmPayload && confirmPayload.type === 'custo' ? (
                    <>
                      <button type="button" className={`${styles.modalButton} ${styles.modalButtonSecondary}`} onClick={() => setConfirmPayload(null)} disabled={saving}>Cancelar</button>
                      <button type="button" className={`${styles.modalButton} ${styles.modalButtonPrimary}`} onClick={executeUpdate} disabled={saving}>{saving ? 'Salvando…' : 'Confirmar'}</button>
                    </>
                  ) : (
                    <>
                      <button type="button" className={`${styles.modalButton} ${styles.modalButtonSecondary}`} onClick={() => setModalCustoOpen(false)}>Fechar</button>
                      <button type="button" className={`${styles.modalButton} ${styles.modalButtonPrimary}`} onClick={handleSaveCusto} disabled={!hasCustoChange}>Salvar</button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
