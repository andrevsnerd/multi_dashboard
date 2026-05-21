"use client";

import { useState } from "react";

import {
  resolveCompany,
  type CompanyConfig,
  type CompanyKey,
  type CompanyModule,
  VAREJO_VALUE,
} from "@/lib/config/company";

import styles from "./FilialFilter.module.css";

interface FilialFilterProps {
  companyKey: CompanyKey;
  value: string | null;
  onChange: (value: string | null) => void;
  label?: string;
  module?: CompanyModule; // Permite escolher entre 'sales' ou 'inventory'
  /** Se informado, mostra apenas essas filiais no select (nomes canônicos). Admin vê todas. */
  allowedFiliais?: string[] | null;
  /** Esconde a opção VAREJO (ex.: controle de transferências em scarfme). */
  hideVarejo?: boolean;
  showActiveGroupHint?: boolean;
  companyConfigOverride?: Pick<
    CompanyConfig,
    "filialFilters" | "filialDisplayNames" | "filialGroups" | "activeFilials" | "ecommerceFilials"
  > | null;
}

export default function FilialFilter({
  companyKey,
  value,
  onChange,
  label = "Filial",
  module = "sales",
  allowedFiliais,
  hideVarejo = false,
  showActiveGroupHint = false,
  companyConfigOverride = null,
}: FilialFilterProps) {
  const [isOpen, setIsOpen] = useState(false);

  const company = companyConfigOverride ?? resolveCompany(companyKey);
  const filiais = company?.filialFilters[module] ?? [];
  const displayNames = company?.filialDisplayNames ?? {};
  const isScarfme = companyKey === 'scarfme';
  const ecommerceFilials = company?.ecommerceFilials ?? [];
  const isEcommerceOption = (filial: string | null | undefined) =>
    Boolean(filial && ecommerceFilials.includes(filial));

  // Membros não-canônicos de grupos (ex: 'SCARF ME - PAULISTA RSR') → não mostrar no dropdown;
  // apenas a filial canônica do grupo aparece (ex: 'SCARFME ME - PAULISTA FFF' → "PAULISTA")
  const nonCanonicalGroupMembers = new Set<string>();
  if (company?.filialGroups) {
    const canonicals = new Set(Object.keys(company.filialGroups));
    for (const members of Object.values(company.filialGroups)) {
      for (const m of members) {
        if (!canonicals.has(m)) nonCanonicalGroupMembers.add(m);
      }
    }
  }

  // Filtrar filiais normais (sem ecommerce, sem membros não-canônicos de grupos)
  let normalFiliais = filiais.filter(f => !ecommerceFilials.includes(f) && !nonCanonicalGroupMembers.has(f));
  if (allowedFiliais && allowedFiliais.length > 0) {
    // Expandir allowedFiliais: se um membro de grupo está permitido, a filial canônica também fica visível
    const expandedAllowed = new Set<string>();
    allowedFiliais.forEach((a) => {
      expandedAllowed.add(a.trim().toUpperCase());
      // Se é membro de grupo, adicionar a filial canônica à lista expandida
      if (company) {
        const canonical = Object.entries(company.filialGroups ?? {}).find(([, members]) =>
          members.map(m => m.trim().toUpperCase()).includes(a.trim().toUpperCase())
        )?.[0];
        if (canonical) expandedAllowed.add(canonical.trim().toUpperCase());
      }
    });
    normalFiliais = normalFiliais.filter((f) =>
      expandedAllowed.has((f || "").trim().toUpperCase())
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

  const getGroupActiveHint = (filial: string | null): string | null => {
    if (!showActiveGroupHint || !company || !filial || filial === VAREJO_VALUE) return null;
    const members = company.filialGroups?.[filial] ?? null;
    if (!members || members.length <= 1) return null;
    return (
      company.activeFilials?.[filial] ??
      members.map((member) => company.activeFilials?.[member]).find(Boolean) ??
      null
    );
  };

  const displayValue = value === VAREJO_VALUE
    ? "VAREJO"
    : isEcommerceOption(value)
    ? ecommerceDisplayName ?? "E-COMMERCE"
    : value
    ? displayNames[value] ?? value
    : "Todas as filiais";
  const displayActiveHint = getGroupActiveHint(value);

  return (
    <div className={styles.container}>
      {label ? <span className={styles.label}>{label}</span> : null}
      <button
        type="button"
        className={`${styles.button} ${isOpen ? styles.buttonActive : ""}`}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <span className={styles.buttonValue}>
          <span className={styles.valuePrimary}>
            {displayValue}
            {displayActiveHint ? <span className={styles.valueSecondary}> ({displayActiveHint})</span> : null}
          </span>
        </span>
        <span>▼</span>
      </button>

      {isOpen ? (
        <>
          <div className={styles.backdrop} onClick={() => setIsOpen(false)} />
          <div className={styles.dropdown}>
            {/* Quando permissão é apenas uma filial, não mostrar "Todas as filiais" */}
            {(!allowedFiliais || allowedFiliais.length !== 1) && (
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
            )}
            {isScarfme && !hideVarejo && (
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
              const activeHint = getGroupActiveHint(filial);
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
                  <span className={styles.optionLabel}>
                    {displayName}
                    {activeHint ? <span className={styles.optionSecondary}> ({activeHint})</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

