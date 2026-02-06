"use client";

import { useState } from "react";

import { resolveCompany, type CompanyKey, type CompanyModule, VAREJO_VALUE, isEcommerceFilial } from "@/lib/config/company";

import styles from "./FilialFilter.module.css";

interface FilialFilterProps {
  companyKey: CompanyKey;
  value: string | null;
  onChange: (value: string | null) => void;
  label?: string;
  module?: CompanyModule; // Permite escolher entre 'sales' ou 'inventory'
  /** Se informado, mostra apenas essas filiais no select (nomes canônicos). Admin vê todas. */
  allowedFiliais?: string[] | null;
}

export default function FilialFilter({
  companyKey,
  value,
  onChange,
  label = "Filial",
  module = "sales",
  allowedFiliais,
}: FilialFilterProps) {
  const [isOpen, setIsOpen] = useState(false);

  const company = resolveCompany(companyKey);
  const filiais = company?.filialFilters[module] ?? [];
  const displayNames = company?.filialDisplayNames ?? {};
  const isScarfme = companyKey === 'scarfme';
  const ecommerceFilials = company?.ecommerceFilials ?? [];
  
  // Filtrar filiais normais (sem ecommerce) para mostrar na lista
  let normalFiliais = filiais.filter(f => !ecommerceFilials.includes(f));
  if (allowedFiliais && allowedFiliais.length > 0) {
    const allowedSet = new Set(allowedFiliais.map((a) => a.trim().toUpperCase()));
    normalFiliais = normalFiliais.filter((f) =>
      allowedSet.has((f || "").trim().toUpperCase())
    );
  }

  // Obter a primeira filial de ecommerce (se houver e se permitida)
  let ecommerceFilial = ecommerceFilials.length > 0 ? ecommerceFilials[0] : null;
  if (allowedFiliais && allowedFiliais.length > 0 && ecommerceFilial) {
    const allowedSet = new Set(allowedFiliais.map((a) => a.trim().toUpperCase()));
    if (!allowedSet.has((ecommerceFilial || "").trim().toUpperCase())) {
      ecommerceFilial = null;
    }
  }
  const ecommerceDisplayName = ecommerceFilial ? (displayNames[ecommerceFilial] ?? ecommerceFilial) : null;

  const displayValue = value === VAREJO_VALUE
    ? "VAREJO"
    : isEcommerceFilial(companyKey, value)
    ? ecommerceDisplayName ?? "E-COMMERCE"
    : value
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
            {isScarfme && (
              <button
                type="button"
                className={`${styles.option} ${value === VAREJO_VALUE ? styles.optionActive : ""}`}
                onClick={() => {
                  onChange(VAREJO_VALUE);
                  setIsOpen(false);
                }}
              >
                VAREJO
              </button>
            )}
            {isScarfme && ecommerceFilial && (
              <button
                type="button"
                className={`${styles.option} ${value === ecommerceFilial ? styles.optionActive : ""}`}
                onClick={() => {
                  onChange(ecommerceFilial);
                  setIsOpen(false);
                }}
              >
                {ecommerceDisplayName}
              </button>
            )}
            {normalFiliais.map((filial) => {
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

