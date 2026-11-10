"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useAuth } from "@/components/auth/AuthContext";
import { useTheme } from "@/components/theme/ThemeContext";
import type { CompanyKey } from "@/lib/config/company";
import type { ShopifyKpis, ShopifyResumo } from "@/lib/shopify/dashboard";

import ShopifyMapaLinx from "./ShopifyMapaLinx";
import styles from "./ShopifyPage.module.css";

interface ShopifyPageProps {
  companyKey: CompanyKey;
  companyName: string;
}

type Preset = "hoje" | "ontem" | "7d" | "30d" | "mes" | "custom";

const AUTO_REFRESH_MS = 60_000;

const brl = (v: number, digits = 0) =>
  v.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
const int = (v: number) => Math.round(v).toLocaleString("pt-BR");

function todayBrt(): string {
  return new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
}
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00-03:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
}
function presetRange(preset: Preset): { start: string; end: string } | null {
  const t = todayBrt();
  switch (preset) {
    case "hoje":
      return { start: t, end: t };
    case "ontem":
      return { start: addDays(t, -1), end: addDays(t, -1) };
    case "7d":
      return { start: addDays(t, -6), end: t };
    case "30d":
      return { start: addDays(t, -29), end: t };
    case "mes":
      return { start: `${t.slice(0, 8)}01`, end: t };
    default:
      return null;
  }
}

const FINANCIAL_LABEL: Record<string, string> = {
  PAID: "Pago",
  PENDING: "Pendente",
  AUTHORIZED: "Autorizado",
  PARTIALLY_PAID: "Pago parcial",
  PARTIALLY_REFUNDED: "Reemb. parcial",
  REFUNDED: "Reembolsado",
  VOIDED: "Anulado",
  EXPIRED: "Expirado",
};
const FULFILLMENT_LABEL: Record<string, string> = {
  FULFILLED: "Enviado",
  UNFULFILLED: "A enviar",
  PARTIALLY_FULFILLED: "Envio parcial",
  IN_PROGRESS: "Em preparo",
  ON_HOLD: "Retido",
  SCHEDULED: "Agendado",
  RESTOCKED: "Devolvido ao estoque",
  OPEN: "A enviar",
};

function statusTone(status: string | null, cancelado: boolean) {
  if (cancelado) return styles.toneBad;
  if (status === "PAID" || status === "PARTIALLY_PAID") return styles.toneGood;
  if (status === "PENDING" || status === "AUTHORIZED") return styles.toneWarn;
  if (status === "REFUNDED" || status === "PARTIALLY_REFUNDED")
    return styles.toneBad;
  return styles.toneNeutral;
}

function delta(
  atual: number,
  anterior: number,
): { text: string; tone: string } | null {
  if (anterior <= 0)
    return atual > 0 ? { text: "novo", tone: styles.deltaUp } : null;
  const pct = ((atual - anterior) / anterior) * 100;
  const text = `${pct >= 0 ? "+" : ""}${pct.toFixed(1).replace(".", ",")}%`;
  return { text, tone: pct >= 0 ? styles.deltaUp : styles.deltaDown };
}

function timeAgo(iso: string | null, now: number): string {
  if (!iso) return "nunca";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `há ${s}s`;
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
}

function orderTime(iso: string, porHora: boolean) {
  const d = new Date(iso);
  return porHora
    ? d.toLocaleTimeString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        hour: "2-digit",
        minute: "2-digit",
      })
    : d.toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function fmtDate(date: string) {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

export default function ShopifyPage({
  companyKey,
  companyName,
}: ShopifyPageProps) {
  const [aba, setAba] = useState<"vendas" | "mapa">("vendas");
  const [preset, setPreset] = useState<Preset>("hoje");
  const [range, setRange] = useState(() => presetRange("hoje")!);
  const [data, setData] = useState<ShopifyResumo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // "Incluir frete" sempre abre marcado (pedido do dono, 10/11/2026); desmarcar vale só
  // até sair da página.
  const [comFrete, setComFrete] = useState(true);
  const requestId = useRef(0);
  const { theme } = useTheme();
  const toggleFrete = (value: boolean) => setComFrete(value);
  const isScarfme = companyKey === "scarfme";
  // Aba "Mapeamento Linx" só para admin (o servidor também barra as rotas /api/shopify/mapa).
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const load = useCallback(
    async (silent = false) => {
      const id = ++requestId.current;
      if (!silent) setLoading(true);
      try {
        const params = new URLSearchParams({
          company: companyKey,
          start: range.start,
          end: range.end,
        });
        const response = await fetch(`/api/shopify/resumo?${params}`, {
          cache: "no-store",
        });
        const json = (await response.json()) as {
          data?: ShopifyResumo;
          error?: string;
        };
        if (!response.ok || !json.data)
          throw new Error(json.error || "Não foi possível carregar o Shopify.");
        if (id === requestId.current) {
          setData(json.data);
          setError(null);
        }
      } catch (cause) {
        if (id === requestId.current)
          setError(
            cause instanceof Error ? cause.message : "Erro ao carregar.",
          );
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [companyKey, range.start, range.end],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Período em andamento: atualiza sozinho. Carga inicial ainda rodando: atualiza mais rápido.
  const parcial = data?.periodo.parcial ?? true;
  const cargaCompleta = data?.sync.cargaInicialCompleta ?? true;
  useEffect(() => {
    if (!parcial && cargaCompleta) return;
    const interval = setInterval(
      () => void load(true),
      cargaCompleta ? AUTO_REFRESH_MS : 10_000,
    );
    return () => clearInterval(interval);
  }, [load, parcial, cargaCompleta]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(tick);
  }, []);

  function choosePreset(next: Preset) {
    setPreset(next);
    const r = presetRange(next);
    if (r) setRange(r);
  }

  const chartColors =
    theme === "dark"
      ? {
          grid: "rgba(255,255,255,0.06)",
          axis: "#8b95a6",
          // Scarf Me: rosa do logo (nunca verde); NERD segue no verde.
          bar: isScarfme ? "#f08f96" : "#3fb68b",
          prev: "#8b95a6",
          tooltipBg: "#1b1f2a",
          tooltipBorder: "rgba(255,255,255,0.1)",
          tooltipText: "#cfd6e2",
        }
      : {
          grid: "#e2e8f0",
          axis: "#64748b",
          bar: isScarfme ? "#e0676f" : "#0f8a5f",
          prev: "#94a3b8",
          tooltipBg: "#fff",
          tooltipBorder: "#e2e8f0",
          tooltipText: "#334155",
        };

  const k = data?.kpis;
  const p = data?.kpisAnterior;
  // "Incluir frete": venda + frete líquido (= "Vendas totais" do painel do Shopify).
  const kpiValor = (kp: ShopifyKpis, key: keyof ShopifyKpis) => {
    if (!comFrete) return kp[key];
    if (key === "venda") return kp.venda + kp.freteLiquido;
    if (key === "ticketMedio")
      return kp.pedidos > 0 ? (kp.venda + kp.freteLiquido) / kp.pedidos : 0;
    return kp[key];
  };
  const chartData = useMemo(
    () =>
      (data?.serie ?? []).map((pt) => ({
        ...pt,
        valor: pt.venda + (comFrete ? pt.frete : 0),
        valorAnterior: pt.vendaAnterior + (comFrete ? pt.freteAnterior : 0),
      })),
    [data, comFrete],
  );
  const comparLabel = useMemo(() => {
    if (!data) return "";
    const a = data.anterior;
    if (data.periodo.porHora)
      return data.periodo.parcial
        ? `vs ${fmtDate(a.start)} até a mesma hora`
        : `vs ${fmtDate(a.start)}`;
    return `vs ${fmtDate(a.start)}–${fmtDate(a.end)}`;
  }, [data]);

  const mainCards: Array<{
    key: keyof ShopifyKpis;
    label: string;
    format: (v: number) => string;
  }> = [
    {
      key: "venda",
      label: comFrete ? "Venda + frete" : "Venda líquida",
      format: (v) => brl(v),
    },
    { key: "pedidos", label: "Pedidos pagos", format: int },
    { key: "ticketMedio", label: "Ticket médio", format: (v) => brl(v) },
    { key: "itens", label: "Peças", format: int },
    { key: "clientes", label: "Clientes", format: int },
  ];

  return (
    <div
      className={`${styles.wrapper} ${isScarfme ? styles.brandScarfme : ""}`}
    >
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>{companyName} · loja online</p>
          <h1 className={styles.title}>Shopify · tempo real</h1>
          <p className={styles.subtitle}>
            Pedidos direto do Shopify, minutos depois de acontecerem. É a visão
            operacional do site: não soma com o faturamento do Linx, que segue
            sendo o número oficial.
          </p>
        </div>
        <div className={styles.syncBox}>
          <span
            className={`${styles.liveDot} ${data?.sync.erro ? styles.liveDotError : ""}`}
            aria-hidden
          />
          <div>
            <strong>
              {data?.sync.erro ? "Falha na sincronização" : "Sincronizado"}
            </strong>
            <span>{timeAgo(data?.sync.ultimaExecucao ?? null, now)}</span>
          </div>
          <button
            type="button"
            className={styles.refresh}
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? "Atualizando…" : "Atualizar"}
          </button>
        </div>
      </header>

      {isAdmin && (
        <div className={styles.tabs} role="tablist" aria-label="Seção">
          <button
            type="button"
            role="tab"
            aria-selected={aba === "vendas"}
            className={`${styles.tab} ${aba === "vendas" ? styles.tabActive : ""}`}
            onClick={() => setAba("vendas")}
          >
            Vendas
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={aba === "mapa"}
            className={`${styles.tab} ${aba === "mapa" ? styles.tabActive : ""}`}
            onClick={() => setAba("mapa")}
          >
            Mapeamento Linx
          </button>
        </div>
      )}

      {isAdmin && aba === "mapa" ? (
        <ShopifyMapaLinx companyKey={companyKey} />
      ) : (
        <>
          <div className={styles.toolbar}>
            <div className={styles.presets} role="tablist" aria-label="Período">
              {(
                [
                  ["hoje", "Hoje"],
                  ["ontem", "Ontem"],
                  ["7d", "7 dias"],
                  ["30d", "30 dias"],
                  ["mes", "Este mês"],
                ] as Array<[Preset, string]>
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={preset === value}
                  className={`${styles.preset} ${preset === value ? styles.presetActive : ""}`}
                  onClick={() => choosePreset(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className={styles.dates}>
              <input
                type="date"
                className={styles.dateInput}
                value={range.start}
                max={range.end}
                onChange={(e) => {
                  setPreset("custom");
                  setRange((r) => ({ ...r, start: e.target.value || r.start }));
                }}
              />
              <span>até</span>
              <input
                type="date"
                className={styles.dateInput}
                value={range.end}
                min={range.start}
                max={todayBrt()}
                onChange={(e) => {
                  setPreset("custom");
                  setRange((r) => ({ ...r, end: e.target.value || r.end }));
                }}
              />
              <label className={styles.freteToggle}>
                <input
                  type="checkbox"
                  checked={comFrete}
                  onChange={(e) => toggleFrete(e.target.checked)}
                />
                Incluir frete
              </label>
            </div>
          </div>

          {error && <div className={styles.error}>{error}</div>}
          {data?.sync.erro && !error && (
            <div className={styles.warning}>
              Última sincronização com erro: {data.sync.erro}
            </div>
          )}
          {data && !data.sync.cargaInicialCompleta && (
            <div className={styles.warning}>
              Carregando o histórico de pedidos do Shopify pela primeira vez. Os
              números vão subindo sozinhos até terminar.
            </div>
          )}

          <section className={styles.kpis}>
            {mainCards.map((card) => {
              const value = k ? kpiValor(k, card.key) : 0;
              const d = k && p ? delta(value, kpiValor(p, card.key)) : null;
              return (
                <div
                  key={card.key}
                  className={`${styles.kpi} ${card.key === "venda" ? styles.kpiMain : ""}`}
                >
                  <span className={styles.kpiLabel}>{card.label}</span>
                  <strong className={styles.kpiValue}>
                    {k ? card.format(value) : "—"}
                  </strong>
                  {d && (
                    <span className={styles.kpiDelta}>
                      <span className={d.tone}>{d.text}</span> {comparLabel}
                    </span>
                  )}
                </div>
              );
            })}
          </section>

          <section className={styles.subKpis}>
            <div>
              <span>Pendentes (Pix/boleto aguardando)</span>
              <strong>
                {k ? `${int(k.pendentesQtd)} · ${brl(k.pendentesValor)}` : "—"}
              </strong>
            </div>
            <div>
              <span>Descontos dados</span>
              <strong>{k ? brl(k.descontos) : "—"}</strong>
            </div>
            <div>
              <span>
                {comFrete
                  ? "Frete (incluído na venda)"
                  : "Frete (fora da venda)"}
              </span>
              <strong>
                {k ? brl(k.freteLiquido) : "—"}
                {k && k.freteEstornado > 0 && (
                  <small className={styles.subNote}>
                    {" "}
                    · {brl(k.freteEstornado)} estornado
                  </small>
                )}
              </strong>
            </div>
            <div>
              <span>Devoluções (no dia do reembolso)</span>
              <strong>{k ? brl(k.devolucoes) : "—"}</strong>
            </div>
            <div>
              <span>Cancelados</span>
              <strong>
                {k
                  ? `${int(k.canceladosQtd)} · ${brl(k.canceladosValor)}`
                  : "—"}
              </strong>
            </div>
          </section>

          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <h2>
                {data?.periodo.porHora ? "Venda por hora" : "Venda por dia"}
                {comFrete ? " (com frete)" : ""}
              </h2>
              <div className={styles.legend}>
                <span>
                  <i
                    className={styles.legendBar}
                    style={{ background: chartColors.bar }}
                  />{" "}
                  Período
                </span>
                <span>
                  <i
                    className={styles.legendLine}
                    style={{ borderColor: chartColors.prev }}
                  />{" "}
                  Período anterior
                </span>
              </div>
            </div>
            <div className={styles.chart}>
              {data && data.serie.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={chartData}
                    margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid stroke={chartColors.grid} vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: chartColors.axis, fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: chartColors.axis, fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                      width={72}
                      tickFormatter={(v: number) =>
                        v >= 1000 ? `R$ ${Math.round(v / 1000)} mil` : `R$ ${v}`
                      }
                    />
                    <Tooltip
                      cursor={{ fill: chartColors.grid }}
                      contentStyle={{
                        background: chartColors.tooltipBg,
                        border: `1px solid ${chartColors.tooltipBorder}`,
                        borderRadius: 10,
                        color: chartColors.tooltipText,
                      }}
                      formatter={(value, name) => [
                        brl(Number(value)),
                        name === "valor" ? "Período" : "Anterior",
                      ]}
                    />
                    <Bar
                      dataKey="valor"
                      fill={chartColors.bar}
                      radius={[4, 4, 0, 0]}
                      maxBarSize={36}
                    />
                    <Line
                      dataKey="valorAnterior"
                      stroke={chartColors.prev}
                      strokeDasharray="4 4"
                      strokeWidth={2}
                      dot={false}
                      type="monotone"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <div className={styles.empty}>
                  {loading ? "Carregando…" : "Sem pedidos no período."}
                </div>
              )}
            </div>
          </section>

          <div className={styles.grid}>
            <section className={styles.card}>
              <div className={styles.cardHeader}>
                <h2>Últimos pedidos</h2>
                <span className={styles.muted}>
                  {data ? `${data.pedidos.length} mais recentes` : ""}
                </span>
              </div>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Pedido</th>
                      <th>Quando</th>
                      <th>Cliente</th>
                      <th>Status</th>
                      <th className={styles.num}>Peças</th>
                      <th className={styles.num}>Venda</th>
                      <th className={styles.num}>Frete</th>
                      <th className={styles.num}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.pedidos.map((o) => (
                      <tr
                        key={o.orderId}
                        className={
                          o.cancelado ? styles.rowCancelled : undefined
                        }
                      >
                        <td className={styles.strong}>{o.name}</td>
                        <td>{orderTime(o.createdAt, data.periodo.porHora)}</td>
                        <td>
                          <div className={styles.clientCell}>
                            <span>{o.cliente ?? "—"}</span>
                            <small>
                              {[o.cidade, o.uf].filter(Boolean).join(" / ")}
                            </small>
                          </div>
                        </td>
                        <td>
                          <span
                            className={`${styles.badge} ${statusTone(o.status, o.cancelado)}`}
                          >
                            {o.cancelado
                              ? "Cancelado"
                              : (FINANCIAL_LABEL[o.status ?? ""] ??
                                o.status ??
                                "—")}
                          </span>
                          {!o.cancelado && o.fulfillment && (
                            <small className={styles.fulfillment}>
                              {FULFILLMENT_LABEL[o.fulfillment] ??
                                o.fulfillment}
                            </small>
                          )}
                        </td>
                        <td className={styles.num}>{int(o.itens)}</td>
                        <td className={styles.num}>{brl(o.venda, 2)}</td>
                        <td className={`${styles.num} ${styles.muted}`}>
                          {o.frete > 0 ? brl(o.frete, 2) : "grátis"}
                        </td>
                        <td className={`${styles.num} ${styles.strong}`}>
                          {brl(o.venda + o.frete, 2)}
                        </td>
                      </tr>
                    ))}
                    {data && data.pedidos.length === 0 && (
                      <tr>
                        <td colSpan={8} className={styles.empty}>
                          Nenhum pedido no período.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className={styles.card}>
              <div className={styles.cardHeader}>
                <h2>Mais vendidos</h2>
                <span className={styles.muted}>
                  por venda líquida · frete rateado pelo valor do item no pedido
                </span>
              </div>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th className={styles.num}>Peças</th>
                      <th className={styles.num}>Venda</th>
                      <th className={styles.num}>Frete</th>
                      <th className={styles.num}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.topProdutos.map((prod, index) => (
                      <tr key={`${prod.linx ? `${prod.linx.produto}|${prod.linx.cor}` : (prod.productId ?? prod.titulo)}-${index}`}>
                        <td>
                          {/* Com vínculo no Linx: visão do Linx (produto × cor + código de barras).
                              Sem vínculo: nome do Shopify. */}
                          {prod.linx ? (
                            <div className={styles.clientCell}>
                              <span>
                                <b>{prod.linx.produto}</b> {prod.linx.descProduto}
                                {prod.linx.descCor ? ` · ${prod.linx.descCor}` : ""}
                              </span>
                              <small>
                                {prod.linx.codigoBarra ? `cód. barras ${prod.linx.codigoBarra}` : "sem código de barras"}
                                {` · Shopify: ${prod.titulo}`}
                              </small>
                            </div>
                          ) : (
                            <div className={styles.clientCell}>
                              <span>{prod.titulo}</span>
                              <small>
                                <span className={styles.semVinculo}>sem vínculo no Linx</span>
                                {prod.skus.length > 0
                                  ? ` · SKU ${prod.skus.slice(0, 3).join(", ")}${prod.skus.length > 3 ? "…" : ""}`
                                  : ""}
                                {prod.tipo ? ` · ${prod.tipo}` : ""}
                              </small>
                            </div>
                          )}
                        </td>
                        <td className={styles.num}>{int(prod.qtde)}</td>
                        <td className={styles.num}>{brl(prod.venda)}</td>
                        <td className={`${styles.num} ${styles.muted}`}>
                          {brl(prod.frete)}
                        </td>
                        <td className={`${styles.num} ${styles.strong}`}>
                          {brl(prod.venda + prod.frete)}
                        </td>
                      </tr>
                    ))}
                    {data && data.topProdutos.length === 0 && (
                      <tr>
                        <td colSpan={5} className={styles.empty}>
                          Sem vendas no período.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <div className={styles.grid}>
            {/* Rankings somam o valor dos pedidos do período (sem abater devolução de outro período). */}
            <Ranking
              title="Por estado (entrega)"
              rows={data?.estados ?? []}
              total={(k?.vendaPedidos ?? 0) + (comFrete ? (k?.frete ?? 0) : 0)}
              comFrete={comFrete}
            />
            <Ranking
              title="Por forma de pagamento"
              rows={data?.pagamentos ?? []}
              total={(k?.vendaPedidos ?? 0) + (comFrete ? (k?.frete ?? 0) : 0)}
              comFrete={comFrete}
            />
          </div>
        </>
      )}
    </div>
  );
}

function Ranking({
  title,
  rows,
  total,
  comFrete,
}: {
  title: string;
  rows: ShopifyResumo["estados"];
  total: number;
  comFrete: boolean;
}) {
  const valor = (row: ShopifyResumo["estados"][number]) =>
    row.venda + (comFrete ? row.frete : 0);
  return (
    <section className={styles.card}>
      <div className={styles.cardHeader}>
        <h2>{title}</h2>
      </div>
      <ul className={styles.ranking}>
        {rows.map((row) => {
          const share = total > 0 ? valor(row) / total : 0;
          return (
            <li key={row.chave}>
              <div className={styles.rankingTop}>
                <span>{row.chave}</span>
                <span className={styles.num}>
                  {brl(valor(row))}{" "}
                  <small>
                    · {int(row.pedidos)} ped. · {(share * 100).toFixed(0)}%
                    {!comFrete && row.frete > 0
                      ? ` · frete ${brl(row.frete)}`
                      : ""}
                  </small>
                </span>
              </div>
              <div className={styles.track}>
                <div
                  className={styles.fill}
                  style={{ width: `${Math.min(100, share * 100)}%` }}
                />
              </div>
            </li>
          );
        })}
        {rows.length === 0 && (
          <li className={styles.empty}>Sem dados no período.</li>
        )}
      </ul>
    </section>
  );
}
