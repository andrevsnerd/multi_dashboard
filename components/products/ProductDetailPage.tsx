"use client";

import { useEffect, useRef, useMemo, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import DateRangeFilter, {
  type DateRangeValue,
} from "@/components/filters/DateRangeFilter";
import { getCurrentMonthRange } from "@/lib/utils/date";
import type { CompanyKey } from "@/lib/config/company";
import type {
  ProductDetailInfo,
  ProductStockByFilial,
  ProductSaleHistory,
  ProductAvailableColor,
  ProductStockProgressDay,
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
  saleHistoryComparison: ProductSaleHistory[];
  availableColors: ProductAvailableColor[];
  stockProgress: ProductStockProgressDay[];
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
  range: DateRangeValue,
  selectedColors: string[]
): Promise<ProductDetailData | null> {
  const searchParams = new URLSearchParams({
    productId,
    company,
    start: range.startDate.toISOString(),
    end: range.endDate.toISOString(),
  });
  if (selectedColors.length > 0) {
    searchParams.set("colors", selectedColors.join(","));
  }

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
  const searchParams = useSearchParams();
  const lastUrlProductId = useRef<string | null>(null);

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
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const refetchDetail = useCallback(() => setRefreshTrigger((t) => t + 1), []);

  const selectedColorValue = selectedColors[0] ?? "";

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

  // Abrir produto a partir de ?productId=… (ex.: link da Curva ABC)
  useEffect(() => {
    const id = searchParams.get("productId")?.trim();
    if (!id) {
      lastUrlProductId.current = null;
      return;
    }
    if (lastUrlProductId.current === id) {
      return;
    }
    lastUrlProductId.current = id;
    const name = (searchParams.get("name") ?? id).trim();
    const colorsParam = searchParams.get("colors");
    const colors = colorsParam
      ? colorsParam.split(",").map((c) => c.trim()).filter(Boolean)
      : [];
    setSelectedProductId(id);
    setSelectedProductName(name);
    setSearchTerm(name);
    setShowSearchResults(false);
    setSearchResults([]);
    setSelectedColors(colors);
  }, [searchParams]);

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
        const productData = await fetchProductDetail(selectedProductId, companyKey, range, selectedColors);
        if (active) {
          // Converter datas de strings para Date objects se necessário
          if (productData) {
            const mapSaleDates = (rows: ProductSaleHistory[]) =>
              rows.map((sale) => ({
                ...sale,
                date: sale.date instanceof Date ? sale.date : new Date(sale.date),
              }));
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
              saleHistory: mapSaleDates(productData.saleHistory),
              saleHistoryComparison: mapSaleDates(productData.saleHistoryComparison ?? []),
              stockProgress: productData.stockProgress ?? [],
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
  }, [selectedProductId, companyKey, range, refreshTrigger, selectedColors]);

  const handleProductSelect = useCallback((productId: string, productName: string) => {
    const trimmedName = productName.trim();
    setSelectedProductId(productId);
    setSelectedProductName(trimmedName);
    setSearchTerm(trimmedName);
    setShowSearchResults(false);
    setSearchResults([]);
    setSelectedColors([]);
  }, []);

  const productContent = data ? (
    <>
      <div className={styles.productCard}>
        <div className={styles.productCardLeft}>
          <div className={styles.productTitleRow}>
            <h2 className={styles.productName}>
              {data.detail.productName}
              {companyKey === "scarfme" && "grade" in data.detail && data.detail.grade && (
                <span className={styles.productGrade}> {data.detail.grade}</span>
              )}
            </h2>
          </div>
          <div className={styles.productCodeRow}>
            <span className={styles.productCodeLabel}>COD</span>
            <span className={styles.productCodeValue}>{data.detail.productId}</span>
          </div>

          <div className={styles.productMetaRow}>
            {(data.availableColors ?? []).length > 0 && (
              <select
                className={styles.colorSelectNative}
                value={selectedColorValue}
                onChange={(e) => {
                  const value = e.target.value;
                  setSelectedColors(value ? [value] : []);
                }}
                aria-label="Filtrar por cor"
                title="Filtrar por cor"
              >
                <option value="">Todas as cores</option>
                {(data.availableColors ?? []).map(({ code, displayName }) => (
                  <option key={code || "sem-cor"} value={code}>
                    {displayName}
                  </option>
                ))}
              </select>
            )}

            {data.detail.lastEntryDate && (
              <span className={styles.lastEntryInline}>
                Última entrada:{" "}
                {(data.detail.lastEntryDate instanceof Date
                  ? data.detail.lastEntryDate
                  : new Date(data.detail.lastEntryDate)
                ).toLocaleDateString("pt-BR")}
              </span>
            )}
          </div>
        </div>

        <div className={styles.productCardRight}>
          <span className={styles.stockTotalCardLabel}>ESTOQUE TOTAL</span>
          <span className={styles.stockTotalCardValue}>{data.detail.totalStock}</span>
          <span className={styles.stockTotalCardUnit}>unidades</span>
        </div>
      </div>

      <ProductDetailKPIs
        detail={data.detail}
        productId={data.detail.productId}
        companyKey={companyKey}
        companyName={companyName}
        range={range}
        saleHistory={data.saleHistory}
        saleHistoryComparison={data.saleHistoryComparison}
        stockByFilial={data.stockByFilial}
        stockProgress={data.stockProgress ?? []}
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
      <div className={styles.headerTopRow}>
        <div className={styles.headerTitles}>
          <h1 className={styles.title}>Produto Detalhado</h1>
          <p className={styles.subtitle}>Análise completa do produto selecionado</p>
        </div>
      </div>

      <div className={styles.controlsRow}>
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
              placeholder="PASHMINA LISA VISCOSE"
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

        <div className={styles.rangeWrapper}>
          <DateRangeFilter value={range} onChange={setRange} label="" />
        </div>
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

