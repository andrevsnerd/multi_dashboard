"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import styles from "./AppHeader.module.css";

interface AppHeaderProps {
  companyName: string;
}

export default function AppHeader({ companyName }: AppHeaderProps) {
  const pathname = usePathname();

  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <span className={styles.brandSubtitle}>Dashboard Corporativo</span>
        <h2 className={styles.brandTitle}>{companyName}</h2>
      </div>

      <nav className={styles.nav}>
        <span className={styles.navPlaceholder}>Menus em desenvolvimento</span>
        {pathname !== "/" ? (
          <Link href="/" className={styles.backLink}>
            Voltar à seleção
          </Link>
        ) : null}
      </nav>
    </header>
  );
}


