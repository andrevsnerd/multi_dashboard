"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCart, formatBRL } from "../CartContext";
import styles from "../loja.module.css";

export default function CarrinhoPage() {
  const { items, subtotal, frete, total, setQuantidade, removeItem } = useCart();
  const router = useRouter();

  if (items.length === 0) {
    return (
      <>
        <div className={styles.pageHead}>
          <h1 className={styles.pageTitle}>Seu carrinho</h1>
        </div>
        <div className={styles.empty}>
          <p>Seu carrinho está vazio.</p>
          <Link href="/corporativo/loja" className={styles.btn} style={{ marginTop: 12 }}>
            Ver produtos
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <div className={styles.pageHead}>
        <h1 className={styles.pageTitle}>Seu carrinho</h1>
        <p className={styles.pageSub}>{items.length} item(ns) no carrinho</p>
      </div>

      <div className={styles.cartLayout}>
        <div className={styles.cartList}>
          {items.map((i) => (
            <div key={`${i.produto} ${i.cor} ${i.tamanho}`} className={styles.cartItem}>
              <div className={styles.cartThumb}>
                {i.imagem ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={i.imagem} alt={i.descProduto} />
                ) : (
                  <span>🖼️</span>
                )}
              </div>
              <div className={styles.cartInfo}>
                <span className={styles.cartName}>
                  {i.descProduto || i.produto}
                  {i.grade ? <span className={styles.gradeNote}> ({i.grade})</span> : null}
                </span>
                {i.corNome && <span className={styles.cartMeta}>Cor: {i.corNome}</span>}
                {i.tamanho && <span className={styles.cartMeta}>Tamanho: {i.tamanho}</span>}
                {i.ean && <span className={styles.cartMeta}>EAN {i.ean}</span>}
                <span className={styles.cartUnit}>{formatBRL(i.precoUnitario)} / un.</span>
              </div>
              <div className={styles.cartRight}>
                <div className={styles.stepperSm}>
                  <button onClick={() => setQuantidade(i.produto, i.cor, i.tamanho, i.quantidade - 1)}>−</button>
                  <span>{i.quantidade}</span>
                  <button onClick={() => setQuantidade(i.produto, i.cor, i.tamanho, i.quantidade + 1)}>+</button>
                </div>
                <span className={styles.cartLineTotal}>
                  {formatBRL(i.precoUnitario * i.quantidade)}
                </span>
                <button className={styles.removeBtn} onClick={() => removeItem(i.produto, i.cor, i.tamanho)}>
                  Remover
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className={styles.summary}>
          <h2 className={styles.summaryTitle}>Resumo</h2>
          <div className={styles.summaryRow}>
            <span>Subtotal</span>
            <span>{formatBRL(subtotal)}</span>
          </div>
          <div className={styles.summaryRow}>
            <span>Frete</span>
            <span>{formatBRL(frete)}</span>
          </div>
          <div className={styles.summaryTotal}>
            <span>Total</span>
            <span>{formatBRL(total)}</span>
          </div>
          <button
            className={`${styles.btn} ${styles.btnPrimary} ${styles.btnBlock}`}
            onClick={() => router.push("/corporativo/loja/checkout")}
          >
            Finalizar compra
          </button>
          <Link href="/corporativo/loja" className={`${styles.btn} ${styles.btnBlock}`}>
            Continuar comprando
          </Link>
        </div>
      </div>
    </>
  );
}
