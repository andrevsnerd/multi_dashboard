"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import DateRangeFilter, { type DateRangeValue } from "@/components/filters/DateRangeFilter";
import FilialFilter from "@/components/filters/FilialFilter";
import MultiSelectFilter, { type MultiSelectOption } from "@/components/filters/MultiSelectFilter";
import { type CompanyKey } from "@/lib/config/company";
import { getCurrentMonthRange, formatDateForQuery } from "@/lib/utils/date";
import { exportAumentosDescontosXlsx } from "@/lib/utils/exportAumentosDescontosXlsx";
import type {
  AumentoDescontoRow,
  AumentosDescontosResumo,
} from "@/lib/repositories/aumentosDescontos";

import styles from "./AumentosDescontosPage.module.css";

interface AumentosDescontosPageProps {
  companyKey: CompanyKey;
  companyName: string;
}

interface ApiResult {
  descontos: AumentoDescontoRow[];
  aumentos: AumentoDescontoRow[];
  resumo: AumentosDescontosResumo;
}

type OptKind = "grupo" | "linha" | "subgrupo" | "grade" | "colecao" | "cor" | "tipo";
type Tab = "descontos" | "aumentos";
type SortDir = "asc" | "desc";

const BRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const INT = (v: number) => Math.round(v).toLocaleString("pt-BR");
const PCT = (v: number) => `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

/** Chaves ordenáveis da tabela. */
type SortKey = keyof AumentoDescontoRow;

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

  const [result, setResult] = useState<ApiResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedOnce, setGeneratedOnce] = useState(false);

  const [tab, setTab] = useState<Tab>("descontos");
  const [sortKey, setSortKey] = useState<SortKey>("valor");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

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

  // ── Gerar ──
  const handleGenerate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
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

      const res = await fetch(`/api/aumentos-descontos?${params}`, { cache: "no-store" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Erro ${res.status}`);
      }
      const json = (await res.json()) as ApiResult;
      setResult(json);
      setGeneratedOnce(true);
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "Erro ao gerar análise");
    } finally {
      setLoading(false);
    }
  }, [companyKey, filial, startStr, endStr, grupos, linhas, subgrupos, grades, colecoes, cores, tipos]);

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

  // ── Ordenação da tabela ativa ──
  const activeRows = useMemo(
    () => (tab === "descontos" ? result?.descontos ?? [] : result?.aumentos ?? []),
    [tab, result]
  );
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

  const onSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(typeof (activeRows[0]?.[key]) === "number" ? "desc" : "asc");
    }
  };

  const resumo = result?.resumo;
  const isDesc = tab === "descontos";
  const valorHeader = isDesc ? "Desconto (R$)" : "Aumento (R$)";
  const percHeader = isDesc ? "% Desc." : "% Aum.";

  const groupCol: { key: SortKey; label: string } = isScarfme
    ? { key: "subgrupo", label: "Subgrupo" }
    : { key: "grupo", label: "Grupo" };

  const columns: Array<{ key: SortKey; label: string; numeric?: boolean }> = [
    { key: "produto", label: "Código" },
    { key: "descricao", label: "Descrição" },
    { key: "corDescricao", label: "Cor" },
    { key: "linha", label: "Linha" },
    groupCol,
    ...(isScarfme ? [{ key: "grade" as SortKey, label: "Grade" }] : []),
    { key: "qtde", label: "Qtde", numeric: true },
    { key: "precoSugerido", label: "Preço sugerido", numeric: true },
    { key: "valorSugerido", label: "Valor sugerido", numeric: true },
    { key: "precoMedioReal", label: "Preço médio real", numeric: true },
    { key: "valorReal", label: "Valor real vendido", numeric: true },
    { key: "valor", label: valorHeader, numeric: true },
    { key: "percentual", label: percHeader, numeric: true },
  ];

  const fmtCell = (key: SortKey, value: string | number): string => {
    if (typeof value !== "number") return value || "—";
    if (key === "qtde") return INT(value);
    if (key === "percentual") return PCT(value);
    return BRL(value);
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <h1 className={styles.title}>Aumentos e Descontos</h1>
        <p className={styles.subtitle}>
          {companyName} · Compara o valor real vendido (regra de vendas validada) contra o preço
          sugerido do cadastro, por produto × cor.
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
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => void handleGenerate()}
            disabled={loading}
          >
            {loading ? "Gerando…" : "Gerar análise"}
          </button>
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
            <span className={styles.kpiSub}>preço de cadastro × qtde</span>
          </div>
          <div className={`${styles.kpiCard} ${styles.kpiCardNeutral}`}>
            <span className={styles.kpiLabel}>Valor real vendido total</span>
            <span className={styles.kpiValue}>{BRL(resumo.valorRealTotal)}</span>
            <span className={styles.kpiSub}>faturamento líquido validado</span>
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

      {/* ── Tabelas por aba ── */}
      {resumo && (
        <div className={styles.panel}>
          <div className={styles.tabs}>
            <button
              type="button"
              className={`${styles.tab} ${isDesc ? styles.tabActiveDesc : ""}`}
              onClick={() => setTab("descontos")}
            >
              Descontos
              <span className={styles.tabCount}>{INT(result?.descontos.length ?? 0)}</span>
            </button>
            <button
              type="button"
              className={`${styles.tab} ${!isDesc ? styles.tabActiveAum : ""}`}
              onClick={() => setTab("aumentos")}
            >
              Aumentos
              <span className={styles.tabCount}>{INT(result?.aumentos.length ?? 0)}</span>
            </button>
          </div>

          {sortedRows.length === 0 ? (
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
                    <tr key={`${row.produto}-${row.cor}-${i}`}>
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
                            {fmtCell(c.key, row[c.key])}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className={styles.footNote}>
            {INT(resumo.itensPrecoJusto)} item(ns) vendido(s) exatamente ao preço sugerido ·{" "}
            {INT(resumo.itensSemPrecoSugerido)} sem preço sugerido cadastrado (fora da análise).
          </p>
        </div>
      )}

      {!resumo && !loading && !error && (
        <div className={styles.panel}>
          <div className={styles.empty}>
            {generatedOnce
              ? "Sem dados para os filtros selecionados."
              : "Selecione o período e os filtros e clique em “Gerar análise”."}
          </div>
        </div>
      )}
    </div>
  );
}
