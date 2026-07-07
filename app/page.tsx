"use client";

import Link from "next/link";
import { useAuth } from "@/components/auth/AuthContext";
import { canAccessPath, getFirstAllowedPath, getVisibleCompanies } from "@/lib/auth/permissions";
import styles from "./page.module.css";

export default function Home() {
  const { user } = useAuth();
  const visible = user ? getVisibleCompanies(user) : ["nerd", "scarfme"];
  const nerdHref = user ? getFirstAllowedPath(user, "nerd") : "/nerd";
  const scarfmeHref = user ? getFirstAllowedPath(user, "scarfme") : "/scarfme";
  // CORPORATIVO só aparece para quem realmente pode entrar (admin + cliente_corporativo).
  const canCorporativo = user ? canAccessPath(user, "/corporativo") : false;

  return (
    <main className={styles.container}>
      <header className={styles.header}>
        <span className={styles.label}>Seleção de Empresa</span>
        <h1 className={styles.title}>Escolha o ambiente de análise</h1>
        <p className={styles.subtitle}>
          Selecione entre as operações para acessar dashboards dedicados com filtros, métricas e
          análises específicas.
        </p>
      </header>

      <div className={styles.actions}>
        {visible.includes("nerd") && (
          <Link href={nerdHref} className={styles.companyCard}>
            <span className={styles.companyLabel}>NERD</span>
            <strong className={styles.companyTitle}>Dashboard NERD</strong>
            <span className={styles.companyHint}>Filiais, KPIs e análises personalizadas</span>
          </Link>
        )}
        {visible.includes("scarfme") && (
          <Link href={scarfmeHref} className={styles.companyCard}>
            <span className={styles.companyLabel}>SCARF ME</span>
            <strong className={styles.companyTitle}>Dashboard Scarf Me</strong>
            <span className={styles.companyHint}>Indicadores estratégicos por operação</span>
          </Link>
        )}
        {canCorporativo && (
          <Link href="/corporativo/loja" className={styles.companyCard}>
            <span className={styles.companyLabel}>CORPORATIVO</span>
            <strong className={styles.companyTitle}>Corporativo</strong>
            <span className={styles.companyHint}>Loja de atacado, catálogo e pedidos</span>
          </Link>
        )}
      </div>
    </main>
  );
}
