"use client";

import { useState } from "react";

import { resolveCompany, type CompanyKey } from "@/lib/config/company";

import styles from "./FilialFilter.module.css";

interface FilialFilterProps {
  companyKey: CompanyKey;
  value: string | null;
  onChange: (value: string | null) => void;
  label?: string;
}

export default function FilialFilter({
  companyKey,
  value,
  onChange,
  label = "Filial",
}: FilialFilterProps) {
  const [isOpen, setIsOpen] = useState(false);

  const company = resolveCompany(companyKey);
  const filiais = company?.filialFilters.sales ?? [];
  const displayNames = company?.filialDisplayNames ?? {};

  const displayValue = value
    ? displayNames[value] ?? value
    : "Todas as filiais";

  return (
    <div className={styles.container}>
      <span className={styles.label}>{label}</span>
      <button
        type="button"
        className={`${styles.button} ${isOpen ? styles.buttonActive : ""}`}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <span className={styles.buttonValue}>
          <span className={styles.valuePrimary}>{displayValue}</span>
        </span>
        <span>▼</span>
      </button>

      {isOpen ? (
        <>
          <div className={styles.backdrop} onClick={() => setIsOpen(false)} />
          <div className={styles.dropdown}>
            <button
              type="button"
              className={`${styles.option} ${value === null ? styles.optionActive : ""}`}
              onClick={() => {
                onChange(null);
                setIsOpen(false);
              }}
            >
              Todas as filiais
            </button>
            {filiais.map((filial) => {
              const displayName = displayNames[filial] ?? filial;
              return (
                <button
                  key={filial}
                  type="button"
                  className={`${styles.option} ${value === filial ? styles.optionActive : ""}`}
                  onClick={() => {
                    onChange(filial);
                    setIsOpen(false);
                  }}
                >
                  {displayName}
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

