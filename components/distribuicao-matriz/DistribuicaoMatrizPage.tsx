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
  const [subgrupo, setSubgrupo] = useState("todos");
  const [soComEnvio, setSoComEnvio] = useState(true);
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

  const subgrupos = useMemo(() => {
    const set = new Set<string>();
    distribuicao.itens.forEach((i) => {
      if (i.subgrupo) set.add(i.subgrupo);
    });
    return Array.from(set).sort();
  }, [distribuicao.itens]);

  const itensFiltrados = useMemo(() => {
    const termo = normalize(busca.trim());
    return distribuicao.itens.filter((item) => {
      if (soComEnvio && item.totalEnviar <= 0) return false;
      if (soZeradas && item.lojasSemEstoque <= 0) return false;
      if (subgrupo !== "todos" && item.subgrupo !== subgrupo) return false;
      if (termo) {
        const hay = normalize(
          `${item.descricao} ${item.produto} ${item.codigo} ${item.codigoBarra ?? ""} ${item.cor}`
        );
        if (!hay.includes(termo)) return false;
      }
      return true;
    });
  }, [distribuicao.itens, busca, subgrupo, soComEnvio, soZeradas]);

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
  }, [busca, subgrupo, soComEnvio, soZeradas]);

  const visiveis = itensFiltrados.slice(0, limite);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Distribuição Matriz</h1>
          <p className={styles.subtitle}>
            Estoque da <strong>{distribuicao.matrizLabel}</strong> e quanto enviar para cada loja não
            zerar. A missão da matriz é abastecer a rede — acabou o item na loja, manda; nunca deixa
            com 1. Mesma Compra Ideal de Lista Loja/Curva ABC, aplicada por loja. {companyName}
          </p>
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
          value={subgrupo}
          onChange={(e) => setSubgrupo(e.target.value)}
        >
          <option value="todos">Todos os subgrupos</option>
          {subgrupos.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={soComEnvio}
            onChange={(e) => setSoComEnvio(e.target.checked)}
          />
          Só com envio sugerido
        </label>
        <label className={styles.toggle}>
          <input type="checkbox" checked={soZeradas} onChange={(e) => setSoZeradas(e.target.checked)} />
          Só com loja zerada
        </label>
      </section>

      <section className={styles.legend}>
        <span className={`${styles.legendItem} ${styles.legendSemEstoque}`}>Loja zerada (0)</span>
        <span className={`${styles.legendItem} ${styles.legendCritico}`}>Crítico (repor urgente)</span>
        <span className={`${styles.legendItem} ${styles.legendBaixo}`}>Repor</span>
        <span className={`${styles.legendItem} ${styles.legendOk}`}>OK</span>
        <span className={`${styles.legendItem} ${styles.legendNovo}`}>Novo (sem histórico)</span>
        <span className={`${styles.legendItem} ${styles.legendSemVenda}`}>Não vende</span>
        <span className={styles.legendEnviar}>➜ N = enviar N unidades</span>
      </section>

      {error && <div className={styles.error}>{error}</div>}

      {!error && loading && !loadedOnce && (
        <div className={styles.loadingBox}>
          <div className={styles.spinner} />
          <span>Carregando estoque e Compra Ideal da rede…</span>
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
        const tooltip =
          loja.status === "NOVO"
            ? `${loja.filialLabel}\nSem histórico — abertura igual entre as lojas\nEstoque: ${loja.estoqueAtual}${
                loja.enviar > 0 ? `\n➜ Enviar ${loja.enviar} (fica com ${loja.saldoAposEnvio})` : ""
              }`
            : loja.vende
              ? `${loja.filialLabel}\nEstoque: ${loja.estoqueAtual}\nCobertura: ${
                  loja.coberturaAtualDias == null ? "—" : `${loja.coberturaAtualDias}d`
                }\nCompra Ideal: ${loja.idealStatusLabel} (alvo ${loja.idealAlvo})${
                  loja.enviar > 0 ? `\n➜ Enviar ${loja.enviar} (fica com ${loja.saldoAposEnvio})` : ""
                }`
              : `${loja.filialLabel}\nNão vende o item`;
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
