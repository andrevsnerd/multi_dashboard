"use client";

import { useEffect, useRef, useMemo, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import DateRangeFilter, {
  type DateRangeValue,
} from "@/components/filters/DateRangeFilter";
import { getCurrentMonthRange } from "@/lib/utils/date";
import { useAuth } from "@/components/auth/AuthContext";
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

const NO_COLOR_VALUE = "__SEM_COR__";

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

type LoadingPhase = "initial" | "product" | "color" | "period";

type ProductSearchResult = {
  productId: string;
  productName: string;
  matchedColorCode?: string | null;
  matchedColorName?: string | null;
};

async function searchProducts(
  company: string,
  searchTerm: string
): Promise<ProductSearchResult[]> {
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
    data: ProductSearchResult[];
  };

  return json.data || [];
}

async function fetchProductDetail(
  productId: string,
  company: string,
  range: DateRangeValue,
  selectedColors: string[],
  options?: {
    includeColors?: boolean;
    includeStockProgress?: boolean;
  }
): Promise<ProductDetailData | null> {
  const searchParams = new URLSearchParams({
    productId,
    company,
    start: range.startDate.toISOString(),
    end: range.endDate.toISOString(),
  });
  if (options?.includeColors === false) {
    searchParams.set("includeColors", "0");
  }
  if (options?.includeStockProgress === false) {
    searchParams.set("includeStockProgress", "0");
  }
  if (selectedColors.length > 0) {
    searchParams.set("colors", selectedColors.map((color) => color || NO_COLOR_VALUE).join(","));
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

async function fetchProductStockProgress(
  productId: string,
  company: string,
  range: DateRangeValue,
  selectedColors: string[],
  stockByFilial: ProductStockByFilial[]
): Promise<ProductStockProgressDay[]> {
  const response = await fetch("/api/product-detail/stock-progress", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    cache: "no-store",
    body: JSON.stringify({
      productId,
      company,
      colors: selectedColors,
      range: {
        start: range.startDate.toISOString(),
        end: range.endDate.toISOString(),
      },
      stockByFilial,
    }),
  });

  if (!response.ok) {
    throw new Error("Erro ao carregar progresso de estoque");
  }

  const json = (await response.json()) as {
    data: ProductStockProgressDay[];
  };

  return json.data ?? [];
}

export default function ProductDetailPage({
  companyKey,
  companyName,
}: ProductDetailPageProps) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
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
  const hasVisibleDataRef = useRef(false);
  const colorOptionsCacheRef = useRef<Record<string, ProductAvailableColor[]>>({});
  const lastLoadedSignatureRef = useRef<{
    productId: string;
    colorsKey: string;
    rangeKey: string;
  } | null>(null);
  const [range, setRange] = useState<DateRangeValue>(initialRange);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selectedProductName, setSelectedProductName] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<
    ProductSearchResult[]
  >([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [data, setData] = useState<ProductDetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>("initial");
  const [error, setError] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const [colorModalOpen, setColorModalOpen] = useState(false);
  const [colorForm, setColorForm] = useState({ code: "", description: "" });
  const [colorModalError, setColorModalError] = useState<string | null>(null);
  const [colorSaving, setColorSaving] = useState(false);
  const refetchDetail = useCallback(() => setRefreshTrigger((t) => t + 1), []);

  const selectedColorCode = selectedColors[0] ?? null;
  const selectedColorValue = selectedColorCode === null ? "" : (selectedColorCode || NO_COLOR_VALUE);
  const colorsKey = selectedColors.join("|");
  const rangeKey = `${range.startDate.toISOString()}|${range.endDate.toISOString()}`;
  const colorCacheKey = `${companyKey}:${selectedProductId ?? ""}`;
  const selectedColor = useMemo(() => {
    if (!data || selectedColorCode === null) return null;
    return (data.availableColors ?? []).find((color) => color.code === selectedColorCode) ?? null;
  }, [data, selectedColorCode]);

  useEffect(() => {
    hasVisibleDataRef.current = data !== null;
  }, [data]);

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
      ? colorsParam.split(",").map((c) => c.trim() === NO_COLOR_VALUE ? "" : c.trim()).filter((c) => c || c === "")
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
      } catch {
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
      setLoadingPhase("initial");
      lastLoadedSignatureRef.current = null;
      return;
    }

    let active = true;

    async function load() {
      const productIdForLoad = selectedProductId;
      if (!productIdForLoad) {
        return;
      }
      const nextSignature = {
        productId: productIdForLoad,
        colorsKey,
        rangeKey,
      };
      const previousSignature = lastLoadedSignatureRef.current;
      const nextPhase: LoadingPhase = !hasVisibleDataRef.current
        ? "initial"
        : previousSignature?.productId !== productIdForLoad
          ? "product"
          : previousSignature?.colorsKey !== colorsKey
            ? "color"
            : "period";
      const cachedColors = colorOptionsCacheRef.current[colorCacheKey] ?? [];
      const shouldFetchColors = cachedColors.length === 0;

      setLoadingPhase(nextPhase);
      setLoading(true);
      setError(null);
      try {
        const productData = await fetchProductDetail(productIdForLoad, companyKey, range, selectedColors, {
          includeColors: shouldFetchColors,
          includeStockProgress: false,
        });
        if (active) {
          // Converter datas de strings para Date objects se necessário
          if (productData) {
            const mapSaleDates = (rows: ProductSaleHistory[]) =>
              rows.map((sale) => ({
                ...sale,
                date: sale.date instanceof Date ? sale.date : new Date(sale.date),
              }));
            const availableColors =
              productData.availableColors?.length > 0 ? productData.availableColors : cachedColors;
            if (availableColors.length > 0) {
              colorOptionsCacheRef.current[colorCacheKey] = availableColors;
            }
            const processedData = {
              ...productData,
              availableColors,
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
              stockProgress: [],
            };
            setData(processedData);
            void fetchProductStockProgress(
              productIdForLoad,
              companyKey,
              range,
              selectedColors,
              processedData.stockByFilial
            )
              .then((stockProgress) => {
                if (!active) return;
                setData((current) => {
                  if (!current || current.detail.productId !== processedData.detail.productId) {
                    return current;
                  }
                  return {
                    ...current,
                    stockProgress,
                  };
                });
              })
              .catch((progressError) => {
                if (!active) return;
                console.error("Erro ao carregar progresso de estoque", progressError);
              });
          } else {
            setData(null);
          }
          lastLoadedSignatureRef.current = nextSignature;
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
  }, [selectedProductId, companyKey, range, refreshTrigger, selectedColors, colorsKey, rangeKey, colorCacheKey]);

  const handleProductSelect = useCallback((product: ProductSearchResult) => {
    const trimmedName = product.productName.trim();
    const preSelectedColor = product.matchedColorCode?.trim() || "";

    setSelectedProductId(product.productId);
    setSelectedProductName(trimmedName);
    setSearchTerm(trimmedName);
    setShowSearchResults(false);
    setSearchResults([]);
    setSelectedColors(preSelectedColor ? [preSelectedColor] : []);
  }, []);

  const openColorModal = useCallback(() => {
    if (!selectedColor) return;
    setColorForm({
      code: selectedColor.code,
      description: selectedColor.description || selectedColor.displayName,
    });
    setColorModalError(null);
    setColorModalOpen(true);
  }, [selectedColor]);

  const closeColorModal = useCallback(() => {
    if (colorSaving) return;
    setColorModalOpen(false);
    setColorModalError(null);
  }, [colorSaving]);

  const saveColor = useCallback(async () => {
    if (!selectedProductId || !selectedColor || !user?.username) return;
    const code = colorForm.code.trim().toUpperCase();
    const description = colorForm.description.trim().toUpperCase();
    if (!code) {
      setColorModalError("Informe o codigo da cor.");
      return;
    }
    if (code.length > 10) {
      setColorModalError("Codigo da cor deve ter no maximo 10 caracteres.");
      return;
    }
    if (!description) {
      setColorModalError("Informe a descricao da cor.");
      return;
    }
    if (description.length > 25) {
      setColorModalError("Descricao da cor deve ter no maximo 25 caracteres.");
      return;
    }

    setColorSaving(true);
    setColorModalError(null);
    try {
      const response = await fetch("/api/product-detail/color", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-auth-username": user.username,
        },
        body: JSON.stringify({
          productId: selectedProductId,
          currentCode: selectedColor.code,
          code,
          description,
        }),
      });
      const json = (await response.json()) as {
        error?: string;
        data?: { code?: string; description?: string };
      };
      if (!response.ok || json.error) {
        throw new Error(json.error || "Erro ao salvar cor.");
      }
      delete colorOptionsCacheRef.current[colorCacheKey];
      setSelectedColors([json.data?.code || code]);
      setColorModalOpen(false);
      refetchDetail();
    } catch (err) {
      setColorModalError(err instanceof Error ? err.message : "Erro ao salvar cor.");
    } finally {
      setColorSaving(false);
    }
  }, [colorCacheKey, colorForm, refetchDetail, selectedColor, selectedProductId, user?.username]);

  const loadingTitle =
    loadingPhase === "color"
      ? "Atualizando cor"
      : loadingPhase === "period"
        ? "Atualizando período"
        : loadingPhase === "product"
          ? "Carregando produto"
          : "Carregando dados";

  const loadingHint =
    loadingPhase === "color"
      ? "Os dados estão sendo recalculados para a cor selecionada."
      : "Isso pode levar alguns segundos.";

  const showLoadingSkeleton = loading && !data;
  const showLoadingOverlay = loading && !!data;

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
              <div className={styles.colorSelectGroup}>
                <select
                  className={styles.colorSelectNative}
                  value={selectedColorValue}
                  disabled={loading}
                  onChange={(e) => {
                    const value = e.target.value;
                    setSelectedColors(value ? [value === NO_COLOR_VALUE ? "" : value] : []);
                  }}
                  aria-label="Filtrar por cor"
                  title="Filtrar por cor"
                >
                  <option value="">Todas as cores</option>
                  {(data.availableColors ?? []).map(({ code, displayName }) => (
                    <option key={code || "sem-cor"} value={code || NO_COLOR_VALUE}>
                      {code ? displayName : `${displayName} (sem codigo)`}
                    </option>
                  ))}
                </select>
                {showLoadingOverlay && loadingPhase === "color" && (
                  <span className={styles.inlineLoadingTag}>Atualizando...</span>
                )}
                {isAdmin && selectedColor && (
                  <button
                    type="button"
                    className={styles.colorEditButton}
                    onClick={openColorModal}
                    disabled={loading}
                    aria-label="Editar cadastro da cor"
                    title="Editar cadastro da cor"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M12 20h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                )}
              </div>
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
      <p>Digite o nome, código do produto ou código de barras para começar</p>
    </div>
  ) : null;

  const loadingSkeleton = (
    <div className={styles.loadingSkeleton} aria-live="polite" aria-busy="true">
      <div className={`${styles.skeletonSurface} ${styles.skeletonHeader}`}>
        <div className={styles.skeletonHeaderLeft}>
          <div className={`${styles.skeletonLine} ${styles.skeletonLineTitle}`} />
          <div className={`${styles.skeletonLine} ${styles.skeletonLineCode}`} />
          <div className={styles.skeletonInlineRow}>
            <div className={`${styles.skeletonLine} ${styles.skeletonLinePill}`} />
            <div className={`${styles.skeletonLine} ${styles.skeletonLineMeta}`} />
          </div>
        </div>
        <div className={styles.skeletonHeaderRight}>
          <div className={`${styles.skeletonLine} ${styles.skeletonLineLabel}`} />
          <div className={`${styles.skeletonLine} ${styles.skeletonLineNumber}`} />
          <div className={`${styles.skeletonLine} ${styles.skeletonLineUnit}`} />
        </div>
      </div>

      <div className={styles.loadingOverlayCard}>
        <span className={styles.loadingSpinner} aria-hidden />
        <div className={styles.loadingTextBlock}>
          <strong className={styles.loadingOverlayTitle}>{loadingTitle}</strong>
          <span className={styles.loadingOverlayHint}>{loadingHint}</span>
        </div>
      </div>

      <div className={styles.skeletonGrid}>
        <div className={styles.skeletonSurface}>
          <div className={`${styles.skeletonLine} ${styles.skeletonLineSectionTitle}`} />
          <div className={styles.skeletonMetricGrid}>
            <div className={styles.skeletonMetricCard}>
              <div className={`${styles.skeletonLine} ${styles.skeletonLineMetricLabel}`} />
              <div className={`${styles.skeletonLine} ${styles.skeletonLineMetricValue}`} />
            </div>
            <div className={styles.skeletonMetricCard}>
              <div className={`${styles.skeletonLine} ${styles.skeletonLineMetricLabel}`} />
              <div className={`${styles.skeletonLine} ${styles.skeletonLineMetricValue}`} />
            </div>
            <div className={styles.skeletonMetricCard}>
              <div className={`${styles.skeletonLine} ${styles.skeletonLineMetricLabel}`} />
              <div className={`${styles.skeletonLine} ${styles.skeletonLineMetricValue}`} />
            </div>
          </div>
        </div>
        <div className={`${styles.skeletonSurface} ${styles.skeletonChart}`} />
      </div>
    </div>
  );

  function renderBody() {
    if (showLoadingSkeleton) return loadingSkeleton;
    if (data) {
      return (
        <div className={styles.contentShell} aria-busy={loading}>
          <div className={showLoadingOverlay ? styles.contentDimmed : undefined}>{productContent}</div>
          {showLoadingOverlay && (
            <div className={styles.contentLoadingOverlay} aria-live="polite">
              <div className={styles.loadingOverlayCard}>
                <span className={styles.loadingSpinner} aria-hidden />
                <div className={styles.loadingTextBlock}>
                  <strong className={styles.loadingOverlayTitle}>{loadingTitle}</strong>
                  <span className={styles.loadingOverlayHint}>{loadingHint}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }
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
        <div className={styles.rangeWrapper}>
          <DateRangeFilter value={range} onChange={setRange} label="" />
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
              placeholder="Nome, código ou código de barras"
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
              {searchResults.map((product) => (
                <button
                  key={`${product.productId}-${product.matchedColorCode ?? "all"}`}
                  type="button"
                  className={styles.searchResultItem}
                  onClick={() => handleProductSelect(product)}
                >
                  <div className={styles.searchResultName}>{product.productName}</div>
                  <div className={styles.searchResultId}>
                    {product.productId}
                    {product.matchedColorCode
                      ? ` • Cor: ${product.matchedColorName || product.matchedColorCode}`
                      : ""}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

      </div>
      {error && (
        <div className={styles.controlsStatus}>
          {error ? <span className={styles.error}>{error}</span> : null}
        </div>
      )}
    </div>
  );

  return (
    <div className={styles.wrapper}>
      {headerSection}
      {renderBody()}
      {colorModalOpen && selectedColor && (
        <div className={styles.modalOverlay} onClick={closeColorModal}>
          <div className={styles.modalContent} onClick={(event) => event.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Cadastro da cor</h3>
              <button
                type="button"
                className={styles.modalCloseButton}
                onClick={closeColorModal}
                aria-label="Fechar"
                disabled={colorSaving}
              >
                x
              </button>
            </div>
            <div className={styles.colorForm}>
              <label className={styles.colorFormField}>
                <span>Codigo cor</span>
                <input
                  className={styles.colorFormInput}
                  value={colorForm.code}
                  maxLength={10}
                  onChange={(event) => setColorForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))}
                  disabled={colorSaving}
                />
              </label>
              <label className={styles.colorFormField}>
                <span>Descricao cor</span>
                <input
                  className={styles.colorFormInput}
                  value={colorForm.description}
                  maxLength={25}
                  onChange={(event) => setColorForm((current) => ({ ...current, description: event.target.value.toUpperCase() }))}
                  disabled={colorSaving}
                />
              </label>
              {colorModalError && <div className={styles.modalError}>{colorModalError}</div>}
            </div>
            <div className={styles.modalActions}>
              <button
                type="button"
                className={`${styles.modalButton} ${styles.modalButtonSecondary}`}
                onClick={closeColorModal}
                disabled={colorSaving}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={`${styles.modalButton} ${styles.modalButtonPrimary}`}
                onClick={saveColor}
                disabled={colorSaving}
              >
                {colorSaving ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
