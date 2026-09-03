"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import MultiSelectFilter, { type MultiSelectOption } from "@/components/filters/MultiSelectFilter";
import { formatDateForQuery } from "@/lib/utils/date";
import type { CompanyKey } from "@/lib/config/company";

import styles from "./ProjecaoCompraPage.module.css";

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface PickerRow {
  produto: string;
  descricao: string;
  cor?: string;
  corDescricao?: string;
  codigoBarra?: string;
  grade?: string;
  grupo?: string;
  linha?: string;
  subgrupo?: string;
  colecao?: string;
  tipoProduto?: string;
  estoque?: number;
}

interface CurvaAbcResponse {
  produtos: PickerRow[];
}

interface ProjecaoItem {
  produto: string;
  cor: string;
  corDescricao: string;
  descricao: string;
  codigoBarra: string;
  grade: string;
  subgrupo: string;
  colecao: string;
  janelas: Record<string, number>;
}

interface ProjecaoResponse {
  dataBase: string;
  windows: number[];
  itens: ProjecaoItem[];
}

// Janelas exibidas (ordem da imagem: 60 dias como base, depois 12m, 120, 90, 30).
const WINDOW_ROWS: { dias: number; label: string; base?: boolean }[] = [
  { dias: 60, label: "60 dias (base)", base: true },
  { dias: 365, label: "12 meses" },
  { dias: 120, label: "120 dias" },
  { dias: 90, label: "90 dias" },
  { dias: 30, label: "30 dias" },
];

// ── Filtros de cadastro: um select por dimensão, como no Gerador de Relatórios.
//    O nome da chave é também o nome do parâmetro da API (?grupo=&subgrupo=…).
type DimKey = "grupo" | "linha" | "subgrupo" | "grade" | "colecao" | "cor" | "tipo";
const DIM_KEYS: DimKey[] = ["grupo", "linha", "subgrupo", "grade", "colecao", "cor", "tipo"];
const DIM_LABEL: Record<DimKey, string> = {
  grupo: "Grupo",
  linha: "Linha",
  subgrupo: "Subgrupo",
  grade: "Grade",
  colecao: "Coleção",
  cor: "Cor",
  tipo: "Tipo",
};
/** Endpoint de opções de cada dimensão (os mesmos que o Gerador de Relatórios usa). */
const DIM_ENDPOINT: Record<DimKey, string> = {
  grupo: "grupos",
  linha: "linhas",
  subgrupo: "subgrupos",
  grade: "grades",
  colecao: "colecoes",
  cor: "cores",
  tipo: "tipos",
};
type DimState = Record<DimKey, string[]>;
const EMPTY_DIMS: DimState = {
  grupo: [],
  linha: [],
  subgrupo: [],
  grade: [],
  colecao: [],
  cor: [],
  tipo: [],
};
const EMPTY_DIM_OPTIONS: Record<DimKey, MultiSelectOption[]> = {
  grupo: [],
  linha: [],
  subgrupo: [],
  grade: [],
  colecao: [],
  cor: [],
  tipo: [],
};

// ─── Formatação ──────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}
function fmtDec(n: number, dec = 2): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function rowKey(produto: string, cor: string | null | undefined): string {
  return `${produto}||${(cor ?? "").trim()}`;
}
/** Valor da dimensão numa linha do universo (mesma normalização das opções: UPPER/trim). */
function dimValue(row: PickerRow, dim: DimKey): string {
  const raw =
    dim === "grupo"
      ? row.grupo
      : dim === "linha"
      ? row.linha
      : dim === "subgrupo"
      ? row.subgrupo
      : dim === "grade"
      ? row.grade
      : dim === "colecao"
      ? row.colecao
      : dim === "cor"
      ? row.corDescricao || row.cor
      : row.tipoProduto;
  return (raw ?? "").trim().toUpperCase();
}

/** Hoje no calendário local, como 'yyyy-MM-dd'. */
function todayYmd(): string {
  return formatDateForQuery(new Date());
}
/** 31 de dezembro do ano da data base. */
function endOfYearYmd(baseYmd: string): string {
  const year = Number(baseYmd.slice(0, 4)) || new Date().getFullYear();
  return `${year}-12-31`;
}
/** Diferença em dias entre duas datas 'yyyy-MM-dd' (b − a). */
function diffDays(aYmd: string, bYmd: string): number {
  const [ay, am, ad] = aYmd.split("-").map(Number);
  const [by, bm, bd] = bYmd.split("-").map(Number);
  const a = Date.UTC(ay, am - 1, ad);
  const b = Date.UTC(by, bm - 1, bd);
  return Math.round((b - a) / 86400000);
}
/** Data base + N dias, formatada dd/MM/yyyy. */
function addDaysFormatted(baseYmd: string, days: number): string {
  const [y, m, d] = baseYmd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + days);
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${dt.getUTCFullYear()}`;
}
function ymdToBr(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}
/** Janela de 12 meses até hoje — o universo desta tela (opções e picker). */
function janela12Meses(): { start: string; end: string } {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 365);
  return { start: formatDateForQuery(start), end: formatDateForQuery(today) };
}

// ─── Componente ──────────────────────────────────────────────────────────────

interface Props {
  companyKey: CompanyKey;
}

export default function ProjecaoCompraPage({ companyKey }: Props) {
  const [dataBase, setDataBase] = useState<string>(todayYmd);
  const [venderAte, setVenderAte] = useState<string>(() => endOfYearYmd(todayYmd()));

  // Universo pesquisável — reusa o dataset da Curva ABC (12m, rede, por cor): traz
  // estoque atual + as dimensões de cadastro de cada item (produto × cor).
  const [pickerRows, setPickerRows] = useState<PickerRow[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  const [dims, setDims] = useState<DimState>(EMPTY_DIMS);
  const [dimOptions, setDimOptions] = useState<Record<DimKey, MultiSelectOption[]>>(EMPTY_DIM_OPTIONS);
  // Já nasce carregando: o efeito abaixo dispara na montagem e só desliga por dimensão.
  const [dimLoading, setDimLoading] = useState<Partial<Record<DimKey, boolean>>>(() =>
    Object.fromEntries(DIM_KEYS.map((dim) => [dim, true]))
  );
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  // Projeção (unidades vendidas por janela) — vem do endpoint dedicado.
  const [projItens, setProjItens] = useState<Record<string, ProjecaoItem>>({});
  const [projLoading, setProjLoading] = useState(false);
  const [projErro, setProjErro] = useState<string | null>(null);

  // Overrides editáveis (amarelos da planilha).
  const [estoqueOverride, setEstoqueOverride] = useState<number | null>(null);
  const [qtdOverride, setQtdOverride] = useState<Record<number, number | null>>({});

  // Debounce da busca do picker.
  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search.trim().toLowerCase()), 250);
    return () => clearTimeout(t);
  }, [search]);

  // Fecha o dropdown de produtos ao clicar fora.
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [pickerOpen]);

  // ── Opções dos selects: um por dimensão, carregadas de uma vez (mesmos endpoints do
  //    Gerador de Relatórios), na janela de 12 meses que é o universo desta tela. Ficam
  //    prontas na hora, sem depender do dataset pesado do picker.
  useEffect(() => {
    let cancelled = false;
    const { start, end } = janela12Meses();

    DIM_KEYS.forEach((dim) => {
      const params = new URLSearchParams({ company: companyKey });
      // Cor sai do estoque/cadastro e não aceita período (ver /api/products/cores).
      if (dim !== "cor") {
        params.set("start", start);
        params.set("end", end);
      }
      // Coleção: rótulo "DESCRIÇÃO (CÓDIGO)" com o value sendo o código.
      if (dim === "colecao") params.set("includeDescriptions", "1");

      fetch(`/api/products/${DIM_ENDPOINT[dim]}?${params.toString()}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((json: { data?: Array<string | MultiSelectOption> }) => {
          if (cancelled) return;
          const options = (json.data ?? [])
            .map((item) =>
              typeof item === "string" ? { value: item, label: item } : { value: item.value, label: item.label }
            )
            .filter((opt) => opt.value);
          setDimOptions((prev) => ({ ...prev, [dim]: options }));
        })
        .catch(() => {
          if (!cancelled) setDimOptions((prev) => ({ ...prev, [dim]: [] }));
        })
        .finally(() => {
          if (!cancelled) setDimLoading((prev) => ({ ...prev, [dim]: false }));
        });
    });

    return () => {
      cancelled = true;
    };
  }, [companyKey]);

  // ── Carrega a base de produtos (uma vez por empresa): últimos 12 meses, rede inteira,
  //    por cor — dá o universo pesquisável com estoque atual e metadados de cadastro.
  useEffect(() => {
    let cancelled = false;
    setPickerLoading(true);
    const { start, end } = janela12Meses();
    const params = new URLSearchParams({ company: companyKey, start, end, porCor: "1" });
    fetch(`/api/curva-abc?${params.toString()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((json: CurvaAbcResponse) => {
        if (!cancelled) setPickerRows(Array.isArray(json.produtos) ? json.produtos : []);
      })
      .catch(() => {
        if (!cancelled) setPickerRows([]);
      })
      .finally(() => {
        if (!cancelled) setPickerLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyKey]);

  const pickerByKey = useMemo(() => {
    const map = new Map<string, PickerRow>();
    pickerRows.forEach((p) => map.set(rowKey(p.produto, p.cor), p));
    return map;
  }, [pickerRows]);

  /** Rótulo bonito da coleção ("DESCRIÇÃO (CÓDIGO)") para os chips. */
  const colecaoLabels = useMemo(() => {
    const map = new Map<string, string>();
    dimOptions.colecao.forEach((opt) => map.set(opt.value, opt.label));
    return map;
  }, [dimOptions.colecao]);

  const dimChipLabel = (dim: DimKey, value: string) =>
    dim === "colecao" ? colecaoLabels.get(value) ?? value : value;

  // ── Escopo ────────────────────────────────────────────────────────────────
  /** Uma linha do universo casa com todos os filtros marcados. */
  const matchesDims = useCallback(
    (row: PickerRow) =>
      DIM_KEYS.every((dim) => dims[dim].length === 0 || dims[dim].includes(dimValue(row, dim))),
    [dims]
  );

  const dimFiltradas = useMemo(() => DIM_KEYS.filter((dim) => dims[dim].length > 0), [dims]);
  const temDimensao = dimFiltradas.length > 0;
  const temSelecao = selectedKeys.size > 0;

  /** Itens do escopo quando ele vem dos filtros (sem seleção manual de produto). */
  const dimScopeRows = useMemo(
    () => (temDimensao ? pickerRows.filter((row) => matchesDims(row)) : []),
    [temDimensao, pickerRows, matchesDims]
  );

  // ── Busca a projeção sempre que muda o escopo ou a data base.
  //    venderAte e Qtd Compra são puro cálculo no cliente (não vão ao servidor).
  useEffect(() => {
    const params = new URLSearchParams({ company: companyKey, base: dataBase });
    if (temSelecao) {
      // Seleção manual manda: projeta exatamente os itens escolhidos.
      const produtos = Array.from(new Set(Array.from(selectedKeys).map((k) => k.split("||")[0])));
      produtos.forEach((p) => params.append("produto", p));
    } else if (temDimensao) {
      // Sem seleção, o recorte de cadastro vai para o SQL (nada de listar milhares de códigos).
      DIM_KEYS.forEach((dim) => dims[dim].forEach((v) => params.append(dim, v)));
    } else {
      setProjItens({});
      setProjErro(null);
      return;
    }

    let cancelled = false;
    setProjLoading(true);
    setProjErro(null);
    fetch(`/api/projecao-compra?${params.toString()}`, { cache: "no-store" })
      .then(async (r) => {
        const json = (await r.json()) as ProjecaoResponse & { error?: string };
        if (!r.ok) throw new Error(json?.error || "Erro ao calcular a projeção");
        return json;
      })
      .then((json) => {
        if (cancelled) return;
        const next: Record<string, ProjecaoItem> = {};
        (json.itens ?? []).forEach((it) => {
          next[rowKey(it.produto, it.cor)] = it;
        });
        setProjItens(next);
      })
      .catch((error: Error) => {
        if (cancelled) return;
        setProjItens({});
        setProjErro(error.message || "Erro ao calcular a projeção");
      })
      .finally(() => {
        if (!cancelled) setProjLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyKey, dataBase, selectedKeys, dims, temSelecao, temDimensao]);

  // Trocar a data base ou o escopo zera os overrides (a base de cálculo mudou).
  useEffect(() => {
    setEstoqueOverride(null);
    setQtdOverride({});
  }, [dataBase, selectedKeys, dims]);

  // ── Itens selecionados resolvidos (metadados do picker + janelas da projeção).
  const selectedItems = useMemo(() => {
    return Array.from(selectedKeys)
      .map((key) => {
        const picker = pickerByKey.get(key);
        const proj = projItens[key];
        const produto = key.split("||")[0];
        const cor = key.split("||")[1] ?? "";
        return {
          key,
          produto,
          cor,
          descricao: picker?.descricao || proj?.descricao || produto,
          corDescricao: picker?.corDescricao || proj?.corDescricao || cor,
          codigoBarra: picker?.codigoBarra || proj?.codigoBarra || "",
          grade: picker?.grade || proj?.grade || "",
          estoque: Math.max(0, picker?.estoque ?? 0),
          janelas: proj?.janelas ?? {},
        };
      })
      .sort((a, b) => a.descricao.localeCompare(b.descricao, "pt-BR"));
  }, [selectedKeys, pickerByKey, projItens]);

  // ── Agregado do escopo: estoque somado + unidades vendidas somadas por janela.
  //    Seleção manual → só os itens escolhidos. Filtros → tudo o que o SQL devolveu.
  const agregado = useMemo(() => {
    const unidades: Record<number, number> = {};
    if (temSelecao) {
      const estoqueSomado = selectedItems.reduce((s, it) => s + it.estoque, 0);
      WINDOW_ROWS.forEach(({ dias }) => {
        unidades[dias] = selectedItems.reduce(
          (s, it) => s + (Number(it.janelas[String(dias)] ?? 0) || 0),
          0
        );
      });
      return { estoqueSomado, unidades, itens: selectedItems.length };
    }
    const projList = Object.values(projItens);
    WINDOW_ROWS.forEach(({ dias }) => {
      unidades[dias] = projList.reduce(
        (s, it) => s + (Number(it.janelas[String(dias)] ?? 0) || 0),
        0
      );
    });
    const estoqueSomado = dimScopeRows.reduce((s, row) => s + Math.max(0, row.estoque ?? 0), 0);
    return { estoqueSomado, unidades, itens: Math.max(dimScopeRows.length, projList.length) };
  }, [temSelecao, selectedItems, projItens, dimScopeRows]);

  const estoqueAtual = estoqueOverride ?? agregado.estoqueSomado;
  const diasHorizonte = Math.max(0, diffDays(dataBase, venderAte));
  const hasScope = temSelecao || temDimensao;

  // ── Linhas calculadas (tudo reativo, no cliente).
  const linhas = useMemo(() => {
    return WINDOW_ROWS.map(({ dias, label, base }) => {
      const unVendidas = agregado.unidades[dias] ?? 0;
      const ritmoDia = dias > 0 ? unVendidas / dias : 0;
      const ritmoMes = ritmoDia * 30;
      // Sugestão = quanto comprar p/ o estoque durar até "Vender até".
      const sugestao = Math.max(0, Math.ceil(ritmoDia * diasHorizonte - estoqueAtual));
      const qtd = qtdOverride[dias] ?? sugestao;
      const cobertura = ritmoDia > 0 ? (estoqueAtual + qtd) / ritmoDia : null;
      const duraAte = cobertura !== null ? addDaysFormatted(dataBase, Math.round(cobertura)) : null;
      return { dias, label, base, unVendidas, ritmoDia, ritmoMes, sugestao, qtd, cobertura, duraAte };
    });
  }, [agregado, diasHorizonte, estoqueAtual, qtdOverride, dataBase]);

  // ── Picker: universo já recortado pelos filtros de dimensão + busca textual.
  const pickerFiltered = useMemo(() => {
    let rows = pickerRows.filter((row) => matchesDims(row));
    if (searchDebounced) {
      rows = rows.filter((p) => {
        const hay = `${p.descricao ?? ""} ${p.produto ?? ""} ${p.codigoBarra ?? ""} ${p.corDescricao ?? ""} ${p.subgrupo ?? ""} ${p.colecao ?? ""}`.toLowerCase();
        return hay.includes(searchDebounced);
      });
    }
    return rows;
  }, [pickerRows, matchesDims, searchDebounced]);
  const pickerVisible = useMemo(() => pickerFiltered.slice(0, 120), [pickerFiltered]);

  const toggleKey = (key: string) =>
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const limparTudo = () => {
    setSelectedKeys(new Set());
    setDims(EMPTY_DIMS);
    setSearch("");
  };

  const soUm = temSelecao && selectedItems.length === 1 ? selectedItems[0] : null;

  return (
    <div className={styles.wrapper}>
      {/* Header */}
      <div className={styles.headerCard}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>Projeção Compra</h1>
          <span
            className={`${styles.loadingCue} ${projLoading || pickerLoading ? styles.loadingCueActive : ""}`}
            role="status"
          >
            <span className={styles.spinner} aria-hidden="true" />
            Calculando…
          </span>
        </div>
        <p className={styles.subtitle}>
          Escolha o escopo — pelos filtros de cadastro (grupo, linha, subgrupo, grade, coleção, cor,
          tipo) ou por produtos específicos (um ou vários) — e veja quanto comprar para o estoque
          durar até a data alvo. O ritmo é medido em várias janelas (loja + e-commerce) com a venda
          validada global. Mude a data ou a quantidade e tudo recalcula na hora.
        </p>
      </div>

      {/* Menus (acima da tabela) */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarRow}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Data base</span>
            <input
              type="date"
              className={styles.input}
              value={dataBase}
              onChange={(e) => e.target.value && setDataBase(e.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Vender até</span>
            <input
              type="date"
              className={styles.input}
              value={venderAte}
              min={dataBase}
              onChange={(e) => e.target.value && setVenderAte(e.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Estoque atual (un)</span>
            <input
              type="number"
              className={styles.input}
              value={estoqueAtual}
              min={0}
              disabled={!hasScope}
              onChange={(e) => {
                const v = e.target.value === "" ? null : Math.max(0, Math.round(Number(e.target.value)));
                setEstoqueOverride(Number.isNaN(v as number) ? null : v);
              }}
            />
          </label>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Dias no horizonte</span>
            <span className={styles.computed}>{fmt(diasHorizonte)}</span>
          </div>
          {estoqueOverride !== null && hasScope && (
            <button type="button" className={styles.resetLink} onClick={() => setEstoqueOverride(null)}>
              ↺ voltar ao estoque real ({fmt(agregado.estoqueSomado)} un)
            </button>
          )}
        </div>

        {/* Um select por dimensão (só some quando a empresa não tem opção nenhuma) */}
        <div className={styles.toolbarRow}>
          {DIM_KEYS.map((dim) =>
            dimOptions[dim].length > 0 || dims[dim].length > 0 ? (
              <MultiSelectFilter
                key={dim}
                label={DIM_LABEL[dim]}
                value={dims[dim]}
                options={dimOptions[dim]}
                loading={!!dimLoading[dim]}
                onChange={(values) => setDims((prev) => ({ ...prev, [dim]: values }))}
              />
            ) : null
          )}

          {/* Picker de produtos (produto × cor), multi-seleção */}
          <div className={styles.produtoPicker} ref={pickerRef}>
            <span className={styles.fieldLabel}>Produtos</span>
            <button
              type="button"
              className={`${styles.pickerButton} ${pickerOpen ? styles.pickerButtonActive : ""}`}
              onClick={() => setPickerOpen((prev) => !prev)}
            >
              <span>
                {selectedItems.length === 0
                  ? "Todos do filtro"
                  : selectedItems.length === 1
                  ? selectedItems[0].descricao
                  : `${selectedItems.length} itens`}
              </span>
              <span>▼</span>
            </button>
            {pickerOpen && (
              <div className={styles.pickerDropdown}>
                <div className={styles.searchBox}>
                  <input
                    className={styles.searchInput}
                    type="text"
                    placeholder="Buscar produto, código, cor…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {search && (
                    <button
                      type="button"
                      className={styles.searchClear}
                      onClick={() => setSearch("")}
                      aria-label="Limpar"
                    >
                      ×
                    </button>
                  )}
                </div>
                <div className={styles.pickerList}>
                  {pickerLoading ? (
                    <div className={styles.pickerEmpty}>Carregando produtos…</div>
                  ) : pickerVisible.length === 0 ? (
                    <div className={styles.pickerEmpty}>Nenhum produto encontrado.</div>
                  ) : (
                    pickerVisible.map((p) => {
                      const key = rowKey(p.produto, p.cor);
                      const checked = selectedKeys.has(key);
                      return (
                        <label
                          key={key}
                          className={`${styles.pickerRow} ${checked ? styles.pickerRowActive : ""}`}
                        >
                          <input type="checkbox" checked={checked} onChange={() => toggleKey(key)} />
                          <span className={styles.pickerInfo}>
                            <span className={styles.pickerName}>{p.descricao || p.produto}</span>
                            <span className={styles.pickerMeta}>
                              {(p.corDescricao || p.cor) && <span>{p.corDescricao || p.cor}</span>}
                              <span>{(p.codigoBarra || p.produto).trim()}</span>
                              <span>{fmt(Math.max(0, p.estoque ?? 0))} un</span>
                            </span>
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
                <div className={styles.pickerFoot}>
                  <span>
                    {fmt(pickerFiltered.length)} itens no filtro
                    {pickerFiltered.length > pickerVisible.length
                      ? ` · mostrando ${fmt(pickerVisible.length)}, busque para refinar`
                      : ""}
                  </span>
                  {temSelecao && (
                    <button
                      type="button"
                      className={styles.pickerFootAction}
                      onClick={() => setSelectedKeys(new Set())}
                    >
                      limpar seleção
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {hasScope && (
            <button type="button" className={styles.clearAll} onClick={limparTudo}>
              Limpar filtros
            </button>
          )}
        </div>

        {/* Chips do escopo ativo */}
        {hasScope && (
          <div className={styles.chips}>
            {dimFiltradas.flatMap((dim) =>
              dims[dim].map((value) => (
                <button
                  key={`${dim}:${value}`}
                  type="button"
                  className={styles.chip}
                  title={`Remover filtro de ${DIM_LABEL[dim]}`}
                  onClick={() =>
                    setDims((prev) => ({ ...prev, [dim]: prev[dim].filter((v) => v !== value) }))
                  }
                >
                  <span className={styles.chipDim}>{DIM_LABEL[dim]}</span>
                  {dimChipLabel(dim, value)} ×
                </button>
              ))
            )}
            {temSelecao && temDimensao && (
              <span className={styles.chipNote}>
                com produtos selecionados, os filtros só recortam a busca — a projeção usa os itens
                escolhidos
              </span>
            )}
            {selectedItems.map((it) => (
              <button
                key={it.key}
                type="button"
                className={`${styles.chip} ${styles.chipProduto}`}
                title="Remover da seleção"
                onClick={() => toggleKey(it.key)}
              >
                {it.descricao}
                {it.corDescricao || it.cor ? ` · ${it.corDescricao || it.cor}` : ""} ×
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Projeção (tabela em tela cheia) */}
      {!hasScope ? (
        <div className={styles.emptyPanel}>
          <div className={styles.emptyIcon}>🎯</div>
          <div className={styles.emptyTitle}>Escolha um escopo para projetar</div>
          <div className={styles.emptyText}>
            Use os filtros de cadastro acima — grupo, linha, subgrupo, grade, coleção, cor, tipo — ou
            selecione produtos específicos. Tudo o que estiver no escopo é somado num único bloco de
            compra.
          </div>
        </div>
      ) : (
        <div className={styles.projCard}>
          {/* Cabeçalho do escopo */}
          <div className={styles.projHead}>
            <div className={styles.projTitle}>Análise de giro e sugestão de compra</div>
            {soUm ? (
              <div className={styles.projSubtitle}>
                <strong>{soUm.descricao}</strong>
                {(soUm.corDescricao || soUm.cor) && <> · {soUm.corDescricao || soUm.cor}</>}
                {soUm.codigoBarra && <> · cód. {soUm.codigoBarra}</>}
                {soUm.grade && <> · {soUm.grade}</>}
                {" · "}estoque <strong>{fmt(estoqueAtual)}</strong> un · vender até{" "}
                <strong>{ymdToBr(venderAte)}</strong> ({fmt(diasHorizonte)} dias)
              </div>
            ) : (
              <div className={styles.projSubtitle}>
                <strong>{fmt(agregado.itens)}</strong> itens (produto × cor) somados · estoque{" "}
                <strong>{fmt(estoqueAtual)}</strong> un · vender até{" "}
                <strong>{ymdToBr(venderAte)}</strong> ({fmt(diasHorizonte)} dias)
              </div>
            )}
          </div>

          {projErro && <div className={styles.erro}>{projErro}</div>}

          {/* Tabela de janelas */}
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.thLeft}>Janela do ritmo</th>
                  <th>Dias</th>
                  <th>Un. vendidas</th>
                  <th>Ritmo (un/dia)</th>
                  <th>Ritmo (un/mês)</th>
                  <th>Sugestão compra</th>
                  <th>Qtd Compra</th>
                  <th>Cobertura (dias)</th>
                  <th>Dura até</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => {
                  const overridden = qtdOverride[l.dias] != null && qtdOverride[l.dias] !== l.sugestao;
                  return (
                    <tr key={l.dias} className={l.base ? styles.rowBase : ""}>
                      <td className={styles.tdLeft}>{l.label}</td>
                      <td className={styles.num}>{fmt(l.dias)}</td>
                      <td className={styles.num}>{fmt(l.unVendidas)}</td>
                      <td className={styles.num}>{fmtDec(l.ritmoDia)}</td>
                      <td className={styles.num}>{fmtDec(l.ritmoMes, 1)}</td>
                      <td className={`${styles.num} ${styles.sugestao}`}>{fmt(l.sugestao)}</td>
                      <td className={styles.num}>
                        <input
                          type="number"
                          className={`${styles.qtdInput} ${overridden ? styles.qtdInputEdited : ""}`}
                          value={l.qtd}
                          min={0}
                          onChange={(e) => {
                            const raw = e.target.value;
                            setQtdOverride((prev) => ({
                              ...prev,
                              [l.dias]: raw === "" ? 0 : Math.max(0, Math.round(Number(raw))),
                            }));
                          }}
                        />
                      </td>
                      <td className={styles.num}>
                        {l.cobertura !== null ? fmt(l.cobertura) : <span className={styles.muted}>—</span>}
                      </td>
                      <td className={styles.num}>{l.duraAte ?? <span className={styles.muted}>—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className={styles.footNote}>
            Como usar: altere <strong>Qtd Compra</strong> (ou o estoque / as datas) e as colunas{" "}
            <strong>Cobertura</strong> e <strong>Dura até</strong> se ajustam sozinhas. A{" "}
            <strong>Sugestão de compra</strong> é a quantidade para o estoque durar exatamente até{" "}
            <strong>Vender até</strong>. Ritmo = unidades vendidas na janela ÷ dias (loja +
            e-commerce), pela venda líquida validada global (com trocas). O{" "}
            <strong>estoque</strong> do escopo soma os itens com venda nos últimos 12 meses (saldos
            positivos da rede) — ajuste o campo à mão quando quiser outro cenário.
          </div>
        </div>
      )}
    </div>
  );
}
