"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import FilialFilter from "@/components/filters/FilialFilter";
import MultiSelectFilter, { type MultiSelectOption } from "@/components/filters/MultiSelectFilter";
import type { CompanyKey } from "@/lib/config/company";
import type { EntradaPorFilial, ProdutoParadoDetalhado } from "@/lib/repositories/controleEstoque";
import { exportProdutosParadosXlsx } from "@/lib/utils/exportProdutosParadosXlsx";

import styles from "./ProdutosParadosPage.module.css";

interface ProdutosParadosPageProps {
  companyKey: CompanyKey;
  companyName: string;
}

type SortKey = "diasParado" | "estoque" | "linha" | "produto" | "ultimaVenda";
type SortDir = "asc" | "desc";

const MIN_DIAS_OPTIONS = [
  { label: "Todos", value: 0 },
  { label: "30+ dias", value: 30 },
  { label: "60+ dias", value: 60 },
  { label: "90+ dias", value: 90 },
  { label: "120+ dias", value: 120 },
  { label: "150+ dias", value: 150 },
  { label: "180+ dias", value: 180 },
  { label: "Nunca vendeu", value: 9998 },
] as const;

function formatDate(iso: string | null): string {
  if (!iso) return "Nunca";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function diasLabel(dias: number): string {
  if (dias >= 9999) return "Nunca vendeu";
  return `${dias} dias`;
}

function diasColorClass(dias: number, styles: Record<string, string>): string {
  if (dias >= 9999) return styles.diasNunca;
  if (dias >= 180) return styles.diasCritico;
  if (dias >= 120) return styles.diasAlto;
  if (dias >= 60) return styles.diasMedio;
  if (dias >= 30) return styles.diasBaixo;
  return styles.diasOk;
}

async function fetchParados(
  company: string,
  filial: string | null,
  minDias: number,
  grupos: string[],
  linhas: string[],
  colecoes: string[],
  subgrupos: string[],
  grades: string[]
): Promise<ProdutoParadoDetalhado[]> {
  const params = new URLSearchParams({ company, minDias: String(minDias) });
  if (filial) params.set("filial", filial);
  grupos.forEach(g => params.append("grupos", g));
  linhas.forEach(l => params.append("linhas", l));
  colecoes.forEach(c => params.append("colecoes", c));
  subgrupos.forEach(s => params.append("subgrupos", s));
  grades.forEach(g => params.append("grades", g));

  const res = await fetch(`/api/produtos-parados?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Erro ao carregar produtos parados");
  const json = (await res.json()) as { data: ProdutoParadoDetalhado[] };
  return json.data;
}

export default function ProdutosParadosPage({ companyKey, companyName }: ProdutosParadosPageProps) {
  const [selectedFilial, setSelectedFilial] = useState<string | null>(null);
  const [minDias, setMinDias] = useState(30);
  const [selectedGrupos, setSelectedGrupos] = useState<string[]>([]);
  const [selectedLinhas, setSelectedLinhas] = useState<string[]>([]);
  const [selectedColecoes, setSelectedColecoes] = useState<string[]>([]);
  const [selectedSubgrupos, setSelectedSubgrupos] = useState<string[]>([]);
  const [selectedGrades, setSelectedGrades] = useState<string[]>([]);

  const [availableGrupos, setAvailableGrupos] = useState<string[]>([]);
  const [availableLinhas, setAvailableLinhas] = useState<string[]>([]);
  // Opções { value: código, label: "DESCRIÇÃO (CÓDIGO)" } — filtra por código.
  const [availableColecoes, setAvailableColecoes] = useState<MultiSelectOption[]>([]);
  const [availableSubgrupos, setAvailableSubgrupos] = useState<string[]>([]);
  const [availableGrades, setAvailableGrades] = useState<string[]>([]);

  const [data, setData] = useState<ProdutoParadoDetalhado[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sortKey, setSortKey] = useState<SortKey>("diasParado");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);

  const [tooltipKey, setTooltipKey] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const [, setTooltipTick] = useState(0);
  const tooltipCache = useRef<Map<string, EntradaPorFilial[] | "loading" | "error">>(new Map());

  const isNerd = companyKey === "nerd";
  const isScarfme = companyKey === "scarfme";

  useEffect(() => {
    if (!isNerd) { setAvailableGrupos([]); return; }
    let active = true;
    fetch(`/api/products/grupos?company=${companyKey}`, { cache: "no-store" })
      .then(r => r.json())
      .then((json: { data: string[] }) => { if (active) setAvailableGrupos(json.data ?? []); })
      .catch(() => {});
    return () => { active = false; };
  }, [companyKey, isNerd]);

  useEffect(() => {
    if (!isScarfme) { setAvailableLinhas([]); return; }
    let active = true;
    fetch(`/api/products/linhas?company=${companyKey}`, { cache: "no-store" })
      .then(r => r.json())
      .then((json: { data: string[] }) => { if (active) setAvailableLinhas(json.data ?? []); })
      .catch(() => {});
    return () => { active = false; };
  }, [companyKey, isScarfme]);

  useEffect(() => {
    if (!isScarfme) { setAvailableColecoes([]); return; }
    let active = true;
    fetch(`/api/products/colecoes?company=${companyKey}&includeDescriptions=1`, { cache: "no-store" })
      .then(r => r.json())
      .then((json: { data: MultiSelectOption[] }) => { if (active) setAvailableColecoes(json.data ?? []); })
      .catch(() => {});
    return () => { active = false; };
  }, [companyKey, isScarfme]);

  useEffect(() => {
    if (!isScarfme) { setAvailableSubgrupos([]); return; }
    let active = true;
    fetch(`/api/products/subgrupos?company=${companyKey}`, { cache: "no-store" })
      .then(r => r.json())
      .then((json: { data: string[] }) => { if (active) setAvailableSubgrupos(json.data ?? []); })
      .catch(() => {});
    return () => { active = false; };
  }, [companyKey, isScarfme]);

  useEffect(() => {
    if (!isScarfme) { setAvailableGrades([]); return; }
    let active = true;
    fetch(`/api/products/grades?company=${companyKey}`, { cache: "no-store" })
      .then(r => r.json())
      .then((json: { data: string[] }) => { if (active) setAvailableGrades(json.data ?? []); })
      .catch(() => {});
    return () => { active = false; };
  }, [companyKey, isScarfme]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    const effectiveMinDias = minDias >= 9998 ? 0 : minDias;

    fetchParados(
      companyKey,
      selectedFilial,
      effectiveMinDias,
      selectedGrupos,
      selectedLinhas,
      selectedColecoes,
      selectedSubgrupos,
      selectedGrades
    )
      .then(result => {
        if (!active) return;
        const filtered = minDias >= 9998 ? result.filter(r => r.diasParado >= 9999) : result;
        setData(filtered);
      })
      .catch(err => {
        if (active) setError(err instanceof Error ? err.message : "Erro ao carregar dados");
      })
      .finally(() => { if (active) setLoading(false); });

    return () => { active = false; };
  }, [companyKey, selectedFilial, minDias, selectedGrupos, selectedLinhas, selectedColecoes, selectedSubgrupos, selectedGrades]);

  const handleSort = useCallback((key: SortKey) => {
    if (key === sortKey) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "diasParado" || key === "estoque" ? "desc" : "asc");
    }
  }, [sortKey]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return data;
    return data.filter(r =>
      r.produto.toLowerCase().includes(term) ||
      r.descricao.toLowerCase().includes(term) ||
      r.cor.toLowerCase().includes(term) ||
      r.linha.toLowerCase().includes(term) ||
      r.subgrupo.toLowerCase().includes(term) ||
      r.colecao.toLowerCase().includes(term) ||
      r.grade.toLowerCase().includes(term)
    );
  }, [data, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "diasParado":
          cmp = a.diasParado - b.diasParado;
          break;
        case "estoque":
          cmp = a.estoque - b.estoque;
          break;
        case "linha":
          cmp = a.linha.localeCompare(b.linha, "pt-BR");
          break;
        case "produto":
          cmp = a.produto.localeCompare(b.produto, "pt-BR");
          break;
        case "ultimaVenda":
          cmp = (a.ultimaVenda ?? "0000-00-00").localeCompare(b.ultimaVenda ?? "0000-00-00");
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  const kpis = useMemo(() => {
    const totalProdutos = filtered.length;
    const totalUnidades = filtered.reduce((s, r) => s + r.estoque, 0);
    const maiorDias = filtered.reduce((max, r) => Math.max(max, r.diasParado >= 9999 ? 9999 : r.diasParado), 0);
    const nuncaVendeu = filtered.filter(r => r.diasParado >= 9999).length;
    return { totalProdutos, totalUnidades, maiorDias, nuncaVendeu };
  }, [filtered]);

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return <span className={styles.sortNeutral}>↕</span>;
    return <span className={styles.sortActive}>{sortDir === "asc" ? "↑" : "↓"}</span>;
  };

  const handleExport = useCallback(() => {
    if (exporting || sorted.length === 0) return;
    setExporting(true);
    try {
      exportProdutosParadosXlsx(sorted, companyName, minDias, selectedFilial);
    } finally {
      setExporting(false);
    }
  }, [sorted, companyName, minDias, selectedFilial, exporting]);

  const thClass = (key: SortKey) =>
    [styles.th, styles.thSortable, sortKey === key ? styles.thActive : ""].filter(Boolean).join(" ");

  const thNumClass = (key: SortKey) =>
    [styles.th, styles.thNum, styles.thSortable, sortKey === key ? styles.thActive : ""].filter(Boolean).join(" ");

  const handleNuncaVendeuEnter = useCallback((produto: string, corCodigo: string, e: React.MouseEvent<HTMLSpanElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltipPos({ x: rect.left + rect.width / 2, y: rect.top });
    const key = `${produto}|${corCodigo}`;
    setTooltipKey(key);
    // Só reaproveita resultado já carregado (array). "loading"/"error" não bloqueiam novo fetch.
    const cached = tooltipCache.current.get(key);
    if (Array.isArray(cached) || cached === "loading") return;
    tooltipCache.current.set(key, "loading");
    setTooltipTick(t => t + 1);
    fetch(`/api/produtos-parados/entradas-por-filial?company=${encodeURIComponent(companyKey)}&produto=${encodeURIComponent(produto)}&cor=${encodeURIComponent(corCodigo)}`, { cache: "no-store" })
      .then(r => r.json())
      .then((json: { data?: EntradaPorFilial[] }) => {
        tooltipCache.current.set(key, json.data ?? []);
        setTooltipTick(t => t + 1);
      })
      .catch(() => {
        tooltipCache.current.delete(key);
        setTooltipTick(t => t + 1);
      });
  }, [companyKey]);

  const handleNuncaVendeuLeave = useCallback(() => {
    setTooltipKey(null);
    setTooltipPos(null);
  }, []);

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.iconWrapper}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
              <path d="M12 7v5l3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <h1 className={styles.title}>Produtos Parados</h1>
            <p className={styles.subtitle}>Estoque na rede sem venda — calculado em relação a hoje</p>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className={styles.kpisRow}>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>PRODUTOS PARADOS</div>
          <div className={styles.kpiValue}>{kpis.totalProdutos.toLocaleString("pt-BR")}</div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>UNIDADES PARADAS</div>
          <div className={styles.kpiValue}>{kpis.totalUnidades.toLocaleString("pt-BR")}</div>
        </div>
        <div className={`${styles.kpiCard} ${kpis.maiorDias >= 180 ? styles.kpiCardAlert : ""}`}>
          <div className={styles.kpiLabel}>MAIOR PARADO</div>
          <div className={styles.kpiValue}>
            {kpis.maiorDias >= 9999 ? "Nunca vendeu" : `${kpis.maiorDias} dias`}
          </div>
        </div>
        <div className={`${styles.kpiCard} ${kpis.nuncaVendeu > 0 ? styles.kpiCardAlert : ""}`}>
          <div className={styles.kpiLabel}>NUNCA VENDEU</div>
          <div className={styles.kpiValue}>{kpis.nuncaVendeu.toLocaleString("pt-BR")}</div>
        </div>
      </div>

      {/* Filtros */}
      <div className={styles.filtersRow}>
        <FilialFilter companyKey={companyKey} value={selectedFilial} onChange={setSelectedFilial} />
        {isNerd && (
          <MultiSelectFilter label="Grupo" value={selectedGrupos} options={availableGrupos} onChange={setSelectedGrupos} />
        )}
        {isScarfme && (
          <>
            <MultiSelectFilter label="Linha" value={selectedLinhas} options={availableLinhas} onChange={setSelectedLinhas} />
            <MultiSelectFilter label="Coleção" value={selectedColecoes} options={availableColecoes} onChange={setSelectedColecoes} />
            <MultiSelectFilter label="Subgrupo" value={selectedSubgrupos} options={availableSubgrupos} onChange={setSelectedSubgrupos} />
            <MultiSelectFilter label="Grade" value={selectedGrades} options={availableGrades} onChange={setSelectedGrades} />
          </>
        )}
      </div>

      {/* Seletor de período + busca */}
      <div className={styles.controlsRow}>
        <div className={styles.diasButtons}>
          {MIN_DIAS_OPTIONS.map(opt => (
            <button
              key={opt.value}
              className={`${styles.diasBtn} ${minDias === opt.value ? styles.diasBtnActive : ""}`}
              onClick={() => setMinDias(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          className={styles.searchInput}
          placeholder="Buscar produto, cor, linha..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Tabela */}
      {loading ? (
        <div className={styles.feedback}>Carregando produtos parados...</div>
      ) : error ? (
        <div className={`${styles.feedback} ${styles.feedbackError}`}>{error}</div>
      ) : sorted.length === 0 ? (
        <div className={styles.feedback}>Nenhum produto encontrado com os filtros selecionados.</div>
      ) : (
        <div className={styles.tableWrapper}>
          <div className={styles.tableTopBar}>
            <span className={styles.tableCount}>
              {sorted.length.toLocaleString("pt-BR")} produto{sorted.length !== 1 ? "s" : ""}
            </span>
            <button
              className={styles.exportBtn}
              onClick={handleExport}
              disabled={exporting || sorted.length === 0}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <polyline points="7 10 12 15 17 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <line x1="12" y1="15" x2="12" y2="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              {exporting ? "Exportando..." : "Exportar XLSX"}
            </button>
          </div>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={thClass("produto")} onClick={() => handleSort("produto")}>
                    Produto {sortIcon("produto")}
                  </th>
                  <th className={styles.th}>Descrição</th>
                  <th className={styles.th}>Cor</th>
                  <th className={styles.th}>Grade</th>
                  <th className={thClass("linha")} onClick={() => handleSort("linha")}>
                    Linha {sortIcon("linha")}
                  </th>
                  <th className={styles.th}>Subgrupo</th>
                  <th className={styles.th}>Coleção</th>
                  <th className={thNumClass("estoque")} onClick={() => handleSort("estoque")}>
                    Estoque {sortIcon("estoque")}
                  </th>
                  <th className={thNumClass("diasParado")} onClick={() => handleSort("diasParado")}>
                    Dias Parado {sortIcon("diasParado")}
                  </th>
                  <th className={thNumClass("ultimaVenda")} onClick={() => handleSort("ultimaVenda")}>
                    Última Venda {sortIcon("ultimaVenda")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row, i) => (
                  <tr key={`${row.produto}-${row.cor}-${i}`} className={styles.tr}>
                    <td className={styles.tdMono}>{row.produto}</td>
                    <td className={styles.tdDesc} title={row.descricao}>{row.descricao}</td>
                    <td className={styles.td}>{row.cor}</td>
                    <td className={styles.td}>{row.grade}</td>
                    <td className={styles.td}>{row.linha}</td>
                    <td className={styles.td}>{row.subgrupo}</td>
                    <td className={styles.td}>{row.colecao}</td>
                    <td className={`${styles.tdNum}`}>{row.estoque.toLocaleString("pt-BR")}</td>
                    <td className={`${styles.tdNum}`}>
                      {row.diasParado >= 9999 ? (
                        <span
                          className={`${styles.diasBadge} ${styles.diasNunca}`}
                          onMouseEnter={(e) => handleNuncaVendeuEnter(row.produto, row.corCodigo, e)}
                          onMouseLeave={handleNuncaVendeuLeave}
                        >
                          Nunca vendeu
                        </span>
                      ) : (
                        <span className={`${styles.diasBadge} ${diasColorClass(row.diasParado, styles)}`}>
                          {diasLabel(row.diasParado)}
                        </span>
                      )}
                    </td>
                    <td className={`${styles.tdNum} ${styles.tdDate}`}>
                      {formatDate(row.ultimaVenda)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tooltipKey && tooltipPos && typeof document !== "undefined" && createPortal(
        (() => {
          const state = tooltipCache.current.get(tooltipKey);
          return (
            <div
              className={styles.entradaTooltip}
              style={{ position: "fixed", left: tooltipPos.x, top: tooltipPos.y - 8, transform: "translate(-50%, -100%)" }}
            >
              <div className={styles.entradaTooltipTitle}>Última entrada por filial</div>
              {state === "loading" && <div className={styles.entradaTooltipEmpty}>Carregando...</div>}
              {state === "error" && <div className={styles.entradaTooltipEmpty}>Erro ao carregar</div>}
              {Array.isArray(state) && state.length === 0 && (
                <div className={styles.entradaTooltipEmpty}>Nenhuma entrada encontrada</div>
              )}
              {Array.isArray(state) && state.map(e => (
                <div key={e.codFilial} className={styles.entradaTooltipRow}>
                  <span className={styles.entradaTooltipFilial}>{e.display}</span>
                  <span className={styles.entradaTooltipDate}>{formatDate(e.ultimaEntrada)}</span>
                </div>
              ))}
            </div>
          );
        })(),
        document.body
      )}
    </div>
  );
}
