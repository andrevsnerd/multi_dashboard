import Link from "next/link";

import styles from "./page.module.css";

export default function Home() {
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
        <Link href="/nerd" className={styles.companyCard}>
          <span className={styles.companyLabel}>NERD</span>
          <strong className={styles.companyTitle}>Dashboard NERD</strong>
          <span className={styles.companyHint}>Filiais, KPIs e análises personalizadas</span>
        </Link>

        <Link href="/scarfme" className={styles.companyCard}>
          <span className={styles.companyLabel}>SCARF ME</span>
          <strong className={styles.companyTitle}>Dashboard Scarf Me</strong>
          <span className={styles.companyHint}>Indicadores estratégicos por operação</span>
        </Link>
      </div>
    </main>
  );
}
