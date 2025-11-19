"use client";

import { useEffect, useMemo, useState } from "react";

import DateRangeFilter, {
  type DateRangeValue,
} from "@/components/filters/DateRangeFilter";
import FilialFilter from "@/components/filters/FilialFilter";
import SelectFilter from "@/components/filters/SelectFilter";
import SummaryCards from "@/components/dashboard/SummaryCards";
import ProductsTable from "@/components/products/ProductsTable";
import type { ProductDetail } from "@/lib/repositories/products";
import type { SalesSummary } from "@/types/dashboard";
import { getCurrentMonthRange } from "@/lib/utils/date";
import type { CompanyKey } from "@/lib/config/company";

import styles from "./ProductsPage.module.css";

interface ProductsPageProps {
  companyKey: CompanyKey;
  companyName: string;
}

const EMPTY_SUMMARY: SalesSummary = {
  totalRevenue: { currentValue: 0, previousValue: 0, changePercentage: 0 },
  totalQuantity: { currentValue: 0, previousValue: 0, changePercentage: 0 },
  totalTickets: { currentValue: 0, previousValue: 0, changePercentage: 0 },
  averageTicket: { currentValue: 0, previousValue: 0, changePercentage: 0 },
  totalStockQuantity: { currentValue: 0, previousValue: 0, changePercentage: null },
  totalStockValue: { currentValue: 0, previousValue: 0, changePercentage: null },
};

async function fetchProducts(
  company: string,
  range: DateRangeValue,
  filial: string | null,
  grupo: string | null,
  linha: string | null,
  colecao: string | null,
  subgrupo: string | null,
  grade: string | null,
  groupByColor: boolean
): Promise<ProductDetail[]> {
  const searchParams = new URLSearchParams({
    company,
    start: range.startDate.toISOString(),
    end: range.endDate.toISOString(),
  });

  if (filial) {
    searchParams.set("filial", filial);
  }

  if (grupo) {
    searchParams.set("grupo", grupo);
  }

  if (linha) {
    searchParams.set("linha", linha);
  }

  if (colecao) {
    searchParams.set("colecao", colecao);
  }

  if (subgrupo) {
    searchParams.set("subgrupo", subgrupo);
  }

  if (grade) {
    searchParams.set("grade", grade);
  }

  if (groupByColor) {
    searchParams.set("groupByColor", "true");
  }

  const response = await fetch(`/api/products?${searchParams.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Erro ao carregar produtos");
  }

  const json = (await response.json()) as {
    data: ProductDetail[];
  };

  return json.data;
}

async function fetchSummary(
  company: string,
  range: DateRangeValue,
  filial: string | null,
  grupo: string | null,
  linha: string | null,
  colecao: string | null,
  subgrupo: string | null,
  grade: string | null
): Promise<SalesSummary> {
  const searchParams = new URLSearchParams({
    company,
    start: range.startDate.toISOString(),
    end: range.endDate.toISOString(),
  });

  if (filial) {
    searchParams.set("filial", filial);
  }

  if (grupo) {
    searchParams.set("grupo", grupo);
  }

  if (linha) {
    searchParams.set("linha", linha);
  }

  if (colecao) {
    searchParams.set("colecao", colecao);
  }

  if (subgrupo) {
    searchParams.set("subgrupo", subgrupo);
  }

  if (grade) {
    searchParams.set("grade", grade);
  }

  const response = await fetch(`/api/sales-summary?${searchParams.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Erro ao carregar resumo de vendas");
  }

  const json = (await response.json()) as {
    data: SalesSummary;
  };

  return json.data;
}

export default function ProductsPage({
  companyKey,
  companyName,
}: ProductsPageProps) {
  const initialRange = useMemo(() => {
    const range = getCurrentMonthRange();
    return {
      startDate: range.start,
      endDate: range.end,
    };
  }, []);

  const [range, setRange] = useState<DateRangeValue>(initialRange);
  const [selectedFilial, setSelectedFilial] = useState<string | null>(null);
  const [selectedGrupo, setSelectedGrupo] = useState<string | null>(null);
  const [selectedLinha, setSelectedLinha] = useState<string | null>(null);
  const [selectedColecao, setSelectedColecao] = useState<string | null>(null);
  const [selectedSubgrupo, setSelectedSubgrupo] = useState<string | null>(null);
  const [selectedGrade, setSelectedGrade] = useState<string | null>(null);
  const [groupByColor, setGroupByColor] = useState(false);
  const [data, setData] = useState<ProductDetail[]>([]);
  const [summary, setSummary] = useState<SalesSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [availableGrupos, setAvailableGrupos] = useState<string[]>([]);
  const [availableLinhas, setAvailableLinhas] = useState<string[]>([]);
  const [availableColecoes, setAvailableColecoes] = useState<string[]>([]);
  const [availableSubgrupos, setAvailableSubgrupos] = useState<string[]>([]);
  const [availableGrades, setAvailableGrades] = useState<string[]>([]);

  // Buscar grupos disponíveis para NERD
  useEffect(() => {
    if (companyKey !== "nerd") {
      setAvailableGrupos([]);
      return;
    }

    let active = true;

    async function loadGrupos() {
      try {
        const searchParams = new URLSearchParams({
          company: companyKey,
          start: range.startDate.toISOString(),
          end: range.endDate.toISOString(),
        });

        if (selectedFilial) {
          searchParams.set("filial", selectedFilial);
        }

        const response = await fetch(`/api/products/grupos?${searchParams.toString()}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const json = (await response.json()) as {
          data: string[];
        };

        if (active) {
          setAvailableGrupos(json.data || []);
        }
      } catch (err) {
        // Silenciosamente falhar
      }
    }

    void loadGrupos();

    return () => {
      active = false;
    };
  }, [companyKey, range.startDate, range.endDate, selectedFilial]);

  // Buscar linhas disponíveis para ScarfMe
  useEffect(() => {
    if (companyKey !== "scarfme") {
      setAvailableLinhas([]);
      return;
    }

    let active = true;

    async function loadLinhas() {
      try {
        const searchParams = new URLSearchParams({
          company: companyKey,
          start: range.startDate.toISOString(),
          end: range.endDate.toISOString(),
        });

        if (selectedFilial) {
          searchParams.set("filial", selectedFilial);
        }

        const response = await fetch(`/api/products/linhas?${searchParams.toString()}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const json = (await response.json()) as {
          data: string[];
        };

        if (active) {
          setAvailableLinhas(json.data || []);
        }
      } catch (err) {
        // Silenciosamente falhar
      }
    }

    void loadLinhas();

    return () => {
      active = false;
    };
  }, [companyKey, range.startDate, range.endDate, selectedFilial]);

  // Buscar coleções disponíveis para ScarfMe
  useEffect(() => {
    if (companyKey !== "scarfme") {
      setAvailableColecoes([]);
      return;
    }

    let active = true;

    async function loadColecoes() {
      try {
        const searchParams = new URLSearchParams({
          company: companyKey,
          start: range.startDate.toISOString(),
          end: range.endDate.toISOString(),
        });

        if (selectedFilial) {
          searchParams.set("filial", selectedFilial);
        }

        const response = await fetch(`/api/products/colecoes?${searchParams.toString()}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const json = (await response.json()) as {
          data: string[];
        };

        if (active) {
          setAvailableColecoes(json.data || []);
        }
      } catch (err) {
        // Silenciosamente falhar
      }
    }

    void loadColecoes();

    return () => {
      active = false;
    };
  }, [companyKey, range.startDate, range.endDate, selectedFilial]);

  // Buscar subgrupos disponíveis para ScarfMe
  useEffect(() => {
    if (companyKey !== "scarfme") {
      setAvailableSubgrupos([]);
      return;
    }

    let active = true;

    async function loadSubgrupos() {
      try {
        const searchParams = new URLSearchParams({
          company: companyKey,
          start: range.startDate.toISOString(),
          end: range.endDate.toISOString(),
        });

        if (selectedFilial) {
          searchParams.set("filial", selectedFilial);
        }

        const response = await fetch(`/api/products/subgrupos?${searchParams.toString()}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const json = (await response.json()) as {
          data: string[];
        };

        if (active) {
          setAvailableSubgrupos(json.data || []);
        }
      } catch (err) {
        // Silenciosamente falhar
      }
    }

    void loadSubgrupos();

    return () => {
      active = false;
    };
  }, [companyKey, range.startDate, range.endDate, selectedFilial]);

  // Buscar grades disponíveis para ScarfMe
  useEffect(() => {
    if (companyKey !== "scarfme") {
      setAvailableGrades([]);
      return;
    }

    let active = true;

    async function loadGrades() {
      try {
        const searchParams = new URLSearchParams({
          company: companyKey,
          start: range.startDate.toISOString(),
          end: range.endDate.toISOString(),
        });

        if (selectedFilial) {
          searchParams.set("filial", selectedFilial);
        }

        const response = await fetch(`/api/products/grades?${searchParams.toString()}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const json = (await response.json()) as {
          data: string[];
        };

        if (active) {
          setAvailableGrades(json.data || []);
        }
      } catch (err) {
        // Silenciosamente falhar
      }
    }

    void loadGrades();

    return () => {
      active = false;
    };
  }, [companyKey, range.startDate, range.endDate, selectedFilial]);

  const rangeKey = useMemo(
    () =>
      `${range.startDate.toISOString()}::${range.endDate.toISOString()}::${selectedFilial ?? 'all'}::${selectedGrupo ?? 'all'}::${selectedLinha ?? 'all'}::${selectedColecao ?? 'all'}::${selectedSubgrupo ?? 'all'}::${selectedGrade ?? 'all'}::${groupByColor}`,
    [range.startDate, range.endDate, selectedFilial, selectedGrupo, selectedLinha, selectedColecao, selectedSubgrupo, selectedGrade, groupByColor]
  );

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [productsData, summaryData] = await Promise.all([
          fetchProducts(companyKey, range, selectedFilial, selectedGrupo, selectedLinha, selectedColecao, selectedSubgrupo, selectedGrade, groupByColor),
          fetchSummary(companyKey, range, selectedFilial, selectedGrupo, selectedLinha, selectedColecao, selectedSubgrupo, selectedGrade),
        ]);
        if (active) {
          setData(productsData);
          setSummary(summaryData);
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : "Não foi possível carregar os dados."
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [companyKey, range, rangeKey, selectedFilial, selectedGrupo, selectedLinha, selectedColecao, selectedSubgrupo, selectedGrade]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <h1 className={styles.title}>Produtos</h1>
        <div className={styles.controls}>
          <DateRangeFilter value={range} onChange={setRange} />
          <FilialFilter
            companyKey={companyKey}
            value={selectedFilial}
            onChange={setSelectedFilial}
          />
          {companyKey === "nerd" && (
            <SelectFilter
              label="Grupo"
              value={selectedGrupo}
              options={availableGrupos}
              onChange={setSelectedGrupo}
            />
          )}
          {companyKey === "scarfme" && (
            <>
              <SelectFilter
                label="Linha"
                value={selectedLinha}
                options={availableLinhas}
                onChange={setSelectedLinha}
              />
              <SelectFilter
                label="Coleção"
                value={selectedColecao}
                options={availableColecoes}
                onChange={setSelectedColecao}
              />
              <SelectFilter
                label="Subgrupo"
                value={selectedSubgrupo}
                options={availableSubgrupos}
                onChange={setSelectedSubgrupo}
              />
              <SelectFilter
                label="Grade"
                value={selectedGrade}
                options={availableGrades}
                onChange={setSelectedGrade}
              />
            </>
          )}
          {loading ? (
            <span className={styles.loading}>Carregando dados…</span>
          ) : null}
          {error ? <span className={styles.error}>{error}</span> : null}
        </div>
      </div>

      <SummaryCards
        summary={summary}
        companyName={companyName}
        dateRange={range}
      />

      <div className={styles.tableControls}>
        <label className={styles.switchLabel}>
          <input
            type="checkbox"
            className={styles.switch}
            checked={groupByColor}
            onChange={(e) => setGroupByColor(e.target.checked)}
          />
          <span className={styles.switchText}>Por cor</span>
        </label>
      </div>

      <ProductsTable data={data} loading={loading} groupByColor={groupByColor} />
    </div>
  );
}

