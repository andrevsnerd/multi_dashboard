"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import DateRangeFilter, { type DateRangeValue } from "@/components/filters/DateRangeFilter";
import FilialFilter from "@/components/filters/FilialFilter";
import MultiSelectFilter, { type MultiSelectOption } from "@/components/filters/MultiSelectFilter";
import { useAuth } from "@/components/auth/AuthContext";
import { resolveCompany, type CompanyKey } from "@/lib/config/company";
import { getCurrentMonthRange, formatDateForQuery } from "@/lib/utils/date";
import { exportRelatorioXlsx } from "@/lib/utils/exportRelatorioXlsx";
import { exportCompraSugeridaAbcXlsx } from "@/lib/utils/exportCompraSugeridaAbcXlsx";
import { COMPRA_FILIAL_COL_PREFIX, COMPRA_SUGERIDA_ABC_ID } from "@/lib/reports/compra-sugerida-abc";
import { formatData, formatDataVenda, formatDiasParado } from "@/lib/reports/format";
import { getDefaultPresets, getReportMeta, REPORT_TYPES, VENDAS_FATURAMENTO_ID } from "@/lib/reports/registry";
import { computeExtraSources, getEditorExtraColumns } from "@/lib/reports/column-sources";
import type {
  ColumnType,
  ReportColumnDef,
  ReportPresetDef,
  ReportRow,
  ReportSummaryMetric,
} from "@/lib/reports/types";
import type { ReportPreset } from "@/lib/types/report-preset";

import styles from "./GeradorRelatoriosPage.module.css";

interface GeradorRelatoriosPageProps {
  companyKey: CompanyKey;
  companyName: string;
}

/** Coluna no editor de estrutura: ordem do array = ordem exibida. */
interface WorkingColumn {
  key: string;
  label: string;
  enabled: boolean;
}

type SortDir = "asc" | "desc";

const SYNTHETIC_NEW = "__new__";
/** Prefixo das chaves das colunas dinâmicas de estoque por filial (espelha o backend). */
const FILIAL_COL_PREFIX = "ESTOQUE_FILIAL::";
/** Prefixos das chaves das colunas dinâmicas de venda/qtde por filial (espelha o backend). */
const VENDA_FILIAL_COL_PREFIX = "VENDA_FILIAL::";
const QTD_FILIAL_COL_PREFIX = "QTD_FILIAL::";

// ---------- helpers ----------

function buildWorkingColumns(
  catalog: ReportColumnDef[],
  presetColumns: { key: string; label: string }[]
): WorkingColumn[] {
  const presetKeys = presetColumns.map((c) => c.key);
  const inPreset = presetColumns
    .filter((c) => catalog.some((cat) => cat.key === c.key))
    .map((c) => ({ key: c.key, label: c.label, enabled: true }));
  const rest = catalog
    .filter((c) => !presetKeys.includes(c.key))
    .map((c) => ({ key: c.key, label: c.defaultLabel, enabled: false }));
  return [...inPreset, ...rest];
}

function colTypeOf(catalog: ReportColumnDef[], key: string): ColumnType {
  return catalog.find((c) => c.key === key)?.type ?? "text";
}

function formatCell(value: ReportRow[string], type: ColumnType): string {
  if (type === "dataVenda") return formatDataVenda(value);
  if (type === "date") return formatData(value);
  if (type === "diasParado") return formatDiasParado(value);
  if (value === null || value === undefined || value === "") return "";
  if (type === "text") return String(value);
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  if (type === "currency") {
    return num.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }
  if (type === "percent") {
    return `${num.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`;
  }
  if (type === "int") {
    return num.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  }
  return num.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function isNumericType(type: ColumnType): boolean {
  // datas alinham/ordenam como texto (ISO ordena cronologicamente); diasParado é numérico.
  return type !== "text" && type !== "dataVenda" && type !== "date";
}

function formatKpi(value: number, format: ReportSummaryMetric["format"]): string {
  if (!Number.isFinite(value)) return "—";
  if (format === "currency") {
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }
  if (format === "int") {
    return value.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  }
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

// ---------- component ----------

export default function GeradorRelatoriosPage({
  companyKey,
  companyName,
}: GeradorRelatoriosPageProps) {
  const { user } = useAuth();

  const initialRange = useMemo<DateRangeValue>(() => {
    const r = getCurrentMonthRange();
    return { startDate: r.start, endDate: r.end };
  }, []);

  // Tipo de análise (por ora só vendas por faturamento).
  const [reportTypeId, setReportTypeId] = useState<string>(VENDAS_FATURAMENTO_ID);
  const meta = useMemo(() => getReportMeta(reportTypeId), [reportTypeId]);
  const catalog = useMemo<ReportColumnDef[]>(() => meta?.columns ?? [], [meta]);
  // Catálogo do editor = colunas da base + colunas "cross" de outras análises (misturar).
  const editorCatalog = useMemo<ReportColumnDef[]>(() => {
    const baseKeys = new Set(catalog.map((c) => c.key));
    return [...catalog, ...getEditorExtraColumns(reportTypeId, baseKeys)];
  }, [catalog, reportTypeId]);
  const supports = (f: string) => meta?.supportedFilters.includes(f as never) ?? false;

  // Filtros
  const [range, setRange] = useState<DateRangeValue>(initialRange);
  const [filial, setFilial] = useState<string | null>(null);
  const [grupos, setGrupos] = useState<string[]>([]);
  const [linhas, setLinhas] = useState<string[]>([]);
  const [subgrupos, setSubgrupos] = useState<string[]>([]);
  const [grades, setGrades] = useState<string[]>([]);
  const [colecoes, setColecoes] = useState<string[]>([]);
  const [cores, setCores] = useState<string[]>([]);
  const [tipos, setTipos] = useState<string[]>([]);
  // Filtro opcional de dias parado (análise Produtos Parados): valor + modo.
  const [diasParadoValor, setDiasParadoValor] = useState<string>("");
  const [diasParadoModo, setDiasParadoModo] = useState<"lte" | "gte">("gte");
  const [incluirZerados, setIncluirZerados] = useState(false);
  const [incluirNegativos, setIncluirNegativos] = useState(false);

  // Opções dinâmicas
  const [optGrupos, setOptGrupos] = useState<string[]>([]);
  const [optLinhas, setOptLinhas] = useState<string[]>([]);
  const [optSubgrupos, setOptSubgrupos] = useState<string[]>([]);
  const [optGrades, setOptGrades] = useState<string[]>([]);
  // Coleção usa {value: código, label: "descrição (código)"} — busca casa os dois.
  const [optColecoes, setOptColecoes] = useState<MultiSelectOption[]>([]);
  const [optCores, setOptCores] = useState<string[]>([]);
  const [optTipos, setOptTipos] = useState<string[]>([]);
  const [loadingOpt, setLoadingOpt] = useState<Record<string, boolean>>({});

  // Busca por nome / produto
  const [produtoQuery, setProdutoQuery] = useState("");
  const [produtoSelected, setProdutoSelected] = useState<{ id: string; name: string } | null>(null);
  const [produtoResults, setProdutoResults] = useState<Array<{ productId: string; productName: string }>>([]);
  const [produtoDropdownOpen, setProdutoDropdownOpen] = useState(false);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);

  // Presets + estrutura de colunas
  const [backendPresets, setBackendPresets] = useState<ReportPreset[]>([]);
  const [activePresetId, setActivePresetId] = useState<string>("");
  const [workingColumns, setWorkingColumns] = useState<WorkingColumn[]>([]);
  const [sortBy, setSortBy] = useState<string>("FATURAMENTO");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [columnsOpen, setColumnsOpen] = useState(false);

  // Resultado
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [summary, setSummary] = useState<ReportSummaryMetric[]>([]);
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedOnce, setGeneratedOnce] = useState(false);
  // Colunas dinâmicas (ex.: estoque por filial) devolvidas pelo backend.
  const [dynamicColumns, setDynamicColumns] = useState<ReportColumnDef[]>([]);
  // Progresso de análises demoradas via streaming (ex.: compra sugerida por loja).
  const [genProgress, setGenProgress] = useState<{ done: number; total: number; phase?: string } | null>(null);

  // Catálogo efetivo = base + colunas cross + colunas dinâmicas (para tipo/formatação).
  const effectiveCatalog = useMemo<ReportColumnDef[]>(() => {
    const m = new Map(editorCatalog.map((c) => [c.key, c] as const));
    for (const d of dynamicColumns) m.set(d.key, d);
    return Array.from(m.values());
  }, [editorCatalog, dynamicColumns]);

  // Presets padrão da empresa (alguns variam por empresa — ex.: colunas líderes).
  const builtinPresets = useMemo<ReportPresetDef[]>(
    () => getDefaultPresets(reportTypeId, companyKey),
    [reportTypeId, companyKey]
  );

  // Lista combinada de presets (builtin + backend).
  const allPresets = useMemo(() => {
    return { builtin: builtinPresets, backend: backendPresets };
  }, [builtinPresets, backendPresets]);

  // Preset ativo pede estoque por filial? (só presets builtin carregam a flag)
  const wantsFilialStock = useMemo(
    () => !!allPresets.builtin.find((p) => p.id === activePresetId)?.dynamicFilialStock,
    [allPresets, activePresetId]
  );

  // Preset ativo pede venda por filial? (intercala "{filial} Venda" com o estoque)
  const wantsFilialSales = useMemo(
    () => !!allPresets.builtin.find((p) => p.id === activePresetId)?.dynamicFilialSales,
    [allPresets, activePresetId]
  );

  // Aplica um preset (builtin ou backend) à estrutura de colunas.
  const applyPreset = useCallback(
    (preset: { id: string; columns: { key: string; label: string }[]; sortBy?: string | null; sortDir?: SortDir | null }) => {
      setWorkingColumns(buildWorkingColumns(editorCatalog, preset.columns));
      if (preset.sortBy) setSortBy(preset.sortBy);
      if (preset.sortDir) setSortDir(preset.sortDir);
      setActivePresetId(preset.id);
      // Limpa colunas dinâmicas de filial; serão repovoadas ao gerar, se a view pedir.
      setDynamicColumns([]);
    },
    [editorCatalog]
  );

  // Inicializa estrutura com o primeiro preset builtin quando muda de análise.
  useEffect(() => {
    const first = builtinPresets[0];
    if (first) applyPreset(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportTypeId]);

  // Carrega presets do backend.
  const loadPresets = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/relatorios/presets?reportType=${encodeURIComponent(reportTypeId)}&company=${encodeURIComponent(companyKey)}`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const json = (await res.json()) as { data: ReportPreset[] };
      setBackendPresets(json.data ?? []);
    } catch {
      // silencioso — presets builtin continuam disponíveis
    }
  }, [reportTypeId, companyKey]);

  useEffect(() => {
    void loadPresets();
  }, [loadPresets]);

  // ---------- opções de filtro (lazy) ----------
  const startStr = formatDateForQuery(range.startDate);
  const endStr = formatDateForQuery(range.endDate);

  const loadOptions = useCallback(
    async (kind: "grupo" | "linha" | "subgrupo" | "grade" | "colecao" | "cor" | "tipo") => {
      setLoadingOpt((s) => ({ ...s, [kind]: true }));
      try {
        const params = new URLSearchParams({ company: companyKey });
        if (filial) params.set("filial", filial);
        if (kind !== "cor") {
          params.set("start", startStr);
          params.set("end", endStr);
        }
        const endpoint: Record<typeof kind, string> = {
          grupo: "grupos",
          linha: "linhas",
          subgrupo: "subgrupos",
          grade: "grades",
          colecao: "colecoes",
          cor: "cores",
          tipo: "tipos",
        };
        // Coleção: pede descrição junto (label "descrição (código)", value = código).
        if (kind === "colecao") params.set("includeDescriptions", "1");
        const url = `/api/products/${endpoint[kind]}?${params}`;

        const res = await fetch(url, { cache: "no-store" });
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

  // Carrega as opções de TODOS os filtros suportados de forma antecipada (ao
  // montar e quando empresa/filial/período mudam). Assim só exibimos os filtros
  // que realmente têm opções para a empresa (ex.: NERD não mostra Subgrupo/Grade).
  useEffect(() => {
    if (!meta) return;
    (["grupo", "linha", "subgrupo", "grade", "colecao", "cor", "tipo"] as const).forEach((k) => {
      if (meta.supportedFilters.includes(k as never)) void loadOptions(k);
    });
  }, [meta, loadOptions]);

  // ---------- busca de produto ----------
  const runSearch = useCallback(
    async (term: string) => {
      if (!term || term.trim().length < 2) {
        setProdutoResults([]);
        return;
      }
      try {
        const res = await fetch(
          `/api/products/search?company=${encodeURIComponent(companyKey)}&q=${encodeURIComponent(term)}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          setProdutoResults([]);
          return;
        }
        const json = (await res.json()) as {
          data: Array<{ productId: string; productName: string }>;
        };
        setProdutoResults(json.data ?? []);
      } catch {
        setProdutoResults([]);
      }
    },
    [companyKey]
  );

  const onProdutoQueryChange = (value: string) => {
    setProdutoQuery(value);
    setProdutoSelected(null);
    setProdutoDropdownOpen(true);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => void runSearch(value), 300);
  };

  const pickProduto = (p: { productId: string; productName: string }) => {
    setProdutoSelected({ id: p.productId, name: p.productName });
    setProdutoQuery(`${p.productName} (${p.productId})`);
    setProdutoDropdownOpen(false);
  };

  const clearProduto = () => {
    setProdutoSelected(null);
    setProdutoQuery("");
    setProdutoResults([]);
  };

  // Fecha o dropdown de sugestões ao clicar fora ou apertar Esc — mantém o texto
  // digitado (vira `produtoSearchTerm` ao gerar, sem precisar clicar numa sugestão).
  useEffect(() => {
    if (!produtoDropdownOpen) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target as Node)) {
        setProdutoDropdownOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setProdutoDropdownOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [produtoDropdownOpen]);

  // ---------- gerar ----------
  const buildQuery = useCallback(() => {
    const params = new URLSearchParams();
    params.set("company", companyKey);
    if (filial) params.set("filial", filial);
    params.set("start", startStr);
    params.set("end", endStr);
    grupos.forEach((g) => params.append("grupo", g));
    linhas.forEach((l) => params.append("linha", l));
    subgrupos.forEach((s) => params.append("subgrupo", s));
    grades.forEach((g) => params.append("grade", g));
    colecoes.forEach((c) => params.append("colecao", c));
    cores.forEach((c) => params.append("cor", c));
    tipos.forEach((t) => params.append("tipo", t));
    if (produtoSelected) {
      params.set("produtoId", produtoSelected.id);
    } else if (produtoQuery.trim().length >= 2) {
      params.set("produtoSearchTerm", produtoQuery.trim());
    }
    const diasNum = Number(diasParadoValor.trim());
    const suportaDiasParado = meta?.supportedFilters.includes("diasParado" as never) ?? false;
    if (suportaDiasParado && diasParadoValor.trim() !== "" && Number.isFinite(diasNum) && diasNum >= 0) {
      params.set("diasParadoValor", String(Math.round(diasNum)));
      params.set("diasParadoModo", diasParadoModo);
    }
    const suportaSaldo = meta?.supportedFilters.includes("saldoEstoque" as never) ?? false;
    if (suportaSaldo && incluirZerados) params.set("incluirZerados", "1");
    if (suportaSaldo && incluirNegativos) params.set("incluirNegativos", "1");
    return params.toString();
  }, [
    companyKey, filial, startStr, endStr, grupos, linhas, subgrupos, grades,
    colecoes, cores, tipos, produtoSelected, produtoQuery,
    diasParadoValor, diasParadoModo, incluirZerados, incluirNegativos, meta,
  ]);

  // Aplica o ReportResult recebido (fetch único OU stream) ao estado da página.
  const applyResult = useCallback((json: {
    rows?: ReportRow[];
    summary?: ReportSummaryMetric[];
    total?: number;
    truncated?: boolean;
    dynamicColumns?: ReportColumnDef[];
  }) => {
    setRows(json.rows ?? []);
    setSummary(Array.isArray(json.summary) ? json.summary : []);
    setTotal(json.total ?? 0);
    setTruncated(Boolean(json.truncated));
    setGeneratedOnce(true);

    // Colunas dinâmicas (estoque/compra por filial + "Código de barra"): mescla no catálogo
    // e (re)anexa ao FIM das colunas habilitadas, na ordem que o backend mandou. Removemos
    // antes as dinâmicas já anexadas (por regra estável de chave) p/ não duplicar nem
    // desordenar entre gerações.
    const dyn: ReportColumnDef[] = Array.isArray(json.dynamicColumns) ? json.dynamicColumns : [];
    setDynamicColumns(dyn);
    setWorkingColumns((cols) => {
      const stripped = cols.filter(
        (c) =>
          c.key !== "CODIGO_BARRA" &&
          !c.key.startsWith(FILIAL_COL_PREFIX) &&
          !c.key.startsWith(VENDA_FILIAL_COL_PREFIX) &&
          !c.key.startsWith(QTD_FILIAL_COL_PREFIX) &&
          !c.key.startsWith(COMPRA_FILIAL_COL_PREFIX)
      );
      const existing = new Set(stripped.map((c) => c.key));
      const appended = dyn
        .filter((d) => !existing.has(d.key))
        .map((d) => ({ key: d.key, label: d.defaultLabel, enabled: true }));
      return [...stripped, ...appended];
    });
  }, []);

  const clearResultOnError = useCallback((message: string) => {
    setError(message);
    setRows([]);
    setSummary([]);
    setTotal(0);
    setTruncated(false);
  }, []);

  // Caminho de streaming para análises demoradas: lê NDJSON via fetch (NÃO EventSource — ele
  // reconecta sozinho ao fim do stream e dispararia o cálculo de novo). Mostra "Calculando
  // compra por loja… X/N" enquanto o servidor calcula e aplica o resultado ao final.
  const generateViaStream = useCallback(
    async (url: string) => {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok || !res.body) {
        clearResultOnError("Erro ao gerar relatório");
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let gotResult = false;

      const handleLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let msg: { type?: string; done?: number; total?: number; phase?: string; result?: unknown; error?: string; details?: string };
        try {
          msg = JSON.parse(trimmed);
        } catch {
          return; // linha parcial/ruído — ignora
        }
        if (msg.type === "progress") {
          setGenProgress({ done: msg.done ?? 0, total: msg.total ?? 0, phase: msg.phase });
        } else if (msg.type === "result") {
          gotResult = true;
          applyResult((msg.result ?? {}) as Parameters<typeof applyResult>[0]);
        } else if (msg.type === "failed") {
          gotResult = true;
          clearResultOnError(msg.error || msg.details || "Erro ao gerar relatório");
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n")) >= 0) {
          handleLine(buf.slice(0, idx));
          buf = buf.slice(idx + 1);
        }
      }
      handleLine(buf); // resto sem \n final
      if (!gotResult) clearResultOnError("Conexão interrompida ao gerar o relatório");
    },
    [applyResult, clearResultOnError]
  );

  const handleGenerate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setGenProgress(null);
    try {
      const qs = buildQuery();

      // Análise demorada → streaming com progresso por loja.
      if (reportTypeId === COMPRA_SUGERIDA_ABC_ID) {
        await generateViaStream(
          `/api/relatorios/compra-sugerida-abc/stream?reportType=${encodeURIComponent(reportTypeId)}&${qs}`
        );
        return;
      }

      // Fontes extras (colunas de outras análises misturadas neste preset).
      const enabledKeys = workingColumns.filter((c) => c.enabled).map((c) => c.key);
      const baseKeys = new Set(catalog.map((c) => c.key));
      const extraSources = computeExtraSources(reportTypeId, enabledKeys, baseKeys);
      const srcQs = extraSources.map((s) => `&src=${encodeURIComponent(s)}`).join("");
      const compraIdealQs = enabledKeys.includes("COMPRA_IDEAL") ? "&compraIdeal=1" : "";
      const url = `/api/relatorios/dados?reportType=${encodeURIComponent(reportTypeId)}&${qs}${wantsFilialStock ? "&estoquePorFilial=1" : ""}${wantsFilialSales ? "&vendasPorFilial=1" : ""}${srcQs}${compraIdealQs}`;
      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error || json?.details || "Erro ao gerar relatório");
      }
      applyResult(json);
    } catch (e) {
      clearResultOnError(e instanceof Error ? e.message : "Erro ao gerar relatório");
    } finally {
      setLoading(false);
      setGenProgress(null);
    }
  }, [
    buildQuery,
    wantsFilialStock,
    wantsFilialSales,
    reportTypeId,
    workingColumns,
    catalog,
    applyResult,
    clearResultOnError,
    generateViaStream,
  ]);

  // ---------- ordenação client-side ----------
  const enabledColumns = useMemo(
    () => workingColumns.filter((c) => c.enabled),
    [workingColumns]
  );

  const sortedRows = useMemo(() => {
    if (!sortBy) return rows;
    const type = colTypeOf(effectiveCatalog,sortBy);
    const numeric = isNumericType(type);
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[sortBy];
      const bv = b[sortBy];
      if (numeric) {
        return (Number(av ?? 0) - Number(bv ?? 0)) * dir;
      }
      return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
    });
  }, [rows, sortBy, sortDir, effectiveCatalog]);

  const toggleSort = (key: string) => {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir(isNumericType(colTypeOf(effectiveCatalog,key)) ? "desc" : "asc");
    }
  };

  // ---------- editor de colunas ----------
  const moveColumn = (index: number, dir: -1 | 1) => {
    setWorkingColumns((cols) => {
      const next = [...cols];
      const target = index + dir;
      if (target < 0 || target >= next.length) return cols;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const toggleColumn = (key: string) => {
    setWorkingColumns((cols) =>
      cols.map((c) => (c.key === key ? { ...c, enabled: !c.enabled } : c))
    );
  };

  const renameColumn = (key: string, label: string) => {
    setWorkingColumns((cols) => cols.map((c) => (c.key === key ? { ...c, label } : c)));
  };

  const onSelectPreset = (id: string) => {
    if (id === SYNTHETIC_NEW) return;
    const builtin = allPresets.builtin.find((p) => p.id === id);
    if (builtin) {
      applyPreset(builtin);
      return;
    }
    const backend = allPresets.backend.find((p) => p.id === id);
    if (backend) {
      applyPreset({
        id: backend.id,
        columns: backend.columns,
        sortBy: backend.sortBy ?? undefined,
        sortDir: (backend.sortDir as SortDir) ?? undefined,
      });
    }
  };

  const activeBackendPreset = backendPresets.find((p) => p.id === activePresetId) ?? null;

  const presetPayload = () => ({
    reportType: reportTypeId,
    companyKey,
    columns: enabledColumns.map((c) => ({ key: c.key, label: c.label })),
    sortBy,
    sortDir,
  });

  const authHeaders = (): HeadersInit => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (user?.username) h["x-auth-username"] = user.username;
    return h;
  };

  const handleSaveAsNew = async () => {
    if (enabledColumns.length === 0) {
      alert("Selecione ao menos uma coluna");
      return;
    }
    const name = window.prompt("Nome do novo preset:");
    if (!name || !name.trim()) return;
    try {
      const res = await fetch("/api/relatorios/presets", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ ...presetPayload(), name: name.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Erro ao salvar preset");
      await loadPresets();
      setActivePresetId(json.data.id);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao salvar preset");
    }
  };

  const handleUpdatePreset = async () => {
    if (!activeBackendPreset) return;
    try {
      const res = await fetch(`/api/relatorios/presets/${activeBackendPreset.id}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify(presetPayload()),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Erro ao atualizar preset");
      await loadPresets();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao atualizar preset");
    }
  };

  const handleRenamePreset = async () => {
    if (!activeBackendPreset) return;
    const name = window.prompt("Novo nome do preset:", activeBackendPreset.name);
    if (!name || !name.trim()) return;
    try {
      const res = await fetch(`/api/relatorios/presets/${activeBackendPreset.id}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json?.error || "Erro ao renomear preset");
      }
      await loadPresets();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao renomear preset");
    }
  };

  const handleDeletePreset = async () => {
    if (!activeBackendPreset) return;
    if (!window.confirm(`Excluir o preset "${activeBackendPreset.name}"?`)) return;
    try {
      const res = await fetch(`/api/relatorios/presets/${activeBackendPreset.id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json?.error || "Erro ao excluir preset");
      }
      await loadPresets();
      const firstBuiltin = builtinPresets[0];
      if (firstBuiltin) applyPreset(firstBuiltin);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao excluir preset");
    }
  };

  // ---------- exportar ----------
  const filialLabel = useMemo(() => {
    if (!filial) return "todas-filiais";
    const cfg = resolveCompany(companyKey);
    return cfg?.filialDisplayNames?.[filial] ?? filial;
  }, [filial, companyKey]);

  const handleExport = () => {
    const columnTypes: Record<string, ColumnType> = {};
    for (const c of enabledColumns) columnTypes[c.key] = colTypeOf(effectiveCatalog, c.key);
    // Compra sugerida por Curva ABC: export dedicado com fórmulas (Compra total / Custo
    // total dinâmicos no Excel). Os demais relatórios usam o export genérico (valores).
    if (reportTypeId === COMPRA_SUGERIDA_ABC_ID) {
      void exportCompraSugeridaAbcXlsx(
        sortedRows,
        enabledColumns.map((c) => ({ key: c.key, label: c.label })),
        {
          reportLabel: meta?.label ?? "compra-sugerida",
          companyKey,
          range: { startDate: range.startDate, endDate: range.endDate },
          sheetName: meta?.label,
          columnTypes,
        }
      );
      return;
    }
    exportRelatorioXlsx(
      sortedRows,
      enabledColumns.map((c) => ({ key: c.key, label: c.label })),
      {
        reportLabel: meta?.label ?? "relatorio",
        companyKey,
        range: { startDate: range.startDate, endDate: range.endDate },
        filialLabel,
        sheetName: meta?.label,
        columnTypes,
      }
    );
  };

  // ---------- render ----------
  return (
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <h1 className={styles.title}>Gerador de Relatórios</h1>
        <p className={styles.subtitle}>
          Monte a análise que você quiser: escolha o período, aplique filtros, ajuste as
          colunas e exporte. {companyName}.
        </p>
      </header>

      {/* Tipo de análise */}
      <section className={styles.panel}>
        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel}>Tipo de análise</label>
          <select
            className={styles.select}
            value={reportTypeId}
            onChange={(e) => setReportTypeId(e.target.value)}
          >
            {REPORT_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        {meta?.description && <p className={styles.hint}>{meta.description}</p>}
      </section>

      {/* Filtros */}
      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>Filtros</h2>
        <div className={styles.filtersGrid}>
          {supports("periodo") && (
            <DateRangeFilter value={range} onChange={setRange} label="Período" />
          )}
          {supports("filial") && (
            <FilialFilter
              companyKey={companyKey}
              value={filial}
              onChange={setFilial}
              module="sales"
            />
          )}
          {supports("grupo") && (optGrupos.length > 0 || grupos.length > 0) && (
            <MultiSelectFilter
              label="Grupo"
              value={grupos}
              options={optGrupos}
              onChange={setGrupos}
              onOpen={() => void loadOptions("grupo")}
              loading={!!loadingOpt.grupo}
            />
          )}
          {supports("linha") && (optLinhas.length > 0 || linhas.length > 0) && (
            <MultiSelectFilter
              label="Linha"
              value={linhas}
              options={optLinhas}
              onChange={setLinhas}
              onOpen={() => void loadOptions("linha")}
              loading={!!loadingOpt.linha}
            />
          )}
          {supports("subgrupo") && (optSubgrupos.length > 0 || subgrupos.length > 0) && (
            <MultiSelectFilter
              label="Subgrupo"
              value={subgrupos}
              options={optSubgrupos}
              onChange={setSubgrupos}
              onOpen={() => void loadOptions("subgrupo")}
              loading={!!loadingOpt.subgrupo}
            />
          )}
          {supports("grade") && (optGrades.length > 0 || grades.length > 0) && (
            <MultiSelectFilter
              label="Grade"
              value={grades}
              options={optGrades}
              onChange={setGrades}
              onOpen={() => void loadOptions("grade")}
              loading={!!loadingOpt.grade}
            />
          )}
          {supports("colecao") && (optColecoes.length > 0 || colecoes.length > 0) && (
            <MultiSelectFilter
              label="Coleção"
              value={colecoes}
              options={optColecoes}
              onChange={setColecoes}
              onOpen={() => void loadOptions("colecao")}
              loading={!!loadingOpt.colecao}
            />
          )}
          {supports("cor") && (optCores.length > 0 || cores.length > 0) && (
            <MultiSelectFilter
              label="Cor"
              value={cores}
              options={optCores}
              onChange={setCores}
              onOpen={() => void loadOptions("cor")}
              loading={!!loadingOpt.cor}
            />
          )}
          {supports("tipo") && (optTipos.length > 0 || tipos.length > 0) && (
            <MultiSelectFilter
              label="Tipo"
              value={tipos}
              options={optTipos}
              onChange={setTipos}
              onOpen={() => void loadOptions("tipo")}
              loading={!!loadingOpt.tipo}
            />
          )}
          {supports("nome") && (
            <div className={styles.searchField}>
              <label className={styles.fieldLabel}>Nome / código / cód. barra</label>
              <div className={styles.searchWrap} ref={searchWrapRef}>
                <input
                  className={styles.input}
                  value={produtoQuery}
                  placeholder="Buscar produto..."
                  onChange={(e) => onProdutoQueryChange(e.target.value)}
                  onFocus={() => produtoResults.length > 0 && setProdutoDropdownOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") setProdutoDropdownOpen(false);
                  }}
                />
                {(produtoQuery || produtoSelected) && (
                  <button type="button" className={styles.clearBtn} onClick={clearProduto}>
                    ×
                  </button>
                )}
                {produtoDropdownOpen && produtoResults.length > 0 && !produtoSelected && (
                  <div className={styles.searchDropdown}>
                    {produtoResults.slice(0, 30).map((p) => (
                      <button
                        type="button"
                        key={`${p.productId}`}
                        className={styles.searchItem}
                        onClick={() => pickProduto(p)}
                      >
                        <span className={styles.searchItemName}>{p.productName}</span>
                        <span className={styles.searchItemId}>{p.productId}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          {supports("diasParado") && (
            <div className={styles.searchField}>
              <label className={styles.fieldLabel}>Dias parado (opcional)</label>
              <div className={styles.diasParadoRow}>
                <select
                  className={styles.select}
                  value={diasParadoModo}
                  onChange={(e) => setDiasParadoModo(e.target.value as "lte" | "gte")}
                >
                  <option value="gte">Igual ou mais de</option>
                  <option value="lte">Até</option>
                </select>
                <input
                  className={styles.input}
                  type="number"
                  min={0}
                  step={1}
                  value={diasParadoValor}
                  placeholder="dias"
                  onChange={(e) => setDiasParadoValor(e.target.value)}
                />
                {diasParadoValor.trim() !== "" && (
                  <button
                    type="button"
                    className={styles.diasParadoClear}
                    onClick={() => setDiasParadoValor("")}
                    aria-label="Limpar dias parado"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
          )}
          {supports("saldoEstoque") && (
            <div className={styles.searchField}>
              <label className={styles.fieldLabel}>Saldo (opcional)</label>
              <div className={styles.saldoRow}>
                <label className={styles.checkLabel}>
                  <input
                    type="checkbox"
                    checked={incluirZerados}
                    onChange={(e) => setIncluirZerados(e.target.checked)}
                  />
                  Incluir zerados
                </label>
                <label className={styles.checkLabel}>
                  <input
                    type="checkbox"
                    checked={incluirNegativos}
                    onChange={(e) => setIncluirNegativos(e.target.checked)}
                  />
                  Incluir negativos
                </label>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Estrutura de colunas */}
      <section className={styles.panel}>
        <div className={styles.panelHeaderRow}>
          <h2 className={styles.panelTitle}>Estrutura de colunas</h2>
          <button
            type="button"
            className={styles.linkBtn}
            onClick={() => setColumnsOpen((o) => !o)}
          >
            {columnsOpen ? "Ocultar" : "Editar colunas"}
          </button>
        </div>

        <div className={styles.presetRow}>
          <label className={styles.fieldLabel}>Preset</label>
          <select
            className={styles.select}
            value={activePresetId}
            onChange={(e) => onSelectPreset(e.target.value)}
          >
            <optgroup label="Padrão">
              {allPresets.builtin.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
            {allPresets.backend.length > 0 && (
              <optgroup label="Salvos">
                {allPresets.backend.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>

          <div className={styles.presetActions}>
            <button type="button" className={styles.btnSecondary} onClick={handleSaveAsNew}>
              Salvar como novo
            </button>
            {activeBackendPreset && (
              <>
                <button type="button" className={styles.btnSecondary} onClick={handleUpdatePreset}>
                  Atualizar
                </button>
                <button type="button" className={styles.btnSecondary} onClick={handleRenamePreset}>
                  Renomear
                </button>
                <button type="button" className={styles.btnDanger} onClick={handleDeletePreset}>
                  Excluir
                </button>
              </>
            )}
          </div>
        </div>

        {columnsOpen && (
          <div className={styles.columnEditor}>
            {workingColumns.map((col, idx) => (
              <div key={col.key} className={styles.columnRow}>
                <input
                  type="checkbox"
                  checked={col.enabled}
                  onChange={() => toggleColumn(col.key)}
                />
                <input
                  className={styles.colLabelInput}
                  value={col.label}
                  onChange={(e) => renameColumn(col.key, e.target.value)}
                  disabled={!col.enabled}
                />
                <span className={styles.colKey}>{col.key}</span>
                <div className={styles.colMoveBtns}>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    onClick={() => moveColumn(idx, -1)}
                    disabled={idx === 0}
                    aria-label="Subir"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    onClick={() => moveColumn(idx, 1)}
                    disabled={idx === workingColumns.length - 1}
                    aria-label="Descer"
                  >
                    ↓
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Ações */}
      <section className={styles.actionsBar}>
        <button
          type="button"
          className={styles.btnPrimary}
          onClick={() => void handleGenerate()}
          disabled={loading}
        >
          {loading ? "Gerando..." : "Gerar relatório"}
        </button>
        <button
          type="button"
          className={styles.btnSecondary}
          onClick={handleExport}
          disabled={rows.length === 0}
        >
          Exportar XLSX
        </button>
        {generatedOnce && !loading && (
          <span className={styles.resultMeta}>
            {total.toLocaleString("pt-BR")} linha(s)
            {truncated && " (exibindo as primeiras 5.000 — refine os filtros)"}
          </span>
        )}
      </section>

      {loading && reportTypeId === COMPRA_SUGERIDA_ABC_ID && (
        <section className={styles.progressWrap}>
          <div className={styles.progressHeader}>
            <span className={styles.progressSpinner} aria-hidden="true" />
            <span className={styles.progressText}>
              {genProgress && genProgress.phase === "lojas" && genProgress.total > 0
                ? `Calculando compra por loja… ${genProgress.done}/${genProgress.total} lojas`
                : "Buscando vendas da rede…"}
            </span>
          </div>
          <div className={styles.progressBar}>
            {genProgress && genProgress.total > 0 ? (
              <div
                className={styles.progressFill}
                style={{ width: `${Math.round((genProgress.done / genProgress.total) * 100)}%` }}
              />
            ) : (
              <div className={`${styles.progressFill} ${styles.progressFillIndeterminate}`} />
            )}
          </div>
          <p className={styles.progressHint}>
            Lê o histórico de cada loja para calcular a compra sugerida — pode levar alguns
            instantes.
          </p>
        </section>
      )}

      {error && <div className={styles.error}>{error}</div>}

      {/* KPIs */}
      {summary.length > 0 && (
        <section className={styles.kpiGrid}>
          {summary.map((kpi) => (
            <div key={kpi.label} className={styles.kpiCard}>
              <span className={styles.kpiLabel}>{kpi.label}</span>
              <span className={styles.kpiValue}>{formatKpi(kpi.value, kpi.format)}</span>
            </div>
          ))}
        </section>
      )}

      {/* Tabela */}
      {enabledColumns.length === 0 ? (
        <div className={styles.empty}>Selecione ao menos uma coluna na estrutura.</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                {enabledColumns.map((col) => (
                  <th
                    key={col.key}
                    className={`${styles.th} ${isNumericType(colTypeOf(effectiveCatalog,col.key)) ? styles.thNumeric : ""}`}
                    onClick={() => toggleSort(col.key)}
                  >
                    {col.label}
                    {sortBy === col.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, i) => (
                <tr key={i}>
                  {enabledColumns.map((col) => {
                    const type = colTypeOf(effectiveCatalog,col.key);
                    return (
                      <td
                        key={col.key}
                        className={`${styles.td} ${isNumericType(type) ? styles.tdNumeric : ""}`}
                      >
                        {formatCell(row[col.key], type)}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {generatedOnce && sortedRows.length === 0 && !loading && (
                <tr>
                  <td className={styles.td} colSpan={enabledColumns.length}>
                    Nenhum resultado para os filtros selecionados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
