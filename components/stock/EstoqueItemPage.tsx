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
  // Negativos devem ser exibidos (quando habilitado), mas não entram na soma.
  return values.reduce((s, v) => s + (v > 0 ? v : 0), 0);
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
  mostrarZerados: boolean;
  mostrarNegativos: boolean;
}): Promise<DetalhesPorFilialResponse> {
  const sp = new URLSearchParams({ company: params.company });
  if (params.filial) sp.set("filial", params.filial);
  if (params.itens.trim()) sp.set("itens", params.itens.trim());
  if (params.grupo) sp.set("grupo", params.grupo);
  if (params.linha) sp.set("linha", params.linha);
  if (params.subgrupo) sp.set("subgrupo", params.subgrupo);
  if (params.grade) sp.set("grade", params.grade);
  if (params.colecao) sp.set("colecao", params.colecao);
  if (params.mostrarZerados) sp.set("mostrarZerados", "1");
  if (params.mostrarNegativos) sp.set("mostrarNegativos", "1");

  const res = await fetch(`/api/controle-estoque/detalhes-por-filial?${sp.toString()}`, {
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as { data?: DetalhesPorFilialResponse; error?: string };
  if (!res.ok) {
    throw new Error(body.error || `Erro ao consultar estoque (${res.status})`);
  }
  if (!body.data) {
    throw new Error("Resposta inválida do servidor");
  }
  return body.data;
}

export default function EstoqueItemPage({ companyKey, companyName }: EstoqueItemPageProps) {
  const companyCfg = useMemo(() => resolveCompany(companyKey), [companyKey]);
  const range = useMemo(() => {
    const r = getCurrentMonthRange();
    return { startDate: r.start, endDate: r.end };
  }, []);

  const linhasExcluidas = useMemo(() => {
    if (companyCfg?.excludedLines && companyCfg.excludedLines.length > 0) {
      return new Set(companyCfg.excludedLines.map((l) => l.toUpperCase().trim()));
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
  const [mostrarZerados, setMostrarZerados] = useState(false);
  const [mostrarNegativos, setMostrarNegativos] = useState(false);

  const [availableGrupos, setAvailableGrupos] = useState<string[]>([]);
  const [availableLinhas, setAvailableLinhas] = useState<string[]>([]);
  const [availableSubgrupos, setAvailableSubgrupos] = useState<string[]>([]);
  const [availableGrades, setAvailableGrades] = useState<string[]>([]);
  const [availableColecoes, setAvailableColecoes] = useState<string[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DetalhesPorFilialResponse | null>(null);

  useEffect(() => {
    if (companyKey !== "nerd") {
      setAvailableGrupos([]);
      return;
    }
    let active = true;
    (async () => {
      try {
        const sp = new URLSearchParams({
          company: companyKey,
          start: range.startDate.toISOString(),
          end: range.endDate.toISOString(),
        });
        if (selectedFilial) sp.set("filial", selectedFilial);
        const res = await fetch(`/api/products/grupos?${sp.toString()}`, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { data: string[] };
        if (active) setAvailableGrupos(json.data || []);
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
      setAvailableLinhas([]);
      return;
    }
    let active = true;
    (async () => {
      try {
        const sp = new URLSearchParams({
          company: companyKey,
          start: range.startDate.toISOString(),
          end: range.endDate.toISOString(),
        });
        if (selectedFilial) sp.set("filial", selectedFilial);
        if (colecao) sp.append("colecoes", colecao);
        if (subgrupo) sp.append("subgrupos", subgrupo);
        if (grade) sp.append("grades", grade);
        const res = await fetch(`/api/products/linhas?${sp.toString()}`, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { data: string[] };
        if (active) {
          const raw = json.data || [];
          setAvailableLinhas(
            raw.filter((l) => !linhasExcluidas.has(l.toUpperCase().trim())),
          );
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      active = false;
    };
  }, [companyKey, range.startDate, range.endDate, selectedFilial, colecao, subgrupo, grade, linhasExcluidas]);

  useEffect(() => {
    if (companyKey !== "scarfme") {
      setAvailableColecoes([]);
      return;
    }
    let active = true;
    (async () => {
      try {
        const sp = new URLSearchParams({
          company: companyKey,
          start: range.startDate.toISOString(),
          end: range.endDate.toISOString(),
        });
        if (selectedFilial) sp.set("filial", selectedFilial);
        if (linha) sp.append("linhas", linha);
        if (subgrupo) sp.append("subgrupos", subgrupo);
        if (grade) sp.append("grades", grade);
        const res = await fetch(`/api/products/colecoes?${sp.toString()}`, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { data: string[] };
        if (active) setAvailableColecoes(json.data || []);
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
      setAvailableSubgrupos([]);
      return;
    }
    let active = true;
    (async () => {
      try {
        const sp = new URLSearchParams({
          company: companyKey,
          start: range.startDate.toISOString(),
          end: range.endDate.toISOString(),
        });
        if (selectedFilial) sp.set("filial", selectedFilial);
        if (linha) sp.append("linhas", linha);
        if (colecao) sp.append("colecoes", colecao);
        if (grade) sp.append("grades", grade);
        const res = await fetch(`/api/products/subgrupos?${sp.toString()}`, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { data: string[] };
        if (active) setAvailableSubgrupos(json.data || []);
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
      setAvailableGrades([]);
      return;
    }
    let active = true;
    (async () => {
      try {
        const sp = new URLSearchParams({
          company: companyKey,
          start: range.startDate.toISOString(),
          end: range.endDate.toISOString(),
        });
        if (selectedFilial) sp.set("filial", selectedFilial);
        if (linha) sp.append("linhas", linha);
        if (colecao) sp.append("colecoes", colecao);
        if (subgrupo) sp.append("subgrupos", subgrupo);
        const res = await fetch(`/api/products/grades?${sp.toString()}`, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { data: string[] };
        if (active) setAvailableGrades(json.data || []);
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
      const res = await fetchDetalhesPorFilial({
        company: companyKey,
        filial: selectedFilial,
        itens: itensInput,
        grupo: companyKey === "nerd" ? grupo : null,
        linha: companyKey === "scarfme" ? linha : null,
        subgrupo: companyKey === "scarfme" ? subgrupo : null,
        grade: companyKey === "scarfme" ? grade : null,
        colecao: companyKey === "scarfme" ? colecao : null,
        mostrarZerados,
        mostrarNegativos,
      });
      setData(res);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Não foi possível carregar o estoque.");
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
    mostrarZerados,
    mostrarNegativos,
  ]);

  const { pivotRows, filiaisColumns } = useMemo(() => {
    if (!data?.variacoes.length) {
      return { pivotRows: [] as PivotRow[], filiaisColumns: [] as string[] };
    }
    const labelSet = new Set<string>();
    for (const v of data.variacoes) {
      labelSet.add(getFilialLabelForDisplay(companyCfg, v.filial));
    }
    const filiaisColumns = Array.from(labelSet).sort((a, b) =>
      compareFilialDisplayOrder(a, b, companyCfg),
    );

    const map = new Map<string, PivotRow>();
    for (const v of data.variacoes) {
      const key = `${v.produto}\u0000${v.cor}`;
      const col = getFilialLabelForDisplay(companyCfg, v.filial);
      if (!map.has(key)) {
        const empty: Record<string, number> = {};
        for (const f of filiaisColumns) empty[f] = 0;
        map.set(key, {
          produto: v.produto,
          descricao: v.descricao,
          linha: v.linha,
          subgrupo: v.subgrupo,
          grade: v.grade,
          colecao: v.colecao,
          cor: v.cor,
          porFilial: empty,
          total: 0,
        });
      }
      const row = map.get(key)!;
      row.porFilial[col] = (row.porFilial[col] ?? 0) + v.estoque;
    }

    const pivotRows = Array.from(map.values()).map((row) => {
      const total = sumOnlyPositive(filiaisColumns.map((f) => row.porFilial[f] ?? 0));
      return { ...row, total };
    });

    pivotRows.sort((a, b) => b.total - a.total || a.produto.localeCompare(b.produto));
    return { pivotRows, filiaisColumns };
  }, [data, companyCfg]);

  const kpis = useMemo(() => {
    if (!data) return null;
    return {
      itens: pivotRows.length,
      estoqueTotal: sumOnlyPositive(pivotRows.map((r) => r.total)),
      filiais: filiaisColumns.length,
    };
  }, [data, pivotRows.length, filiaisColumns.length]);

  const totaisPorFilial = useMemo(() => {
    if (!data || filiaisColumns.length === 0) return [];
    return filiaisColumns.map((filialLabel) => {
      const total = sumOnlyPositive(pivotRows.map((r) => r.porFilial[filialLabel] ?? 0));
      return { filialLabel, total };
    });
  }, [data, filiaisColumns, pivotRows]);

  const limparFiltros = () => {
    setItensInput("");
    setGrupo(null);
    setLinha(null);
    setSubgrupo(null);
    setGrade(null);
    setColecao(null);
    setSelectedFilial(null);
    setMostrarZerados(false);
    setMostrarNegativos(false);
    setData(null);
    setError(null);
  };

  const selectClass = styles.select;
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
          <p className={styles.subtitle}>
            Itens e disponibilidade por filial — {companyName}
          </p>
        </div>
      </header>

      <p className={styles.hint}>
        Informe SKUs ou trechos de nome (separados por vírgula) e/ou use os filtros. Por padrão são
        exibidas apenas variações com estoque positivo; marque as opções abaixo para incluir zeradas ou
        negativas.
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
                placeholder="SKU, nome ou grade — separe por vírgula"
                value={itensInput}
                onChange={(e) => setItensInput(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>

          {companyKey === "nerd" ? (
            <div>
              <label className={styles.fieldLabel} htmlFor="estoque-grupo">
                Grupo
              </label>
              <select
                id="estoque-grupo"
                className={selectClass}
                value={grupo ?? ""}
                onChange={(e) => setGrupo(e.target.value || null)}
              >
                <option value="">Todos</option>
                {availableGrupos.map((g) => (
                  <option key={g} value={g}>
                    {g}
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
                  className={selectClass}
                  value={linha ?? ""}
                  onChange={(e) => setLinha(e.target.value || null)}
                >
                  <option value="">Todas</option>
                  {availableLinhas.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={styles.fieldLabel} htmlFor="estoque-sub">
                  Subgrupo
                </label>
                <select
                  id="estoque-sub"
                  className={selectClass}
                  value={subgrupo ?? ""}
                  onChange={(e) => setSubgrupo(e.target.value || null)}
                >
                  <option value="">Todos</option>
                  {availableSubgrupos.map((s) => (
                    <option key={s} value={s}>
                      {s}
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
                  className={selectClass}
                  value={grade ?? ""}
                  onChange={(e) => setGrade(e.target.value || null)}
                >
                  <option value="">Todas</option>
                  {availableGrades.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={styles.fieldLabel} htmlFor="estoque-col">
                  Coleção
                </label>
                <select
                  id="estoque-col"
                  className={selectClass}
                  value={colecao ?? ""}
                  onChange={(e) => setColecao(e.target.value || null)}
                >
                  <option value="">Todas</option>
                  {availableColecoes.map((c) => (
                    <option key={c} value={c}>
                      {c}
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
                onChange={(e) => setMostrarZerados(e.target.checked)}
              />
              Mostrar zerados
            </label>
            <label className={styles.checkLabel}>
              <input
                type="checkbox"
                checked={mostrarNegativos}
                onChange={(e) => setMostrarNegativos(e.target.checked)}
              />
              Mostrar negativos
            </label>
          </div>
          <button type="button" className={styles.clearBtn} onClick={limparFiltros}>
            <span aria-hidden>×</span> Limpar filtros
          </button>
        </div>
      </div>

      <div className={styles.actionsRow}>
        <button type="button" className={styles.primaryBtn} onClick={() => void consultar()} disabled={loading}>
          {loading ? "Consultando…" : "Consultar"}
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
            <div className={styles.kpiLabel}>Filiais visíveis</div>
            <div className={styles.kpiValue}>{formatInt(kpis.filiais)}</div>
          </div>
        </div>
      ) : null}

      {kpis && !selectedFilial && totaisPorFilial.length > 0 ? (
        <section className={styles.branchTotals}>
          <div className={styles.branchTotalsHeader}>
            <div className={styles.branchTotalsTitle}>Total por filial</div>
            <div className={styles.branchTotalsSubtitle}>
              Composição do “Estoque total” (somente positivos)
            </div>
          </div>
          <div className={styles.branchTotalsGrid}>
            {totaisPorFilial.map((t) => (
              <div key={t.filialLabel} className={styles.branchTotalCard}>
                <div className={styles.branchTotalLabel}>{t.filialLabel}</div>
                <div className={styles.branchTotalValue}>{formatInt(t.total)}</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {loading ? <div className={styles.loading}>Carregando…</div> : null}

      {!loading && data && pivotRows.length === 0 ? (
        <div className={styles.empty}>Nenhuma variação encontrada com os filtros atuais.</div>
      ) : null}

      {!loading && pivotRows.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Item</th>
                {companyKey === "scarfme" ? <th>Grade</th> : null}
                <th>Cor</th>
                {filiaisColumns.map((f) => (
                  <th key={f} className={styles.num}>
                    {f}
                  </th>
                ))}
                <th className={styles.num}>Total</th>
              </tr>
            </thead>
            <tbody>
              {pivotRows.map((row) => (
                <tr key={`${row.produto}-${row.cor}`}>
                  <td className={styles.sku}>{row.produto}</td>
                  <td>
                    <span className={styles.itemName}>{row.descricao || "—"}</span>
                    <span className={styles.itemMeta}>
                      {companyKey === "nerd"
                        ? row.linha || "—"
                        : [row.linha, row.colecao].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </td>
                  {companyKey === "scarfme" ? (
                    <td>
                      {row.grade ? <span className={styles.pill}>{row.grade}</span> : "—"}
                    </td>
                  ) : null}
                  <td>{row.cor || "—"}</td>
                  {filiaisColumns.map((f) => {
                    const v = row.porFilial[f] ?? 0;
                    return (
                      <td key={f} className={`${styles.num} ${v < 0 ? styles.neg : ""}`}>
                        {formatInt(v)}
                      </td>
                    );
                  })}
                  <td className={`${styles.num} ${row.total < 0 ? styles.neg : ""}`}>
                    {formatInt(row.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
