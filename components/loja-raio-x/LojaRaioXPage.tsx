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
import CompraIdealCell from "@/components/shared/CompraIdealCell";
import { useTheme } from "@/components/theme/ThemeContext";
import { useAuth } from "@/components/auth/AuthContext";
import { canSeeCusto } from "@/lib/auth/permissions";
import { compareFilialDisplayOrder, resolveCompany, type CompanyKey } from "@/lib/config/company";
import type { CompraIdealResult } from "@/lib/utils/compra-ideal";
import { exportLojaRaioXXlsx, exportRupturasXlsx } from "@/lib/utils/exportLojaRaioXXlsx";
import { exportCompraPorLojaXlsx, type CompraLojaExportColumn } from "@/lib/utils/exportCompraSugeridaAbcXlsx";
import { productMatchesFornecedor, type Fornecedor } from "@/lib/utils/fornecedor-matcher";

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
  subgrupo: string | null;
  grade: string | null;
  descontinuado: boolean;
  emTransito: boolean;
  transitoQtd: number;
  transitoData: string | null;
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
  subgrupo: string | null;
  grade: string | null;
  descontinuado: boolean;
  emTransito: boolean;
  transitoQtd: number;
  transitoData: string | null;
  qtdVendida: number;
  faturamento: number;
  estoqueLoja: number;
  estoqueRede: number;
  ondeTemEstoque: Array<{ filial: string; estoque: number }>;
  /** Compra Ideal (regra global, igual à Curva ABC). null quando é a soma da rede. */
  compraIdeal: CompraIdealResult | null;
  compraIdealQtd: number;
  compraIdealStatus: "REPOR" | "OK" | "EXCESSO" | null;
  compraIdealTransito: number;
  custoUnitario: number;
}

interface ProdutoVendaEstoqueItem {
  produto: string;
  cor: string;
  corDescricao: string;
  descricao: string;
  subgrupo: string | null;
  grade: string | null;
  descontinuado: boolean;
  emTransito: boolean;
  transitoQtd: number;
  transitoData: string | null;
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
/** "2026-07-20" → "20/07". Vazio se inválido. */
function shortDate(iso: string | null): string {
  if (!iso) return "";
  const [, m, d] = iso.split("-");
  return m && d ? `${d}/${m}` : "";
}

/** Item que carrega os sinais de badge (descontinuado + trânsito). */
interface BadgeInfo {
  descontinuado: boolean;
  emTransito: boolean;
  transitoQtd: number;
  transitoData: string | null;
}

/**
 * Badges do produto: "Descontinuado" (sempre que marcado na tela Produtos
 * Descontinuados) e "Em trânsito" (só onde `showTransito`, ex.: itens em ruptura —
 * pra saber que já estão a caminho).
 */
function ProdBadges({ item, showTransito }: { item: BadgeInfo; showTransito?: boolean }) {
  const transito = !!showTransito && item.emTransito;
  if (!item.descontinuado && !transito) return null;
  const transitoTitle = transito
    ? `Compra em trânsito${item.transitoQtd > 0 ? ` · ${fmtNum(item.transitoQtd)} un` : ""}${
        item.transitoData ? ` · chega ${shortDate(item.transitoData)}` : ""
      }`
    : undefined;
  return (
    <div className={styles.prodBadges}>
      {item.descontinuado && (
        <span className={`${styles.badge} ${styles.badgeDescontinuado}`}>Descontinuado</span>
      )}
      {transito && (
        <span className={`${styles.badge} ${styles.badgeTransito}`} title={transitoTitle}>
          Em trânsito
          {item.transitoQtd > 0 ? ` +${fmtNum(item.transitoQtd)}` : ""}
          {item.transitoData ? ` · ${shortDate(item.transitoData)}` : ""}
        </span>
      )}
    </div>
  );
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

  const [exporting, setExporting] = useState(false);

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
  // ScarfMe exige subgrupo + grade em todo item de produto (grade só existe p/ scarfme).
  const showGradeSubgrupo = companyKey === "scarfme";

  // Está carregando ALGO relevante para a aba atual? (inclui recargas com dados na tela).
  const busy =
    tab === "principal"
      ? principalLoading || comparacaoLoading
      : tab === "produtos"
        ? produtosEstoqueLoading
        : tab === "vendedores"
          ? vendedoresLoading
          : rupturasLoading;

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

  async function handleExport() {
    if (exporting) return;
    setExporting(true);
    try {
      const filialLabel = filial
        ? (resolveCompany(companyKey)?.filialDisplayNames?.[filial] ?? filial)
        : null;
      await exportLojaRaioXXlsx({ companyKey, filial, mes, comparar, isRede, filialLabel });
    } catch (err) {
      alert((err as Error).message || "Erro ao exportar XLSX");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className={styles.wrapper}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <h1 className={styles.title}>Loja Raio X</h1>
          <span className={styles.brandSub}>
            {isRede ? "Rede — todas as lojas" : "loja selecionada"}
            {isRede && hasEcommerce ? " · varejo" : ""}
          </span>
          <LoadingCue active={busy} />
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
          <button type="button" className={styles.exportBtn} onClick={handleExport} disabled={exporting}>
            {exporting ? "Exportando…" : "Exportar XLSX"}
          </button>
        </div>
      </header>

      <div className={`${styles.content} ${busy ? styles.contentBusy : ""}`} aria-busy={busy}>
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
          showGradeSubgrupo={showGradeSubgrupo}
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
          showGradeSubgrupo={showGradeSubgrupo}
        />
      )}
      {tab === "vendedores" && (
        <VendedoresTab data={vendedores} loading={vendedoresLoading} analyzedYm={mes} />
      )}
      {tab === "rupturas" && (
        <RupturasTab
          data={rupturas}
          loading={rupturasLoading}
          mes={mes}
          mesLabel={ymLabel(mes)}
          isRede={isRede}
          showGradeSubgrupo={showGradeSubgrupo}
          companyKey={companyKey}
          filial={filial}
          filialLabel={filial ? (resolveCompany(companyKey)?.filialDisplayNames?.[filial] ?? filial) : null}
        />
      )}
      </div>
    </div>
  );
}

/** Cue de carregamento no cabeçalho — spinner + texto, some sem saltar layout. */
function LoadingCue({ active }: { active: boolean }) {
  return (
    <span
      className={`${styles.loadingCue} ${active ? styles.loadingCueActive : ""}`}
      role="status"
      aria-hidden={!active}
    >
      <span className={styles.spinner} aria-hidden="true" />
      Carregando dados…
    </span>
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
      ? { grid: "rgba(255,255,255,0.06)", axisText: "#8b95a6", bar: "#4d7fff", tooltipBg: "#1b1f2a", tooltipBorder: "rgba(255,255,255,0.1)", tooltipText: "#cfd6e2" }
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
  showGradeSubgrupo,
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
  showGradeSubgrupo: boolean;
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
          label="Gap"
          value={decomposicao ? fmtCurrency(Math.abs(decomposicao.gap)) : "—"}
          delta={decomposicao ? (decomposicao.gap <= 0 ? "+" : "−") : undefined}
          deltaTone={decomposicao ? (decomposicao.gap <= 0 ? "pos" : "neg") : undefined}
          sub={
            decomposicao
              ? decomposicao.gap <= 0
                ? `acima de ${refDescr}`
                : `para igualar ${refDescr}`
              : undefined
          }
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

      {/* O que fez a diferença — 3 perguntas simples, clicáveis */}
      {!isMesmo && comparacao && (
        <>
          <DiferencaProdutos
            data={comparacaoProdutos}
            loading={comparacaoLoading}
            anLabel={anLabel}
            compLabel={compLabel}
            isRede={isRede}
            showGradeSubgrupo={showGradeSubgrupo}
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
 * real por produto abre numa gaveta.
 */
function DiferencaProdutos({
  data,
  loading,
  anLabel,
  compLabel,
  isRede,
  showGradeSubgrupo,
  onGoTab,
}: {
  data: ComparacaoData | null;
  loading: boolean;
  anLabel: string;
  compLabel: string;
  isRede: boolean;
  showGradeSubgrupo: boolean;
  onGoTab: (t: Tab) => void;
}) {
  const [aberto, setAberto] = useState<Bucket | null>(null);
  const toggle = (b: Bucket) => setAberto((cur) => (cur === b ? null : b));

  return (
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
            <ProdutoLista items={data.ruptura} total={data.rupturaCount} anLabel={anLabel} compLabel={compLabel} tipo="ruptura" isRede={isRede} showGradeSubgrupo={showGradeSubgrupo} onGoTab={onGoTab} />
          )}
          {aberto === "tinhaEstoque" && (
            <ProdutoLista items={data.tinhaEstoque} total={data.tinhaEstoqueCount} anLabel={anLabel} compLabel={compLabel} tipo="tinhaEstoque" isRede={isRede} showGradeSubgrupo={showGradeSubgrupo} onGoTab={onGoTab} />
          )}
          {aberto === "cresceu" && (
            <ProdutoLista items={data.cresceu} total={data.cresceuCount} anLabel={anLabel} compLabel={compLabel} tipo="cresceu" isRede={isRede} showGradeSubgrupo={showGradeSubgrupo} onGoTab={onGoTab} />
          )}
        </>
      )}
    </section>
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
  showGradeSubgrupo,
  onGoTab,
}: {
  items: ComparacaoProdutoItem[];
  total: number;
  anLabel: string;
  compLabel: string;
  tipo: Bucket;
  isRede: boolean;
  showGradeSubgrupo: boolean;
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
              {showGradeSubgrupo && <th>Subgrupo</th>}
              {showGradeSubgrupo && <th>Grade</th>}
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
                    <ProdBadges item={p} showTransito={tipo === "ruptura"} />
                  </td>
                  <td>{p.corDescricao || p.cor || "—"}</td>
                  {showGradeSubgrupo && <td>{p.subgrupo || "—"}</td>}
                  {showGradeSubgrupo && <td>{p.grade || "—"}</td>}
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
  showGradeSubgrupo,
}: {
  data: ProdutosEstoqueData | null;
  loading: boolean;
  anLabel: string;
  compLabel: string;
  isRede: boolean;
  showGradeSubgrupo: boolean;
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
        showGradeSubgrupo={showGradeSubgrupo}
        warn
      />
      <ProdutoEstoqueSecao
        titulo="Produtos vendidos COM estoque"
        subtitulo="têm saldo hoje — 'acaba em' indica a urgência de reposição"
        items={data.comEstoque}
        anLabel={anLabel}
        compLabel={compLabel}
        showGradeSubgrupo={showGradeSubgrupo}
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
  showGradeSubgrupo,
  warn = false,
}: {
  titulo: string;
  subtitulo: string;
  items: ProdutoVendaEstoqueItem[];
  anLabel: string;
  compLabel: string;
  showGradeSubgrupo: boolean;
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
                {showGradeSubgrupo && <th>Subgrupo</th>}
                {showGradeSubgrupo && <th>Grade</th>}
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
                      <ProdBadges item={p} showTransito={warn} />
                    </td>
                    <td>{p.corDescricao || p.cor || "—"}</td>
                    {showGradeSubgrupo && <td>{p.subgrupo || "—"}</td>}
                    {showGradeSubgrupo && <td>{p.grade || "—"}</td>}
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

/**
 * Célula de Compra Ideal na aba Rupturas. Numa loja específica reusa o CompraIdealCell
 * global (mesmo número + tooltip da Curva ABC); na visão REDE mostra a SOMA da necessidade
 * por loja (não há um único resumo/tooltip), com o mesmo visual "N pcs" / "Suficiente".
 */
function RupturaCompraIdeal({ item, companyKey }: { item: RupturaItem; companyKey: CompanyKey }) {
  // Descontinuado nunca sugere compra — mesma regra da Curva ABC. Só o texto; fica fora do export.
  if (item.descontinuado) {
    return <span className={styles.acabaMuted} style={{ fontStyle: "italic", fontWeight: 600 }}>Descontinuado</span>;
  }
  if (item.compraIdeal) {
    return (
      <CompraIdealCell
        ideal={item.compraIdeal}
        company={companyKey}
        descricao={item.descricao || item.produto}
        cor={item.corDescricao || item.cor}
      />
    );
  }
  // Rede: soma por loja (sem tooltip).
  if (item.compraIdealStatus == null) return <span className={styles.acabaMuted}>—</span>;
  const repor = item.compraIdealStatus === "REPOR";
  return (
    <span className={styles.compraIdealRede} title="Soma da necessidade de compra de todas as lojas da rede">
      <span className={repor ? styles.compraIdealRepor : styles.compraIdealSuficiente}>
        {repor ? `${fmtNum(item.compraIdealQtd)} pcs` : "Suficiente"}
      </span>
      {item.compraIdealTransito > 0 && (
        <span className={styles.compraIdealTransito}>T {fmtNum(item.compraIdealTransito)}</span>
      )}
    </span>
  );
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      results[i] = await mapper(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Loja-alvo do export: nome canônico (param `filial` da API) + rótulo de exibição (cabeçalho da coluna). */
interface FilialExportTarget {
  filial: string;
  label: string;
}

function buildRupturaKey(produto: string, cor: string | null | undefined): string {
  return `${produto}||${(cor ?? "").trim().toUpperCase()}`;
}

/**
 * Monta as linhas do export "Rupturas por Loja": une TODAS as rupturas de TODAS as lojas
 * numa lista só (um item que zerou em qualquer loja aparece), com uma coluna por loja
 * contendo a Compra Ideal daquela loja para aquele item (mesma regra/fonte da aba —
 * `fetchRupturasLoja` com `withCompraIdeal`, já usada na Curva ABC/Lista Loja/Compra Ideal).
 * Vendas/faturamento somam entre as lojas onde o item é ruptura (total de rede visível).
 * Descontinuado nunca sugere compra e fica fora do export (mesma regra do botão simples).
 */
async function buildRupturasPorFilialRows(
  companyKey: string,
  mes: string,
  filiais: FilialExportTarget[],
  fornecedorFiltro: { id: string; fornecedores: Fornecedor[] } | null,
  onFilialDone?: () => void
): Promise<{ rows: Array<Record<string, string | number | boolean | null>>; colunasFiliais: string[] }> {
  const seenLabel = new Map<string, number>();
  const colunasFiliais = filiais.map((f) => {
    const base = f.label;
    const count = seenLabel.get(base) ?? 0;
    seenLabel.set(base, count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });

  const porFilial = await mapWithConcurrency(filiais, 3, async (f) => {
    try {
      const params = new URLSearchParams({ company: companyKey, filial: f.filial, mes, section: "rupturas" });
      const res = await fetch(`/api/loja-raio-x?${params}`, { cache: "no-store" });
      if (!res.ok) return [] as RupturaItem[];
      const json = (await res.json()) as { data?: RupturaItem[] };
      return json.data ?? [];
    } catch {
      return [] as RupturaItem[];
    } finally {
      onFilialDone?.();
    }
  });

  interface Aggregated {
    produto: string;
    cor: string;
    corDescricao: string;
    descricao: string;
    subgrupo: string | null;
    grade: string | null;
    descontinuado: boolean;
    qtdVendida: number;
    faturamento: number;
    estoqueRede: number;
    custoUnitario: number;
    porFilialQtd: number[];
  }
  const map = new Map<string, Aggregated>();

  porFilial.forEach((items, idx) => {
    for (const r of items) {
      const key = buildRupturaKey(r.produto, r.cor);
      let agg = map.get(key);
      if (!agg) {
        agg = {
          produto: r.produto,
          cor: r.cor,
          corDescricao: r.corDescricao,
          descricao: r.descricao,
          subgrupo: r.subgrupo,
          grade: r.grade,
          descontinuado: r.descontinuado,
          qtdVendida: 0,
          faturamento: 0,
          estoqueRede: r.estoqueRede,
          custoUnitario: 0,
          porFilialQtd: new Array(filiais.length).fill(0),
        };
        map.set(key, agg);
      }
      agg.qtdVendida += r.qtdVendida;
      agg.faturamento += r.faturamento;
      agg.estoqueRede = Math.max(agg.estoqueRede, r.estoqueRede);
      agg.custoUnitario = Math.max(agg.custoUnitario, r.custoUnitario);
      agg.descontinuado = agg.descontinuado || r.descontinuado;
      agg.porFilialQtd[idx] = r.descontinuado ? 0 : Math.max(0, r.compraIdealQtd ?? 0);
    }
  });

  let aggregados = Array.from(map.values()).filter((a) => !a.descontinuado);
  if (fornecedorFiltro) {
    aggregados = aggregados.filter((a) =>
      productMatchesFornecedor(fornecedorFiltro.fornecedores, fornecedorFiltro.id, {
        produto: a.produto,
        cor: a.cor,
        descricao: a.descricao,
      })
    );
  }

  const rows = aggregados
    .sort((a, b) => b.faturamento - a.faturamento)
    .map((agg) => {
      const row: Record<string, string | number | boolean | null> = {
        PRODUTO: agg.produto,
        DESCRICAO: agg.descricao || agg.produto,
        COR_DESCRICAO: agg.corDescricao || agg.cor || "",
        SUBGRUPO: agg.subgrupo?.trim() || "",
        GRADE: agg.grade?.trim() || "",
        CUSTO_UNIT: Math.round(agg.custoUnitario * 100) / 100,
        VENDAS_PERIODO: Math.round(agg.faturamento * 100) / 100,
        QTDE_PERIODO: agg.qtdVendida,
        ESTOQUE_REDE: agg.estoqueRede,
      };
      let totalRede = 0;
      filiais.forEach((_, idx) => {
        const qtd = agg.porFilialQtd[idx] ?? 0;
        row[colunasFiliais[idx]] = qtd;
        totalRede += qtd;
      });
      row["TOTAL REDE"] = totalRede;
      row.CUSTO_TOTAL = Math.round((Number(row.CUSTO_UNIT) || 0) * totalRede * 100) / 100;
      return row;
    });

  return { rows, colunasFiliais };
}

function RupturasTab({
  data,
  loading,
  mes,
  mesLabel,
  isRede,
  showGradeSubgrupo,
  companyKey,
  filial,
  filialLabel,
}: {
  data: RupturaItem[] | null;
  loading: boolean;
  mes: string;
  mesLabel: string;
  isRede: boolean;
  showGradeSubgrupo: boolean;
  companyKey: CompanyKey;
  filial: string | null;
  filialLabel: string | null;
}) {
  const [soZeradoRede, setSoZeradoRede] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [porFilialProgresso, setPorFilialProgresso] = useState<{ feito: number; total: number } | null>(null);
  const { user } = useAuth();
  const podeVerCusto = canSeeCusto(user);
  const escopo = isRede ? "na rede" : "nesta loja";

  // Filtro por grupo de fornecedor (só NERD) — mesma lógica da Curva ABC.
  const [fornecedorFiltro, setFornecedorFiltro] = useState<string>("");
  const [fornecedoresOpts, setFornecedoresOpts] = useState<Fornecedor[]>([]);
  useEffect(() => {
    if (companyKey !== "nerd") {
      setFornecedoresOpts([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/fornecedores?company=nerd`, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { data: Fornecedor[] };
        if (!cancelled) setFornecedoresOpts(json.data ?? []);
      } catch {
        // silencioso
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyKey]);

  if (loading && !data) return <div className={styles.skeleton} style={{ height: 320 }} />;
  if (!data) return null;
  if (data.length === 0)
    return <div className={styles.empty}>Nenhuma ruptura em {mesLabel}: os produtos que venderam têm estoque {escopo}. 🎉</div>;

  const dataFiltrada =
    companyKey === "nerd" && fornecedorFiltro && fornecedoresOpts.length > 0
      ? data.filter((r) =>
          productMatchesFornecedor(fornecedoresOpts, fornecedorFiltro, {
            produto: r.produto,
            cor: r.cor,
            descricao: r.descricao,
          })
        )
      : data;

  // "Zerou na rede toda" = nenhuma loja tem estoque positivo do item (ondeTemEstoque vazio).
  const zeradosRede = dataFiltrada.filter((r) => r.ondeTemEstoque.length === 0).length;
  const visiveis = soZeradoRede ? dataFiltrada.filter((r) => r.ondeTemEstoque.length === 0) : dataFiltrada;
  // Descontinuado aparece na tela (marcado "Descontinuado") mas NÃO vai pro export.
  const exportaveis = visiveis.filter((r) => !r.descontinuado);

  async function handleExportRupturas() {
    if (exporting || exportaveis.length === 0) return;
    setExporting(true);
    try {
      await exportRupturasXlsx({
        companyKey,
        filial,
        filialLabel,
        isRede,
        mes,
        mesLabel,
        soZerados: soZeradoRede,
        rupturas: exportaveis,
      });
    } catch (err) {
      alert((err as Error).message || "Erro ao exportar rupturas");
    } finally {
      setExporting(false);
    }
  }

  async function handleExportRupturasPorFilial() {
    if (porFilialProgresso !== null) return;

    // Lojas-alvo: mesma seleção da Curva ABC (filiais canônicas de venda, excluindo
    // MATRIZ, membros não-canônicos de grupos e o e-commerce; para SCARFME inclui o
    // e-commerce), pra bater 1 pra 1 com as colunas do "Compra Ideal por Loja" de lá.
    const cfg = resolveCompany(companyKey);
    if (!cfg) return;
    const ecommerceFilials = cfg.ecommerceFilials ?? [];
    const groups = cfg.filialGroups ?? {};
    const canonicals = new Set(Object.keys(groups));
    const nonCanonicalGroupMembers = new Set<string>();
    for (const members of Object.values(groups)) {
      for (const m of members) {
        if (!canonicals.has(m)) nonCanonicalGroupMembers.add(m);
      }
    }
    const matrizByCompany: Record<string, string[]> = {
      scarfme: ["SCARF ME - MATRIZ"],
      nerd: ["NERD"],
    };
    const matrizSet = new Set(matrizByCompany[companyKey] ?? []);
    const displayNames = cfg.filialDisplayNames ?? {};
    const salesFiliais = cfg.filialFilters?.sales ?? [];
    const targets: FilialExportTarget[] = salesFiliais
      .filter(
        (f) => !ecommerceFilials.includes(f) && !nonCanonicalGroupMembers.has(f) && !matrizSet.has(f)
      )
      .map((f) => ({ filial: f, label: displayNames[f] ?? f }));
    if (companyKey === "scarfme" && ecommerceFilials.length > 0) {
      const ec = ecommerceFilials[0]!;
      targets.push({ filial: ec, label: displayNames[ec] ?? ec });
    }
    targets.sort((a, b) => compareFilialDisplayOrder(a.label, b.label, cfg));
    if (targets.length === 0) return;

    setPorFilialProgresso({ feito: 0, total: targets.length });
    try {
      const fornecedorAtivo =
        companyKey === "nerd" && fornecedorFiltro && fornecedoresOpts.length > 0
          ? { id: fornecedorFiltro, fornecedores: fornecedoresOpts }
          : null;
      const { rows, colunasFiliais } = await buildRupturasPorFilialRows(
        companyKey,
        mes,
        targets,
        fornecedorAtivo,
        () => setPorFilialProgresso((prev) => (prev ? { ...prev, feito: prev.feito + 1 } : prev))
      );
      if (rows.length === 0) {
        alert("Nenhuma ruptura encontrada em nenhuma loja da rede nesse período (com os filtros aplicados).");
        return;
      }

      const fornecedorNome = fornecedorAtivo
        ? (fornecedoresOpts.find((f) => f.id === fornecedorFiltro)?.nome ?? null)
        : null;
      const filtroAplicado =
        `Todas as lojas · união das rupturas por loja · ${mesLabel}` +
        (fornecedorNome ? ` · fornecedor: ${fornecedorNome}` : "");

      const cols: CompraLojaExportColumn[] = [];
      cols.push({ key: "PRODUTO", label: "Código", role: "value", type: "text" });
      cols.push({ key: "COR_DESCRICAO", label: "Cor", role: "value", type: "text" });
      cols.push({ key: "DESCRICAO", label: "Descrição", role: "value", type: "text" });
      if (showGradeSubgrupo) {
        cols.push({ key: "SUBGRUPO", label: "Subgrupo", role: "value", type: "text" });
        cols.push({ key: "GRADE", label: "Grade", role: "value", type: "text" });
      }
      if (podeVerCusto) cols.push({ key: "CUSTO_UNIT", label: "Custo unit.", role: "custoUnit", type: "currency" });
      cols.push({ key: "VENDAS_PERIODO", label: "Venda período", role: "value", type: "currency" });
      cols.push({ key: "QTDE_PERIODO", label: "Qtd período", role: "value", type: "int" });
      cols.push({ key: "ESTOQUE_REDE", label: "Estoque rede", role: "value", type: "int" });
      cols.push({ key: "TOTAL REDE", label: "Compra total", role: "compraTotal", type: "int" });
      if (podeVerCusto) cols.push({ key: "CUSTO_TOTAL", label: "Custo total", role: "custoTotal", type: "currency" });
      for (const label of colunasFiliais) {
        cols.push({ key: label, label, role: "filial", type: "int" });
      }

      await exportCompraPorLojaXlsx(rows, cols, {
        fileLabel: `rupturas-por-loja-${mes}`,
        companyKey,
        sheetName: "Rupturas por Loja",
        titleLines: [`${cfg.name} — Rupturas por Loja`, filtroAplicado],
      });
    } catch (err) {
      alert((err as Error).message || "Erro ao exportar rupturas por loja");
    } finally {
      setPorFilialProgresso(null);
    }
  }

  return (
    <div className={styles.tabBody}>
      <div className={styles.rupturasHead}>
        <p className={styles.intro}>
          <strong>{dataFiltrada.length} produtos</strong> venderam em {mesLabel} e estão zerados {escopo} — do maior faturamento ao menor.
          {" "}A coluna <strong>Compra Ideal</strong> usa a mesma regra da Curva ABC{isRede ? " (soma da necessidade por loja)" : ""}.
        </p>
        <div className={styles.rupturasActions}>
          {companyKey === "nerd" && fornecedoresOpts.length > 0 && (
            <div className={styles.fornecedorFilter}>
              <span className={styles.fornecedorFilterLabel}>Fornecedor</span>
              <select
                className={styles.fornecedorFilterSelect}
                value={fornecedorFiltro}
                onChange={(e) => setFornecedorFiltro(e.target.value)}
              >
                <option value="">Todos</option>
                {fornecedoresOpts.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nome}
                  </option>
                ))}
              </select>
            </div>
          )}
          <label className={styles.checkFilter} title="Mostra só os itens sem estoque positivo em nenhuma loja da rede">
            <input
              type="checkbox"
              checked={soZeradoRede}
              onChange={(e) => setSoZeradoRede(e.target.checked)}
            />
            <span>Só zerados na rede toda</span>
            <span className={styles.checkCount}>{zeradosRede}</span>
          </label>
          <button
            type="button"
            className={styles.exportRupturasBtn}
            onClick={handleExportRupturas}
            disabled={exporting || exportaveis.length === 0}
            title="Exporta em XLSX a lista de rupturas mostrada (respeita o filtro), sem os descontinuados, com Compra Ideal e custos"
          >
            {exporting ? "Exportando…" : `Exportar rupturas (${exportaveis.length})`}
          </button>
          <button
            type="button"
            className={styles.exportRupturasBtn}
            onClick={handleExportRupturasPorFilial}
            disabled={porFilialProgresso !== null}
            title="Exporta a união das rupturas de TODAS as lojas numa lista só, com a Compra Ideal e o custo de cada loja em colunas separadas (mesma regra da Curva ABC)"
          >
            {porFilialProgresso
              ? `Lendo lojas… ${porFilialProgresso.feito}/${porFilialProgresso.total}`
              : "Exportar rupturas por loja"}
          </button>
        </div>
      </div>
      {visiveis.length === 0 ? (
        <div className={styles.empty}>Nenhum produto zerado em toda a rede em {mesLabel}. 🎉</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.dataTable}>
            <thead>
              <tr>
                <th>Produto</th>
                <th>Cor</th>
                {showGradeSubgrupo && <th>Subgrupo</th>}
                {showGradeSubgrupo && <th>Grade</th>}
                <th className={styles.num}>Vendeu</th>
                <th className={styles.num}>Faturou</th>
                <th className={styles.num}>Estoque {isRede ? "rede" : "loja"}</th>
                <th className={styles.num} title="Compra Ideal — mesma regra global da Curva ABC / Lista Loja">
                  Compra Ideal
                </th>
                <th>Onde tem estoque</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((r) => (
                <tr key={`${r.produto}-${r.cor}`}>
                  <td>
                    <div className={styles.prodDesc}>{r.descricao || r.produto}</div>
                    <div className={styles.prodId}>{r.produto}</div>
                    <ProdBadges item={r} showTransito />
                  </td>
                  <td>{r.corDescricao || r.cor || "—"}</td>
                  {showGradeSubgrupo && <td>{r.subgrupo || "—"}</td>}
                  {showGradeSubgrupo && <td>{r.grade || "—"}</td>}
                  <td className={styles.num}>{fmtNum(r.qtdVendida)}</td>
                  <td className={`${styles.num} ${styles.fat}`}>{fmtCurrency(r.faturamento)}</td>
                  <td className={`${styles.num} ${styles.zero}`}>{r.estoqueLoja}</td>
                  <td className={styles.num}>
                    <RupturaCompraIdeal item={r} companyKey={companyKey} />
                  </td>
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
      )}
    </div>
  );
}
