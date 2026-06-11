"use client";

import { useEffect, useMemo, useState } from "react";

import type { CompanyKey } from "@/lib/config/company";
import type { ProdutoDescontinuadoItem } from "@/lib/utils/produtos-descontinuados";

import styles from "./ProdutoDescontinuadoPage.module.css";

type ProductSearchResult = {
  productId: string;
  productName: string;
  matchedColorCode?: string | null;
  matchedColorName?: string | null;
};

interface ProdutoDescontinuadoPageProps {
  companyKey: CompanyKey;
  companyName: string;
}

export default function ProdutoDescontinuadoPage({
  companyKey,
  companyName,
}: ProdutoDescontinuadoPageProps) {
  const [items, setItems] = useState<ProdutoDescontinuadoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<ProductSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [savingProduto, setSavingProduto] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const existingKeys = useMemo(
    () => new Set(items.map((item) => item.produto.trim().toUpperCase())),
    [items]
  );

  async function loadItems() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/produtos-descontinuados?company=${encodeURIComponent(companyKey)}`,
        { cache: "no-store" }
      );
      const json = (await response.json()) as { data?: ProdutoDescontinuadoItem[]; error?: string };

      if (!response.ok) {
        throw new Error(json.error || "Não foi possível carregar os produtos descontinuados.");
      }

      setItems(json.data ?? []);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Não foi possível carregar os produtos descontinuados."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadItems();
  }, [companyKey]);

  useEffect(() => {
    if (searchTerm.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    let cancelled = false;
    setSearching(true);

    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/products/search?q=${encodeURIComponent(searchTerm.trim())}`, {
          cache: "no-store",
        });
        const json = (await response.json()) as { data?: ProductSearchResult[] };
        if (!cancelled) {
          setSearchResults(json.data ?? []);
        }
      } catch {
        if (!cancelled) {
          setSearchResults([]);
        }
      } finally {
        if (!cancelled) {
          setSearching(false);
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [searchTerm]);

  async function addItem(result: ProductSearchResult) {
    if (existingKeys.has(result.productId.trim().toUpperCase())) {
      setFeedback(`${result.productName} já está marcado como descontinuado.`);
      return;
    }

    setSavingProduto(result.productId);
    setFeedback(null);
    setError(null);

    try {
      const response = await fetch("/api/produtos-descontinuados", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: companyKey,
          produto: result.productId,
          descricao: result.productName,
        }),
      });

      const json = (await response.json()) as { data?: ProdutoDescontinuadoItem; error?: string };
      if (!response.ok) {
        throw new Error(json.error || "Não foi possível marcar o produto.");
      }

      await loadItems();
      setSearchTerm("");
      setSearchResults([]);
      setFeedback(`${result.productName} marcado como descontinuado em ${companyName}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível marcar o produto.");
    } finally {
      setSavingProduto(null);
    }
  }

  async function removeItem(item: ProdutoDescontinuadoItem) {
    const confirmed = window.confirm(`Remover "${item.descricao || item.produto}" da lista de descontinuados?`);
    if (!confirmed) return;

    setError(null);
    setFeedback(null);

    try {
      const response = await fetch(
        `/api/produtos-descontinuados?company=${encodeURIComponent(companyKey)}&produto=${encodeURIComponent(item.produto)}`,
        { method: "DELETE" }
      );
      const json = (await response.json()) as { removed?: boolean; error?: string };
      if (!response.ok) {
        throw new Error(json.error || "Não foi possível remover o produto.");
      }

      await loadItems();
      setFeedback(`${item.descricao || item.produto} removido da lista.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível remover o produto.");
    }
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.hero}>
        <div>
          <h1 className={styles.title}>Produto Descontinuado</h1>
          <p className={styles.subtitle}>
            Marque produtos como descontinuados. Todos os itens adicionados aqui aparecem com fundo
            vermelho claro e uma etiqueta <strong>DESCONTINUADO</strong> nas telas de Produtos por Venda
            e Curva A, B, C.
          </p>
        </div>
        <div className={styles.note}>
          <strong>Como funciona</strong>
          <span>Busque o produto, clique para marcar. É só isso — o destaque é aplicado automaticamente.</span>
        </div>
      </div>

      <div className={styles.grid}>
        <section className={styles.editorCard}>
          <div className={styles.cardHeader}>
            <h2>Marcar produto</h2>
          </div>

          <label className={styles.field}>
            <span className={styles.label}>Buscar produto</span>
            <input
              className={styles.input}
              type="search"
              placeholder="Busque por nome, código ou código de barras"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </label>

          {(searching || searchResults.length > 0 || searchTerm.trim().length >= 2) && (
            <div className={styles.searchPanel}>
              {searching ? (
                <div className={styles.searchEmpty}>Buscando produtos...</div>
              ) : searchResults.length === 0 ? (
                <div className={styles.searchEmpty}>Nenhum produto encontrado.</div>
              ) : (
                searchResults.map((result) => {
                  const alreadyMarked = existingKeys.has(result.productId.trim().toUpperCase());
                  return (
                    <button
                      key={`${result.productId}-${result.matchedColorCode ?? "all"}`}
                      type="button"
                      className={styles.searchItem}
                      onClick={() => addItem(result)}
                      disabled={alreadyMarked || savingProduto === result.productId}
                    >
                      <span className={styles.searchName}>{result.productName}</span>
                      <span className={styles.searchCode}>
                        {alreadyMarked
                          ? "já marcado"
                          : savingProduto === result.productId
                            ? "marcando..."
                            : result.productId}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          )}

          {feedback && <div className={styles.feedback}>{feedback}</div>}
          {error && <div className={styles.error}>{error}</div>}
        </section>

        <section className={styles.listCard}>
          <div className={styles.cardHeader}>
            <h2>Produtos descontinuados</h2>
            <span>{items.length} item(ns)</span>
          </div>

          {loading ? (
            <div className={styles.emptyState}>Carregando produtos...</div>
          ) : items.length === 0 ? (
            <div className={styles.emptyState}>Nenhum produto descontinuado ainda.</div>
          ) : (
            <div className={styles.itemList}>
              {items.map((item) => (
                <div key={item.produto} className={styles.itemRow}>
                  <div>
                    <div className={styles.itemName}>
                      {item.descricao || item.produto}
                      <span className={styles.descontinuadoBadge}>DESCONTINUADO</span>
                    </div>
                    <div className={styles.itemCode}>{item.produto}</div>
                  </div>
                  <button
                    type="button"
                    className={styles.removeButton}
                    onClick={() => removeItem(item)}
                  >
                    Remover
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
