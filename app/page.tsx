"use client";

import Link from "next/link";
import { useAuth } from "@/components/auth/AuthContext";
import { getFirstAllowedPath, getVisibleCompanies } from "@/lib/auth/permissions";
import styles from "./page.module.css";

export default function Home() {
  const { user } = useAuth();
  const visible = user ? getVisibleCompanies(user) : ["nerd", "scarfme"];
  const nerdHref = user ? getFirstAllowedPath(user, "nerd") : "/nerd";
  const scarfmeHref = user ? getFirstAllowedPath(user, "scarfme") : "/scarfme";

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
      </div>
    </main>
  );
}
