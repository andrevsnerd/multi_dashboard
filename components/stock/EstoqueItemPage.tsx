"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import FilialFilter from "@/components/filters/FilialFilter";
import {
  compareFilialDisplayOrder,
  getFilialLabelForDisplay,
  resolveCompany,
  type CompanyKey,
} from "@/lib/config/company";
import { getCurrentMonthRange } from "@/lib/utils/date";

import styles from "./EstoqueItemPage.module.css";

interface EstoqueItemPageProps {
  companyKey: CompanyKey;
  companyName: string;
}

interface VariacaoPorFilial {
  produto: string;
  descricao: string;
  linha: string;
  subgrupo: string;
  grade: string;
  colecao: string;
  cor: string;
  filial: string;
  estoque: number;
}

interface DetalhesPorFilialResponse {
  nomeProduto: string;
  resumo: {
    totalFiliais: number;
    estoqueTotal: number;
    custoTotal: number;
    vendasTotais: number;
  };
  variacoes: VariacaoPorFilial[];
}

interface PivotRow {
  produto: string;
  descricao: string;
  linha: string;
  subgrupo: string;
  grade: string;
  colecao: string;
  cor: string;
  porFilial: Record<string, number>;
  total: number;
}

function formatInt(n: number): string {
  return Math.round(n).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

function sumOnlyPositive(values: number[]): number {
  return values.reduce((sum, value) => sum + (value > 0 ? value : 0), 0);
}

function buildItemMeta(row: PivotRow, companyKey: CompanyKey): string {
  const parts =
    companyKey === "nerd"
      ? [row.linha, row.subgrupo, row.cor]
      : [row.linha, row.subgrupo, row.colecao, row.grade ? `Grade ${row.grade}` : null, row.cor];

  return parts.filter((value) => Boolean(value && value.trim())).join(" · ");
}

function getHighlightedFiliais(row: PivotRow, filiaisColumns: string[]): Set<string> {
  let maxValue = Number.NEGATIVE_INFINITY;
  const highlighted = new Set<string>();

  for (const filial of filiaisColumns) {
    const value = row.porFilial[filial] ?? 0;
    if (value <= 0) continue;

    if (value > maxValue) {
      maxValue = value;
      highlighted.clear();
      highlighted.add(filial);
      continue;
    }

    if (value === maxValue) {
      highlighted.add(filial);
    }
  }

  return highlighted;
}

async function fetchDetalhesPorFilial(params: {
  company: CompanyKey;
  filial: string | null;
  itens: string;
  grupo: string | null;
  linha: string | null;
  subgrupo: string | null;
  grade: string | null;
  colecao: string | null;
  cor: string | null;
  mostrarZerados: boolean;
  mostrarNegativos: boolean;
}): Promise<DetalhesPorFilialResponse> {
  const searchParams = new URLSearchParams({ company: params.company });

  if (params.filial) searchParams.set("filial", params.filial);
  if (params.itens.trim()) searchParams.set("itens", params.itens.trim());
  if (params.grupo) searchParams.set("grupo", params.grupo);
  if (params.linha) searchParams.set("linha", params.linha);
  if (params.subgrupo) searchParams.set("subgrupo", params.subgrupo);
  if (params.grade) searchParams.set("grade", params.grade);
  if (params.colecao) searchParams.set("colecao", params.colecao);
  if (params.cor) searchParams.set("cor", params.cor);
  if (params.mostrarZerados) searchParams.set("mostrarZerados", "1");
  if (params.mostrarNegativos) searchParams.set("mostrarNegativos", "1");

  const response = await fetch(
    `/api/controle-estoque/detalhes-por-filial?${searchParams.toString()}`,
    { cache: "no-store" },
  );
  const body = (await response.json().catch(() => ({}))) as {
    data?: DetalhesPorFilialResponse;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(body.error || `Erro ao consultar estoque (${response.status})`);
  }

  if (!body.data) {
    throw new Error("Resposta invalida do servidor");
  }

  return body.data;
}

export default function EstoqueItemPage({
  companyKey,
  companyName,
}: EstoqueItemPageProps) {
  const companyCfg = useMemo(() => resolveCompany(companyKey), [companyKey]);
  const range = useMemo(() => {
    const currentRange = getCurrentMonthRange();
    return { startDate: currentRange.start, endDate: currentRange.end };
  }, []);

  const linhasExcluidas = useMemo(() => {
    if (companyCfg?.excludedLines && companyCfg.excludedLines.length > 0) {
      return new Set(companyCfg.excludedLines.map((linha) => linha.toUpperCase().trim()));
    }

    return new Set([
      "PRIVATE LABEL",
      "GASTRONOMICA",
      "PERFUMARIA",
      "CASHMERE",
      "ELETRONICOS",
      "EMBALAGENS",
      "CAPAS E ACESSORIOS P/ CEL",
    ]);
  }, [companyCfg]);

  const [itensInput, setItensInput] = useState("");
  const [grupo, setGrupo] = useState<string | null>(null);
  const [linha, setLinha] = useState<string | null>(null);
  const [subgrupo, setSubgrupo] = useState<string | null>(null);
  const [grade, setGrade] = useState<string | null>(null);
  const [colecao, setColecao] = useState<string | null>(null);
  const [selectedFilial, setSelectedFilial] = useState<string | null>(null);
  const [cor, setCor] = useState<string | null>(null);
  const [mostrarZerados, setMostrarZerados] = useState(false);
  const [mostrarNegativos, setMostrarNegativos] = useState(false);

  const [apiCores, setApiCores] = useState<string[]>([]);
  const [apiGrupos, setApiGrupos] = useState<string[]>([]);
  const [apiLinhas, setApiLinhas] = useState<string[]>([]);
  const [apiSubgrupos, setApiSubgrupos] = useState<string[]>([]);
  const [apiGrades, setApiGrades] = useState<string[]>([]);
  const [apiColecoes, setApiColecoes] = useState<string[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DetalhesPorFilialResponse | null>(null);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const searchParams = new URLSearchParams({ company: companyKey });
        if (selectedFilial) searchParams.set("filial", selectedFilial);

        const response = await fetch(`/api/products/cores?${searchParams.toString()}`, {
          cache: "no-store",
        });
        if (!response.ok) return;

        const json = (await response.json()) as { data: string[] };
        if (active) setApiCores(json.data || []);
      } catch {
        /* ignore */
      }
    })();

    return () => {
      active = false;
    };
  }, [companyKey, selectedFilial]);

  useEffect(() => {
    if (companyKey !== "nerd") {
      setApiGrupos([]);
      return;
    }

    let active = true;

    void (async () => {
      try {
        const searchParams = new URLSearchParams({
          company: companyKey,
          start: range.startDate.toISOString(),
          end: range.endDate.toISOString(),
        });

        if (selectedFilial) searchParams.set("filial", selectedFilial);

        const response = await fetch(`/api/products/grupos?${searchParams.toString()}`, {
          cache: "no-store",
        });
        if (!response.ok) return;

        const json = (await response.json()) as { data: string[] };
        if (active) setApiGrupos(json.data || []);
      } catch {
        /* ignore */
      }
    })();

    return () => {
      active = false;
    };
  }, [companyKey, range.startDate, range.endDate, selectedFilial]);

  useEffect(() => {
    if (companyKey !== "scarfme") {
      setApiLinhas([]);
      return;
    }

    let active = true;

    void (async () => {
      try {
        const searchParams = new URLSearchParams({
          company: companyKey,
          start: range.startDate.toISOString(),
          end: range.endDate.toISOString(),
        });

        if (selectedFilial) searchParams.set("filial", selectedFilial);
        if (colecao) searchParams.append("colecoes", colecao);
        if (subgrupo) searchParams.append("subgrupos", subgrupo);
        if (grade) searchParams.append("grades", grade);

        const response = await fetch(`/api/products/linhas?${searchParams.toString()}`, {
          cache: "no-store",
        });
        if (!response.ok) return;

        const json = (await response.json()) as { data: string[] };
        if (active) {
          const raw = json.data || [];
          setApiLinhas(raw.filter((item) => !linhasExcluidas.has(item.toUpperCase().trim())));
        }
      } catch {
        /* ignore */
      }
    })();

    return () => {
      active = false;
    };
  }, [
    companyKey,
    range.startDate,
    range.endDate,
    selectedFilial,
    colecao,
    subgrupo,
    grade,
    linhasExcluidas,
  ]);

  useEffect(() => {
    if (companyKey !== "scarfme") {
      setApiColecoes([]);
      return;
    }

    let active = true;

    void (async () => {
      try {
        const searchParams = new URLSearchParams({
          company: companyKey,
          start: range.startDate.toISOString(),
          end: range.endDate.toISOString(),
        });

        if (selectedFilial) searchParams.set("filial", selectedFilial);
        if (linha) searchParams.append("linhas", linha);
        if (subgrupo) searchParams.append("subgrupos", subgrupo);
        if (grade) searchParams.append("grades", grade);

        const response = await fetch(`/api/products/colecoes?${searchParams.toString()}`, {
          cache: "no-store",
        });
        if (!response.ok) return;

        const json = (await response.json()) as { data: string[] };
        if (active) setApiColecoes(json.data || []);
      } catch {
        /* ignore */
      }
    })();

    return () => {
      active = false;
    };
  }, [companyKey, range.startDate, range.endDate, selectedFilial, linha, subgrupo, grade]);

  useEffect(() => {
    if (companyKey !== "scarfme") {
      setApiSubgrupos([]);
      return;
    }

    let active = true;

    void (async () => {
      try {
        const searchParams = new URLSearchParams({
          company: companyKey,
          start: range.startDate.toISOString(),
          end: range.endDate.toISOString(),
        });

        if (selectedFilial) searchParams.set("filial", selectedFilial);
        if (linha) searchParams.append("linhas", linha);
        if (colecao) searchParams.append("colecoes", colecao);
        if (grade) searchParams.append("grades", grade);

        const response = await fetch(`/api/products/subgrupos?${searchParams.toString()}`, {
          cache: "no-store",
        });
        if (!response.ok) return;

        const json = (await response.json()) as { data: string[] };
        if (active) setApiSubgrupos(json.data || []);
      } catch {
        /* ignore */
      }
    })();

    return () => {
      active = false;
    };
  }, [companyKey, range.startDate, range.endDate, selectedFilial, linha, colecao, grade]);

  useEffect(() => {
    if (companyKey !== "scarfme") {
      setApiGrades([]);
      return;
    }

    let active = true;

    void (async () => {
      try {
        const searchParams = new URLSearchParams({
          company: companyKey,
          start: range.startDate.toISOString(),
          end: range.endDate.toISOString(),
        });

        if (selectedFilial) searchParams.set("filial", selectedFilial);
        if (linha) searchParams.append("linhas", linha);
        if (colecao) searchParams.append("colecoes", colecao);
        if (subgrupo) searchParams.append("subgrupos", subgrupo);

        const response = await fetch(`/api/products/grades?${searchParams.toString()}`, {
          cache: "no-store",
        });
        if (!response.ok) return;

        const json = (await response.json()) as { data: string[] };
        if (active) setApiGrades(json.data || []);
      } catch {
        /* ignore */
      }
    })();

    return () => {
      active = false;
    };
  }, [companyKey, range.startDate, range.endDate, selectedFilial, linha, colecao, subgrupo]);

  const consultar = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetchDetalhesPorFilial({
        company: companyKey,
        filial: selectedFilial,
        itens: itensInput,
        grupo: companyKey === "nerd" ? grupo : null,
        linha: companyKey === "scarfme" ? linha : null,
        subgrupo: companyKey === "scarfme" ? subgrupo : null,
        grade: companyKey === "scarfme" ? grade : null,
        colecao: companyKey === "scarfme" ? colecao : null,
        cor,
        mostrarZerados,
        mostrarNegativos,
      });
      setData(response);
    } catch (cause) {
      setData(null);
      setError(cause instanceof Error ? cause.message : "Nao foi possivel carregar o estoque.");
    } finally {
      setLoading(false);
    }
  }, [
    companyKey,
    selectedFilial,
    itensInput,
    grupo,
    linha,
    subgrupo,
    grade,
    colecao,
    cor,
    mostrarZerados,
    mostrarNegativos,
  ]);

  const { pivotRows, filiaisColumns } = useMemo(() => {
    if (!data?.variacoes.length) {
      return { pivotRows: [] as PivotRow[], filiaisColumns: [] as string[] };
    }

    const labelSet = new Set<string>();
    for (const variacao of data.variacoes) {
      labelSet.add(getFilialLabelForDisplay(companyCfg, variacao.filial));
    }

    const orderedFiliais = Array.from(labelSet).sort((left, right) =>
      compareFilialDisplayOrder(left, right, companyCfg),
    );

    const pivotMap = new Map<string, PivotRow>();

    for (const variacao of data.variacoes) {
      const key = `${variacao.produto}\u0000${variacao.cor}`;
      const filialLabel = getFilialLabelForDisplay(companyCfg, variacao.filial);

      if (!pivotMap.has(key)) {
        const emptyFiliais: Record<string, number> = {};
        for (const filial of orderedFiliais) emptyFiliais[filial] = 0;

        pivotMap.set(key, {
          produto: variacao.produto,
          descricao: variacao.descricao,
          linha: variacao.linha,
          subgrupo: variacao.subgrupo,
          grade: variacao.grade,
          colecao: variacao.colecao,
          cor: variacao.cor,
          porFilial: emptyFiliais,
          total: 0,
        });
      }

      const row = pivotMap.get(key);
      if (!row) continue;

      row.porFilial[filialLabel] = (row.porFilial[filialLabel] ?? 0) + variacao.estoque;
    }

    const rows = Array.from(pivotMap.values()).map((row) => ({
      ...row,
      total: sumOnlyPositive(orderedFiliais.map((filial) => row.porFilial[filial] ?? 0)),
    }));

    rows.sort((left, right) => right.total - left.total || left.produto.localeCompare(right.produto));

    return {
      pivotRows: rows,
      filiaisColumns: orderedFiliais,
    };
  }, [data, companyCfg]);

  const availableCores = useMemo(() => {
    if (!pivotRows.length) return apiCores;
    const seen = new Set<string>();
    for (const row of pivotRows) {
      if (row.cor?.trim()) seen.add(row.cor.trim());
    }
    return Array.from(seen).sort();
  }, [pivotRows, apiCores]);

  const availableGrupos = useMemo(() => {
    if (!pivotRows.length) return apiGrupos;
    const seen = new Set<string>();
    for (const row of pivotRows) {
      if (row.linha?.trim()) seen.add(row.linha.trim());
    }
    return Array.from(seen).sort();
  }, [pivotRows, apiGrupos]);

  const availableLinhas = useMemo(() => {
    if (!pivotRows.length) return apiLinhas;
    const seen = new Set<string>();
    for (const row of pivotRows) {
      if (row.linha?.trim() && !linhasExcluidas.has(row.linha.trim().toUpperCase())) {
        seen.add(row.linha.trim());
      }
    }
    return Array.from(seen).sort();
  }, [pivotRows, apiLinhas, linhasExcluidas]);

  const availableSubgrupos = useMemo(() => {
    if (!pivotRows.length) return apiSubgrupos;
    const seen = new Set<string>();
    for (const row of pivotRows) {
      if (row.subgrupo?.trim()) seen.add(row.subgrupo.trim());
    }
    return Array.from(seen).sort();
  }, [pivotRows, apiSubgrupos]);

  const availableGrades = useMemo(() => {
    if (!pivotRows.length) return apiGrades;
    const seen = new Set<string>();
    for (const row of pivotRows) {
      if (row.grade?.trim()) seen.add(row.grade.trim());
    }
    return Array.from(seen).sort();
  }, [pivotRows, apiGrades]);

  const availableColecoes = useMemo(() => {
    if (!pivotRows.length) return apiColecoes;
    const seen = new Set<string>();
    for (const row of pivotRows) {
      if (row.colecao?.trim()) seen.add(row.colecao.trim());
    }
    return Array.from(seen).sort();
  }, [pivotRows, apiColecoes]);

  const filteredPivotRows = useMemo(() => {
    if (!cor) return pivotRows;
    const target = cor.trim().toUpperCase();
    return pivotRows.filter((row) => row.cor.trim().toUpperCase() === target);
  }, [pivotRows, cor]);

  const kpis = useMemo(() => {
    if (!data) return null;

    return {
      itens: filteredPivotRows.length,
      estoqueTotal: sumOnlyPositive(filteredPivotRows.map((row) => row.total)),
      filiais: filiaisColumns.length,
    };
  }, [data, filteredPivotRows, filiaisColumns]);

  const limparFiltros = () => {
    setItensInput("");
    setGrupo(null);
    setLinha(null);
    setSubgrupo(null);
    setGrade(null);
    setColecao(null);
    setCor(null);
    setSelectedFilial(null);
    setMostrarZerados(false);
    setMostrarNegativos(false);
    setData(null);
    setError(null);
  };

  const filtersGridClass =
    companyKey === "nerd"
      ? `${styles.filtersGrid} ${styles.filtersGridNerd}`
      : `${styles.filtersGrid} ${styles.filtersGridScarf}`;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerIcon} aria-hidden />
        <div>
          <h1 className={styles.title}>Estoque consulta</h1>
          <p className={styles.subtitle}>Itens e disponibilidade por filial - {companyName}</p>
        </div>
      </header>

      <p className={styles.scopeNote}>
        O <strong>Estoque total</strong> e a soma das colunas exibidas (lojas oficiais),
        contando apenas saldo positivo. Nao inclui bazar/outlet, depositos de defeito nem
        saldos negativos (mostrados em vermelho apenas como referencia).
      </p>

      <div className={styles.card}>
        <div className={filtersGridClass}>
          <div>
            <label className={styles.fieldLabel} htmlFor="estoque-itens">
              Itens
            </label>
            <div className={styles.searchWrap}>
              <svg className={styles.searchIcon} viewBox="0 0 16 16" fill="none" aria-hidden>
                <path
                  d="M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10Zm0-1.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z"
                  fill="currentColor"
                />
                <path
                  d="m10.5 10.5 3.5 3.5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
              </svg>
              <input
                id="estoque-itens"
                className={styles.searchInput}
                placeholder="SKU, nome, grade ou cód. barras - separe por virgula"
                value={itensInput}
                onChange={(event) => setItensInput(event.target.value)}
                autoComplete="off"
              />
            </div>
          </div>

          <div>
            <label className={styles.fieldLabel} htmlFor="estoque-cor">
              Cor
            </label>
            <select
              id="estoque-cor"
              className={styles.select}
              value={cor ?? ""}
              onChange={(event) => setCor(event.target.value || null)}
            >
              <option value="">Todas</option>
              {availableCores.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>

          {companyKey === "nerd" ? (
            <div>
              <label className={styles.fieldLabel} htmlFor="estoque-grupo">
                Grupo
              </label>
              <select
                id="estoque-grupo"
                className={styles.select}
                value={grupo ?? ""}
                onChange={(event) => setGrupo(event.target.value || null)}
              >
                <option value="">Todos</option>
                {availableGrupos.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <>
              <div>
                <label className={styles.fieldLabel} htmlFor="estoque-linha">
                  Linha
                </label>
                <select
                  id="estoque-linha"
                  className={styles.select}
                  value={linha ?? ""}
                  onChange={(event) => setLinha(event.target.value || null)}
                >
                  <option value="">Todas</option>
                  {availableLinhas.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={styles.fieldLabel} htmlFor="estoque-subgrupo">
                  Subgrupo
                </label>
                <select
                  id="estoque-subgrupo"
                  className={styles.select}
                  value={subgrupo ?? ""}
                  onChange={(event) => setSubgrupo(event.target.value || null)}
                >
                  <option value="">Todos</option>
                  {availableSubgrupos.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={styles.fieldLabel} htmlFor="estoque-grade">
                  Grade
                </label>
                <select
                  id="estoque-grade"
                  className={styles.select}
                  value={grade ?? ""}
                  onChange={(event) => setGrade(event.target.value || null)}
                >
                  <option value="">Todas</option>
                  {availableGrades.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={styles.fieldLabel} htmlFor="estoque-colecao">
                  Colecao
                </label>
                <select
                  id="estoque-colecao"
                  className={styles.select}
                  value={colecao ?? ""}
                  onChange={(event) => setColecao(event.target.value || null)}
                >
                  <option value="">Todas</option>
                  {availableColecoes.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          <div className={styles.filialField}>
            <FilialFilter
              companyKey={companyKey}
              value={selectedFilial}
              onChange={setSelectedFilial}
              label="Filial"
              module="inventory"
            />
          </div>
        </div>

        <div className={styles.rowBottom}>
          <div className={styles.checks}>
            <label className={styles.checkLabel}>
              <input
                type="checkbox"
                checked={mostrarZerados}
                onChange={(event) => setMostrarZerados(event.target.checked)}
              />
              Mostrar zerados
            </label>
            <label className={styles.checkLabel}>
              <input
                type="checkbox"
                checked={mostrarNegativos}
                onChange={(event) => setMostrarNegativos(event.target.checked)}
              />
              Mostrar negativos
            </label>
          </div>
          <button type="button" className={styles.clearBtn} onClick={limparFiltros}>
            <span aria-hidden>x</span> Limpar filtros
          </button>
        </div>
      </div>

      <div className={styles.actionsRow}>
        <button
          type="button"
          className={styles.primaryBtn}
          onClick={() => void consultar()}
          disabled={loading}
        >
          {loading ? "Consultando..." : "Consultar"}
        </button>
      </div>

      {error ? <div className={styles.error}>{error}</div> : null}

      {kpis ? (
        <div className={styles.kpis}>
          <div className={styles.kpi}>
            <div className={styles.kpiLabel}>Itens encontrados</div>
            <div className={styles.kpiValue}>{formatInt(kpis.itens)}</div>
          </div>
          <div className={styles.kpi}>
            <div className={styles.kpiLabel}>Estoque total</div>
            <div className={styles.kpiValue}>{formatInt(kpis.estoqueTotal)}</div>
          </div>
          <div className={styles.kpi}>
            <div className={styles.kpiLabel}>Filiais visiveis</div>
            <div className={styles.kpiValue}>{formatInt(kpis.filiais)}</div>
          </div>
        </div>
      ) : null}


      {loading ? <div className={styles.loading}>Carregando...</div> : null}

      {!loading && data && filteredPivotRows.length === 0 ? (
        <div className={styles.empty}>Nenhuma variacao encontrada com os filtros atuais.</div>
      ) : null}

      {!loading && filteredPivotRows.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.skuColumn}>Produto</th>
                <th className={styles.itemColumn}>Desc. produto</th>
                <th className={`${styles.num} ${styles.totalHeader}`}>Estoque total</th>
                {filiaisColumns.map((filial) => (
                  <th key={filial} className={styles.num}>
                    {filial}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredPivotRows.map((row) => {
                const highlightedFiliais = getHighlightedFiliais(row, filiaisColumns);
                const meta = buildItemMeta(row, companyKey);

                return (
                  <tr key={`${row.produto}-${row.cor}`}>
                    <td className={`${styles.sku} ${styles.skuColumn}`}>{row.produto}</td>
                    <td className={styles.itemColumn}>
                      <span className={styles.itemName}>{row.descricao || "-"}</span>
                      <span className={styles.itemMeta}>{meta || "-"}</span>
                    </td>
                    <td
                      className={[
                        styles.num,
                        styles.totalCell,
                        row.total < 0 ? styles.neg : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <span className={styles.totalValue}>{formatInt(row.total)}</span>
                    </td>
                    {filiaisColumns.map((filial) => {
                      const value = row.porFilial[filial] ?? 0;

                      return (
                        <td
                          key={filial}
                          className={[
                            styles.num,
                            styles.branchCell,
                            value < 0 ? styles.neg : "",
                            value === 0 ? styles.zeroCell : "",
                            highlightedFiliais.has(filial) ? styles.branchCellHighlight : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          <span className={styles.branchValue}>{formatInt(value)}</span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
