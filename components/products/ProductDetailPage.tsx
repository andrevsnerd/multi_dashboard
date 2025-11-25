"use client";

import { useEffect, useRef, useMemo, useState, useCallback } from "react";
import DateRangeFilter, {
  type DateRangeValue,
} from "@/components/filters/DateRangeFilter";
import { getCurrentMonthRange } from "@/lib/utils/date";
import type { CompanyKey } from "@/lib/config/company";
import type {
  ProductDetailInfo,
  ProductStockByFilial,
  ProductSaleHistory,
} from "@/lib/repositories/productDetail";

import styles from "./ProductDetailPage.module.css";
import ProductDetailKPIs from "./ProductDetailKPIs";
import ProductPerformanceTable from "./ProductPerformanceTable";
import ProductSaleHistoryTable from "./ProductSaleHistoryTable";

interface ProductDetailPageProps {
  companyKey: CompanyKey;
  companyName: string;
}

interface ProductDetailData {
  detail: ProductDetailInfo;
  stockByFilial: ProductStockByFilial[];
  saleHistory: ProductSaleHistory[];
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

async function fetchProductDetail(
  productId: string,
  company: string,
  range: DateRangeValue
): Promise<ProductDetailData | null> {
  const searchParams = new URLSearchParams({
    productId,
    company,
    start: range.startDate.toISOString(),
    end: range.endDate.toISOString(),
  });

  const response = await fetch(`/api/product-detail?${searchParams.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Erro ao carregar detalhes do produto");
  }

  const json = (await response.json()) as {
    data: ProductDetailData;
  };

  return json.data;
}

export default function ProductDetailPage({
  companyKey,
  companyName,
}: ProductDetailPageProps) {
  const initialRange = useMemo(() => {
    const range = getCurrentMonthRange();
    return {
      startDate: range.start,
      endDate: range.end,
    };
  }, []);

  const searchContainerRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<DateRangeValue>(initialRange);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selectedProductName, setSelectedProductName] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<
    Array<{ productId: string; productName: string }>
  >([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [data, setData] = useState<ProductDetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

    async function performSearch() {
      try {
        const results = await searchProducts(companyKey, searchTerm);
        if (active) {
          setSearchResults(results);
          setShowSearchResults(results.length > 0);
        }
      } catch (err) {
        // Silenciosamente falhar
      }
    }

    const timeoutId = setTimeout(performSearch, 300);

    return () => {
      active = false;
      clearTimeout(timeoutId);
    };
  }, [searchTerm, companyKey, selectedProductId, selectedProductName]);

  // Carregar detalhes do produto quando selecionado ou período mudar
  useEffect(() => {
    if (!selectedProductId) {
      setData(null);
      return;
    }

    let active = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        // Verificação adicional para garantir que selectedProductId não é null
        if (!selectedProductId) {
          return;
        }
        const productData = await fetchProductDetail(selectedProductId, companyKey, range);
        if (active) {
          // Converter datas de strings para Date objects se necessário
          if (productData) {
            const processedData = {
              ...productData,
              detail: {
                ...productData.detail,
                lastEntryDate: productData.detail.lastEntryDate
                  ? productData.detail.lastEntryDate instanceof Date
                    ? productData.detail.lastEntryDate
                    : new Date(productData.detail.lastEntryDate)
                  : null,
              },
              saleHistory: productData.saleHistory.map((sale) => ({
                ...sale,
                date: sale.date instanceof Date ? sale.date : new Date(sale.date),
              })),
            };
            setData(processedData);
          } else {
            setData(null);
          }
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : "Não foi possível carregar os dados do produto."
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
  }, [selectedProductId, companyKey, range]);

  const handleProductSelect = useCallback((productId: string, productName: string) => {
    const trimmedName = productName.trim();
    setSelectedProductId(productId);
    setSelectedProductName(trimmedName);
    setSearchTerm(trimmedName);
    setShowSearchResults(false);
    setSearchResults([]);
  }, []);

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <h1 className={styles.title}>Produto Detalhado</h1>
        <div className={styles.controls}>
          <div className={styles.searchContainer} ref={searchContainerRef}>
            <div className={styles.searchInputWrapper}>
              <input
                type="text"
                className={styles.searchInput}
                placeholder="Pesquisar produto por nome ou código..."
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
                      setData(null);
                    }
                  }
                  
                  if (!value) {
                    setSelectedProductId(null);
                    setSelectedProductName(null);
                    setData(null);
                    setShowSearchResults(false);
                  } else {
                    // Sempre permitir mostrar resultados quando há texto
                    if (value.trim().length >= 2) {
                      setShowSearchResults(true);
                    } else {
                      setShowSearchResults(false);
                    }
                  }
                }}
                onFocus={() => {
                  // Se há texto e não há produto selecionado, mostrar resultados
                  if (searchTerm.trim().length >= 2 && !selectedProductId) {
                    setShowSearchResults(true);
                  }
                  // Se o usuário está editando (texto diferente do produto selecionado), permitir busca
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
                    setData(null);
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
            {showSearchResults && searchResults.length > 0 && (
              <div className={styles.searchResults}>
                {searchResults.slice(0, 10).map((product) => (
                  <button
                    key={product.productId}
                    type="button"
                    className={styles.searchResultItem}
                    onClick={() => handleProductSelect(product.productId, product.productName)}
                  >
                    <div className={styles.searchResultName}>{product.productName}</div>
                    <div className={styles.searchResultId}>{product.productId}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <DateRangeFilter value={range} onChange={setRange} />
          {loading ? (
            <span className={styles.loading}>Carregando dados…</span>
          ) : null}
          {error ? <span className={styles.error}>{error}</span> : null}
        </div>
      </div>

      {data ? (
        <>
          <div className={styles.productHeaderContainer}>
            <div className={styles.productHeader}>
              <div>
                <h2 className={styles.productName}>{data.detail.productName}</h2>
                <div className={styles.productInfo}>
                  <span className={styles.productId}>{data.detail.productId}</span>
                </div>
                {data.detail.lastEntryDate && data.detail.lastEntryFilial && (
                  <div className={styles.lastEntryContainer}>
                    <span className={styles.lastEntry}>
                      Última entrada:{" "}
                      {(data.detail.lastEntryDate instanceof Date
                        ? data.detail.lastEntryDate
                        : new Date(data.detail.lastEntryDate)
                      ).toLocaleDateString("pt-BR")}{" "}
                      em {data.detail.lastEntryFilial}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Card Vendas Total no mobile - aparece logo após o nome */}
            <div className={styles.mobileVendasTotalCard}>
              <div className={styles.mobileVendasTotalContent}>
                <span className={styles.mobileVendasTotalLabel}>Vendas Total</span>
                <div className={styles.mobileVendasTotalValue}>
                  <strong className={styles.mobileVendasTotalAmount}>
                    {data.detail.totalRevenue.toLocaleString("pt-BR", {
                      style: "currency",
                      currency: "BRL",
                      maximumFractionDigits: 2,
                    })}
                  </strong>
                  {data.detail.revenueVariance !== null && (
                    <span
                      className={`${styles.mobileVendasTotalVariance} ${
                        data.detail.revenueVariance > 0
                          ? styles.variancePositive
                          : data.detail.revenueVariance < 0
                            ? styles.varianceNegative
                            : ""
                      }`}
                    >
                      {data.detail.revenueVariance > 0 ? "↑" : data.detail.revenueVariance < 0 ? "↓" : ""}
                      {Math.abs(data.detail.revenueVariance).toFixed(1)}%
                    </span>
                  )}
                </div>
                <p className={styles.mobileVendasTotalDescription}>
                  {data.detail.totalQuantity.toLocaleString("pt-BR", {
                    maximumFractionDigits: 0,
                  })} unidades
                </p>
              </div>
            </div>

            <div className={styles.projectionCard}>
              <div className={styles.projectionContent}>
                <div className={styles.projectionItem}>
                  <span className={styles.projectionLabel}>Markup</span>
                  <span className={styles.projectionValue}>
                    {data.detail.totalMarkup > 0 ? `${data.detail.totalMarkup.toFixed(2)}x` : "--"}
                  </span>
                </div>
                <div className={styles.projectionItem}>
                  <span className={styles.projectionLabel}>Projeção do Mês</span>
                  <span className={styles.projectionValue}>
                    {(() => {
                      // Calcular projeção do mês atual
                      const start = new Date(range.startDate);
                      const end = new Date(range.endDate);
                      const daysInPeriod = Math.max(
                        1,
                        Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
                      );
                      
                      // Obter o mês atual
                      const currentMonth = new Date(start.getFullYear(), start.getMonth(), 1);
                      const lastDayOfMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0);
                      const totalDaysInMonth = lastDayOfMonth.getDate();
                      
                      // Calcular dias já passados no mês (até o endDate)
                      const daysPassed = Math.min(
                        Math.ceil((end.getTime() - currentMonth.getTime()) / (1000 * 60 * 60 * 24)),
                        totalDaysInMonth
                      );
                      
                      if (daysPassed <= 0 || data.detail.totalRevenue === 0) {
                        return "R$ 0,00";
                      }
                      
                      // Calcular média diária e projeção
                      const averageDaily = data.detail.totalRevenue / daysPassed;
                      const projection = averageDaily * totalDaysInMonth;
                      
                      return projection.toLocaleString("pt-BR", {
                        style: "currency",
                        currency: "BRL",
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      });
                    })()}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <ProductDetailKPIs detail={data.detail} companyName={companyName} range={range} />

          <ProductPerformanceTable
            data={data.stockByFilial}
            loading={loading}
          />

          <ProductSaleHistoryTable
            data={data.saleHistory}
            loading={loading}
            totalRevenue={data.detail.totalRevenue}
          />
        </>
      ) : (
        !loading && (
          <div className={styles.empty}>
            <p>Digite o nome ou código do produto para começar</p>
          </div>
        )
      )}
    </div>
  );
}

