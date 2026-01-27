"use client";

import { useEffect, useMemo, useState } from "react";

import DateRangeFilter, {
  type DateRangeValue,
} from "@/components/filters/DateRangeFilter";
import FilialFilter from "@/components/filters/FilialFilter";
import ControleTransferenciasTable from "@/components/controle-transferencias/ControleTransferenciasTable";
import type { ProdutoTransferencia } from "@/lib/repositories/controleTransferencias";
import { getCurrentMonthRange } from "@/lib/utils/date";
import { resolveCompany, type CompanyKey } from "@/lib/config/company";

import styles from "./ControleTransferenciasPage.module.css";

interface ControleTransferenciasPageProps {
  companyKey: CompanyKey;
  companyName: string;
}

async function fetchControleTransferencias(
  company: string,
  range: DateRangeValue,
  filial: string | null
): Promise<ProdutoTransferencia[]> {
  const searchParams = new URLSearchParams({
    company,
    start: range.startDate.toISOString(),
    end: range.endDate.toISOString(),
  });

  if (filial) {
    searchParams.set("filial", filial);
  }

  const response = await fetch(`/api/controle-transferencias?${searchParams.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Erro ao carregar controle de transferências");
  }

  const json = (await response.json()) as {
    data: ProdutoTransferencia[];
  };

  return json.data;
}

/**
 * Obtém a matriz padrão para a empresa
 */
function getDefaultMatriz(companyKey: CompanyKey): string | null {
  if (companyKey === "nerd") {
    return "NERD";
  } else if (companyKey === "scarfme") {
    return "SCARF ME - MATRIZ";
  }
  return null;
}

export default function ControleTransferenciasPage({
  companyKey,
  companyName,
}: ControleTransferenciasPageProps) {
  const initialRange = useMemo(() => {
    const range = getCurrentMonthRange();
    return {
      startDate: range.start,
      endDate: range.end,
    };
  }, []);

  // Filial padrão é a matriz
  const defaultMatriz = useMemo(() => getDefaultMatriz(companyKey), [companyKey]);

  const [range, setRange] = useState<DateRangeValue>(initialRange);
  const [selectedFilial, setSelectedFilial] = useState<string | null>(defaultMatriz);
  const [data, setData] = useState<ProdutoTransferencia[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rangeKey = useMemo(
    () =>
      `${range.startDate.toISOString()}::${range.endDate.toISOString()}`,
    [range.startDate, range.endDate]
  );

  // Carregar dados - sempre todas as filiais para calcular transferências corretamente
  // Mas a visualização será filtrada pela filial selecionada
  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        // Sempre carregar todas as filiais para cálculo correto
        const transferenciasData = await fetchControleTransferencias(
          companyKey,
          range,
          null // Sempre carregar todas as filiais
        );
        if (active) {
          // Converter ultimaEntrada de string para Date (JSON serializa Date como string)
          const dataWithDates = transferenciasData.map(item => ({
            ...item,
            filiais: item.filiais.map(filial => ({
              ...filial,
              ultimaEntrada: filial.ultimaEntrada 
                ? (typeof filial.ultimaEntrada === 'string' 
                    ? new Date(filial.ultimaEntrada) 
                    : filial.ultimaEntrada)
                : null,
            })),
          }));
          setData(dataWithDates);
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
  }, [companyKey, range, rangeKey]);

  const company = resolveCompany(companyKey);

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <h1 className={styles.title}>Controle de Transferências</h1>
        <div className={styles.controls}>
          <FilialFilter
            companyKey={companyKey}
            value={selectedFilial}
            onChange={setSelectedFilial}
            label="Filial de Origem"
            module="inventory"
          />
          <DateRangeFilter value={range} onChange={setRange} />
          {loading ? (
            <span className={styles.loading}>Carregando dados…</span>
          ) : null}
          {error ? <span className={styles.error}>{error}</span> : null}
        </div>
      </div>

      <div className={styles.infoBox}>
        <div className={styles.infoIcon}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M10 18C14.4183 18 18 14.4183 18 10C18 5.58172 14.4183 2 10 2C5.58172 2 2 5.58172 2 10C2 14.4183 5.58172 18 10 18Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M10 6V10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M10 14H10.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div className={styles.infoText}>
          <strong>Visualização por Filial:</strong> Selecione uma filial para ver apenas as transferências que devem ser feitas a partir dessa filial. 
          {selectedFilial && (
            <span className={styles.infoFilial}>
              {" "}Visualizando: <strong>{company?.filialDisplayNames?.[selectedFilial] || selectedFilial}</strong>
            </span>
          )}
        </div>
      </div>

      <ControleTransferenciasTable
        companyKey={companyKey}
        data={data}
        loading={loading}
        dateRange={range}
        selectedFilial={selectedFilial}
      />
    </div>
  );
}
