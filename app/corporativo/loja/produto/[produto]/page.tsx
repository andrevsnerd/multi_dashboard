"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useCart, formatBRL } from "../../CartContext";
import styles from "../../loja.module.css";

interface Cor {
  code: string;
  description: string;
  displayName: string;
  ean: string;
}
interface ProdutoDetalhe {
  produto: string;
  descProduto: string;
  ean: string;
  categoria: string;
  precoAtacado: number;
  cores: Cor[];
  imagensGerais: string[];
  imagensPorCor: Record<string, string[]>;
}

export default function ProdutoPage() {
  const params = useParams<{ produto: string }>();
  const produtoId = decodeURIComponent(String(params.produto ?? ""));
  const { addItem } = useCart();

  const [data, setData] = useState<ProdutoDetalhe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [corSel, setCorSel] = useState<string | null>(null);
  const [qtd, setQtd] = useState(1);
  const [imgIdx, setImgIdx] = useState(0);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/corporativo/loja/produto/${encodeURIComponent(produtoId)}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Erro ao carregar.");
        if (!alive) return;
        const d = json.data as ProdutoDetalhe;
        setData(d);
        if (d.cores.length === 1) setCorSel(d.cores[0].code);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Erro ao carregar.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [produtoId]);

  const corAtual = useMemo(
    () => data?.cores.find((c) => c.code === corSel) ?? null,
    [data, corSel]
  );

  // Imagens exibidas: da cor selecionada (se houver) senão as gerais.
  const imagens = useMemo(() => {
    if (!data) return [];
    const daCor = corSel ? data.imagensPorCor[corSel] ?? [] : [];
    return daCor.length > 0 ? daCor : data.imagensGerais;
  }, [data, corSel]);

  useEffect(() => setImgIdx(0), [corSel]);

  const eanExibido = corAtual?.ean || data?.ean || "";
  const precisaCor = (data?.cores.length ?? 0) > 0;

  function handleAdd() {
    if (!data) return;
    if (precisaCor && !corSel) return;
    addItem({
      produto: data.produto,
      descProduto: data.descProduto,
      ean: eanExibido,
      cor: corSel ?? "",
      corNome: corAtual?.displayName ?? "",
      precoUnitario: data.precoAtacado,
      quantidade: qtd,
      imagem: imagens[0] ?? null,
    });
    setAdded(true);
    setTimeout(() => setAdded(false), 2500);
  }

  return (
    <>
      <Link href="/corporativo/loja" className={styles.backLink}>
        ← Voltar aos produtos
      </Link>

      {error && <div className={styles.alertError}>{error}</div>}

      {loading ? (
        <div className={styles.loadingRow}>Carregando produto…</div>
      ) : !data ? (
        !error && <div className={styles.empty}>Produto não encontrado.</div>
      ) : (
        <div className={styles.produtoLayout}>
          {/* Galeria */}
          <div className={styles.gallery}>
            <div className={styles.galleryMain}>
              {imagens.length > 0 ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imagens[imgIdx] ?? imagens[0]} alt={data.descProduto} />
              ) : (
                <div className={styles.imgPlaceholder}>
                  <span style={{ fontSize: 44 }}>🖼️</span>
                  <span>Imagem em breve</span>
                </div>
              )}
            </div>
            {imagens.length > 1 && (
              <div className={styles.thumbs}>
                {imagens.map((src, i) => (
                  <button
                    key={i}
                    className={`${styles.thumb} ${i === imgIdx ? styles.thumbActive : ""}`}
                    onClick={() => setImgIdx(i)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`${data.descProduto} ${i + 1}`} />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Informações */}
          <div className={styles.produtoInfo}>
            {eanExibido && <div className={styles.produtoEan}>EAN {eanExibido}</div>}
            <h1 className={styles.produtoNome}>{data.descProduto || data.produto}</h1>
            {data.categoria && <div className={styles.produtoCat}>{data.categoria}</div>}

            <div className={styles.priceBlock}>
              <span className={styles.priceBig}>{formatBRL(data.precoAtacado)}</span>
              <span className={styles.priceAtacado}>atacado</span>
            </div>

            {data.cores.length > 0 && (
              <div>
                <div className={styles.fieldLabel}>
                  Cor{corAtual ? `: ${corAtual.displayName}` : ""}
                </div>
                <div className={styles.swatches}>
                  {data.cores.map((c) => (
                    <button
                      key={c.code || c.displayName}
                      className={`${styles.swatch} ${corSel === c.code ? styles.swatchActive : ""}`}
                      onClick={() => setCorSel(c.code)}
                    >
                      {c.displayName}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className={styles.fieldLabel}>Quantidade</div>
              <div className={styles.stepper}>
                <button
                  className={styles.stepperBtn}
                  onClick={() => setQtd((n) => Math.max(1, n - 1))}
                  aria-label="Diminuir"
                >
                  −
                </button>
                <input
                  className={styles.stepperVal}
                  type="number"
                  min={1}
                  value={qtd}
                  onChange={(e) => setQtd(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                />
                <button
                  className={styles.stepperBtn}
                  onClick={() => setQtd((n) => n + 1)}
                  aria-label="Aumentar"
                >
                  +
                </button>
              </div>
            </div>

            <div className={styles.addRow}>
              <button
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={handleAdd}
                disabled={precisaCor && !corSel}
              >
                {precisaCor && !corSel ? "Selecione uma cor" : "Adicionar ao carrinho"}
              </button>
              <Link href="/corporativo/loja/carrinho" className={styles.btn}>
                Ver carrinho
              </Link>
            </div>
            {added && (
              <div style={{ color: "#059669", fontSize: 13, fontWeight: 600 }}>
                ✓ Adicionado ao carrinho.
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
