"use client";

import styles from "./TopHeader.module.css";

interface TopHeaderProps {
  companyName: string;
}

export default function TopHeader({ companyName }: TopHeaderProps) {
  return (
    <header className={styles.header}>
      <h1 className={styles.title}>{companyName}</h1>
    </header>
  );
}

