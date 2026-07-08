"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

import FilialFilter from "@/components/filters/FilialFilter";
import { useTheme } from "@/components/theme/ThemeContext";
import { resolveCompany, type CompanyKey } from "@/lib/config/company";

import styles from "./LojaRaioXPage.module.css";

// ── Tipos (espelham o payload de /api/loja-raio-x) ───────────────────────────

interface MesMetric {
  ano: number;
  mes: number;
  ym: string;
  label: string;
  faturamento: number;
  tickets: number;
  quantidade: number;
  ticketMedio: number;
  parcial?: boolean;
}

interface Janela {
  parcial: boolean;
  diaCorte: number | null;
  analisadoLabel: string;
  comparacaoLabel: string | null;
}

interface PrincipalData {
  meses: MesMetric[];
  analyzed: MesMetric | null;
  comparacao: MesMetric | null;
  comparacaoAuto: boolean;
  isMesmo: boolean;
  janela: Janela;
  decomposicao: { gap: number; porAtendimentos: number; porTicketMedio: number } | null;
  rupturasResumo: { quantidade: number; faturamento: number; comEstoqueNaRede: number };
  vendedoresResumo: {
    ativosAnalisado: number;
    ativosBest: number;
    quedas: Array<{ vendedor: string; analisado: number; melhor: number; queda: number }>;
    ranking: Array<{ vendedor: string; analisado: number; comparacao: number; diff: number }>;
  };
}

type SituacaoComparacao = "ruptura" | "tinha_estoque" | "cresceu" | "estavel";

interface ComparacaoProdutoItem {
  produto: string;
  cor: string;
  corDescricao: string;
  descricao: string;
  qtdAnalisado: number;
  fatAnalisado: number;
  qtdComparacao: number;
  fatComparacao: number;
  diffFat: number;
  estoqueLoja: number;
  estoqueFimMesAnalisado: number | null;
  rupturaTipo: "total" | "meio" | null;
  temNaRede: boolean;
  situacao: SituacaoComparacao;
}
interface ComparacaoData {
  ruptura: ComparacaoProdutoItem[];
  tinhaEstoque: ComparacaoProdutoItem[];
  cresceu: ComparacaoProdutoItem[];
  rupturaCount: number;
  tinhaEstoqueCount: number;
  cresceuCount: number;
  rupturaFat: number;
  tinhaEstoqueFat: number;
  cresceuFat: number;
  gapProdutos: number;
  truncado: boolean;
}

interface VendedorLinha {
  vendedor: string;
  porMes: Record<string, { valor: number; qtd: number }>;
  totalValor: number;
  totalQtd: number;
}
interface VendedoresData {
  meses: string[];
  vendedores: VendedorLinha[];
}

interface RupturaItem {
  produto: string;
  cor: string;
  corDescricao: string;
  descricao: string;
  qtdVendida: number;
  faturamento: number;
  estoqueLoja: number;
  estoqueRede: number;
  ondeTemEstoque: Array<{ filial: string; estoque: number }>;
}

interface ProdutoVendaEstoqueItem {
  produto: string;
  cor: string;
  corDescricao: string;
  descricao: string;
  qtdAntes: number;
  fatAntes: number;
  qtdDepois: number;
  fatDepois: number;
  estoque: number;
  acabaEmDias: number | null;
}
interface ProdutosEstoqueData {
  semEstoque: ProdutoVendaEstoqueItem[];
  comEstoque: ProdutoVendaEstoqueItem[];
  diasAntes: number;
  diasDepois: number;
  truncado: boolean;
}

type Tab = "principal" | "produtos" | "vendedores" | "rupturas";

// ── Formatadores ─────────────────────────────────────────────────────────────

const MESES_ABREV = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function fmtCurrency(value: number, digits = 0): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: digits });
}
function fmtNum(value: number): string {
  return value.toLocaleString("pt-BR");
}
function ymLabel(ym: string): string {
  const [ano, mes] = ym.split("-").map(Number);
  return `${MESES_ABREV[(mes || 1) - 1]}/${String(ano).slice(2)}`;
}

/** Últimos 12 meses (inclui o atual), cronológico — para o seletor antes do fetch. */
function ultimosMesesClient(n: number): Array<{ ym: string; label: string }> {
  const now = new Date();
  const ano = now.getFullYear();
  const mes = now.getMonth();
  const out: Array<{ ym: string; label: string }> = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(ano, mes - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    out.push({ ym: `${y}-${String(m).padStart(2, "0")}`, label: `${MESES_ABREV[m - 1]}/${String(y).slice(2)}` });
  }
  return out;
}

// ── Componente principal ──────────────────────────────────────────────────────

interface Props {
  companyKey: CompanyKey;
  companyName: string;
}

export default function LojaRaioXPage({ companyKey }: Props) {
  const mesesOpcoes = useMemo(() => ultimosMesesClient(12), []);
  const [filial, setFilial] = useState<string | null>(null);
  const [mes, setMes] = useState<string>(mesesOpcoes[mesesOpcoes.length - 1].ym);
  // "auto" = melhor mês dos últimos 6; ou um YYYY-MM específico escolhido pelo usuário.
  const [comparar, setComparar] = useState<string>("auto");
  const [tab, setTab] = useState<Tab>("principal");

  const [principal, setPrincipal] = useState<PrincipalData | null>(null);
  const [principalLoading, setPrincipalLoading] = useState(false);
  const [principalError, setPrincipalError] = useState<string | null>(null);

  const [vendedores, setVendedores] = useState<VendedoresData | null>(null);
  const [vendedoresLoading, setVendedoresLoading] = useState(false);

  const [rupturas, setRupturas] = useState<RupturaItem[] | null>(null);
  const [rupturasLoading, setRupturasLoading] = useState(false);

  const [comparacao, setComparacao] = useState<ComparacaoData | null>(null);
  const [comparacaoLoading, setComparacaoLoading] = useState(false);

  const [produtosEstoque, setProdutosEstoque] = useState<ProdutosEstoqueData | null>(null);
  const [produtosEstoqueLoading, setProdutosEstoqueLoading] = useState(false);

  // Principal (linha do tempo + diagnóstico). filial null = visão rede (agrega todas).
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    async function load() {
      setPrincipalLoading(true);
      setPrincipalError(null);
      try {
        const params = new URLSearchParams({ company: companyKey, mes, section: "principal" });
        if (filial) params.set("filial", filial);
        if (comparar !== "auto") params.set("comparar", comparar);
        const r = await fetch(`/api/loja-raio-x?${params}`, { cache: "no-store", signal: controller.signal });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Erro ao carregar");
        const json = await r.json();
        if (!cancelled) setPrincipal(json.data as PrincipalData);
      } catch (err) {
        if (!cancelled && (err as Error).name !== "AbortError") setPrincipalError((err as Error).message);
      } finally {
        if (!cancelled) setPrincipalLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [companyKey, filial, mes, comparar]);

  // Vendedores (matriz 12 meses) — carrega ao abrir a aba. filial null = rede.
  useEffect(() => {
    if (tab !== "vendedores") return;
    const controller = new AbortController();
    let cancelled = false;
    async function load() {
      setVendedoresLoading(true);
      try {
        const params = new URLSearchParams({ company: companyKey, section: "vendedores" });
        if (filial) params.set("filial", filial);
        const r = await fetch(`/api/loja-raio-x?${params}`, { cache: "no-store", signal: controller.signal });
        const json = await r.json();
        if (!cancelled) setVendedores(json.data as VendedoresData);
      } catch {
        /* abortado ou erro transitório */
      } finally {
        if (!cancelled) setVendedoresLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [companyKey, filial, tab]);

  // Rupturas — depende de mês; carrega ao abrir a aba. filial null = rede.
  useEffect(() => {
    if (tab !== "rupturas") return;
    const controller = new AbortController();
    let cancelled = false;
    async function load() {
      setRupturasLoading(true);
      try {
        const params = new URLSearchParams({ company: companyKey, mes, section: "rupturas" });
        if (filial) params.set("filial", filial);
        const r = await fetch(`/api/loja-raio-x?${params}`, { cache: "no-store", signal: controller.signal });
        const json = await r.json();
        if (!cancelled) setRupturas((json.data as RupturaItem[]) ?? []);
      } catch {
        /* abortado ou erro transitório */
      } finally {
        if (!cancelled) setRupturasLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [companyKey, filial, mes, tab]);

  // Comparação de produtos (mês analisado vs comparação) — lazy, no Diagnóstico,
  // depois que o principal resolve o mês de comparação. Não roda se for o mesmo mês.
  const compYm = principal?.comparacao?.ym ?? null;
  const compIsMesmo = principal?.isMesmo ?? false;
  useEffect(() => {
    if (tab !== "principal" || !compYm || compIsMesmo) return;
    const controller = new AbortController();
    let cancelled = false;
    async function load(comparar: string) {
      setComparacaoLoading(true);
      try {
        const params = new URLSearchParams({ company: companyKey, mes, comparar, section: "comparacao" });
        if (filial) params.set("filial", filial);
        const r = await fetch(`/api/loja-raio-x?${params}`, { cache: "no-store", signal: controller.signal });
        const json = await r.json();
        if (!cancelled) setComparacao(json.data as ComparacaoData);
      } catch {
        /* abortado ou erro transitório */
      } finally {
        if (!cancelled) setComparacaoLoading(false);
      }
    }
    void load(compYm);
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [companyKey, filial, mes, tab, compYm, compIsMesmo]);

  // Aba Produtos (vendas antes × depois + estoque) — lazy; usa o mês de referência
  // resolvido pelo principal (melhor mês / escolhido). filial null = rede.
  useEffect(() => {
    if (tab !== "produtos" || !compYm) return;
    const controller = new AbortController();
    let cancelled = false;
    async function load(comparar: string) {
      setProdutosEstoqueLoading(true);
      try {
        const params = new URLSearchParams({ company: companyKey, mes, comparar, section: "produtos-estoque" });
        if (filial) params.set("filial", filial);
        const r = await fetch(`/api/loja-raio-x?${params}`, { cache: "no-store", signal: controller.signal });
        const json = await r.json();
        if (!cancelled) setProdutosEstoque(json.data as ProdutosEstoqueData);
      } catch {
        /* abortado ou erro transitório */
      } finally {
        if (!cancelled) setProdutosEstoqueLoading(false);
      }
    }
    void load(compYm);
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [companyKey, filial, mes, tab, compYm]);

  const timeline = principal?.meses ?? null;
  const isRede = !filial;
  const hasEcommerce = (resolveCompany(companyKey)?.ecommerceFilials?.length ?? 0) > 0;

  const compararLabel =
    comparar === "auto"
      ? `Melhor mês${principal?.comparacao ? ` (${MESES_ABREV[(Number(principal.comparacao.ym.split("-")[1]) || 1) - 1]})` : ""}`
      : ymLabel(comparar);

  const TAB_LABEL: Record<Tab, string> = {
    principal: "Diagnóstico",
    produtos: "Produtos",
    vendedores: "Vendedores",
    rupturas: "Rupturas",
  };

  return (
    <div className={styles.wrapper}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <h1 className={styles.title}>Loja Raio X</h1>
          <span className={styles.brandSub}>
            {isRede ? "Rede — todas as lojas" : "loja selecionada"}
            {isRede && hasEcommerce ? " · varejo" : ""}
          </span>
        </div>

        <nav className={styles.tabs}>
          {(["principal", "produtos", "vendedores", "rupturas"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              className={`${styles.tabBtn} ${tab === t ? styles.tabBtnActive : ""}`}
              onClick={() => setTab(t)}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </nav>

        <div className={styles.controls}>
          <div className={styles.ctrl}>
            <span className={styles.ctrlLabel}>Loja:</span>
            <FilialFilter companyKey={companyKey} value={filial} onChange={setFilial} module="sales" hideVarejo />
          </div>
          <label className={styles.ctrl}>
            <span className={styles.ctrlLabel}>Mês:</span>
            <select className={styles.select} value={mes} onChange={(e) => setMes(e.target.value)}>
              {mesesOpcoes.map((m) => (
                <option key={m.ym} value={m.ym}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.ctrl}>
            <span className={styles.ctrlLabel}>Comparar:</span>
            <select className={styles.select} value={comparar} onChange={(e) => setComparar(e.target.value)} title={compararLabel}>
              <option value="auto">Melhor mês (auto)</option>
              {mesesOpcoes.map((m) => (
                <option key={m.ym} value={m.ym} disabled={m.ym === mes}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {tab === "principal" && (
        <PrincipalTab
          data={principal}
          loading={principalLoading}
          error={principalError}
          onGoTab={setTab}
          comparacaoProdutos={comparacao}
          comparacaoLoading={comparacaoLoading}
          isRede={isRede}
          hasEcommerce={hasEcommerce}
          timeline={timeline}
          analyzedYm={mes}
          onSetAnalisado={setMes}
          onSetComparacao={(ym) => setComparar(ym)}
        />
      )}
      {tab === "produtos" && (
        <ProdutosTab
          data={produtosEstoque}
          loading={produtosEstoqueLoading}
          anLabel={principal?.janela.analisadoLabel ?? ymLabel(mes)}
          compLabel={principal?.janela.comparacaoLabel ?? principal?.comparacao?.label ?? ""}
          isRede={isRede}
        />
      )}
      {tab === "vendedores" && (
        <VendedoresTab data={vendedores} loading={vendedoresLoading} analyzedYm={mes} />
      )}
      {tab === "rupturas" && (
        <RupturasTab data={rupturas} loading={rupturasLoading} mesLabel={ymLabel(mes)} isRede={isRede} />
      )}
    </div>
  );
}

// ── Linha do tempo (12 meses) ─────────────────────────────────────────────────

function Timeline({
  data,
  loading,
  analyzedYm,
  comparYm,
  comparAuto,
  onSetAnalisado,
  onSetComparacao,
  isRede,
  hasEcommerce,
}: {
  data: MesMetric[] | null;
  loading: boolean;
  analyzedYm: string;
  comparYm: string | null;
  comparAuto: boolean;
  onSetAnalisado: (ym: string) => void;
  onSetComparacao: (ym: string) => void;
  isRede: boolean;
  hasEcommerce: boolean;
}) {
  const { theme } = useTheme();
  const [menu, setMenu] = useState<{ ym: string; label: string; x: number; y: number } | null>(null);
  const c =
    theme === "dark"
      ? { grid: "rgba(148,163,184,0.16)", axisText: "#94a3b8", bar: "#3b4a63", tooltipBg: "#1a2433", tooltipBorder: "#29344b", tooltipText: "#cbd5e1" }
      : { grid: "#e2e8f0", axisText: "#64748b", bar: "#cbd5e1", tooltipBg: "#fff", tooltipBorder: "#e2e8f0", tooltipText: "#334155" };
  const COMPAR = "#22c55e";
  const ANALYZED = "#2563eb";

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>
          Faturamento {isRede ? "da rede" : "da loja"} — últimos 12 meses
          {isRede && hasEcommerce && <span className={styles.sectionHint}> · varejo, sem e-commerce</span>}
        </h2>
        <div className={styles.legend}>
          <span><i className={styles.dot} style={{ background: ANALYZED }} /> Mês analisado</span>
          <span>
            <i className={styles.dot} style={{ background: COMPAR }} /> {comparAuto ? "Melhor mês" : "Comparação"}
          </span>
        </div>
      </div>
      {loading && !data && <div className={styles.skeleton} style={{ height: 260 }} />}
      {data && (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
            <XAxis dataKey="label" tick={{ fill: c.axisText, fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis
              tick={{ fill: c.axisText, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`)}
              width={44}
            />
            <Tooltip
              cursor={{ fill: "rgba(37,99,235,0.06)" }}
              contentStyle={{ background: c.tooltipBg, border: `1px solid ${c.tooltipBorder}`, borderRadius: 8, color: c.tooltipText }}
              formatter={(value: number, _n, p) => {
                const row = p?.payload as MesMetric;
                return [
                  `${fmtCurrency(value)}  ·  ${fmtNum(row.tickets)} tickets  ·  ${fmtCurrency(row.ticketMedio)} tm`,
                  "Faturamento",
                ];
              }}
              labelStyle={{ color: c.tooltipText }}
            />
            <Bar
              dataKey="faturamento"
              radius={[4, 4, 0, 0]}
              cursor="pointer"
              onClick={(d, _i, e) => {
                const row = (d as { payload?: MesMetric })?.payload ?? (d as unknown as MesMetric);
                const ev = e as unknown as { clientX?: number; clientY?: number } | undefined;
                if (row?.ym) {
                  setMenu({ ym: row.ym, label: row.label, x: ev?.clientX ?? 0, y: ev?.clientY ?? 0 });
                }
              }}
            >
              {data.map((m) => (
                <Cell
                  key={m.ym}
                  fill={m.ym === analyzedYm ? ANALYZED : m.ym === comparYm ? COMPAR : c.bar}
                  fillOpacity={m.parcial ? 0.5 : 1}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
      {data?.some((m) => m.parcial) && (
        <p className={styles.timelineNote}>
          A barra mais clara é o mês atual (parcial — dados só até hoje). Na comparação, os meses são
          alinhados pela mesma faixa de dias.
        </p>
      )}

      {menu && (
        <>
          <div className={styles.menuOverlay} onClick={() => setMenu(null)} aria-hidden="true" />
          <div
            className={styles.barMenu}
            style={{ left: Math.min(menu.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 220), top: menu.y + 8 }}
            role="menu"
          >
            <div className={styles.barMenuHead}>{menu.label}</div>
            <button
              type="button"
              className={styles.barMenuItem}
              onClick={() => { onSetAnalisado(menu.ym); setMenu(null); }}
            >
              <i className={styles.dot} style={{ background: ANALYZED }} /> Definir como mês analisado
            </button>
            <button
              type="button"
              className={styles.barMenuItem}
              onClick={() => { onSetComparacao(menu.ym); setMenu(null); }}
            >
              <i className={styles.dot} style={{ background: COMPAR }} /> Definir como comparação
            </button>
          </div>
        </>
      )}
    </section>
  );
}

// ── Aba Diagnóstico ────────────────────────────────────────────────────────────

function PrincipalTab({
  data,
  loading,
  error,
  onGoTab,
  comparacaoProdutos,
  comparacaoLoading,
  isRede,
  hasEcommerce,
  timeline,
  analyzedYm,
  onSetAnalisado,
  onSetComparacao,
}: {
  data: PrincipalData | null;
  loading: boolean;
  error: string | null;
  onGoTab: (t: Tab) => void;
  comparacaoProdutos: ComparacaoData | null;
  comparacaoLoading: boolean;
  isRede: boolean;
  hasEcommerce: boolean;
  timeline: MesMetric[] | null;
  analyzedYm: string;
  onSetAnalisado: (ym: string) => void;
  onSetComparacao: (ym: string) => void;
}) {
  if (error) return <div className={styles.errorBox}>{error}</div>;
  if (loading && !data) return <div className={styles.skeleton} style={{ height: 420 }} />;
  if (!data || !data.analyzed) return <div className={styles.empty}>Sem dados para o mês selecionado.</div>;

  const { analyzed, comparacao, comparacaoAuto, isMesmo, janela, decomposicao, vendedoresResumo } = data;
  const anLabel = janela.analisadoLabel;
  const compLabel = janela.comparacaoLabel ?? comparacao?.label ?? "";
  const atendimentosDomina =
    !!decomposicao && Math.abs(decomposicao.porAtendimentos) >= Math.abs(decomposicao.porTicketMedio);
  const refDescr = comparacaoAuto ? `o melhor mês ${isRede ? "da rede" : "da loja"}` : compLabel;
  const acimaDaRef = !!(comparacao && analyzed.faturamento > comparacao.faturamento);

  const timelineEl = (
    <Timeline
      data={timeline}
      loading={loading}
      analyzedYm={analyzedYm}
      comparYm={comparacao?.ym ?? null}
      comparAuto={comparacaoAuto}
      onSetAnalisado={onSetAnalisado}
      onSetComparacao={onSetComparacao}
      isRede={isRede}
      hasEcommerce={hasEcommerce}
    />
  );

  // % e absolutos vs a comparação (mesma faixa de dias)
  const pctFat =
    comparacao && comparacao.faturamento > 0
      ? ((analyzed.faturamento - comparacao.faturamento) / comparacao.faturamento) * 100
      : null;

  return (
    <div className={styles.tabBody}>
      {/* Banner: janela + veredito (combinados, como no topo do relatório) */}
      {isMesmo ? (
        <div className={`${styles.banner} ${styles.bannerInfo}`}>
          <span>
            <strong>{anLabel} é o próprio mês de comparação.</strong> Escolha outro mês de comparação (no seletor ou
            clicando numa barra) para ver o que faltou.
          </span>
          <span className={styles.bannerTag}>Mesmo mês</span>
        </div>
      ) : acimaDaRef && decomposicao && comparacao ? (
        <div className={`${styles.banner} ${styles.bannerGood}`}>
          <span>
            Comparando <strong>{anLabel}</strong> vs <strong>{compLabel}</strong> — mesma faixa de dias.{" "}
            {anLabel} superou {refDescr} em <strong>{fmtCurrency(Math.abs(decomposicao.gap))}</strong>.
          </span>
          <span className={styles.bannerTag}>Acima da referência</span>
        </div>
      ) : (
        comparacao &&
        decomposicao && (
          <div className={`${styles.banner} ${styles.bannerAlert}`}>
            <span>
              Comparando <strong>{anLabel}</strong> vs <strong>{compLabel}</strong> — mesma faixa de dias. Faltam{" "}
              <strong className={styles.bannerNeg}>{fmtCurrency(decomposicao.gap)}</strong> para o faturamento igualar{" "}
              {refDescr}.
            </span>
            <span className={styles.bannerTag}>Gap identificado</span>
          </div>
        )
      )}

      {/* Faturamento — últimos 12 meses */}
      {timelineEl}

      {/* KPIs do mês analisado vs comparação (mesma faixa de dias) */}
      <div className={styles.kpiStrip}>
        <Kpi
          label={`Faturamento (${anLabel})`}
          value={fmtCurrency(analyzed.faturamento)}
          delta={pctFat != null ? deltaText(pctFat, "pct") : undefined}
          deltaTone={pctFat != null ? (pctFat >= 0 ? "pos" : "neg") : undefined}
          sub={comparacao ? `vs ${fmtCurrency(comparacao.faturamento)} (${compLabel})` : undefined}
        />
        <Kpi
          label="Tickets"
          value={fmtNum(analyzed.tickets)}
          delta={comparacao ? deltaText(analyzed.tickets - comparacao.tickets, "num") : undefined}
          deltaTone={comparacao ? (analyzed.tickets >= comparacao.tickets ? "pos" : "neg") : undefined}
          sub={comparacao ? `vs ${fmtNum(comparacao.tickets)} tickets` : undefined}
        />
        <Kpi
          label="Ticket médio"
          value={fmtCurrency(analyzed.ticketMedio)}
          delta={comparacao ? deltaText(analyzed.ticketMedio - comparacao.ticketMedio, "brl") : undefined}
          deltaTone={comparacao ? (analyzed.ticketMedio >= comparacao.ticketMedio ? "pos" : "neg") : undefined}
          sub={comparacao ? `vs ${fmtCurrency(comparacao.ticketMedio)}` : undefined}
        />
        <Kpi
          label="Peças vendidas"
          value={fmtNum(analyzed.quantidade)}
          delta={comparacao ? deltaText(analyzed.quantidade - comparacao.quantidade, "num") : undefined}
          deltaTone={comparacao ? (analyzed.quantidade >= comparacao.quantidade ? "pos" : "neg") : undefined}
          sub={comparacao ? `vs ${fmtNum(comparacao.quantidade)} unidades` : undefined}
        />
      </div>

      {/* Decomposição do gap (só quando o mês analisado está ABAIXO da comparação) */}
      {!isMesmo && !acimaDaRef && decomposicao && comparacao && (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h3 className={styles.sectionTitle}>
              Por que faltou {fmtCurrency(decomposicao.gap)}? — Decomposição do gap
            </h3>
          </div>
          <div className={styles.gapGrid}>
            <GapFactor
              titulo="Menos tickets (volume)"
              valor={decomposicao.porAtendimentos}
              gap={decomposicao.gap}
              dica={`${fmtNum(analyzed.tickets)} vs ${fmtNum(comparacao.tickets)} tickets — ${
                atendimentosDomina
                  ? "principal causa do gap."
                  : `${gapPct(decomposicao.porAtendimentos, decomposicao.gap)} da perda de faturamento.`
              }`}
            />
            <GapFactor
              titulo="Ticket médio menor (valor)"
              valor={decomposicao.porTicketMedio}
              gap={decomposicao.gap}
              dica={`${fmtCurrency(analyzed.ticketMedio)} vs ${fmtCurrency(comparacao.ticketMedio)} — ${
                !atendimentosDomina
                  ? "principal causa do gap."
                  : `${gapPct(decomposicao.porTicketMedio, decomposicao.gap)} da perda de faturamento.`
              }`}
            />
          </div>
        </section>
      )}

      {/* O que fez a diferença — 3 perguntas simples, clicáveis + reconciliação */}
      {!isMesmo && comparacao && (
        <>
          <DiferencaProdutos
            data={comparacaoProdutos}
            loading={comparacaoLoading}
            anLabel={anLabel}
            compLabel={compLabel}
            gapKpi={decomposicao?.gap ?? null}
            isRede={isRede}
            onGoTab={onGoTab}
          />

          {vendedoresResumo.ranking.length > 0 && (
            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <h3 className={styles.sectionTitle}>Quem vendeu — vendedores</h3>
                <span className={styles.sectionHint}>{anLabel} vs {compLabel}</span>
              </div>
              <div className={styles.tableWrap}>
                <table className={styles.dataTable}>
                  <thead>
                    <tr>
                      <th>Vendedor</th>
                      <th className={styles.num}>{compLabel}</th>
                      <th className={styles.num}>{anLabel}</th>
                      <th className={styles.num}>Diferença</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendedoresResumo.ranking.map((v) => (
                      <tr key={v.vendedor}>
                        <td className={styles.vendedorNome}>{v.vendedor}</td>
                        <td className={styles.num}>{fmtCurrency(v.comparacao)}</td>
                        <td className={styles.num}>{fmtCurrency(v.analisado)}</td>
                        <td className={`${styles.num} ${v.diff > 0 ? styles.diffNeg : v.diff < 0 ? styles.diffPos : ""}`}>
                          {v.diff > 0 ? "−" : v.diff < 0 ? "+" : ""}
                          {fmtCurrency(Math.abs(v.diff))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/** Texto de variação formatado com sinal (− real). */
function deltaText(diff: number, kind: "pct" | "num" | "brl"): string {
  const sinal = diff >= 0 ? "+" : "−";
  const abs = Math.abs(diff);
  if (kind === "pct") return `${sinal}${abs.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  if (kind === "brl") return `${sinal}${fmtCurrency(abs)}`;
  return `${sinal}${fmtNum(Math.round(abs))}`;
}

/** Percentual de um fator sobre o gap total (para o texto da decomposição). */
function gapPct(valor: number, gap: number): string {
  if (!gap) return "0%";
  return `${Math.round((Math.abs(valor) / Math.abs(gap)) * 100)}%`;
}

type Bucket = "ruptura" | "tinhaEstoque" | "cresceu";

/**
 * "O que fez a diferença — produtos": 3 perguntas simples e clicáveis (sem gráfico).
 * O número em destaque é a CONTAGEM de produtos; o valor é secundário; o detalhe
 * real por produto abre numa gaveta. A linha de reconciliação fecha com o gap dos KPIs.
 */
function DiferencaProdutos({
  data,
  loading,
  anLabel,
  compLabel,
  gapKpi,
  isRede,
  onGoTab,
}: {
  data: ComparacaoData | null;
  loading: boolean;
  anLabel: string;
  compLabel: string;
  gapKpi: number | null;
  isRede: boolean;
  onGoTab: (t: Tab) => void;
}) {
  const [aberto, setAberto] = useState<Bucket | null>(null);
  const toggle = (b: Bucket) => setAberto((cur) => (cur === b ? null : b));

  const gk = gapKpi ?? data?.gapProdutos ?? 0;
  const trocas = data ? Math.round((data.gapProdutos - gk) * 100) / 100 : 0;
  const netUs = -gk;

  return (
    <>
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h3 className={styles.sectionTitle}>O que fez a diferença — produtos</h3>
          <span className={styles.sectionHint}>clique para detalhar</span>
        </div>

        {loading && !data && <div className={styles.skeleton} style={{ height: 170 }} />}

        {data && (
          <>
            <div className={styles.perguntaGrid}>
              <PerguntaCard
                kind="ruptura"
                label="Faltou produto"
                count={data.rupturaCount}
                valor={data.rupturaFat}
                valorTone="neg"
                descricao={`Venderam no período comparado mas estão zerados hoje ${isRede ? "na rede" : "na loja"}.`}
                ativo={aberto === "ruptura"}
                onClick={() => toggle("ruptura")}
              />
              <PerguntaCard
                kind="tinha"
                label="Tinha estoque e vendeu menos"
                count={data.tinhaEstoqueCount}
                valor={data.tinhaEstoqueFat}
                valorTone="neg"
                descricao="Produtos com saldo que converteram abaixo do período de referência."
                ativo={aberto === "tinhaEstoque"}
                onClick={() => toggle("tinhaEstoque")}
              />
              <PerguntaCard
                kind="cresceu"
                label="Compensaram (venderam mais)"
                count={data.cresceuCount}
                valor={data.cresceuFat}
                valorTone="pos"
                descricao="Produtos que cresceram acima da referência."
                ativo={aberto === "cresceu"}
                onClick={() => toggle("cresceu")}
              />
            </div>

            {aberto === "ruptura" && (
              <ProdutoLista items={data.ruptura} total={data.rupturaCount} anLabel={anLabel} compLabel={compLabel} tipo="ruptura" isRede={isRede} onGoTab={onGoTab} />
            )}
            {aberto === "tinhaEstoque" && (
              <ProdutoLista items={data.tinhaEstoque} total={data.tinhaEstoqueCount} anLabel={anLabel} compLabel={compLabel} tipo="tinhaEstoque" isRede={isRede} onGoTab={onGoTab} />
            )}
            {aberto === "cresceu" && (
              <ProdutoLista items={data.cresceu} total={data.cresceuCount} anLabel={anLabel} compLabel={compLabel} tipo="cresceu" isRede={isRede} onGoTab={onGoTab} />
            )}
          </>
        )}
      </section>

      {data && (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h3 className={styles.sectionTitle}>Reconciliação</h3>
            <span className={styles.reconFecha}>
              <span className={styles.reconFechaLabel}>Fecha com</span>
              <span className={styles.reconFechaVal}>Diferença no faturamento total</span>
            </span>
          </div>
          <div className={styles.reconLineBox}>
            <span className={styles.diffNeg}>−{fmtCurrency(data.rupturaFat)}</span>
            <span className={styles.reconTag}>faltou</span>
            <span className={styles.diffNeg}>−{fmtCurrency(data.tinhaEstoqueFat)}</span>
            <span className={styles.reconTag}>vendeu menos</span>
            <span className={styles.diffPos}>+{fmtCurrency(data.cresceuFat)}</span>
            <span className={styles.reconTag}>cresceu</span>
            {Math.abs(trocas) > 1 && (
              <>
                <span className={trocas >= 0 ? styles.diffPos : styles.diffNeg}>
                  {trocas >= 0 ? "+" : "−"}
                  {fmtCurrency(Math.abs(trocas))}
                </span>
                <span className={styles.reconTag}>trocas/dev</span>
              </>
            )}
            <span className={styles.reconEq}>=</span>
            <strong className={netUs >= 0 ? styles.diffPos : styles.diffNeg}>
              {netUs >= 0 ? "+" : "−"}
              {fmtCurrency(Math.abs(gk))}
            </strong>
            <span className={styles.reconTag}>gap total</span>
          </div>
        </section>
      )}
    </>
  );
}

function PerguntaCard({
  kind,
  label,
  count,
  valor,
  valorTone,
  descricao,
  ativo,
  onClick,
}: {
  kind: "ruptura" | "tinha" | "cresceu";
  label: string;
  count: number;
  valor: number;
  valorTone: "neg" | "pos";
  descricao: string;
  ativo: boolean;
  onClick: () => void;
}) {
  const vazio = count === 0;
  const labelCls =
    kind === "ruptura" ? styles.pLabelRuptura : kind === "tinha" ? styles.pLabelTinha : styles.pLabelCresceu;
  return (
    <button
      type="button"
      className={`${styles.perguntaCard} ${ativo ? styles.perguntaCardAtivo : ""}`}
      onClick={onClick}
      disabled={vazio}
    >
      <div className={styles.perguntaHead}>
        <span className={`${styles.perguntaLabel} ${labelCls}`}>{label}</span>
        {!vazio && <span className={styles.perguntaDetalhar}>{ativo ? "Ocultar ▲" : "Detalhar →"}</span>}
      </div>
      <div className={styles.perguntaBig}>
        {count}
        <span className={styles.perguntaBigUnit}>SKUs</span>
      </div>
      <div className={styles.perguntaDesc}>{descricao}</div>
      <div className={`${styles.perguntaValor} ${valorTone === "neg" ? styles.diffNeg : styles.diffPos}`}>
        {valorTone === "neg" ? "−" : "+"}
        {fmtCurrency(valor)}
      </div>
    </button>
  );
}

function ProdutoLista({
  items,
  total,
  anLabel,
  compLabel,
  tipo,
  isRede,
  onGoTab,
}: {
  items: ComparacaoProdutoItem[];
  total: number;
  anLabel: string;
  compLabel: string;
  tipo: Bucket;
  isRede: boolean;
  onGoTab: (t: Tab) => void;
}) {
  if (items.length === 0) return <div className={styles.empty}>Nenhum produto neste grupo.</div>;
  const showEstoque = tipo !== "cresceu";
  return (
    <div className={styles.gaveta}>
      {total > items.length && (
        <p className={styles.gavetaHint}>Mostrando os {items.length} maiores de {total} produtos.</p>
      )}
      <div className={styles.tableWrap}>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th>Produto</th>
              <th>Cor</th>
              <th className={styles.num}>{compLabel}</th>
              <th className={styles.num}>{anLabel}</th>
              <th className={styles.num}>Diferença</th>
              {showEstoque && (
                <th
                  className={styles.num}
                  title="Saldo reconstruído no fim da janela analisada (ou estoque de hoje, no mês corrente)"
                >
                  Estoque no mês
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {items.map((p) => {
              const estMes = p.estoqueFimMesAnalisado ?? p.estoqueLoja;
              const cresceu = p.diffFat < 0;
              return (
                <tr key={`${p.produto}-${p.cor}`}>
                  <td>
                    <div className={styles.prodDesc}>{p.descricao || p.produto}</div>
                    <div className={styles.prodId}>{p.produto}</div>
                  </td>
                  <td>{p.corDescricao || p.cor || "—"}</td>
                  <td className={styles.num}>
                    <div>{fmtCurrency(p.fatComparacao)}</div>
                    <div className={styles.subQtd}>{fmtNum(p.qtdComparacao)} pç</div>
                  </td>
                  <td className={styles.num}>
                    <div>{fmtCurrency(p.fatAnalisado)}</div>
                    <div className={styles.subQtd}>{fmtNum(p.qtdAnalisado)} pç</div>
                  </td>
                  <td className={`${styles.num} ${cresceu ? styles.diffPos : styles.diffNeg}`}>
                    {cresceu ? "+" : "−"}
                    {fmtCurrency(Math.abs(p.diffFat))}
                  </td>
                  {showEstoque && (
                    <td className={`${styles.num} ${estMes <= 0 ? styles.zero : ""}`}>
                      <div>{estMes}</div>
                      {p.estoqueFimMesAnalisado != null && <div className={styles.subQtd}>hoje: {p.estoqueLoja}</div>}
                      {tipo === "ruptura" && !isRede && p.temNaRede && (
                        <button type="button" className={styles.redeLink} onClick={() => onGoTab("rupturas")}>
                          tem na rede →
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  delta,
  deltaTone,
  sub,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaTone?: "pos" | "neg";
  sub?: string;
}) {
  return (
    <div className={styles.kpi}>
      <span className={styles.kpiLabel}>{label}</span>
      <span className={styles.kpiValueRow}>
        <span className={styles.kpiValue}>{value}</span>
        {delta && (
          <span className={`${styles.kpiDelta} ${deltaTone === "pos" ? styles.diffPos : styles.diffNeg}`}>{delta}</span>
        )}
      </span>
      {sub && <span className={styles.kpiSub}>{sub}</span>}
    </div>
  );
}

function GapFactor({
  titulo,
  valor,
  gap,
  dica,
}: {
  titulo: string;
  valor: number;
  gap: number;
  dica: string;
}) {
  // valor > 0 = puxou o faturamento para baixo (perda); < 0 = ajudou.
  const perda = valor >= 0;
  const pct =
    gap !== 0 ? Math.max(0, Math.min(100, Math.round((Math.abs(valor) / Math.abs(gap)) * 100))) : 0;
  return (
    <div className={styles.gapFactor}>
      <div className={styles.gapFactorTop}>
        <span className={styles.gapFactorNome}>{titulo}</span>
        <strong className={perda ? styles.diffNeg : styles.diffPos}>
          {perda ? "−" : "+"} {fmtCurrency(Math.abs(valor))}
        </strong>
      </div>
      <div className={styles.gapBar}>
        <div
          className={`${styles.gapBarFill} ${perda ? styles.gapBarNeg : styles.gapBarPos}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={styles.gapDica}>{dica}</span>
    </div>
  );
}

// ── Aba Vendedores (matriz) ────────────────────────────────────────────────────

function VendedoresTab({
  data,
  loading,
  analyzedYm,
}: {
  data: VendedoresData | null;
  loading: boolean;
  analyzedYm: string;
}) {
  if (loading && !data) return <div className={styles.skeleton} style={{ height: 320 }} />;
  if (!data || data.vendedores.length === 0)
    return <div className={styles.empty}>Sem vendas de vendedores nesta loja (e-commerce não tem vendedor por item).</div>;

  const maxValor = Math.max(1, ...data.vendedores.flatMap((v) => Object.values(v.porMes).map((c) => c.valor)));

  const heat = (valor: number) => {
    if (valor <= 0) return "transparent";
    const t = Math.min(1, valor / maxValor);
    return `rgba(37, 99, 235, ${0.08 + t * 0.5})`;
  };

  const now = new Date();
  const nowYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  return (
    <div className={styles.tabBody}>
      <p className={styles.intro}>
        Faturamento por vendedor, mês a mês (meses completos). O mês atual ({ymLabel(nowYm)}) está parcial —
        dados só até hoje.
      </p>
      <div className={styles.matrizScroll}>
        <table className={styles.matriz}>
          <thead>
            <tr>
              <th className={styles.matrizNome}>Vendedor</th>
              {data.meses.map((ym) => (
                <th key={ym} className={ym === analyzedYm ? styles.matrizColHi : ""}>
                  {ymLabel(ym)}
                </th>
              ))}
              <th className={styles.matrizTotal}>Total</th>
            </tr>
          </thead>
          <tbody>
            {data.vendedores.map((v) => (
              <tr key={v.vendedor}>
                <td className={styles.matrizNome}>{v.vendedor}</td>
                {data.meses.map((ym) => {
                  const cell = v.porMes[ym];
                  const valor = cell?.valor ?? 0;
                  return (
                    <td
                      key={ym}
                      className={`${styles.matrizCell} ${ym === analyzedYm ? styles.matrizColHi : ""}`}
                      style={{ background: heat(valor) }}
                      title={cell ? `${fmtCurrency(valor)} · ${fmtNum(cell.qtd)} pç` : "—"}
                    >
                      {valor > 0 ? (
                        <>
                          <span className={styles.cellVal}>{fmtCurrency(valor)}</span>
                          <span className={styles.cellQtd}>{fmtNum(cell!.qtd)} pç</span>
                        </>
                      ) : (
                        <span className={styles.cellZero}>—</span>
                      )}
                    </td>
                  );
                })}
                <td className={styles.matrizTotal}>{fmtCurrency(v.totalValor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Aba Produtos (vendas antes × depois + estoque hoje) ──────────────────────────

function fmtAcabaEm(dias: number | null): { texto: string; cls: string } {
  if (dias == null) return { texto: "sem giro", cls: styles.acabaMuted };
  if (dias <= 0) return { texto: "esgotado", cls: styles.acabaCrit };
  if (dias <= 7) return { texto: `${dias} dias`, cls: styles.acabaCrit };
  if (dias <= 15) return { texto: `${dias} dias`, cls: styles.acabaWarn };
  if (dias > 180) return { texto: "+180 dias", cls: styles.acabaOk };
  return { texto: `${dias} dias`, cls: styles.acabaOk };
}

function ProdutosTab({
  data,
  loading,
  anLabel,
  compLabel,
  isRede,
}: {
  data: ProdutosEstoqueData | null;
  loading: boolean;
  anLabel: string;
  compLabel: string;
  isRede: boolean;
}) {
  if (loading && !data) return <div className={styles.skeleton} style={{ height: 320 }} />;
  if (!data) return <div className={styles.empty}>Selecione um mês de comparação para ver os produtos.</div>;
  if (data.semEstoque.length === 0 && data.comEstoque.length === 0)
    return <div className={styles.empty}>Nenhum produto vendido nas janelas comparadas.</div>;

  return (
    <div className={styles.tabBody}>
      <p className={styles.intro}>
        Produtos que venderam em <strong>{compLabel}</strong> (antes) e/ou <strong>{anLabel}</strong> (depois),
        com o estoque de hoje {isRede ? "na rede" : "na loja"} e em quantos dias ele acaba no ritmo recente.
        {data.truncado && " Lista grande: mostrando os principais de cada grupo (sem estoque = mais vendidos; com estoque = os que acabam antes)."}
      </p>
      <ProdutoEstoqueSecao
        titulo="Produtos vendidos SEM estoque"
        subtitulo="venderam no período mas estão zerados hoje — venda perdida até repor"
        items={data.semEstoque}
        anLabel={anLabel}
        compLabel={compLabel}
        warn
      />
      <ProdutoEstoqueSecao
        titulo="Produtos vendidos COM estoque"
        subtitulo="têm saldo hoje — 'acaba em' indica a urgência de reposição"
        items={data.comEstoque}
        anLabel={anLabel}
        compLabel={compLabel}
      />
    </div>
  );
}

function ProdutoEstoqueSecao({
  titulo,
  subtitulo,
  items,
  anLabel,
  compLabel,
  warn = false,
}: {
  titulo: string;
  subtitulo: string;
  items: ProdutoVendaEstoqueItem[];
  anLabel: string;
  compLabel: string;
  warn?: boolean;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h3 className={`${styles.sectionTitle} ${warn ? styles.sectionTitleWarn : styles.sectionTitleOk}`}>
          {titulo} <span className={styles.secaoCount}>— {items.length}</span>
        </h3>
        <span className={styles.sectionHint}>{subtitulo}</span>
      </div>
      {items.length === 0 ? (
        <div className={styles.empty}>Nenhum produto neste grupo.</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.dataTable}>
            <thead>
              <tr>
                <th>Produto</th>
                <th>Cor</th>
                <th className={styles.num}>Vendas antes ({compLabel})</th>
                <th className={styles.num}>Vendas depois ({anLabel})</th>
                <th className={styles.num}>Estoque</th>
                <th className={styles.num} title="Dias até acabar no ritmo recente de venda">
                  Acaba em
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => {
                const acaba = fmtAcabaEm(p.acabaEmDias);
                return (
                  <tr key={`${p.produto}-${p.cor}`}>
                    <td>
                      <div className={styles.prodDesc}>{p.descricao || p.produto}</div>
                      <div className={styles.prodId}>{p.produto}</div>
                    </td>
                    <td>{p.corDescricao || p.cor || "—"}</td>
                    <td className={styles.num}>
                      <div>{fmtNum(p.qtdAntes)} pç</div>
                      <div className={styles.subQtd}>{fmtCurrency(p.fatAntes)}</div>
                    </td>
                    <td className={styles.num}>
                      <div>{fmtNum(p.qtdDepois)} pç</div>
                      <div className={styles.subQtd}>{fmtCurrency(p.fatDepois)}</div>
                    </td>
                    <td className={`${styles.num} ${p.estoque <= 0 ? styles.zero : ""}`}>{fmtNum(p.estoque)}</td>
                    <td className={`${styles.num} ${acaba.cls}`}>{acaba.texto}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── Aba Rupturas ───────────────────────────────────────────────────────────────

function RupturasTab({
  data,
  loading,
  mesLabel,
  isRede,
}: {
  data: RupturaItem[] | null;
  loading: boolean;
  mesLabel: string;
  isRede: boolean;
}) {
  const escopo = isRede ? "na rede" : "nesta loja";
  if (loading && !data) return <div className={styles.skeleton} style={{ height: 320 }} />;
  if (!data) return null;
  if (data.length === 0)
    return <div className={styles.empty}>Nenhuma ruptura em {mesLabel}: os produtos que venderam têm estoque {escopo}. 🎉</div>;

  return (
    <div className={styles.tabBody}>
      <p className={styles.intro}>
        <strong>{data.length} produtos</strong> venderam em {mesLabel} e estão zerados {escopo} — do maior faturamento ao menor.
      </p>
      <div className={styles.tableWrap}>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th>Produto</th>
              <th>Cor</th>
              <th className={styles.num}>Vendeu</th>
              <th className={styles.num}>Faturou</th>
              <th className={styles.num}>Estoque {isRede ? "rede" : "loja"}</th>
              <th>Onde tem estoque</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={`${r.produto}-${r.cor}`}>
                <td>
                  <div className={styles.prodDesc}>{r.descricao || r.produto}</div>
                  <div className={styles.prodId}>{r.produto}</div>
                </td>
                <td>{r.corDescricao || r.cor || "—"}</td>
                <td className={styles.num}>{fmtNum(r.qtdVendida)}</td>
                <td className={`${styles.num} ${styles.fat}`}>{fmtCurrency(r.faturamento)}</td>
                <td className={`${styles.num} ${styles.zero}`}>{r.estoqueLoja}</td>
                <td>
                  {r.ondeTemEstoque.length === 0 ? (
                    <span className={styles.semRede}>Zerado em toda a rede</span>
                  ) : (
                    <div className={styles.chips}>
                      {r.ondeTemEstoque.map((f) => (
                        <span key={f.filial} className={styles.chip}>
                          {f.filial} <strong>{fmtNum(f.estoque)}</strong>
                        </span>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
