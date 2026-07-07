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
import type { CompanyKey } from "@/lib/config/company";

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
}

interface PrincipalData {
  meses: MesMetric[];
  analyzed: MesMetric | null;
  comparacao: MesMetric | null;
  comparacaoAuto: boolean;
  isMesmo: boolean;
  decomposicao: { gap: number; porAtendimentos: number; porTicketMedio: number } | null;
  rupturasResumo: { quantidade: number; faturamento: number; comEstoqueNaRede: number };
  vendedoresResumo: {
    ativosAnalisado: number;
    ativosBest: number;
    quedas: Array<{ vendedor: string; analisado: number; melhor: number; queda: number }>;
  };
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

type Tab = "principal" | "vendedores" | "rupturas";

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

  // Principal (linha do tempo + diagnóstico) — depende de filial + mês.
  useEffect(() => {
    if (!filial) return;
    const controller = new AbortController();
    let cancelled = false;
    async function load(currentFilial: string) {
      setPrincipalLoading(true);
      setPrincipalError(null);
      try {
        const params = new URLSearchParams({ company: companyKey, filial: currentFilial, mes, section: "principal" });
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
    void load(filial);
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [companyKey, filial, mes, comparar]);

  // Vendedores (matriz 12 meses) — depende só de filial; carrega ao abrir a aba.
  useEffect(() => {
    if (tab !== "vendedores" || !filial) return;
    const controller = new AbortController();
    let cancelled = false;
    async function load(currentFilial: string) {
      setVendedoresLoading(true);
      try {
        const params = new URLSearchParams({ company: companyKey, filial: currentFilial, section: "vendedores" });
        const r = await fetch(`/api/loja-raio-x?${params}`, { cache: "no-store", signal: controller.signal });
        const json = await r.json();
        if (!cancelled) setVendedores(json.data as VendedoresData);
      } catch {
        /* abortado ou erro transitório */
      } finally {
        if (!cancelled) setVendedoresLoading(false);
      }
    }
    void load(filial);
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [companyKey, filial, tab]);

  // Rupturas — depende de filial + mês; carrega ao abrir a aba.
  useEffect(() => {
    if (tab !== "rupturas" || !filial) return;
    const controller = new AbortController();
    let cancelled = false;
    async function load(currentFilial: string) {
      setRupturasLoading(true);
      try {
        const params = new URLSearchParams({ company: companyKey, filial: currentFilial, mes, section: "rupturas" });
        const r = await fetch(`/api/loja-raio-x?${params}`, { cache: "no-store", signal: controller.signal });
        const json = await r.json();
        if (!cancelled) setRupturas((json.data as RupturaItem[]) ?? []);
      } catch {
        /* abortado ou erro transitório */
      } finally {
        if (!cancelled) setRupturasLoading(false);
      }
    }
    void load(filial);
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [companyKey, filial, mes, tab]);

  const timeline = principal?.meses ?? null;

  return (
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Loja Raio X</h1>
          <p className={styles.subtitle}>
            Raio-x de performance de uma loja: histórico, o que faltou para bater o melhor mês,
            vendedores e rupturas.
          </p>
        </div>
        <div className={styles.controls}>
          <FilialFilter
            companyKey={companyKey}
            value={filial}
            onChange={setFilial}
            module="sales"
            hideVarejo
            label="Loja"
          />
          <label className={styles.mesField}>
            <span className={styles.mesLabel}>Mês analisado</span>
            <select className={styles.select} value={mes} onChange={(e) => setMes(e.target.value)}>
              {mesesOpcoes.map((m) => (
                <option key={m.ym} value={m.ym}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.mesField}>
            <span className={styles.mesLabel}>Comparar com</span>
            <select className={styles.select} value={comparar} onChange={(e) => setComparar(e.target.value)}>
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

      {!filial && (
        <div className={styles.empty}>Selecione uma loja para começar o raio-x.</div>
      )}

      {filial && (
        <>
          <Timeline
            data={timeline}
            loading={principalLoading}
            analyzedYm={mes}
            comparYm={principal?.comparacao?.ym ?? null}
            comparAuto={principal?.comparacaoAuto ?? true}
            onSetAnalisado={setMes}
            onSetComparacao={(ym) => setComparar(ym)}
          />

          <nav className={styles.tabs}>
            {(["principal", "vendedores", "rupturas"] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                className={`${styles.tabBtn} ${tab === t ? styles.tabBtnActive : ""}`}
                onClick={() => setTab(t)}
              >
                {t === "principal" ? "Diagnóstico" : t === "vendedores" ? "Vendedores" : "Rupturas"}
              </button>
            ))}
          </nav>

          {tab === "principal" && (
            <PrincipalTab
              data={principal}
              loading={principalLoading}
              error={principalError}
              onGoTab={setTab}
            />
          )}
          {tab === "vendedores" && (
            <VendedoresTab data={vendedores} loading={vendedoresLoading} analyzedYm={mes} />
          )}
          {tab === "rupturas" && (
            <RupturasTab data={rupturas} loading={rupturasLoading} mesLabel={ymLabel(mes)} />
          )}
        </>
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
}: {
  data: MesMetric[] | null;
  loading: boolean;
  analyzedYm: string;
  comparYm: string | null;
  comparAuto: boolean;
  onSetAnalisado: (ym: string) => void;
  onSetComparacao: (ym: string) => void;
}) {
  const { theme } = useTheme();
  const [menu, setMenu] = useState<{ ym: string; label: string; x: number; y: number } | null>(null);
  const c =
    theme === "dark"
      ? { grid: "rgba(148,163,184,0.16)", axisText: "#94a3b8", bar: "#3b4a63", tooltipBg: "#1a2433", tooltipBorder: "#29344b", tooltipText: "#cbd5e1" }
      : { grid: "#e2e8f0", axisText: "#64748b", bar: "#cbd5e1", tooltipBg: "#fff", tooltipBorder: "#e2e8f0", tooltipText: "#334155" };
  const COMPAR = "#10b981";
  const ANALYZED = "#2563eb";

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>Faturamento — últimos 12 meses</h2>
        <div className={styles.legend}>
          <span><i className={styles.dot} style={{ background: ANALYZED }} /> Mês analisado</span>
          <span>
            <i className={styles.dot} style={{ background: COMPAR }} /> Comparação{comparAuto ? " (melhor mês)" : ""}
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
                <Cell key={m.ym} fill={m.ym === analyzedYm ? ANALYZED : m.ym === comparYm ? COMPAR : c.bar} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
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
}: {
  data: PrincipalData | null;
  loading: boolean;
  error: string | null;
  onGoTab: (t: Tab) => void;
}) {
  if (error) return <div className={styles.errorBox}>{error}</div>;
  if (loading && !data) return <div className={styles.skeleton} style={{ height: 320 }} />;
  if (!data || !data.analyzed) return <div className={styles.empty}>Sem dados para o mês selecionado.</div>;

  const { analyzed, comparacao, comparacaoAuto, isMesmo, decomposicao, rupturasResumo, vendedoresResumo } = data;
  const temAlerta = rupturasResumo.quantidade > 0 || vendedoresResumo.quedas.length > 0;
  const atendimentosDomina =
    !!decomposicao && Math.abs(decomposicao.porAtendimentos) >= Math.abs(decomposicao.porTicketMedio);
  const refLabel = comparacao ? `${comparacao.label}${comparacaoAuto ? " (melhor mês)" : ""}` : "";
  const acimaDaRef = !!(comparacao && analyzed.faturamento > comparacao.faturamento);

  return (
    <div className={styles.tabBody}>
      {isMesmo ? (
        <div className={`${styles.banner} ${styles.bannerInfo}`}>
          <strong>{analyzed.label} é o próprio mês de comparação.</strong> Escolha outro mês de comparação (no seletor ou clicando numa barra) para ver o que faltou.
        </div>
      ) : acimaDaRef && decomposicao ? (
        <div className={`${styles.banner} ${styles.bannerGood}`}>
          <strong>{analyzed.label} superou {refLabel} em {fmtCurrency(Math.abs(decomposicao.gap))}.</strong>{" "}
          Faturou {fmtCurrency(analyzed.faturamento)} vs {fmtCurrency(comparacao!.faturamento)}.
        </div>
      ) : (
        comparacao &&
        decomposicao && (
          <div className={`${styles.banner} ${temAlerta ? styles.bannerAlert : styles.bannerInfo}`}>
            <strong>Faltam {fmtCurrency(decomposicao.gap)}</strong> para {analyzed.label} igualar {refLabel} (
            {fmtCurrency(comparacao.faturamento)}).{" "}
            {atendimentosDomina
              ? "O maior peso está em MENOS atendimentos."
              : "O maior peso está no TICKET MÉDIO menor."}
          </div>
        )
      )}

      {/* KPIs do mês analisado vs comparação */}
      <div className={styles.kpiRow}>
        <Kpi label={`Faturamento (${analyzed.label})`} value={fmtCurrency(analyzed.faturamento)} sub={comparacao ? `comparação: ${fmtCurrency(comparacao.faturamento)}` : undefined} />
        <Kpi label="Atendimentos" value={fmtNum(analyzed.tickets)} sub={comparacao ? `comparação: ${fmtNum(comparacao.tickets)}` : undefined} />
        <Kpi label="Ticket médio" value={fmtCurrency(analyzed.ticketMedio)} sub={comparacao ? `comparação: ${fmtCurrency(comparacao.ticketMedio)}` : undefined} />
        <Kpi label="Peças vendidas" value={fmtNum(analyzed.quantidade)} />
      </div>

      {/* Decomposição do gap (só quando o mês analisado está ABAIXO da comparação) */}
      {!isMesmo && !acimaDaRef && decomposicao && (
        <div className={styles.card}>
          <h3 className={styles.cardTitle}>Por que faltou {fmtCurrency(decomposicao.gap)}?</h3>
          <div className={styles.gapGrid}>
            <GapFactor
              titulo="Menos atendimentos"
              valor={decomposicao.porAtendimentos}
              gap={decomposicao.gap}
              dica={`${fmtNum(analyzed.tickets)} vs ${fmtNum(comparacao?.tickets ?? 0)} tickets na comparação`}
              destaque={atendimentosDomina}
            />
            <GapFactor
              titulo="Ticket médio menor"
              valor={decomposicao.porTicketMedio}
              gap={decomposicao.gap}
              dica={`${fmtCurrency(analyzed.ticketMedio)} vs ${fmtCurrency(comparacao?.ticketMedio ?? 0)} na comparação`}
              destaque={!atendimentosDomina}
            />
          </div>
        </div>
      )}

      {/* Diagnóstico: produto e vendedores */}
      <div className={styles.diagGrid}>
        <button type="button" className={`${styles.diagCard} ${rupturasResumo.quantidade > 0 ? styles.diagCardWarn : ""}`} onClick={() => onGoTab("rupturas")}>
          <div className={styles.diagHead}>
            <span className={styles.diagIcon}>📦</span>
            <span className={styles.diagTitle}>Faltou produto?</span>
          </div>
          <div className={styles.diagBig}>{rupturasResumo.quantidade}</div>
          <div className={styles.diagText}>
            SKUs que venderam e estão zerados na loja
            {rupturasResumo.faturamento > 0 && <> · {fmtCurrency(rupturasResumo.faturamento)} no mês</>}
            {rupturasResumo.comEstoqueNaRede > 0 && (
              <> · <strong>{rupturasResumo.comEstoqueNaRede}</strong> têm estoque em outra loja</>
            )}
          </div>
          <span className={styles.diagLink}>Ver rupturas →</span>
        </button>

        <button type="button" className={`${styles.diagCard} ${vendedoresResumo.quedas.length > 0 ? styles.diagCardWarn : ""}`} onClick={() => onGoTab("vendedores")}>
          <div className={styles.diagHead}>
            <span className={styles.diagIcon}>🧑‍💼</span>
            <span className={styles.diagTitle}>Performance dos vendedores?</span>
          </div>
          <div className={styles.diagBig}>
            {vendedoresResumo.ativosAnalisado}
            {comparacao && !isMesmo && <span className={styles.diagBigSub}> / {vendedoresResumo.ativosBest}</span>}
          </div>
          <div className={styles.diagText}>
            vendedores ativos no mês{comparacao && !isMesmo && <> (vs comparação)</>}
          </div>
          {vendedoresResumo.quedas.length > 0 && (
            <ul className={styles.quedaList}>
              {vendedoresResumo.quedas.slice(0, 3).map((q) => (
                <li key={q.vendedor}>
                  <span>{q.vendedor}</span>
                  <span className={styles.quedaVal}>−{fmtCurrency(q.queda)}</span>
                </li>
              ))}
            </ul>
          )}
          <span className={styles.diagLink}>Ver vendedores →</span>
        </button>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className={styles.kpi}>
      <span className={styles.kpiLabel}>{label}</span>
      <span className={styles.kpiValue}>{value}</span>
      {sub && <span className={styles.kpiSub}>{sub}</span>}
    </div>
  );
}

function GapFactor({
  titulo,
  valor,
  gap,
  dica,
  destaque,
}: {
  titulo: string;
  valor: number;
  gap: number;
  dica: string;
  destaque: boolean;
}) {
  const pct = gap > 0 ? Math.max(0, Math.min(100, Math.round((valor / gap) * 100))) : 0;
  return (
    <div className={`${styles.gapFactor} ${destaque ? styles.gapFactorHi : ""}`}>
      <div className={styles.gapFactorTop}>
        <span>{titulo}</span>
        <strong>{fmtCurrency(valor)}</strong>
      </div>
      <div className={styles.gapBar}>
        <div className={styles.gapBarFill} style={{ width: `${pct}%` }} />
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

  return (
    <div className={styles.tabBody}>
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

// ── Aba Rupturas ───────────────────────────────────────────────────────────────

function RupturasTab({
  data,
  loading,
  mesLabel,
}: {
  data: RupturaItem[] | null;
  loading: boolean;
  mesLabel: string;
}) {
  if (loading && !data) return <div className={styles.skeleton} style={{ height: 320 }} />;
  if (!data) return null;
  if (data.length === 0)
    return <div className={styles.empty}>Nenhuma ruptura em {mesLabel}: os produtos que venderam têm estoque na loja. 🎉</div>;

  return (
    <div className={styles.tabBody}>
      <p className={styles.rupturaHint}>
        {data.length} produto(s) venderam em {mesLabel} e estão zerados nesta loja — do maior faturamento ao menor.
      </p>
      <div className={styles.matrizScroll}>
        <table className={styles.rupturaTable}>
          <thead>
            <tr>
              <th>Produto</th>
              <th>Cor</th>
              <th className={styles.num}>Vendeu</th>
              <th className={styles.num}>Faturou</th>
              <th className={styles.num}>Estoque loja</th>
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
