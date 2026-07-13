"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { useAuth } from "@/components/auth/AuthContext";
import { CartProvider, useCart } from "./CartContext";
import styles from "./loja.module.css";

function LojaHeader() {
  const { count } = useCart();
  const { user } = useAuth();
  const router = useRouter();
  const [term, setTerm] = useState("");

  function onSearch(e: FormEvent) {
    e.preventDefault();
    const q = term.trim();
    router.push(q ? `/corporativo/loja?q=${encodeURIComponent(q)}` : "/corporativo/loja");
  }

  return (
    <div className={styles.storeHeader}>
      <div className={styles.storeHeaderInner}>
        <Link href="/corporativo/loja" className={styles.brand}>
          <span className={styles.brandLogo}>S</span>
          <span className={styles.brandText}>
            <span className={styles.brandTitle}>Loja Corporativa</span>
            <span className={styles.brandSub}>Atacado</span>
          </span>
        </Link>

        <form className={styles.headerSearch} onSubmit={onSearch}>
          <span className={styles.headerSearchIcon}>⌕</span>
          <input
            type="search"
            placeholder="Buscar produto por nome, código ou EAN…"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </form>

        <div className={styles.headerActions}>
          {user?.role === "admin" && (
            <div className={styles.adminNav}>
              <Link href="/corporativo/catalogo" className={styles.adminNavLink}>
                Catálogo
              </Link>
              <Link href="/corporativo/pedidos" className={styles.adminNavLink}>
                Pedidos
              </Link>
            </div>
          )}
          <Link href="/corporativo/loja/carrinho" className={styles.cartBtn}>
            <span>🛒 Carrinho</span>
            {count > 0 && <span className={styles.cartBadge}>{count}</span>}
          </Link>
        </div>
      </div>
    </div>
  );
}

function PendingBanner() {
  const { user } = useAuth();
  if (!(user?.role === "cliente_corporativo" && !user?.clienteCodigo)) return null;
  return (
    <div className={styles.container} style={{ paddingTop: 16, paddingBottom: 0 }}>
      <div className={styles.sampleBanner}>
        Seu cadastro está <strong>em análise</strong>. Você já pode navegar e montar o carrinho — a
        finalização de pedidos será liberada assim que a equipe aprovar seu cadastro.
      </div>
    </div>
  );
}

export default function LojaLayout({ children }: { children: ReactNode }) {
  return (
    <CartProvider>
      <div className={styles.shell}>
        <LojaHeader />
        <PendingBanner />
        <div className={styles.container}>{children}</div>
      </div>
    </CartProvider>
  );
}
