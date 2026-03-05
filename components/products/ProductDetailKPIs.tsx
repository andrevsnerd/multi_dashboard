"use client";

import { useState, useCallback } from "react";
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
    saleHistory.forEach((sale) => {
      const d = sale.date instanceof Date ? sale.date : new Date(sale.date);
      const key = format(d, "yyyy-MM-dd");
      revenueByDay.set(key, (revenueByDay.get(key) ?? 0) + sale.revenue);
    });
    let cumulative = 0;
    const averageDaily = daysPassed > 0 && detail.totalRevenue > 0
      ? detail.totalRevenue / daysPassed
      : 0;
    return days.map((day) => {
      const key = format(day, "yyyy-MM-dd");
      const dayRevenue = revenueByDay.get(key) ?? 0;
      cumulative += dayRevenue;
      const dayIndex = day.getDate();
      const projection = averageDaily * dayIndex;
      return {
        day: format(day, "dd", { locale: ptBR }),
        vendasReais: Math.round(cumulative * 100) / 100,
        projecao: Math.round(projection * 100) / 100,
      };
    });
  })();

  const quantityVariance = detail.totalQuantity > 0 && detail.revenueVariance !== null
    ? detail.revenueVariance
    : null;

  return (
    <div className={styles.section}>
      {/* Primeira linha: 5 KPIs */}
      <div className={styles.kpiRow}>
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
                {detail.revenueVariance > 0 ? "↑" : detail.revenueVariance < 0 ? "↓" : ""}
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
                {quantityVariance > 0 ? "↑" : quantityVariance < 0 ? "↓" : ""}
                {Math.abs(quantityVariance).toFixed(1)}%
              </span>
            )}
          </div>
          <p className={styles.cardDescription}>unidades no período</p>
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
          <div className={styles.cardValue}>{formatCurrency(detail.registeredPrice)}</div>
          <p className={styles.cardDescription}>Preço de venda cadastrado</p>
        </article>

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
          <div className={styles.cardValue}>{formatCurrency(detail.registeredCost)}</div>
          <p className={styles.cardDescription}>Custo cadastrado</p>
        </article>
      </div>

      {/* Estoque por Filial - ordem fixa por empresa */}
      <div className={styles.estoqueSection}>
        <h3 className={styles.estoqueSectionTitle}>Estoque por Filial</h3>
        <div className={styles.estoqueCards}>
          {(() => {
            const order = resolveCompany(companyKey)?.estoqueFilialOrder ?? [];
            const orderMap = new Map(order.map((name, i) => [name.toUpperCase().trim(), i]));
            const sorted = [...stockByFilial].sort((a, b) => {
              const nameA = (a.filialDisplayName || a.filial || "").toUpperCase().trim();
              const nameB = (b.filialDisplayName || b.filial || "").toUpperCase().trim();
              const idxA = orderMap.get(nameA) ?? order.length;
              const idxB = orderMap.get(nameB) ?? order.length;
              return idxA - idxB;
            });
            return sorted.map((filial) => (
            <div key={filial.filial} className={styles.estoqueCard}>
              <span className={styles.estoqueCardName}>{filial.filialDisplayName || filial.filial}</span>
              <span className={styles.estoqueCardValue}>{filial.stock}</span>
            </div>
          ));
          })()}
        </div>
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
                  contentStyle={{
                    backgroundColor: "#fff",
                    border: "1px solid #e2e8f0",
                    borderRadius: "8px",
                    padding: "8px 12px",
                  }}
                  formatter={(value: number) => formatCurrency(value)}
                  labelStyle={{ color: "#64748b", fontSize: "12px" }}
                />
                <Line
                  type="monotone"
                  dataKey="vendasReais"
                  name="Vendas Reais"
                  stroke="#2563eb"
                  strokeWidth={2}
                  dot={{ fill: "#2563eb", r: 3 }}
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
      {modalCustoOpen && (
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
