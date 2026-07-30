"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";

import type { CompanyKey } from "@/lib/config/company";
import type { DistribuicaoItem, DistribuicaoResult, LojaDistStatus } from "@/lib/utils/distribuicao-matriz";
import { exportDistribuicaoMatrizPdf, exportDistribuicaoMatrizXlsx } from "@/lib/utils/exportDistribuicaoMatriz";

import styles from "./DistribuicaoMatrizPage.module.css";

interface DistribuicaoMatrizPageProps {
  companyKey: CompanyKey;
  companyName: string;
}

const PAGE_STEP = 60;

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// ── Ícones (SVG inline, estilo lucide, stroke=currentColor) ───────────────────
type IconProps = { className?: string };
const svg = (children: ReactNode) => (p: IconProps) => (
  <svg
    className={p.className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.9}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

const Icons = {
  box: svg(
    <>
      <path d="M21 8v8a2 2 0 0 1-1 1.73l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.73l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </>
  ),
  xCircle: svg(
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </>
  ),
  checkCircle: svg(
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  triangle: svg(
    <>
      <path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </>
  ),
  alertCircle: svg(
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </>
  ),
  ban: svg(
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m4.9 4.9 14.2 14.2" />
    </>
  ),
  refresh: svg(
    <>
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M8 16H3v5" />
    </>
  ),
  search: svg(
    <>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  home: svg(
    <>
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M9 22V12h6v10" />
    </>
  ),
  building: svg(
    <>
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <path d="M9 22v-4h6v4" />
      <path d="M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01" />
    </>
  ),
  bag: svg(
    <>
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
      <path d="M3 6h18" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </>
  ),
  gem: svg(
    <>
      <path d="M6 3h12l4 6-10 13L2 9Z" />
      <path d="M2 9h20" />
      <path d="m12 22 4-13-3-6" />
      <path d="M12 22 8 9l3-6" />
    </>
  ),
  bell: svg(
    <>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </>
  ),
  mapPin: svg(
    <>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </>
  ),
  cart: svg(
    <>
      <circle cx="8" cy="21" r="1" />
      <circle cx="19" cy="21" r="1" />
      <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
    </>
  ),
  plane: svg(
    <>
      <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
    </>
  ),
  download: svg(
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </>
  ),
};

/** Ícone por loja (rótulo de exibição) — espelha o mockup. */
function storeIcon(label: string): (p: IconProps) => ReactElement {
  switch (label) {
    case "PAULISTA":
      return Icons.building;
    case "MORUMBI":
      return Icons.bag;
    case "HIGIENÓPOLIS":
      return Icons.home;
    case "IGUATEMI":
      return Icons.gem;
    case "VILLA LOBOS":
      return Icons.bell;
    case "OSCAR FREIRE":
      return Icons.mapPin;
    case "E-COMMERCE":
      return Icons.cart;
    case "GALEÃO RJ":
    case "GUARULHOS":
      return Icons.plane;
    default:
      return Icons.mapPin;
  }
}

const NUM_CLASS: Record<LojaDistStatus, string> = {
  SEM_ESTOQUE: styles.numSemEstoque,
  CRITICO: styles.numCritico,
  BAIXO: styles.numBaixo,
  OK: styles.numOk,
  SEM_VENDA: styles.numSemVenda,
  NOVO: styles.numOk,
};

const EMPTY_RESULT: DistribuicaoResult = {
  matrizLabel: "Matriz",
  filiaisDestino: [],
  filialLabels: {},
  itens: [],
};

async function fetchDistribuicao(company: string): Promise<DistribuicaoResult> {
  const response = await fetch(`/api/distribuicao-matriz?company=${encodeURIComponent(company)}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Erro ao carregar distribuição da matriz");
  const json = (await response.json()) as { data: DistribuicaoResult };
  return json.data ?? EMPTY_RESULT;
}

export default function DistribuicaoMatrizPage({ companyKey }: DistribuicaoMatrizPageProps) {
  const [distribuicao, setDistribuicao] = useState<DistribuicaoResult>(EMPTY_RESULT);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [busca, setBusca] = useState("");
  const [material, setMaterial] = useState("todos");
  const [soZeradas, setSoZeradas] = useState(false);
  const [limite, setLimite] = useState(PAGE_STEP);
  // Ordenação por coluna: col = 'produto' | 'matriz' | <filial>. Clique cicla desc → asc → padrão.
  const [sort, setSort] = useState<{ col: string; dir: "asc" | "desc" } | null>(null);

  const toggleSort = useCallback((col: string) => {
    setSort((prev) => {
      if (!prev || prev.col !== col) return { col, dir: "desc" };
      if (prev.dir === "desc") return { col, dir: "asc" };
      return null;
    });
  }, []);

  const inFlightRef = useRef(false);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const stickyBarRef = useRef<HTMLDivElement | null>(null);

  // Cabeçalho fixo clonado ao rolar (mesma lógica da Curva ABC): mostra uma barra fixa no topo
  // com as colunas quando o thead real sai da viewport, sincronizando larguras via rAF.
  useEffect(() => {
    let rafId: number | null = null;
    let isVisible = false;

    const syncWidths = (thead: Element, bar: HTMLDivElement, tableRect: DOMRect) => {
      bar.style.left = tableRect.left + "px";
      bar.style.width = tableRect.width + "px";
      const ths = thead.querySelectorAll("th");
      const barThs = bar.querySelectorAll("th");
      ths.forEach((th, i) => {
        if (barThs[i]) (barThs[i] as HTMLElement).style.width = th.getBoundingClientRect().width + "px";
      });
    };

    const update = () => {
      rafId = null;
      const bar = stickyBarRef.current;
      const table = tableRef.current;
      if (!bar || !table) return;
      const thead = table.querySelector("thead");
      if (!thead) return;
      const theadRect = thead.getBoundingClientRect();
      const tableRect = table.getBoundingClientRect();
      const shouldShow = theadRect.top < 0 && tableRect.bottom > 0;
      if (shouldShow && !isVisible) {
        isVisible = true;
        syncWidths(thead, bar, tableRect);
        bar.style.display = "block";
      } else if (!shouldShow && isVisible) {
        isVisible = false;
        bar.style.display = "none";
      } else if (shouldShow && isVisible) {
        syncWidths(thead, bar, tableRect);
      }
    };

    const schedule = () => {
      if (rafId === null) rafId = requestAnimationFrame(update);
    };

    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", () => {
      isVisible = false;
      schedule();
    });
    return () => {
      window.removeEventListener("scroll", schedule);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  const loadData = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchDistribuicao(companyKey);
      setDistribuicao(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar dados");
    } finally {
      setLoading(false);
      setLoadedOnce(true);
      inFlightRef.current = false;
    }
  }, [companyKey]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const materiais = useMemo(() => {
    const set = new Set<string>();
    distribuicao.itens.forEach((i) => {
      if (i.material) set.add(i.material);
    });
    return Array.from(set).sort();
  }, [distribuicao.itens]);

  const itensFiltrados = useMemo(() => {
    const termo = normalize(busca.trim());
    return distribuicao.itens.filter((item) => {
      if (item.totalEnviar <= 0) return false; // envio sugerido é sempre o padrão
      if (soZeradas && item.lojasSemEstoque <= 0) return false;
      if (material !== "todos" && item.material !== material) return false;
      if (termo) {
        const hay = normalize(
          `${item.descricao} ${item.produto} ${item.codigo} ${item.codigoBarra ?? ""} ${item.cor}`
        );
        if (!hay.includes(termo)) return false;
      }
      return true;
    });
  }, [distribuicao.itens, busca, material, soZeradas]);

  const resumo = useMemo(() => {
    let lojasZeradas = 0;
    let totalEnviar = 0;
    let itensDescoberto = 0;
    itensFiltrados.forEach((i) => {
      lojasZeradas += i.lojasSemEstoque;
      totalEnviar += i.totalEnviar;
      if (!i.atendeTudo) itensDescoberto += 1;
    });
    return {
      totalItens: itensFiltrados.length,
      lojasZeradas,
      totalEnviar,
      itensDescoberto,
    };
  }, [itensFiltrados]);

  const itensOrdenados = useMemo(() => {
    if (!sort) return itensFiltrados;
    const arr = [...itensFiltrados];
    const dir = sort.dir === "asc" ? 1 : -1;
    if (sort.col === "produto") {
      arr.sort((a, b) => dir * (a.descricao || a.produto).localeCompare(b.descricao || b.produto, "pt-BR"));
      return arr;
    }
    const valor = (item: DistribuicaoItem) => {
      if (sort.col === "matriz") return item.matrizEstoque;
      return item.lojas.find((l) => l.filial === sort.col)?.estoqueAtual ?? 0;
    };
    arr.sort((a, b) => dir * (valor(a) - valor(b)));
    return arr;
  }, [itensFiltrados, sort]);

  useEffect(() => {
    setLimite(PAGE_STEP);
  }, [busca, material, soZeradas]);

  const visiveis = itensOrdenados.slice(0, limite);
  const fmt = (n: number) => n.toLocaleString("pt-BR");

  const exportArgs = useMemo(
    () => ({
      items: itensOrdenados,
      filiais: distribuicao.filiaisDestino,
      labels: distribuicao.filialLabels,
      companyKey,
      matrizLabel: distribuicao.matrizLabel,
    }),
    [itensOrdenados, distribuicao.filiaisDestino, distribuicao.filialLabels, distribuicao.matrizLabel, companyKey]
  );
  const sortArrow = (col: string) =>
    sort?.col === col ? <span className={styles.sortArrow}>{sort.dir === "desc" ? "▼" : "▲"}</span> : null;

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>Distribuição Matriz</h1>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.exportBtn}
            onClick={() => exportDistribuicaoMatrizXlsx(exportArgs)}
            disabled={itensFiltrados.length === 0}
            title="Exportar Excel (colorido por status)"
          >
            <Icons.download />
            Excel
          </button>
          <button
            type="button"
            className={styles.exportBtn}
            onClick={() => exportDistribuicaoMatrizPdf(exportArgs)}
            disabled={itensFiltrados.length === 0}
            title="Exportar PDF"
          >
            <Icons.download />
            PDF
          </button>
          <button type="button" className={styles.refreshBtn} onClick={loadData} disabled={loading}>
            <Icons.refresh />
            {loading ? "Carregando…" : "Atualizar"}
          </button>
        </div>
      </header>

      <section className={styles.tiles}>
        <div className={`${styles.tile} ${styles.tileBlue}`}>
          <span className={styles.tileIcon}>
            <Icons.box />
          </span>
          <div className={styles.tileBody}>
            <span className={styles.tileLabel}>Itens na Matriz</span>
            <span className={styles.tileValue}>{fmt(resumo.totalItens)}</span>
            <span className={styles.tileSub}>SKUs disponíveis</span>
          </div>
        </div>

        <div className={`${styles.tile} ${styles.tileRed}`}>
          <span className={styles.tileIcon}>
            <Icons.xCircle />
          </span>
          <div className={styles.tileBody}>
            <span className={styles.tileLabel}>Lojas Zeradas (vendem)</span>
            <span className={styles.tileValue}>{fmt(resumo.lojasZeradas)}</span>
            <span className={styles.tileSub}>Precisam de envio</span>
          </div>
        </div>

        <div className={`${styles.tile} ${styles.tileGreen}`}>
          <span className={styles.tileIcon}>
            <Icons.checkCircle />
          </span>
          <div className={styles.tileBody}>
            <span className={styles.tileLabel}>Total a Enviar</span>
            <span className={styles.tileValue}>{fmt(resumo.totalEnviar)}</span>
            <span className={styles.tileSub}>Unidades sugeridas</span>
          </div>
        </div>

        <div className={`${styles.tile} ${styles.tileAmber}`}>
          <span className={styles.tileIcon}>
            <Icons.triangle />
          </span>
          <div className={styles.tileBody}>
            <span className={styles.tileLabel}>Itens que a Matriz não cobre</span>
            <span className={styles.tileValue}>{fmt(resumo.itensDescoberto)}</span>
            <span className={styles.tileSub}>Déficit de estoque</span>
          </div>
        </div>
      </section>

      <section className={styles.controls}>
        <div className={styles.searchWrap}>
          <Icons.search className={styles.searchIcon} />
          <input
            type="search"
            className={styles.search}
            placeholder="Buscar produto, código, cor…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <select className={styles.select} value={material} onChange={(e) => setMaterial(e.target.value)}>
          <option value="todos">Todos os materiais</option>
          {materiais.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <label className={styles.switch}>
          <input type="checkbox" checked={soZeradas} onChange={(e) => setSoZeradas(e.target.checked)} />
          <span className={styles.switchTrack}>
            <span className={styles.switchThumb} />
          </span>
          <span className={styles.switchLabel}>Só com loja zerada</span>
        </label>
      </section>

      <section className={styles.legend}>
        <span className={styles.legendEnviar}>➜ N = enviar N unidades</span>
      </section>

      {error && <div className={styles.error}>{error}</div>}

      {!error && loading && !loadedOnce && (
        <div className={styles.loadingBox}>
          <div className={styles.spinner} />
          <span>Carregando estoque da rede e mínimos por loja…</span>
        </div>
      )}

      {!loading && !error && itensFiltrados.length === 0 && (
        <div className={styles.emptyBox}>Nenhum item para distribuir com os filtros atuais.</div>
      )}

      {itensFiltrados.length > 0 && (
        <div className={styles.tableWrap}>
          <table ref={tableRef} className={styles.table}>
            <thead>
              <tr>
                <th
                  className={`${styles.stickyProduto} ${styles.th} ${styles.thProduto} ${styles.thSortable}`}
                  onClick={() => toggleSort("produto")}
                  title="Ordenar por nome"
                >
                  Produto {sortArrow("produto")}
                </th>
                <th
                  className={`${styles.stickyMatriz} ${styles.th} ${styles.center} ${styles.thSortable}`}
                  onClick={() => toggleSort("matriz")}
                  title="Ordenar pelo estoque da Matriz"
                >
                  Matriz {sortArrow("matriz")}
                </th>
                {distribuicao.filiaisDestino.map((filial) => {
                  const label = distribuicao.filialLabels[filial];
                  const StoreIcon = storeIcon(label);
                  return (
                    <th
                      key={filial}
                      className={`${styles.th} ${styles.center} ${styles.filialTh} ${styles.thSortable}`}
                      onClick={() => toggleSort(filial)}
                      title={`Ordenar pelo estoque de ${label}`}
                    >
                      <span className={styles.thStore}>
                        <span className={styles.thIcon}>
                          <StoreIcon />
                        </span>
                        <span>
                          {label} {sortArrow(filial)}
                        </span>
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className={styles.tbody}>
              {visiveis.map((item) => (
                <ItemRow
                  key={`${item.produto}|${item.cor}|${item.codigoCor ?? ""}`}
                  item={item}
                  filiais={distribuicao.filiaisDestino}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {itensFiltrados.length > 0 && (
        <div ref={stickyBarRef} className={styles.stickyTableHeader} style={{ display: "none" }}>
          <table
            className={styles.table}
            style={{ borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed" }}
          >
            <thead>
              <tr>
                <th
                  className={`${styles.stickyTableHeaderTh} ${styles.thProduto} ${styles.thSortable}`}
                  onClick={() => toggleSort("produto")}
                >
                  Produto {sortArrow("produto")}
                </th>
                <th
                  className={`${styles.stickyTableHeaderTh} ${styles.center} ${styles.thSortable}`}
                  onClick={() => toggleSort("matriz")}
                >
                  Matriz {sortArrow("matriz")}
                </th>
                {distribuicao.filiaisDestino.map((filial) => (
                  <th
                    key={filial}
                    className={`${styles.stickyTableHeaderTh} ${styles.center} ${styles.thSortable}`}
                    onClick={() => toggleSort(filial)}
                  >
                    {distribuicao.filialLabels[filial]} {sortArrow(filial)}
                  </th>
                ))}
              </tr>
            </thead>
          </table>
        </div>
      )}

      {limite < itensFiltrados.length && (
        <div className={styles.loadMoreWrap}>
          <button
            type="button"
            className={styles.loadMore}
            onClick={() => setLimite((l) => l + PAGE_STEP)}
          >
            Mostrar mais ({itensFiltrados.length - limite} restantes)
          </button>
        </div>
      )}
    </div>
  );
}

function ItemRow({ item, filiais }: { item: DistribuicaoItem; filiais: string[] }) {
  const lojaPorFilial = useMemo(() => new Map(item.lojas.map((l) => [l.filial, l])), [item.lojas]);

  const nome = item.descricao?.replace(`(${item.produto})`, "").trim() || item.descricao;

  return (
    <tr>
      <td className={`${styles.stickyProduto} ${styles.produtoCell}`}>
        <span className={styles.produtoNome}>{nome}</span>
        <span className={styles.produtoMeta}>
          {/* Código de barra (menor/interno) — é o que se bipa. Cai no código do produto se faltar. */}
          {item.codigoBarra || item.codigo}
          {item.cor ? ` • ${item.cor}` : ""}
        </span>
        {(item.subgrupo || item.grade) && (
          <span className={styles.produtoSub}>
            {item.subgrupo}
            {item.subgrupo && item.grade ? " • " : ""}
            {item.grade}
          </span>
        )}
      </td>
      <td className={`${styles.stickyMatriz} ${styles.center} ${styles.matrizCell}`}>
        <span className={styles.matrizEstoque}>{item.matrizEstoque}</span>
      </td>
      {filiais.map((filial) => {
        const loja = lojaPorFilial.get(filial);
        if (!loja) {
          return (
            <td key={filial} className={`${styles.center}`}>
              <span className={styles.numSemVenda}>—</span>
            </td>
          );
        }
        const tooltip = loja.vende
          ? `${loja.filialLabel}\nMínimo: ${loja.idealAlvo}\nEstoque: ${loja.estoqueAtual}\n${loja.idealStatusLabel}${
              loja.enviar > 0 ? `\n➜ Enviar ${loja.enviar} (fica com ${loja.saldoAposEnvio})` : ""
            }`
          : `${loja.filialLabel}\nNão estoca este item (mínimo 0)`;
        return (
          <td key={filial} className={styles.center} title={tooltip}>
            <span className={styles.cellInner}>
              <span className={`${styles.estoqueNum} ${NUM_CLASS[loja.status]}`}>{loja.estoqueAtual}</span>
              {loja.enviar > 0 && <span className={styles.enviarBadge}>➜ {loja.enviar}</span>}
            </span>
          </td>
        );
      })}
    </tr>
  );
}
