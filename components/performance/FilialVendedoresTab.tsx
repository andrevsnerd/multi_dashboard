"use client";

import { useEffect, useState } from "react";
import VendedoresTable from "@/components/vendedores/VendedoresTable";
import type { VendedorItem } from "@/lib/repositories/vendedores-v2";
import type { CompanyKey } from "@/lib/config/company";
import type { DateRangeValue } from "@/components/filters/DateRangeFilter";
import styles from "@/components/vendedores/VendedoresPage.module.css";
import tabStyles from "./FilialVendedoresTab.module.css";

interface Props {
  companyKey: CompanyKey;
  filial: string;
  initialRange: DateRangeValue;
}

async function fetchVendedores(
  company: string,
  range: DateRangeValue,
  filial: string,
  comparisonMode: "month" | "year",
): Promise<VendedorItem[]> {
  const searchParams = new URLSearchParams({
    company,
    start: range.startDate.toISOString(),
    end: range.endDate.toISOString(),
    filial,
    compare: comparisonMode,
    light: "0",
  });
  const response = await fetch(`/api/vendedores?${searchParams.toString()}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Erro ao carregar vendedores");
  const json = (await response.json()) as { data: VendedorItem[] };
  return json.data;
}

export default function FilialVendedoresTab({ companyKey, filial, initialRange }: Props) {
  const [data, setData] = useState<VendedorItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comparisonMode, setComparisonMode] = useState<"month" | "year">("month");

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const vendedoresData = await fetchVendedores(companyKey, initialRange, filial, comparisonMode);
        if (active) setData(vendedoresData);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Não foi possível carregar os dados.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [companyKey, initialRange, filial, comparisonMode]);

  return (
    <div className={styles.wrapper}>
      <div className={tabStyles.comparisonRow}>
        <span className={tabStyles.comparisonLabel}>Comparação:</span>
        <div className={tabStyles.comparisonToggle}>
          <button
            type="button"
            className={`${tabStyles.toggleBtn} ${comparisonMode === "month" ? tabStyles.toggleBtnActive : ""}`}
            onClick={() => setComparisonMode("month")}
          >
            Mês
          </button>
          <button
            type="button"
            className={`${tabStyles.toggleBtn} ${comparisonMode === "year" ? tabStyles.toggleBtnActive : ""}`}
            onClick={() => setComparisonMode("year")}
          >
            Ano
          </button>
        </div>
      </div>

      {error ? <span className={styles.error}>{error}</span> : null}

      {loading && (
        <div className={styles.loadingBanner}>
          <span className={styles.loadingSpinner}></span>
          <span className={styles.loadingText}>Carregando dados…</span>
        </div>
      )}

      <div className={loading ? styles.contentLoading : undefined}>
        <VendedoresTable
          data={data}
          loading={loading}
          companyKey={companyKey}
          range={initialRange}
          selectedFilial={filial}
          selectedGrupos={[]}
          selectedLinhas={[]}
          selectedColecoes={[]}
          selectedSubgrupos={[]}
          selectedGrades={[]}
          comparisonMode={comparisonMode}
        />
      </div>
    </div>
  );
}
