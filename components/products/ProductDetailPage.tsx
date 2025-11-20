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

    // Se já tem um produto selecionado e o termo mudou, não mostrar resultados
    if (selectedProductId && searchTerm) {
      setShowSearchResults(false);
      return;
    }

    let active = true;

    async function performSearch() {
      try {
        const results = await searchProducts(companyKey, searchTerm);
        if (active && !selectedProductId) {
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
  }, [searchTerm, companyKey, selectedProductId]);

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
    setSelectedProductId(productId);
    setSearchTerm(productName);
    setShowSearchResults(false);
    setSearchResults([]);
  }, []);

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <h1 className={styles.title}>Produto Detalhado</h1>
        <div className={styles.controls}>
          <div className={styles.searchContainer} ref={searchContainerRef}>
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Pesquisar produto por nome ou código..."
              value={searchTerm}
              onChange={(e) => {
                const value = e.target.value;
                setSearchTerm(value);
                if (!value) {
                  setSelectedProductId(null);
                  setData(null);
                  setShowSearchResults(false);
                } else if (!selectedProductId) {
                  // Apenas mostrar resultados se não tiver produto selecionado
                  setShowSearchResults(true);
                }
              }}
              onFocus={() => {
                if (searchResults.length > 0 && !selectedProductId) {
                  setShowSearchResults(true);
                }
              }}
            />
            {showSearchResults && searchResults.length > 0 && !selectedProductId && (
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
          <div className={styles.productHeader}>
            <div>
              <h2 className={styles.productName}>{data.detail.productName}</h2>
              <div className={styles.productInfo}>
                <span className={styles.productId}>{data.detail.productId}</span>
                {data.detail.lastEntryDate && data.detail.lastEntryFilial && (
                  <span className={styles.lastEntry}>
                    Última entrada:{" "}
                    {(data.detail.lastEntryDate instanceof Date
                      ? data.detail.lastEntryDate
                      : new Date(data.detail.lastEntryDate)
                    ).toLocaleDateString("pt-BR")}{" "}
                    em {data.detail.lastEntryFilial}
                  </span>
                )}
                {data.detail.revenueVariance !== null && (
                  <span
                    className={`${styles.variance} ${
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
            </div>
          </div>

          <ProductDetailKPIs detail={data.detail} companyName={companyName} />

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

