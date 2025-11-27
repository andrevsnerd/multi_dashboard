"use client";

import { useEffect, useState } from "react";

import type { DateRangeValue } from "@/components/filters/DateRangeFilter";
import type { CompanyKey } from "@/lib/config/company";

import styles from "./FilialFilter.module.css";

interface VendedorFilterProps {
  companyKey: CompanyKey;
  value: string | null;
  onChange: (value: string | null) => void;
  label?: string;
  range: DateRangeValue;
  filial: string | null;
}

interface VendedorOption {
  codigo: string;
  nome: string;
}

export default function VendedorFilter({
  companyKey,
  value,
  onChange,
  label = "Vendedor",
  range,
  filial,
}: VendedorFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [vendedores, setVendedores] = useState<VendedorOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadVendedores() {
      setLoading(true);
      try {
        const searchParams = new URLSearchParams({
          company: companyKey,
          start: range.startDate.toISOString(),
          end: range.endDate.toISOString(),
        });

        if (filial) {
          searchParams.set("filial", filial);
        }

        const response = await fetch(`/api/clientes/vendedores?${searchParams.toString()}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("Erro ao carregar vendedores");
        }

        const json = (await response.json()) as { data: VendedorOption[] };
        
        if (active) {
          setVendedores(json.data || []);
        }
      } catch (err) {
        console.error("Erro ao carregar vendedores:", err);
        if (active) {
          setVendedores([]);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadVendedores();

    return () => {
      active = false;
    };
  }, [companyKey, range.startDate, range.endDate, filial]);

  const displayValue = value
    ? vendedores.find((v) => v.codigo === value || v.nome === value)?.nome ?? value
    : "Todos os vendedores";

  return (
    <div className={styles.container}>
      <span className={styles.label}>{label}</span>
      <button
        type="button"
        className={`${styles.button} ${isOpen ? styles.buttonActive : ""}`}
        onClick={() => setIsOpen((prev) => !prev)}
        disabled={loading}
      >
        <span className={styles.buttonValue}>
          <span className={styles.valuePrimary}>
            {loading ? "Carregando..." : displayValue}
          </span>
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
              Todos os vendedores
            </button>
            {vendedores.map((vendedor) => {
              const displayName = vendedor.nome || vendedor.codigo;
              // O valor pode ser código ou nome, então verificamos ambos
              const isSelected = value === vendedor.codigo || value === vendedor.nome;
              return (
                <button
                  key={`${vendedor.codigo}-${vendedor.nome}`}
                  type="button"
                  className={`${styles.option} ${isSelected ? styles.optionActive : ""}`}
                  onClick={() => {
                    // Usar o nome como valor, pois é mais legível e o filtro SQL aceita tanto código quanto nome
                    onChange(vendedor.nome);
                    setIsOpen(false);
                  }}
                >
                  {displayName}
                </button>
              );
            })}
            {vendedores.length === 0 && !loading && (
              <div className={styles.option} style={{ cursor: 'default', opacity: 0.6 }}>
                Nenhum vendedor encontrado
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

