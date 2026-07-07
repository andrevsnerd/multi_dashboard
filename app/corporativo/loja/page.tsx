"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { formatBRL } from "./CartContext";
import styles from "./loja.module.css";

interface ProdutoCard {
  produto: string;
  descProduto: string;
  ean: string;
  categoria: string;
  precoAtacado: number;
  imagem: string | null;
}

function Vitrine() {
  const searchParams = useSearchParams();
  const q = (searchParams.get("q") ?? "").trim().toLowerCase();

  const [cards, setCards] = useState<ProdutoCard[]>([]);
  const [categorias, setCategorias] = useState<string[]>([]);
  const [categoriaAtiva, setCategoriaAtiva] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/corporativo/loja/produtos");
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Erro ao carregar.");
        if (!alive) return;
        setCards(json.data as ProdutoCard[]);
        setCategorias(json.categorias as string[]);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Erro ao carregar.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const visiveis = useMemo(() => {
    return cards.filter((c) => {
      if (categoriaAtiva && c.categoria !== categoriaAtiva) return false;
      if (q) {
        const hay = `${c.descProduto} ${c.ean} ${c.produto}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [cards, categoriaAtiva, q]);

  return (
    <>
      <div className={styles.pageHead}>
        <h1 className={styles.pageTitle}>Produtos disponíveis</h1>
        <p className={styles.pageSub}>
          {q
            ? `Resultados para “${q}”`
            : "Selecione um produto para ver cores, preço de atacado e adicionar ao carrinho."}
        </p>
      </div>

      {categorias.length > 0 && (
        <div className={styles.chips}>
          <button
            className={`${styles.chip} ${categoriaAtiva === "" ? styles.chipActive : ""}`}
            onClick={() => setCategoriaAtiva("")}
          >
            Todos
          </button>
          {categorias.map((cat) => (
            <button
              key={cat}
              className={`${styles.chip} ${categoriaAtiva === cat ? styles.chipActive : ""}`}
              onClick={() => setCategoriaAtiva((prev) => (prev === cat ? "" : cat))}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {error && <div className={styles.alertError}>{error}</div>}

      {loading ? (
        <div className={styles.loadingRow}>Carregando produtos…</div>
      ) : visiveis.length === 0 ? (
        <div className={styles.empty}>
          {cards.length === 0
            ? "Nenhum produto disponível no momento."
            : "Nenhum produto encontrado com esse filtro."}
        </div>
      ) : (
        <div className={styles.grid}>
          {visiveis.map((c) => (
            <Link
              key={c.produto}
              href={`/corporativo/loja/produto/${encodeURIComponent(c.produto)}`}
              className={styles.card}
            >
              <div className={styles.cardImage}>
                {c.imagem ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.imagem} alt={c.descProduto} />
                ) : (
                  <div className={styles.imgPlaceholder}>
                    <span>🖼️</span>
                    <span>Sem imagem</span>
                  </div>
                )}
              </div>
              <div className={styles.cardBody}>
                {c.categoria && <span className={styles.cardCat}>{c.categoria}</span>}
                <span className={styles.cardName}>{c.descProduto || c.produto}</span>
                {c.ean && <span className={styles.cardEan}>EAN {c.ean}</span>}
                <div className={styles.cardPriceRow}>
                  <span className={styles.cardPrice}>{formatBRL(c.precoAtacado)}</span>
                  <span className={styles.atacadoTag}>(atacado)</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

export default function LojaHomePage() {
  return (
    <Suspense fallback={<div className={styles.loadingRow}>Carregando…</div>}>
      <Vitrine />
    </Suspense>
  );
}
