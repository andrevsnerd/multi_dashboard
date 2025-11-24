"use client";

import { useEffect, useMemo, useState } from "react";

import DateRangeFilter, {
  type DateRangeValue,
} from "@/components/filters/DateRangeFilter";
import SelectFilter from "@/components/filters/SelectFilter";
import StockByFilialTable from "@/components/stock/StockByFilialTable";
import type { StockByFilialItem } from "@/lib/repositories/stockByFilial";
import { getCurrentMonthRange } from "@/lib/utils/date";
import type { CompanyKey } from "@/lib/config/company";
import { generateStockActionsPDF } from "@/lib/utils/generateStockActionsPDF";

import styles from "./StockByFilialPage.module.css";

interface StockByFilialPageProps {
  companyKey: CompanyKey;
  companyName: string;
}

async function fetchStockByFilial(
  company: string,
  range: DateRangeValue,
  filial: string | null
): Promise<StockByFilialItem[]> {
  const searchParams = new URLSearchParams({
    company,
    start: range.startDate.toISOString(),
    end: range.endDate.toISOString(),
  });

  if (filial) {
    searchParams.set("filial", filial);
  }

  const response = await fetch(`/api/stock-by-filial?${searchParams.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Erro ao carregar estoque por filial");
  }

  const json = (await response.json()) as {
    data: StockByFilialItem[];
  };

  return json.data;
}

export default function StockByFilialPage({
  companyKey,
  companyName,
}: StockByFilialPageProps) {
  const initialRange = useMemo(() => {
    const range = getCurrentMonthRange();
    return {
      startDate: range.start,
      endDate: range.end,
    };
  }, []);

  const [range, setRange] = useState<DateRangeValue>(initialRange);
  const [data, setData] = useState<StockByFilialItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showItemsWithoutSales, setShowItemsWithoutSales] = useState(false);
  
  // Filtros específicos para ScarfMe
  const [linha, setLinha] = useState<string | null>(null);
  const [subgrupo, setSubgrupo] = useState<string | null>(null);
  const [grade, setGrade] = useState<string | null>(null);
  const [colecao, setColecao] = useState<string | null>(null);

  const rangeKey = useMemo(
    () =>
      `${range.startDate.toISOString()}::${range.endDate.toISOString()}`,
    [range.startDate, range.endDate]
  );

  // Carregar dados sem filtros (filtros serão aplicados no frontend)
  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const stockData = await fetchStockByFilial(
          companyKey,
          range,
          null // Sempre mostrar todas as filiais nesta página
        );
        if (active) {
          setData(stockData);
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

  // Extrair opções de filtro dinamicamente dos dados carregados
  // Os filtros reagem ao checkbox "mostrar itens sem vendas"
  // Se desmarcado: mostra apenas opções dos itens com vendas no período
  // Se marcado: mostra opções de todos os itens (com vendas + sem vendas das filiais mapeadas)
  const availableFilterOptions = useMemo(() => {
    if (companyKey !== "scarfme") {
      return { linhas: [], subgrupos: [], grades: [], colecoes: [] };
    }

    // Filtrar dados baseado no checkbox
    const dataToUse = showItemsWithoutSales
      ? data
      : data.filter((item) => item.totalVendas > 0);

    const linhasSet = new Set<string>();
    const subgruposSet = new Set<string>();
    const gradesSet = new Set<string>();
    const colecoesSet = new Set<string>();

    dataToUse.forEach((item) => {
      if (item.linha && typeof item.linha === 'string' && item.linha.trim() !== "") {
        linhasSet.add(item.linha.trim().toUpperCase());
      }
      if (item.subgrupo && typeof item.subgrupo === 'string' && item.subgrupo.trim() !== "" && item.subgrupo !== "SEM SUBGRUPO") {
        subgruposSet.add(item.subgrupo.trim().toUpperCase());
      }
      if (item.grade && typeof item.grade === 'string' && item.grade.trim() !== "") {
        gradesSet.add(item.grade.trim().toUpperCase());
      }
      if (item.colecao && typeof item.colecao === 'string' && item.colecao.trim() !== "") {
        colecoesSet.add(item.colecao.trim().toUpperCase());
      }
    });

    return {
      linhas: Array.from(linhasSet).sort(),
      subgrupos: Array.from(subgruposSet).sort(),
      grades: Array.from(gradesSet).sort(),
      colecoes: Array.from(colecoesSet).sort(),
    };
  }, [data, showItemsWithoutSales, companyKey]);

  // Aplicar filtros no frontend
  const filteredData = useMemo(() => {
    let result = data;

    // Filtrar por checkbox primeiro
    if (!showItemsWithoutSales) {
      result = result.filter((item) => item.totalVendas > 0);
    }

    // Aplicar filtros específicos para ScarfMe
    if (companyKey === "scarfme") {
      if (linha) {
        result = result.filter(
          (item) => item.linha && typeof item.linha === 'string' && item.linha.trim().toUpperCase() === linha.toUpperCase()
        );
      }
      if (subgrupo) {
        result = result.filter(
          (item) => item.subgrupo && typeof item.subgrupo === 'string' && item.subgrupo.trim().toUpperCase() === subgrupo.toUpperCase()
        );
      }
      if (grade) {
        result = result.filter(
          (item) => item.grade && typeof item.grade === 'string' && item.grade.trim().toUpperCase() === grade.toUpperCase()
        );
      }
      if (colecao) {
        result = result.filter(
          (item) => item.colecao && typeof item.colecao === 'string' && item.colecao.trim().toUpperCase() === colecao.toUpperCase()
        );
      }
    }

    return result;
  }, [data, showItemsWithoutSales, companyKey, linha, subgrupo, grade, colecao]);

  const handleGeneratePDF = () => {
    if (filteredData.length === 0) {
      alert("Não há dados para gerar o relatório.");
      return;
    }
    
    try {
      generateStockActionsPDF(filteredData, companyKey, companyName, range);
    } catch (error) {
      console.error("Erro ao gerar PDF:", error);
      alert("Erro ao gerar PDF. Por favor, tente novamente.");
    }
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <h1 className={styles.title}>Estoque por Filial</h1>
        <div className={styles.controls}>
          <DateRangeFilter value={range} onChange={setRange} />
          {companyKey === "scarfme" && (
            <>
              <SelectFilter
                label="Linha"
                value={linha}
                options={availableFilterOptions.linhas}
                onChange={setLinha}
              />
              <SelectFilter
                label="Subgrupo"
                value={subgrupo}
                options={availableFilterOptions.subgrupos}
                onChange={setSubgrupo}
              />
              <SelectFilter
                label="Grade"
                value={grade}
                options={availableFilterOptions.grades}
                onChange={setGrade}
              />
              <SelectFilter
                label="Coleção"
                value={colecao}
                options={availableFilterOptions.colecoes}
                onChange={setColecao}
              />
            </>
          )}
          <button
            onClick={handleGeneratePDF}
            className={styles.pdfButton}
            disabled={loading || filteredData.length === 0}
            title="Gerar PDF com ações de estoque"
          >
            📄 Gerar PDF de Ações
          </button>
          {loading ? (
            <span className={styles.loading}>Carregando dados…</span>
          ) : null}
          {error ? <span className={styles.error}>{error}</span> : null}
        </div>
      </div>

      <div className={styles.filterRow}>
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={showItemsWithoutSales}
            onChange={(e) => setShowItemsWithoutSales(e.target.checked)}
            className={styles.checkbox}
          />
          <span>Mostrar itens sem vendas</span>
        </label>
      </div>

      <StockByFilialTable
        companyKey={companyKey}
        data={filteredData}
        loading={loading}
        showItemsWithoutSales={showItemsWithoutSales}
        dateRange={range}
      />
    </div>
  );
}

