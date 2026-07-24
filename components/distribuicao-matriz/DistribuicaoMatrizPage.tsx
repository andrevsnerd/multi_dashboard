"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CompanyKey } from "@/lib/config/company";
import type { DistribuicaoItem, DistribuicaoResult, LojaDistStatus } from "@/lib/utils/distribuicao-matriz";

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

const STATUS_CLASS: Record<LojaDistStatus, string> = {
  SEM_ESTOQUE: styles.cellSemEstoque,
  CRITICO: styles.cellCritico,
  BAIXO: styles.cellBaixo,
  OK: styles.cellOk,
  SEM_VENDA: styles.cellSemVenda,
  NOVO: styles.cellNovo,
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

export default function DistribuicaoMatrizPage({
  companyKey,
  companyName,
}: DistribuicaoMatrizPageProps) {
  const [distribuicao, setDistribuicao] = useState<DistribuicaoResult>(EMPTY_RESULT);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [busca, setBusca] = useState("");
  const [material, setMaterial] = useState("todos");
  const [soZeradas, setSoZeradas] = useState(false);
  const [limite, setLimite] = useState(PAGE_STEP);

  const inFlightRef = useRef(false);

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

  useEffect(() => {
    setLimite(PAGE_STEP);
  }, [busca, material, soZeradas]);

  const visiveis = itensFiltrados.slice(0, limite);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Distribuição Matriz</h1>
        </div>
        <button type="button" className={styles.refreshBtn} onClick={loadData} disabled={loading}>
          {loading ? "Carregando…" : "Atualizar"}
        </button>
      </header>

      <section className={styles.tiles}>
        <div className={styles.tile}>
          <span className={styles.tileLabel}>Itens na matriz</span>
          <span className={styles.tileValue}>{resumo.totalItens}</span>
        </div>
        <div className={`${styles.tile} ${styles.tileDanger}`}>
          <span className={styles.tileLabel}>Lojas zeradas (vendem)</span>
          <span className={styles.tileValue}>{resumo.lojasZeradas}</span>
        </div>
        <div className={`${styles.tile} ${styles.tileSuccess}`}>
          <span className={styles.tileLabel}>Total a enviar</span>
          <span className={styles.tileValue}>{resumo.totalEnviar}</span>
        </div>
        <div className={`${styles.tile} ${styles.tileWarn}`}>
          <span className={styles.tileLabel}>Itens que a matriz não cobre</span>
          <span className={styles.tileValue}>{resumo.itensDescoberto}</span>
        </div>
      </section>

      <section className={styles.controls}>
        <input
          type="search"
          className={styles.search}
          placeholder="Buscar produto, código, cor…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <select
          className={styles.select}
          value={material}
          onChange={(e) => setMaterial(e.target.value)}
        >
          <option value="todos">Todos os materiais</option>
          {materiais.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <label className={styles.toggle}>
          <input type="checkbox" checked={soZeradas} onChange={(e) => setSoZeradas(e.target.checked)} />
          Só com loja zerada
        </label>
      </section>

      <section className={styles.legend}>
        <span className={`${styles.legendItem} ${styles.legendSemEstoque}`}>Zerada (estoca, tem 0)</span>
        <span className={`${styles.legendItem} ${styles.legendCritico}`}>Bem abaixo do mínimo</span>
        <span className={`${styles.legendItem} ${styles.legendBaixo}`}>Abaixo do mínimo</span>
        <span className={`${styles.legendItem} ${styles.legendOk}`}>No mínimo ou acima</span>
        <span className={`${styles.legendItem} ${styles.legendSemVenda}`}>Não estoca (mín. 0)</span>
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
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={`${styles.stickyProduto} ${styles.th}`}>Produto</th>
                <th className={`${styles.stickyMatriz} ${styles.th} ${styles.center}`}>
                  Matriz
                  <br />
                  estoque
                </th>
                {distribuicao.filiaisDestino.map((filial) => (
                  <th key={filial} className={`${styles.th} ${styles.center} ${styles.filialTh}`}>
                    {distribuicao.filialLabels[filial]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
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
  const lojaPorFilial = useMemo(
    () => new Map(item.lojas.map((l) => [l.filial, l])),
    [item.lojas]
  );

  const nome = item.descricao?.replace(`(${item.produto})`, "").trim() || item.descricao;

  return (
    <tr>
      <td className={`${styles.stickyProduto} ${styles.produtoCell}`}>
        <span className={styles.produtoNome}>
          {nome}
          {item.semHistorico && (
            <span
              className={styles.novoBadge}
              title="Sem histórico de venda em nenhuma loja — distribuição de abertura, igual entre as lojas"
            >
              NOVO
            </span>
          )}
        </span>
        <span className={styles.produtoMeta}>
          {item.codigo}
          {item.cor ? ` · ${item.cor}` : ""}
          {item.subgrupo ? ` · ${item.subgrupo}` : ""}
        </span>
      </td>
      <td className={`${styles.stickyMatriz} ${styles.center} ${styles.matrizCell}`}>
        <span className={styles.matrizEstoque}>{item.matrizEstoque}</span>
        {!item.atendeTudo && <span className={styles.matrizFalta} title="Matriz não cobre toda a rede">falta</span>}
      </td>
      {filiais.map((filial) => {
        const loja = lojaPorFilial.get(filial);
        if (!loja) {
          return (
            <td key={filial} className={`${styles.center} ${styles.cellSemVenda}`}>
              —
            </td>
          );
        }
        const tooltip = loja.vende
          ? `${loja.filialLabel}\nMínimo: ${loja.idealAlvo}\nEstoque: ${loja.estoqueAtual}\n${loja.idealStatusLabel}${
              loja.enviar > 0 ? `\n➜ Enviar ${loja.enviar} (fica com ${loja.saldoAposEnvio})` : ""
            }`
          : `${loja.filialLabel}\nNão estoca este item (mínimo 0)`;
        return (
          <td
            key={filial}
            className={`${styles.center} ${STATUS_CLASS[loja.status]}`}
            title={tooltip}
          >
            <span className={styles.estoqueNum}>{loja.estoqueAtual}</span>
            {loja.enviar > 0 && <span className={styles.enviarBadge}>➜ {loja.enviar}</span>}
          </td>
        );
      })}
    </tr>
  );
}
