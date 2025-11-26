"use client";

import { useEffect, useMemo, useState, useRef, useCallback } from "react";

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

async function fetchVendedores(
  company: string,
  range: DateRangeValue,
  filial: string | null,
  grupos: string[],
  linhas: string[],
  colecoes: string[],
  subgrupos: string[],
  grades: string[],
  produtoId?: string | null,
  produtoSearchTerm?: string | null,
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

  if (produtoId) {
    searchParams.set("produtoId", produtoId);
  } else if (produtoSearchTerm && produtoSearchTerm.trim().length >= 2) {
    searchParams.set("produtoSearchTerm", produtoSearchTerm.trim());
  }

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
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selectedProductName, setSelectedProductName] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<
    Array<{ productId: string; productName: string }>
  >([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
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
      `${range.startDate.toISOString()}::${range.endDate.toISOString()}::${selectedFilial ?? 'all'}::${selectedGrupos.join(',')}::${selectedLinhas.join(',')}::${selectedColecoes.join(',')}::${selectedSubgrupos.join(',')}::${selectedGrades.join(',')}::${selectedProductId ?? 'all'}::${searchTerm.trim()}`,
    [range.startDate, range.endDate, selectedFilial, selectedGrupos, selectedLinhas, selectedColecoes, selectedSubgrupos, selectedGrades, selectedProductId, searchTerm]
  );

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

    let active = true;

    // Sempre mostrar o dropdown quando há texto (mesmo que não tenha resultados ainda)
    setShowSearchResults(true);

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
          selectedGrades,
          selectedProductId,
          selectedProductId ? null : (searchTerm && searchTerm.trim().length >= 2 ? searchTerm.trim() : null)
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
          selectedProductId={selectedProductId}
          produtoSearchTerm={selectedProductId ? null : (searchTerm && searchTerm.trim().length >= 2 ? searchTerm.trim() : null)}
        />
      </div>
    </div>
  );
}

