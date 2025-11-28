"use client";

import { useEffect, useMemo, useState, useRef, useCallback } from "react";

import DateRangeFilter, {
  type DateRangeValue,
} from "@/components/filters/DateRangeFilter";
import FilialFilter from "@/components/filters/FilialFilter";
import MultiSelectFilter from "@/components/filters/MultiSelectFilter";
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
  grupos: string[],
  linhas: string[],
  colecoes: string[],
  subgrupos: string[],
  grades: string[],
  groupByColor: boolean,
  acimaDoTicket: boolean,
  produtoId?: string | null,
  produtoSearchTerm?: string | null,
): Promise<ProductDetail[]> {
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

  if (groupByColor) {
    searchParams.set("groupByColor", "true");
  }

  if (acimaDoTicket) {
    searchParams.set("acimaDoTicket", "true");
  }

  if (produtoId) {
    searchParams.set("produtoId", produtoId);
  } else if (produtoSearchTerm && produtoSearchTerm.trim().length >= 2) {
    searchParams.set("produtoSearchTerm", produtoSearchTerm.trim());
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
  grupos: string[],
  linhas: string[],
  colecoes: string[],
  subgrupos: string[],
  grades: string[],
  acimaDoTicket: boolean,
  produtoId?: string | null,
  produtoSearchTerm?: string | null,
): Promise<SalesSummary> {
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

  if (acimaDoTicket) {
    searchParams.set("acimaDoTicket", "true");
  }

  if (produtoId) {
    searchParams.set("produtoId", produtoId);
  } else if (produtoSearchTerm && produtoSearchTerm.trim().length >= 2) {
    searchParams.set("produtoSearchTerm", produtoSearchTerm.trim());
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

async function searchProducts(
  company: string,
  searchTerm: string
): Promise<Array<{ productId: string; productName: string }>> {
  if (!searchTerm || searchTerm.trim().length < 2) {
    return [];
  }

  const response = await fetch(
    `/api/products/search?company=${encodeURIComponent(company)}&q=${encodeURIComponent(searchTerm)}`,
    {
      cache: "no-store",
    }
  );

  if (!response.ok) {
    return [];
  }

  const json = (await response.json()) as {
    data: Array<{ productId: string; productName: string }>;
  };

  return json.data || [];
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
  const [selectedGrupos, setSelectedGrupos] = useState<string[]>([]);
  const [selectedLinhas, setSelectedLinhas] = useState<string[]>([]);
  const [selectedColecoes, setSelectedColecoes] = useState<string[]>([]);
  const [selectedSubgrupos, setSelectedSubgrupos] = useState<string[]>([]);
  const [selectedGrades, setSelectedGrades] = useState<string[]>([]);
  const [groupByColor, setGroupByColor] = useState(true);
  const [acimaDoTicket, setAcimaDoTicket] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selectedProductName, setSelectedProductName] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<
    Array<{ productId: string; productName: string }>
  >([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
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

  // Buscar produtos ao digitar
  useEffect(() => {
    if (!searchTerm || searchTerm.trim().length < 2) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }

    // Se há produto selecionado, verificar se o texto mudou
    if (selectedProductId && selectedProductName) {
      // Se o texto é igual ao nome do produto selecionado, não buscar
      if (searchTerm.trim() === selectedProductName.trim()) {
        setShowSearchResults(false);
        return;
      }
      // Se mudou, já limpamos o selectedProductId no onChange, então continuar com a busca
    }

    // Sempre mostrar o dropdown quando há texto (mesmo que não tenha resultados ainda)
    setShowSearchResults(true);

    let active = true;

    async function performSearch() {
      try {
        const results = await searchProducts(companyKey, searchTerm);
        if (active) {
          setSearchResults(results);
        }
      } catch (err) {
        // Silenciosamente falhar
        if (active) {
          setSearchResults([]);
        }
      }
    }

    const timeoutId = setTimeout(performSearch, 300);

    return () => {
      active = false;
      clearTimeout(timeoutId);
    };
  }, [searchTerm, companyKey, selectedProductId, selectedProductName]);

  const handleProductSelect = useCallback((productId: string, productName: string) => {
    const trimmedName = productName.trim();
    setSelectedProductId(productId);
    setSelectedProductName(trimmedName);
    setSearchTerm(trimmedName);
    setShowSearchResults(false);
    setSearchResults([]);
  }, []);

  // Fechar dropdown ao clicar fora
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(event.target as Node)
      ) {
        setShowSearchResults(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const rangeKey = useMemo(
    () =>
      `${range.startDate.toISOString()}::${range.endDate.toISOString()}::${selectedFilial ?? 'all'}::${selectedGrupos.join(',')}::${selectedLinhas.join(',')}::${selectedColecoes.join(',')}::${selectedSubgrupos.join(',')}::${selectedGrades.join(',')}::${groupByColor}::${acimaDoTicket}::${selectedProductId ?? 'all'}::${searchTerm.trim()}`,
    [range.startDate, range.endDate, selectedFilial, selectedGrupos, selectedLinhas, selectedColecoes, selectedSubgrupos, selectedGrades, groupByColor, acimaDoTicket, selectedProductId, searchTerm]
  );

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [productsData, summaryData] = await Promise.all([
          fetchProducts(companyKey, range, selectedFilial, selectedGrupos, selectedLinhas, selectedColecoes, selectedSubgrupos, selectedGrades, groupByColor, acimaDoTicket, selectedProductId, selectedProductId ? null : (searchTerm && searchTerm.trim().length >= 2 ? searchTerm.trim() : null)),
          fetchSummary(companyKey, range, selectedFilial, selectedGrupos, selectedLinhas, selectedColecoes, selectedSubgrupos, selectedGrades, acimaDoTicket, selectedProductId, selectedProductId ? null : (searchTerm && searchTerm.trim().length >= 2 ? searchTerm.trim() : null)),
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
  }, [companyKey, range, rangeKey, selectedFilial, selectedGrupos, selectedLinhas, selectedColecoes, selectedSubgrupos, selectedGrades, acimaDoTicket]);

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
          <div className={styles.searchContainer} ref={searchContainerRef}>
            <div className={styles.searchLabel}>Produto</div>
            <div className={styles.searchInputWrapper}>
              <input
                type="text"
                className={styles.searchInput}
                placeholder="Digite o nome ou código do produto..."
                value={searchTerm}
                onChange={(e) => {
                  const value = e.target.value;
                  setSearchTerm(value);
                  
                  // Se o usuário está editando e o texto mudou do produto selecionado, limpar seleção
                  if (selectedProductId && selectedProductName) {
                    if (value.trim() !== selectedProductName.trim()) {
                      // Usuário está editando, limpar seleção para permitir nova busca
                      setSelectedProductId(null);
                      setSelectedProductName(null);
                    }
                  }
                  
                  if (!value) {
                    setSelectedProductId(null);
                    setSelectedProductName(null);
                    setShowSearchResults(false);
                    setSearchResults([]);
                  } else {
                    // Sempre permitir mostrar resultados quando há texto
                    if (value.trim().length >= 2) {
                      setShowSearchResults(true);
                    } else {
                      setShowSearchResults(false);
                      setSearchResults([]);
                    }
                  }
                }}
                onFocus={() => {
                  if (searchTerm.trim().length >= 2 && !selectedProductId) {
                    setShowSearchResults(true);
                  }
                  if (selectedProductId && selectedProductName && searchTerm.trim().length >= 2) {
                    if (searchTerm.trim() !== selectedProductName.trim()) {
                      setShowSearchResults(true);
                    }
                  }
                }}
              />
              {searchTerm && (
                <button
                  type="button"
                  className={styles.clearButton}
                  onClick={() => {
                    setSearchTerm("");
                    setSelectedProductId(null);
                    setSelectedProductName(null);
                    setData([]);
                    setShowSearchResults(false);
                    setSearchResults([]);
                  }}
                  aria-label="Limpar busca"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M12 4L4 12M4 4L12 12"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              )}
            </div>
            {showSearchResults && (
              <div className={styles.searchResults}>
                {searchTerm.trim().length >= 2 && (
                  <button
                    type="button"
                    className={styles.searchResultItem}
                    onClick={() => {
                      setSelectedProductId(null);
                      setSelectedProductName(null);
                      setShowSearchResults(false);
                      setSearchResults([]);
                    }}
                  >
                    <div className={styles.searchResultName}>
                      <strong>Buscar por: "{searchTerm}"</strong>
                    </div>
                    <div className={styles.searchResultId}>Mostrar todos os produtos que contêm este texto</div>
                  </button>
                )}
                {searchResults.length > 0 && (
                  <>
                    {searchTerm.trim().length >= 2 && (
                      <div className={styles.searchResultSeparator}></div>
                    )}
                    {searchResults.map((result) => (
                      <button
                        key={result.productId}
                        type="button"
                        className={styles.searchResultItem}
                        onClick={() => handleProductSelect(result.productId, result.productName)}
                      >
                        <div className={styles.searchResultName}>{result.productName}</div>
                        <div className={styles.searchResultId}>{result.productId}</div>
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
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
        <SummaryCards
          summary={loading ? EMPTY_SUMMARY : summary}
          companyName={companyName}
          dateRange={range}
          acimaDoTicket={acimaDoTicket}
          filteredData={acimaDoTicket ? data : undefined}
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
          <label className={styles.switchLabel}>
            <input
              type="checkbox"
              className={styles.switch}
              checked={acimaDoTicket}
              onChange={(e) => setAcimaDoTicket(e.target.checked)}
            />
            <span className={styles.switchText}>Acima do ticket</span>
          </label>
        </div>

        <ProductsTable 
          data={data} 
          loading={loading} 
          groupByColor={groupByColor} 
          companyKey={companyKey}
          acimaDoTicket={acimaDoTicket}
        />
      </div>
    </div>
  );
}

