"use client";

import { useEffect, useMemo, useState } from "react";

import { formatDateForQuery } from "@/lib/utils/date";
import type { CompanyKey } from "@/lib/config/company";

import styles from "./ProdutoProjecaoCompraPage.module.css";

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface PickerRow {
  produto: string;
  descricao: string;
  cor?: string;
  corDescricao?: string;
  codigoBarra?: string;
  grade?: string;
  subgrupo?: string;
  colecao?: string;
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

// ─── Componente ──────────────────────────────────────────────────────────────

interface Props {
  companyKey: CompanyKey;
}

export default function ProdutoProjecaoCompraPage({ companyKey }: Props) {
  const [dataBase, setDataBase] = useState<string>(todayYmd);
  const [venderAte, setVenderAte] = useState<string>(() => endOfYearYmd(todayYmd()));

  // Picker (busca de produtos) — reusa o dataset da Curva ABC (12m, rede, por cor).
  const [pickerRows, setPickerRows] = useState<PickerRow[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  // Projeção (unidades vendidas por janela) — vem do endpoint dedicado.
  const [projItens, setProjItens] = useState<Record<string, ProjecaoItem>>({});
  const [projLoading, setProjLoading] = useState(false);

  // Overrides editáveis (amarelos da imagem).
  const [estoqueOverride, setEstoqueOverride] = useState<number | null>(null);
  const [qtdOverride, setQtdOverride] = useState<Record<number, number | null>>({});

  // Debounce da busca.
  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search.trim().toLowerCase()), 250);
    return () => clearTimeout(t);
  }, [search]);

  // ── Carrega a base de produtos para o picker (uma vez por empresa): últimos 12 meses,
  //    rede inteira, por cor — dá o universo pesquisável com estoque atual e metadados.
  useEffect(() => {
    let cancelled = false;
    setPickerLoading(true);
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - 365);
    const params = new URLSearchParams({
      company: companyKey,
      start: formatDateForQuery(start),
      end: formatDateForQuery(today),
      porCor: "1",
    });
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

  // ── Busca a projeção (janelas) sempre que muda a seleção ou a data base.
  //    venderAte e Qtd Compra são puro cálculo no cliente (recalculam sem ir ao servidor).
  useEffect(() => {
    const produtos = Array.from(new Set(Array.from(selectedKeys).map((k) => k.split("||")[0])));
    if (produtos.length === 0) {
      setProjItens({});
      return;
    }
    let cancelled = false;
    setProjLoading(true);
    const params = new URLSearchParams({ company: companyKey, base: dataBase });
    produtos.forEach((p) => params.append("produto", p));
    fetch(`/api/produto-projecao-compra?${params.toString()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((json: ProjecaoResponse) => {
        if (cancelled) return;
        const next: Record<string, ProjecaoItem> = {};
        (json.itens ?? []).forEach((it) => {
          next[rowKey(it.produto, it.cor)] = it;
        });
        setProjItens(next);
      })
      .catch(() => {
        if (!cancelled) setProjItens({});
      })
      .finally(() => {
        if (!cancelled) setProjLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyKey, dataBase, selectedKeys]);

  // Trocar a data base ou a seleção zera os overrides (a base de cálculo mudou).
  useEffect(() => {
    setEstoqueOverride(null);
    setQtdOverride({});
  }, [dataBase, selectedKeys]);

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

  // ── Agregado da seleção: estoque somado + unidades vendidas somadas por janela.
  const agregado = useMemo(() => {
    const estoqueSomado = selectedItems.reduce((s, it) => s + it.estoque, 0);
    const unidades: Record<number, number> = {};
    WINDOW_ROWS.forEach(({ dias }) => {
      unidades[dias] = selectedItems.reduce((s, it) => s + (Number(it.janelas[String(dias)] ?? 0) || 0), 0);
    });
    return { estoqueSomado, unidades };
  }, [selectedItems]);

  const estoqueAtual = estoqueOverride ?? agregado.estoqueSomado;
  const diasHorizonte = Math.max(0, diffDays(dataBase, venderAte));

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

  // ── Picker: filtra por busca.
  const pickerFiltered = useMemo(() => {
    let rows = pickerRows;
    if (searchDebounced) {
      rows = rows.filter((p) => {
        const hay = `${p.descricao ?? ""} ${p.produto ?? ""} ${p.codigoBarra ?? ""} ${p.corDescricao ?? ""} ${p.subgrupo ?? ""} ${p.colecao ?? ""}`.toLowerCase();
        return hay.includes(searchDebounced);
      });
    }
    return rows.slice(0, 80);
  }, [pickerRows, searchDebounced]);

  const toggleKey = (key: string) =>
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const hasSelection = selectedItems.length > 0;
  const soUm = selectedItems.length === 1 ? selectedItems[0] : null;

  return (
    <div className={styles.wrapper}>
      {/* Header */}
      <div className={styles.headerCard}>
        <div className={styles.header}>
          <div>
            <div className={styles.titleRow}>
              <h1 className={styles.title}>Produto Projeção Compra</h1>
              <span className={`${styles.loadingCue} ${projLoading || pickerLoading ? styles.loadingCueActive : ""}`} role="status">
                <span className={styles.spinner} aria-hidden="true" />
                Calculando…
              </span>
            </div>
            <p className={styles.subtitle}>
              Escolha um ou mais produtos (por cor) e veja quanto comprar para o estoque durar até a data
              alvo. O ritmo é medido em várias janelas (loja + e-commerce) com a venda validada global.
              Mude a data ou a quantidade e tudo recalcula na hora.
            </p>
          </div>
        </div>
      </div>

      <div className={styles.grid}>
        {/* Coluna esquerda: parâmetros + picker */}
        <div className={styles.leftCol}>
          {/* Parâmetros */}
          <div className={styles.paramCard}>
            <div className={styles.paramTitle}>Parâmetros</div>
            <label className={styles.paramField}>
              <span className={styles.paramLabel}>Data base</span>
              <input
                type="date"
                className={styles.paramInput}
                value={dataBase}
                onChange={(e) => e.target.value && setDataBase(e.target.value)}
              />
            </label>
            <label className={styles.paramField}>
              <span className={styles.paramLabel}>Vender até</span>
              <input
                type="date"
                className={styles.paramInput}
                value={venderAte}
                min={dataBase}
                onChange={(e) => e.target.value && setVenderAte(e.target.value)}
              />
            </label>
            <label className={styles.paramField}>
              <span className={styles.paramLabel}>Estoque atual (un)</span>
              <input
                type="number"
                className={styles.paramInput}
                value={estoqueAtual}
                min={0}
                disabled={!hasSelection}
                onChange={(e) => {
                  const v = e.target.value === "" ? null : Math.max(0, Math.round(Number(e.target.value)));
                  setEstoqueOverride(Number.isNaN(v as number) ? null : v);
                }}
              />
            </label>
            <div className={`${styles.paramField} ${styles.paramComputed}`}>
              <span className={styles.paramLabel}>Dias no horizonte</span>
              <span className={styles.paramValue}>{fmt(diasHorizonte)}</span>
            </div>
            {estoqueOverride !== null && hasSelection && (
              <button type="button" className={styles.resetLink} onClick={() => setEstoqueOverride(null)}>
                ↺ voltar ao estoque real ({fmt(agregado.estoqueSomado)} un)
              </button>
            )}
          </div>

          {/* Picker */}
          <div className={styles.pickerCard}>
            <div className={styles.searchBox}>
              <input
                className={styles.searchInput}
                type="text"
                placeholder="Buscar produto, código, cor…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button type="button" className={styles.searchClear} onClick={() => setSearch("")} aria-label="Limpar">
                  ×
                </button>
              )}
            </div>
            <div className={styles.pickerList}>
              {pickerLoading ? (
                <div className={styles.pickerEmpty}>Carregando produtos…</div>
              ) : pickerFiltered.length === 0 ? (
                <div className={styles.pickerEmpty}>
                  {searchDebounced ? "Nenhum produto encontrado." : "Digite para buscar produtos."}
                </div>
              ) : (
                pickerFiltered.map((p) => {
                  const key = rowKey(p.produto, p.cor);
                  const checked = selectedKeys.has(key);
                  return (
                    <label key={key} className={`${styles.pickerRow} ${checked ? styles.pickerRowActive : ""}`}>
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
            {pickerRows.length > 0 && !searchDebounced && (
              <div className={styles.pickerHint}>Mostrando os primeiros {pickerFiltered.length}. Busque para refinar.</div>
            )}
          </div>
        </div>

        {/* Coluna direita: projeção */}
        <div className={styles.rightCol}>
          {!hasSelection ? (
            <div className={styles.emptyPanel}>
              <div className={styles.emptyIcon}>🎯</div>
              <div className={styles.emptyTitle}>Selecione um ou mais produtos</div>
              <div className={styles.emptyText}>
                A projeção de compra aparece aqui. Vários produtos são somados num único bloco de compra.
              </div>
            </div>
          ) : (
            <div className={styles.projCard}>
              {/* Cabeçalho da seleção */}
              <div className={styles.projHead}>
                <div className={styles.projTitle}>Análise de giro e sugestão de compra</div>
                {soUm ? (
                  <div className={styles.projSubtitle}>
                    <strong>{soUm.descricao}</strong>
                    {(soUm.corDescricao || soUm.cor) && <> · {soUm.corDescricao || soUm.cor}</>}
                    {soUm.codigoBarra && <> · cód. {soUm.codigoBarra}</>}
                    {soUm.grade && <> · {soUm.grade}</>}
                  </div>
                ) : (
                  <div className={styles.projSubtitle}>
                    <strong>{fmt(selectedItems.length)}</strong> itens (produto × cor) somados · estoque{" "}
                    <strong>{fmt(estoqueAtual)}</strong> un · vender até <strong>{ymdToBr(venderAte)}</strong> ({fmt(diasHorizonte)} dias)
                  </div>
                )}
                {selectedItems.length > 1 && (
                  <div className={styles.chips}>
                    {selectedItems.map((it) => (
                      <button
                        key={it.key}
                        type="button"
                        className={styles.chip}
                        onClick={() => toggleKey(it.key)}
                        title="Remover da seleção"
                      >
                        {it.descricao}
                        {(it.corDescricao || it.cor) ? ` · ${it.corDescricao || it.cor}` : ""} ×
                      </button>
                    ))}
                  </div>
                )}
              </div>

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
                          <td className={styles.num}>{l.cobertura !== null ? fmt(l.cobertura) : <span className={styles.muted}>—</span>}</td>
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
                <strong>Vender até</strong>. Ritmo = unidades vendidas na janela ÷ dias (loja + e-commerce),
                pela venda líquida validada global (com trocas). Números em branco recalculam ao editar.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
