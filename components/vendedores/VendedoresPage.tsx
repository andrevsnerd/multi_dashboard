"use client";

import { useEffect, useMemo, useState } from "react";

import DateRangeFilter, {
  type DateRangeValue,
} from "@/components/filters/DateRangeFilter";
import FilialFilter from "@/components/filters/FilialFilter";
import VendedoresTable from "@/components/vendedores/VendedoresTable";
import MultiSelectFilter from "@/components/filters/MultiSelectFilter";
import type { VendedorItem } from "@/lib/repositories/vendedores";
import { getCurrentMonthRange } from "@/lib/utils/date";
import type { CompanyKey } from "@/lib/config/company";

import styles from "./VendedoresPage.module.css";

interface VendedoresPageProps {
  companyKey: CompanyKey;
  companyName: string;
}

async function fetchVendedores(
  company: string,
  range: DateRangeValue,
  filial: string | null,
  grupos: string[],
  linhas: string[],
  colecoes: string[],
  subgrupos: string[],
  grades: string[],
): Promise<VendedorItem[]> {
  const searchParams = new URLSearchParams({
    company,
    start: range.startDate.toISOString(),
    end: range.endDate.toISOString(),
  });

  if (filial) {
    searchParams.set("filial", filial);
  }

  grupos.forEach((grupo) => {
    searchParams.append("grupo", grupo);
  });

  linhas.forEach((linha) => {
    searchParams.append("linha", linha);
  });

  colecoes.forEach((colecao) => {
    searchParams.append("colecao", colecao);
  });

  subgrupos.forEach((subgrupo) => {
    searchParams.append("subgrupo", subgrupo);
  });

  grades.forEach((grade) => {
    searchParams.append("grade", grade);
  });

  const response = await fetch(`/api/vendedores?${searchParams.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Erro ao carregar vendedores");
  }

  const json = (await response.json()) as {
    data: VendedorItem[];
  };

  return json.data;
}

export default function VendedoresPage({
  companyKey,
  companyName,
}: VendedoresPageProps) {
  const initialRange = useMemo(() => {
    const range = getCurrentMonthRange();
    return {
      startDate: range.start,
      endDate: range.end,
    };
  }, []);

  const [range, setRange] = useState<DateRangeValue>(initialRange);
  const [selectedFilial, setSelectedFilial] = useState<string | null>(null);
  const [selectedGrupos, setSelectedGrupos] = useState<string[]>([]);
  const [selectedLinhas, setSelectedLinhas] = useState<string[]>([]);
  const [selectedColecoes, setSelectedColecoes] = useState<string[]>([]);
  const [selectedSubgrupos, setSelectedSubgrupos] = useState<string[]>([]);
  const [selectedGrades, setSelectedGrades] = useState<string[]>([]);
  const [data, setData] = useState<VendedorItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [availableGrupos, setAvailableGrupos] = useState<string[]>([]);
  const [availableLinhas, setAvailableLinhas] = useState<string[]>([]);
  const [availableColecoes, setAvailableColecoes] = useState<string[]>([]);
  const [availableSubgrupos, setAvailableSubgrupos] = useState<string[]>([]);
  const [availableGrades, setAvailableGrades] = useState<string[]>([]);

  const rangeKey = useMemo(
    () =>
      `${range.startDate.toISOString()}::${range.endDate.toISOString()}::${selectedFilial ?? 'all'}::${selectedGrupos.join(',')}::${selectedLinhas.join(',')}::${selectedColecoes.join(',')}::${selectedSubgrupos.join(',')}::${selectedGrades.join(',')}`,
    [range.startDate, range.endDate, selectedFilial, selectedGrupos, selectedLinhas, selectedColecoes, selectedSubgrupos, selectedGrades]
  );

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
      } catch {
        // silencioso
      }
    }

    void loadGrupos();

    return () => {
      active = false;
    };
  }, [companyKey, range.startDate, range.endDate, selectedFilial]);

  // Buscar filtros para ScarfMe (linha, coleção, subgrupo, grade)
  useEffect(() => {
    if (companyKey !== "scarfme") {
      setAvailableLinhas([]);
      setAvailableColecoes([]);
      setAvailableSubgrupos([]);
      setAvailableGrades([]);
      return;
    }

    let active = true;

    async function loadFilter(endpoint: string, setter: (values: string[]) => void) {
      try {
        const searchParams = new URLSearchParams({
          company: companyKey,
          start: range.startDate.toISOString(),
          end: range.endDate.toISOString(),
        });

        if (selectedFilial) {
          searchParams.set("filial", selectedFilial);
        }

        const response = await fetch(`/api/products/${endpoint}?${searchParams.toString()}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const json = (await response.json()) as {
          data: string[];
        };

        if (active) {
          setter(json.data || []);
        }
      } catch {
        // silencioso
      }
    }

    void loadFilter("linhas", setAvailableLinhas);
    void loadFilter("colecoes", setAvailableColecoes);
    void loadFilter("subgrupos", setAvailableSubgrupos);
    void loadFilter("grades", setAvailableGrades);

    return () => {
      active = false;
    };
  }, [companyKey, range.startDate, range.endDate, selectedFilial]);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const vendedoresData = await fetchVendedores(
          companyKey,
          range,
          selectedFilial,
          selectedGrupos,
          selectedLinhas,
          selectedColecoes,
          selectedSubgrupos,
          selectedGrades
        );
        if (active) {
          setData(vendedoresData);
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
  }, [companyKey, range, rangeKey, selectedFilial]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <h1 className={styles.title}>Vendedores</h1>
        <div className={styles.controls}>
          <DateRangeFilter value={range} onChange={setRange} />
          <FilialFilter
            companyKey={companyKey}
            value={selectedFilial}
            onChange={setSelectedFilial}
          />
          {companyKey === "nerd" && (
            <MultiSelectFilter
              label="Grupo"
              value={selectedGrupos}
              options={availableGrupos}
              onChange={setSelectedGrupos}
            />
          )}
          {companyKey === "scarfme" && (
            <>
              <MultiSelectFilter
                label="Linha"
                value={selectedLinhas}
                options={availableLinhas}
                onChange={setSelectedLinhas}
              />
              <MultiSelectFilter
                label="Coleção"
                value={selectedColecoes}
                options={availableColecoes}
                onChange={setSelectedColecoes}
              />
              <MultiSelectFilter
                label="Subgrupo"
                value={selectedSubgrupos}
                options={availableSubgrupos}
                onChange={setSelectedSubgrupos}
              />
              <MultiSelectFilter
                label="Grade"
                value={selectedGrades}
                options={availableGrades}
                onChange={setSelectedGrades}
              />
            </>
          )}
          {error ? <span className={styles.error}>{error}</span> : null}
        </div>
      </div>

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
          range={range}
          selectedFilial={selectedFilial}
          selectedGrupos={selectedGrupos}
          selectedLinhas={selectedLinhas}
          selectedColecoes={selectedColecoes}
          selectedSubgrupos={selectedSubgrupos}
          selectedGrades={selectedGrades}
        />
      </div>
    </div>
  );
}

