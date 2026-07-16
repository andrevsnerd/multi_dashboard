"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import DateRangeFilter, { type DateRangeValue } from "@/components/filters/DateRangeFilter";
import FilialFilter from "@/components/filters/FilialFilter";
import MultiSelectFilter, { type MultiSelectOption } from "@/components/filters/MultiSelectFilter";
import { type CompanyKey } from "@/lib/config/company";
import { getCurrentMonthRange, formatDateForQuery } from "@/lib/utils/date";
import { exportAumentosDescontosXlsx } from "@/lib/utils/exportAumentosDescontosXlsx";
import type {
  AumentoDescontoRow,
  AumentoDescontoDetalheRow,
  AumentosDescontosResumo,
  TicketRow,
  AumentosDescontosPorTicketResumo,
} from "@/lib/repositories/aumentosDescontos";

import styles from "./AumentosDescontosPage.module.css";

interface AumentosDescontosPageProps {
  companyKey: CompanyKey;
  companyName: string;
}

interface AggResult {
  descontos: AumentoDescontoRow[];
  aumentos: AumentoDescontoRow[];
  resumo: AumentosDescontosResumo;
}
interface DetResult {
  descontos: AumentoDescontoDetalheRow[];
  aumentos: AumentoDescontoDetalheRow[];
  total: number;
  truncated: boolean;
  itensSemPrecoSugerido: number;
  itensPrecoJusto: number;
}
interface TicketResult {
  ticketsComDesconto: TicketRow[];
  ticketsComAumento: TicketRow[];
  resumo: AumentosDescontosPorTicketResumo;
  truncated: boolean;
}

type OptKind = "grupo" | "linha" | "subgrupo" | "grade" | "colecao" | "cor" | "tipo";
type Tab = "descontos" | "aumentos";
type View = "agregado" | "detalhe" | "ticket";
type SortDir = "asc" | "desc";
const ticketKey = (t: Pick<TicketRow, "filial" | "ticket">) => `${t.filial}::${t.ticket}`;

const BRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const INT = (v: number) => Math.round(v).toLocaleString("pt-BR");
const PCT = (v: number) =>
  `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

interface Column {
  key: string;
  label: string;
  numeric?: boolean;
  kind?: "brl" | "int" | "pct";
}

export default function AumentosDescontosPage({ companyKey, companyName }: AumentosDescontosPageProps) {
  const isScarfme = companyKey === "scarfme";

  const initialRange = useMemo<DateRangeValue>(() => {
    const r = getCurrentMonthRange();
    return { startDate: r.start, endDate: r.end };
  }, []);

  const [range, setRange] = useState<DateRangeValue>(initialRange);
  const [filial, setFilial] = useState<string | null>(null);
  const [grupos, setGrupos] = useState<string[]>([]);
  const [linhas, setLinhas] = useState<string[]>([]);
  const [subgrupos, setSubgrupos] = useState<string[]>([]);
  const [grades, setGrades] = useState<string[]>([]);
  const [colecoes, setColecoes] = useState<string[]>([]);
  const [cores, setCores] = useState<string[]>([]);
  const [tipos, setTipos] = useState<string[]>([]);

  const [optGrupos, setOptGrupos] = useState<string[]>([]);
  const [optLinhas, setOptLinhas] = useState<string[]>([]);
  const [optSubgrupos, setOptSubgrupos] = useState<string[]>([]);
  const [optGrades, setOptGrades] = useState<string[]>([]);
  const [optColecoes, setOptColecoes] = useState<MultiSelectOption[]>([]);
  const [optCores, setOptCores] = useState<string[]>([]);
  const [optTipos, setOptTipos] = useState<string[]>([]);
  const [loadingOpt, setLoadingOpt] = useState<Partial<Record<OptKind, boolean>>>({});

  const [result, setResult] = useState<AggResult | null>(null);
  const [detail, setDetail] = useState<DetResult | null>(null);
  const [ticketResult, setTicketResult] = useState<TicketResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [ticketLoading, setTicketLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<View>("agregado");
  const [tab, setTab] = useState<Tab>("descontos");
  const [sortKey, setSortKey] = useState<string>("valor");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [ticketSortKey, setTicketSortKey] = useState<string>("diferenca");
  const [ticketSortDir, setTicketSortDir] = useState<SortDir>("desc");
  const [expandedTickets, setExpandedTickets] = useState<Set<string>>(new Set());

  const startStr = formatDateForQuery(range.startDate);
  const endStr = formatDateForQuery(range.endDate);

  // ── Opções de filtro (carregadas antecipadamente; só aparece o que tem opção) ──
  const loadOptions = useCallback(
    async (kind: OptKind) => {
      setLoadingOpt((s) => ({ ...s, [kind]: true }));
      try {
        const params = new URLSearchParams({ company: companyKey });
        if (filial) params.set("filial", filial);
        if (kind !== "cor") {
          params.set("start", startStr);
          params.set("end", endStr);
        }
        const endpoint: Record<OptKind, string> = {
          grupo: "grupos",
          linha: "linhas",
          subgrupo: "subgrupos",
          grade: "grades",
          colecao: "colecoes",
          cor: "cores",
          tipo: "tipos",
        };
        if (kind === "colecao") params.set("includeDescriptions", "1");
        const res = await fetch(`/api/products/${endpoint[kind]}?${params}`, { cache: "no-store" });
        const json = (await res.json()) as { data?: (string | MultiSelectOption)[] };
        const data = json.data ?? [];
        if (kind === "grupo") setOptGrupos(data as string[]);
        else if (kind === "linha") setOptLinhas(data as string[]);
        else if (kind === "subgrupo") setOptSubgrupos(data as string[]);
        else if (kind === "grade") setOptGrades(data as string[]);
        else if (kind === "colecao") setOptColecoes(data as MultiSelectOption[]);
        else if (kind === "tipo") setOptTipos(data as string[]);
        else setOptCores(data as string[]);
      } catch {
        // ignora — multiselect fica vazio
      } finally {
        setLoadingOpt((s) => ({ ...s, [kind]: false }));
      }
    },
    [companyKey, filial, startStr, endStr]
  );

  useEffect(() => {
    (["grupo", "linha", "subgrupo", "grade", "colecao", "cor", "tipo"] as const).forEach((k) => {
      void loadOptions(k);
    });
  }, [loadOptions]);

  // ── Assinatura dos filtros (dispara a busca automática) ──
  const filtersQuery = useMemo(() => {
    const params = new URLSearchParams();
    params.set("company", companyKey);
    if (filial) params.set("filial", filial);
    params.set("start", startStr);
    params.set("end", endStr);
    grupos.forEach((v) => params.append("grupo", v));
    linhas.forEach((v) => params.append("linha", v));
    subgrupos.forEach((v) => params.append("subgrupo", v));
    grades.forEach((v) => params.append("grade", v));
    colecoes.forEach((v) => params.append("colecao", v));
    cores.forEach((v) => params.append("cor", v));
    tipos.forEach((v) => params.append("tipo", v));
    return params.toString();
  }, [companyKey, filial, startStr, endStr, grupos, linhas, subgrupos, grades, colecoes, cores, tipos]);

  // ── Busca automática do AGREGADO (sem botão): ao montar e quando filtros mudam ──
  const aggCtrl = useRef<AbortController | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    aggCtrl.current?.abort();
    aggCtrl.current = ctrl;
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/aumentos-descontos?${filtersQuery}`, {
          cache: "no-store",
          signal: ctrl.signal,
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `Erro ${res.status}`);
        }
        setResult((await res.json()) as AggResult);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setResult(null);
        setError(e instanceof Error ? e.message : "Erro ao gerar análise");
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 450);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [filtersQuery]);

  // ── Busca do DETALHE (só quando a visão detalhada está ativa) ──
  const detCtrl = useRef<AbortController | null>(null);
  useEffect(() => {
    if (view !== "detalhe") return;
    const ctrl = new AbortController();
    detCtrl.current?.abort();
    detCtrl.current = ctrl;
    const t = setTimeout(async () => {
      setDetailLoading(true);
      try {
        const res = await fetch(`/api/aumentos-descontos?${filtersQuery}&view=detalhe`, {
          cache: "no-store",
          signal: ctrl.signal,
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `Erro ${res.status}`);
        }
        setDetail((await res.json()) as DetResult);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setDetail(null);
        setError(e instanceof Error ? e.message : "Erro ao detalhar");
      } finally {
        if (!ctrl.signal.aborted) setDetailLoading(false);
      }
    }, 450);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [filtersQuery, view]);

  // ── Busca do POR TICKET (só quando a visão está ativa) ──
  const ticketCtrl = useRef<AbortController | null>(null);
  useEffect(() => {
    if (view !== "ticket") return;
    const ctrl = new AbortController();
    ticketCtrl.current?.abort();
    ticketCtrl.current = ctrl;
    const t = setTimeout(async () => {
      setTicketLoading(true);
      try {
        const res = await fetch(`/api/aumentos-descontos?${filtersQuery}&view=ticket`, {
          cache: "no-store",
          signal: ctrl.signal,
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `Erro ${res.status}`);
        }
        setTicketResult((await res.json()) as TicketResult);
        setExpandedTickets(new Set());
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setTicketResult(null);
        setError(e instanceof Error ? e.message : "Erro ao agrupar por ticket");
      } finally {
        if (!ctrl.signal.aborted) setTicketLoading(false);
      }
    }, 450);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [filtersQuery, view]);

  const periodoLabel = `${range.startDate.toLocaleDateString("pt-BR")} — ${range.endDate.toLocaleDateString("pt-BR")}`;

  const handleExport = useCallback(() => {
    if (!result) return;
    void exportAumentosDescontosXlsx({
      companyKey,
      companyName,
      filialLabel: filial,
      periodoLabel,
      isScarfme,
      descontos: result.descontos,
      aumentos: result.aumentos,
      resumo: result.resumo,
    });
  }, [result, companyKey, companyName, filial, periodoLabel, isScarfme]);

  const resumo = result?.resumo;
  const isDesc = tab === "descontos";

  // ── Colunas por visão ──
  const groupCol: Column = isScarfme
    ? { key: "subgrupo", label: "Subgrupo" }
    : { key: "grupo", label: "Grupo" };

  const aggColumns: Column[] = [
    { key: "produto", label: "Código" },
    { key: "descricao", label: "Descrição" },
    { key: "corDescricao", label: "Cor" },
    { key: "linha", label: "Linha" },
    groupCol,
    ...(isScarfme ? [{ key: "grade", label: "Grade" }] : []),
    { key: "qtde", label: "Qtde", numeric: true, kind: "int" as const },
    // Preços unitários lado a lado (sugerido vs. real médio).
    { key: "precoSugerido", label: "Preço sugerido", numeric: true, kind: "brl" as const },
    { key: "precoMedioReal", label: "Preço médio real", numeric: true, kind: "brl" as const },
    // Valores totais lado a lado (sugerido vs. real).
    { key: "valorSugerido", label: "Valor sugerido", numeric: true, kind: "brl" as const },
    { key: "valorReal", label: "Valor real vendido", numeric: true, kind: "brl" as const },
    // Impacto: médio por unidade antes do total, seguido do % do item.
    {
      key: "valorMedioUnit",
      label: isDesc ? "Desconto médio/unid." : "Aumento médio/unid.",
      numeric: true,
      kind: "brl" as const,
    },
    { key: "valor", label: isDesc ? "Desconto total (R$)" : "Aumento total (R$)", numeric: true, kind: "brl" as const },
    { key: "percentual", label: isDesc ? "% Desc." : "% Aum.", numeric: true, kind: "pct" as const },
  ];

  const detColumns: Column[] = [
    { key: "data", label: "Data" },
    { key: "ticket", label: "Ticket/NF" },
    { key: "filial", label: "Filial" },
    ...(isScarfme ? [] : [{ key: "vendedor", label: "Vendedor" }]),
    { key: "produto", label: "Código" },
    { key: "descricao", label: "Descrição" },
    { key: "corDescricao", label: "Cor" },
    { key: "qtde", label: "Qtde", numeric: true, kind: "int" as const },
    { key: "precoSugerido", label: "Preço sugerido", numeric: true, kind: "brl" as const },
    { key: "precoReal", label: "Preço real", numeric: true, kind: "brl" as const },
    { key: "valorSugerido", label: "Valor sugerido", numeric: true, kind: "brl" as const },
    { key: "valorReal", label: "Valor real", numeric: true, kind: "brl" as const },
    { key: "valor", label: isDesc ? "Desconto (R$)" : "Aumento (R$)", numeric: true, kind: "brl" as const },
    { key: "percentual", label: isDesc ? "% Desc." : "% Aum.", numeric: true, kind: "pct" as const },
  ];

  const ticketColumns: Column[] = [
    { key: "data", label: "Data" },
    { key: "ticket", label: "Ticket/NF" },
    { key: "filial", label: "Filial" },
    { key: "vendedor", label: "Vendedor" },
    { key: "qtdeItens", label: "Itens", numeric: true, kind: "int" as const },
    { key: "qtdeTotal", label: "Qtde", numeric: true, kind: "int" as const },
    { key: "valorTicketTotal", label: "Valor do ticket", numeric: true, kind: "brl" as const },
    { key: "valorSugeridoComparavel", label: "Valor sugerido", numeric: true, kind: "brl" as const },
    { key: "diferenca", label: isDesc ? "Desconto líquido" : "Aumento líquido", numeric: true, kind: "brl" as const },
    { key: "percentual", label: "%", numeric: true, kind: "pct" as const },
  ];

  const columns = view === "detalhe" ? detColumns : aggColumns;

  const activeRows = useMemo<Array<Record<string, string | number | null>>>(() => {
    const rows =
      view === "detalhe"
        ? (isDesc ? detail?.descontos : detail?.aumentos) ?? []
        : (isDesc ? result?.descontos : result?.aumentos) ?? [];
    return rows as unknown as Array<Record<string, string | number | null>>;
  }, [view, isDesc, detail, result]);

  const sortedRows = useMemo(() => {
    const rows = [...activeRows];
    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      let cmp: number;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av ?? "").localeCompare(String(bv ?? ""), "pt-BR");
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [activeRows, sortKey, sortDir]);

  const onSort = (key: string) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(typeof activeRows[0]?.[key] === "number" ? "desc" : "asc");
    }
  };

  const fmtCell = (col: Column, value: string | number | null): string => {
    if (value == null || value === "") return "—";
    if (typeof value !== "number") return String(value);
    if (col.kind === "int") return INT(value);
    if (col.kind === "pct") return PCT(value);
    if (col.kind === "brl") return BRL(value);
    return String(value);
  };

  const activeTicketRows = useMemo<TicketRow[]>(() => {
    const rows = (isDesc ? ticketResult?.ticketsComDesconto : ticketResult?.ticketsComAumento) ?? [];
    const sorted = [...rows];
    sorted.sort((a, b) => {
      const av = a[ticketSortKey as keyof TicketRow];
      const bv = b[ticketSortKey as keyof TicketRow];
      let cmp: number;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av ?? "").localeCompare(String(bv ?? ""), "pt-BR");
      return ticketSortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [isDesc, ticketResult, ticketSortKey, ticketSortDir]);

  const onTicketSort = (key: string) => {
    if (key === ticketSortKey) setTicketSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setTicketSortKey(key);
      setTicketSortDir("desc");
    }
  };

  const toggleTicketExpanded = (key: string) => {
    setExpandedTickets((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const busy = view === "detalhe" ? detailLoading : view === "ticket" ? ticketLoading : loading;

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <h1 className={styles.title}>Aumentos e Descontos</h1>
        <p className={styles.subtitle}>
          {companyName} · Compara o valor real vendido (regra de vendas validada) contra o preço
          sugerido do cadastro, por produto × cor. A busca é automática ao mudar os filtros.
        </p>
      </div>

      {/* ── Filtros ── */}
      <div className={styles.panel}>
        <div className={styles.filtersGrid}>
          <DateRangeFilter value={range} onChange={setRange} label="Período" />
          <FilialFilter companyKey={companyKey} value={filial} onChange={setFilial} module="sales" />

          {(optGrupos.length > 0 || grupos.length > 0) && (
            <MultiSelectFilter
              label="Grupo"
              value={grupos}
              options={optGrupos}
              onChange={setGrupos}
              onOpen={() => void loadOptions("grupo")}
              loading={!!loadingOpt.grupo}
            />
          )}
          {(optLinhas.length > 0 || linhas.length > 0) && (
            <MultiSelectFilter
              label="Linha"
              value={linhas}
              options={optLinhas}
              onChange={setLinhas}
              onOpen={() => void loadOptions("linha")}
              loading={!!loadingOpt.linha}
            />
          )}
          {(optSubgrupos.length > 0 || subgrupos.length > 0) && (
            <MultiSelectFilter
              label="Subgrupo"
              value={subgrupos}
              options={optSubgrupos}
              onChange={setSubgrupos}
              onOpen={() => void loadOptions("subgrupo")}
              loading={!!loadingOpt.subgrupo}
            />
          )}
          {(optGrades.length > 0 || grades.length > 0) && (
            <MultiSelectFilter
              label="Grade"
              value={grades}
              options={optGrades}
              onChange={setGrades}
              onOpen={() => void loadOptions("grade")}
              loading={!!loadingOpt.grade}
            />
          )}
          {(optColecoes.length > 0 || colecoes.length > 0) && (
            <MultiSelectFilter
              label="Coleção"
              value={colecoes}
              options={optColecoes}
              onChange={setColecoes}
              onOpen={() => void loadOptions("colecao")}
              loading={!!loadingOpt.colecao}
            />
          )}
          {(optTipos.length > 0 || tipos.length > 0) && (
            <MultiSelectFilter
              label="Tipo"
              value={tipos}
              options={optTipos}
              onChange={setTipos}
              onOpen={() => void loadOptions("tipo")}
              loading={!!loadingOpt.tipo}
            />
          )}
          {(optCores.length > 0 || cores.length > 0) && (
            <MultiSelectFilter
              label="Cor"
              value={cores}
              options={optCores}
              onChange={setCores}
              onOpen={() => void loadOptions("cor")}
              loading={!!loadingOpt.cor}
            />
          )}
        </div>

        <div className={styles.actions}>
          {busy && <span className={styles.kpiSub}>Carregando…</span>}
          <button
            type="button"
            className={`${styles.btn} ${styles.btnExport}`}
            onClick={handleExport}
            disabled={!result || (result.descontos.length === 0 && result.aumentos.length === 0)}
          >
            Exportar Excel (3 abas)
          </button>
        </div>

        {error && <div className={styles.errorBox}>{error}</div>}
      </div>

      {/* ── KPIs ── */}
      {resumo && (
        <div className={styles.kpiGrid}>
          <div className={`${styles.kpiCard} ${styles.kpiCardNeutral}`}>
            <span className={styles.kpiLabel}>Vendas no período</span>
            <span className={styles.kpiValue}>{BRL(resumo.vendasPeriodo)}</span>
            <span className={styles.kpiSub}>base global (Dashboard / Curva ABC)</span>
          </div>
          <div className={`${styles.kpiCard} ${styles.kpiCardDesc}`}>
            <span className={styles.kpiLabel}>Total em descontos</span>
            <span className={`${styles.kpiValue} ${styles.valueDesc}`}>{BRL(resumo.totalDescontoValor)}</span>
            <span className={styles.kpiSub}>
              {PCT(resumo.descontoMedioPerc)} médio · {INT(resumo.itensDesconto)} itens
            </span>
          </div>
          <div className={`${styles.kpiCard} ${styles.kpiCardAum}`}>
            <span className={styles.kpiLabel}>Total em aumentos</span>
            <span className={`${styles.kpiValue} ${styles.valueAum}`}>{BRL(resumo.totalAumentoValor)}</span>
            <span className={styles.kpiSub}>
              {PCT(resumo.aumentoMedioPerc)} médio · {INT(resumo.itensAumento)} itens
            </span>
          </div>
          <div className={`${styles.kpiCard} ${styles.kpiCardNeutral}`}>
            <span className={styles.kpiLabel}>Valor sugerido total</span>
            <span className={styles.kpiValue}>{BRL(resumo.valorSugeridoTotal)}</span>
            <span className={styles.kpiSub}>itens analisados · preço cadastro × qtde</span>
          </div>
          <div className={`${styles.kpiCard} ${styles.kpiCardNeutral}`}>
            <span className={styles.kpiLabel}>Impacto líquido</span>
            <span className={styles.kpiValue}>
              {BRL(resumo.totalAumentoValor - resumo.totalDescontoValor)}
            </span>
            <span className={styles.kpiSub}>aumento − desconto</span>
          </div>
        </div>
      )}

      {/* ── KPIs específicos da visão Por Ticket ── */}
      {view === "ticket" && ticketResult && (
        <div className={styles.kpiGrid}>
          <div className={`${styles.kpiCard} ${styles.kpiCardDesc}`}>
            <span className={styles.kpiLabel}>Desconto líquido (por ticket)</span>
            <span className={`${styles.kpiValue} ${styles.valueDesc}`}>
              {BRL(ticketResult.resumo.descontoLiquidoTotal)}
            </span>
            <span className={styles.kpiSub}>{INT(ticketResult.resumo.ticketsDescontoLiquido)} tickets</span>
          </div>
          <div className={`${styles.kpiCard} ${styles.kpiCardAum}`}>
            <span className={styles.kpiLabel}>Aumento líquido (por ticket)</span>
            <span className={`${styles.kpiValue} ${styles.valueAum}`}>
              {BRL(ticketResult.resumo.aumentoLiquidoTotal)}
            </span>
            <span className={styles.kpiSub}>{INT(ticketResult.resumo.ticketsAumentoLiquido)} tickets</span>
          </div>
          <div className={`${styles.kpiCard} ${styles.kpiCardNeutral}`}>
            <span className={styles.kpiLabel}>Tickets neutralizados</span>
            <span className={styles.kpiValue}>{INT(ticketResult.resumo.ticketsNeutralizados)}</span>
            <span className={styles.kpiSub}>
              desconto de um item 100% absorvido por outro do mesmo carrinho
            </span>
          </div>
          <div className={`${styles.kpiCard} ${styles.kpiCardNeutral}`}>
            <span className={styles.kpiLabel}>Tickets mistos (desconto + aumento)</span>
            <span className={styles.kpiValue}>{INT(ticketResult.resumo.ticketsMistos)}</span>
            <span className={styles.kpiSub}>
              de {INT(ticketResult.resumo.ticketsAnalisados)} tickets analisados
            </span>
          </div>
          <div className={`${styles.kpiCard} ${styles.kpiCardNeutral}`}>
            <span className={styles.kpiLabel}>Valor total dos tickets analisados</span>
            <span className={styles.kpiValue}>{BRL(ticketResult.resumo.valorTicketsTotal)}</span>
            <span className={styles.kpiSub}>soma do valor real (todos os itens)</span>
          </div>
        </div>
      )}

      {/* ── Tabelas ── */}
      {resumo && (
        <div className={styles.panel}>
          <div className={styles.viewToggle}>
            <button
              type="button"
              className={`${styles.viewBtn} ${view === "agregado" ? styles.viewBtnActive : ""}`}
              onClick={() => setView("agregado")}
            >
              Agregado (produto × cor)
            </button>
            <button
              type="button"
              className={`${styles.viewBtn} ${view === "detalhe" ? styles.viewBtnActive : ""}`}
              onClick={() => setView("detalhe")}
            >
              Detalhar (por venda)
            </button>
            <button
              type="button"
              className={`${styles.viewBtn} ${view === "ticket" ? styles.viewBtnActive : ""}`}
              onClick={() => setView("ticket")}
            >
              Ver por ticket
            </button>
          </div>

          <div className={styles.tabs}>
            <button
              type="button"
              className={`${styles.tab} ${isDesc ? styles.tabActiveDesc : ""}`}
              onClick={() => setTab("descontos")}
            >
              Descontos
              <span className={styles.tabCount}>
                {INT(
                  view === "ticket"
                    ? ticketResult?.ticketsComDesconto.length ?? 0
                    : view === "detalhe"
                      ? detail?.descontos.length ?? 0
                      : result?.descontos.length ?? 0
                )}
              </span>
            </button>
            <button
              type="button"
              className={`${styles.tab} ${!isDesc ? styles.tabActiveAum : ""}`}
              onClick={() => setTab("aumentos")}
            >
              Aumentos
              <span className={styles.tabCount}>
                {INT(
                  view === "ticket"
                    ? ticketResult?.ticketsComAumento.length ?? 0
                    : view === "detalhe"
                      ? detail?.aumentos.length ?? 0
                      : result?.aumentos.length ?? 0
                )}
              </span>
            </button>
          </div>

          {view === "ticket" ? (
            busy && !ticketResult ? (
              <div className={styles.empty}>Carregando tickets…</div>
            ) : activeTicketRows.length === 0 ? (
              <div className={styles.empty}>
                Nenhum ticket com {isDesc ? "desconto" : "aumento"} líquido no período/filtros
                selecionados.
              </div>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.expandCol} />
                      {ticketColumns.map((c) => (
                        <th
                          key={c.key}
                          className={c.numeric ? styles.numeric : undefined}
                          onClick={() => onTicketSort(c.key)}
                        >
                          {c.label}
                          {ticketSortKey === c.key && (
                            <span className={styles.sortArrow}>
                              {ticketSortDir === "asc" ? "▲" : "▼"}
                            </span>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {activeTicketRows.map((t) => {
                      const key = ticketKey(t);
                      const expanded = expandedTickets.has(key);
                      return (
                        <Fragment key={key}>
                          <tr className={styles.ticketRow} onClick={() => toggleTicketExpanded(key)}>
                            <td className={styles.expandCol}>{expanded ? "▾" : "▸"}</td>
                            {ticketColumns.map((c) => {
                              const isImpact = c.key === "diferenca" || c.key === "percentual";
                              const impactClass = isImpact ? (isDesc ? styles.strongDesc : styles.strongAum) : "";
                              const raw = t[c.key as keyof TicketRow];
                              const value =
                                typeof raw === "number" && isImpact ? Math.abs(raw) : (raw as string | number);
                              return (
                                <td
                                  key={c.key}
                                  className={`${c.numeric ? styles.numeric : ""} ${impactClass}`.trim()}
                                >
                                  {fmtCell(c, value)}
                                </td>
                              );
                            })}
                          </tr>
                          {expanded && (
                            <tr className={styles.ticketExpandRow}>
                              <td colSpan={ticketColumns.length + 1}>
                                <table className={styles.nestedTable}>
                                  <thead>
                                    <tr>
                                      <th>Produto</th>
                                      <th>Cor</th>
                                      <th className={styles.numeric}>Qtde</th>
                                      <th className={styles.numeric}>Preço sugerido</th>
                                      <th className={styles.numeric}>Preço real</th>
                                      <th className={styles.numeric}>Diferença</th>
                                      <th>Classificação</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {t.itens.map((item, ii) => (
                                      <tr key={`${item.produto}-${item.cor}-${ii}`}>
                                        <td>
                                          {item.produto} — {item.descricao}
                                        </td>
                                        <td>{item.corDescricao || "—"}</td>
                                        <td className={styles.numeric}>{INT(item.qtde)}</td>
                                        <td className={styles.numeric}>
                                          {item.precoSugerido != null ? BRL(item.precoSugerido) : "—"}
                                        </td>
                                        <td className={styles.numeric}>{BRL(item.precoReal)}</td>
                                        <td className={styles.numeric}>
                                          {item.valorSugerido != null ? BRL(Math.abs(item.diferenca)) : "—"}
                                        </td>
                                        <td>
                                          <span
                                            className={`${styles.badge} ${
                                              item.classificacao === "desconto"
                                                ? styles.badgeDesc
                                                : item.classificacao === "aumento"
                                                  ? styles.badgeAum
                                                  : item.classificacao === "justo"
                                                    ? styles.badgeJusto
                                                    : styles.badgeSemPreco
                                            }`}
                                          >
                                            {item.classificacao === "desconto"
                                              ? "Desconto"
                                              : item.classificacao === "aumento"
                                                ? "Aumento"
                                                : item.classificacao === "justo"
                                                  ? "Preço justo"
                                                  : "Sem preço"}
                                          </span>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          ) : busy && view === "detalhe" && !detail ? (
            <div className={styles.empty}>Carregando vendas detalhadas…</div>
          ) : sortedRows.length === 0 ? (
            <div className={styles.empty}>
              Nenhum item {isDesc ? "com desconto" : "com aumento"} no período/filtros selecionados.
            </div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    {columns.map((c) => (
                      <th
                        key={c.key}
                        className={c.numeric ? styles.numeric : undefined}
                        onClick={() => onSort(c.key)}
                      >
                        {c.label}
                        {sortKey === c.key && (
                          <span className={styles.sortArrow}>{sortDir === "asc" ? "▲" : "▼"}</span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row, i) => (
                    <tr key={`${row.produto}-${row.cor ?? ""}-${row.ticket ?? ""}-${i}`}>
                      {columns.map((c) => {
                        const isImpact = c.key === "valor" || c.key === "percentual";
                        const impactClass = isImpact
                          ? isDesc
                            ? styles.strongDesc
                            : styles.strongAum
                          : "";
                        return (
                          <td
                            key={c.key}
                            className={`${c.numeric ? styles.numeric : ""} ${impactClass}`.trim()}
                          >
                            {fmtCell(c, row[c.key])}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {view === "detalhe" && detail?.truncated && (
            <p className={styles.footNote}>
              Mostrando as vendas mais recentes (limite atingido) — refine os filtros para ver o
              período inteiro.
            </p>
          )}
          {view === "ticket" && ticketResult?.truncated && (
            <p className={styles.footNote}>
              Base de transações truncada pelo limite da consulta — refine os filtros para garantir
              que todos os tickets do período entraram na análise.
            </p>
          )}
          <p className={styles.footNote}>
            {view === "agregado" ? (
              <>
                {INT(resumo.itensPrecoJusto)} item(ns) vendido(s) exatamente ao preço sugerido ·{" "}
                {INT(resumo.itensSemPrecoSugerido)} sem preço sugerido cadastrado (fora da análise).
              </>
            ) : view === "detalhe" ? (
              <>
                {INT(detail?.itensPrecoJusto ?? 0)} venda(s) exatamente ao preço sugerido ·{" "}
                {INT(detail?.itensSemPrecoSugerido ?? 0)} sem preço sugerido cadastrado (fora da
                análise). Visão por transação (regra de vendas validada por linha) — não abate
                trocas por linha, então pode diferir em poucas unidades do agregado (que é líquido
                de trocas). Número oficial de vendas: “Vendas no período”.
              </>
            ) : (
              <>
                Clique num ticket pra ver os produtos que o compõem. “Valor do ticket” é o valor
                real TOTAL (todos os itens); “Valor sugerido” e a diferença só consideram os itens
                com preço cadastrado. Tickets 100% preço justo/sem preço não aparecem aqui.
              </>
            )}
          </p>
        </div>
      )}

      {!resumo && !loading && !error && (
        <div className={styles.panel}>
          <div className={styles.empty}>Carregando análise…</div>
        </div>
      )}
    </div>
  );
}
