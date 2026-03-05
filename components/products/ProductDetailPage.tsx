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
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const refetchDetail = useCallback(() => setRefreshTrigger((t) => t + 1), []);

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
  }, [selectedProductId, companyKey, range, refreshTrigger]);

  const handleProductSelect = useCallback((productId: string, productName: string) => {
    const trimmedName = productName.trim();
    setSelectedProductId(productId);
    setSelectedProductName(trimmedName);
    setSearchTerm(trimmedName);
    setShowSearchResults(false);
    setSearchResults([]);
  }, []);

  const productContent = data ? (
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

        <div className={styles.stockTotalCard}>
          <span className={styles.stockTotalCardLabel}>ESTOQUE TOTAL</span>
          <span className={styles.stockTotalCardValue}>{data.detail.totalStock}</span>
        </div>
      </div>

      <ProductDetailKPIs
        detail={data.detail}
        productId={data.detail.productId}
        companyKey={companyKey}
        companyName={companyName}
        range={range}
        saleHistory={data.saleHistory}
        stockByFilial={data.stockByFilial}
        onDetailUpdated={refetchDetail}
      />
    </>
  ) : null;

  const emptyContent = !data && !loading ? (
    <div className={styles.empty}>
      <p>Digite o nome ou código do produto para começar</p>
    </div>
  ) : null;

  function renderBody() {
    if (data) return productContent;
    return emptyContent;
  }

  const headerSection = (
    <div className={styles.header}>
      <div className={styles.headerRow}>
        <h1 className={styles.title}>Produto Detalhado</h1>
        <DateRangeFilter value={range} onChange={setRange} label="PERIODO" />
      </div>
      <div className={styles.searchContainer} ref={searchContainerRef}>
        <div className={styles.searchInputWrapper}>
          <span className={styles.searchIcon} aria-hidden>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
          </span>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Q NEIVA 12/20"
            value={searchTerm}
            onChange={(e) => {
              const value = e.target.value;
              setSearchTerm(value);
              if (selectedProductId && selectedProductName && value.trim() !== selectedProductName.trim()) {
                setSelectedProductId(null);
                setSelectedProductName(null);
                setData(null);
              }
              if (!value) {
                setSelectedProductId(null);
                setSelectedProductName(null);
                setData(null);
                setShowSearchResults(false);
              } else {
                setShowSearchResults(value.trim().length >= 2);
              }
            }}
            onFocus={() => {
              if (searchTerm.trim().length >= 2 && (!selectedProductId || (selectedProductName && searchTerm.trim() !== selectedProductName.trim()))) {
                setShowSearchResults(true);
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
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
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
      {(loading || error) && (
        <div className={styles.controlsStatus}>
          {loading ? <span className={styles.loading}>Carregando dados…</span> : null}
          {error ? <span className={styles.error}>{error}</span> : null}
        </div>
      )}
    </div>
  );

  return (
    <div className={styles.wrapper}>
      {headerSection}
      {renderBody()}
    </div>
  );
}

