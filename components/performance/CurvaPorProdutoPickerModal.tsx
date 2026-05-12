"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CompanyKey } from "@/lib/config/company";
import {
  buildCurvaPorProdutoKey,
  type CurvaPorProdutoSelectedItem,
} from "@/lib/performance/curvaPorProduto";

import styles from "./CurvaPorProdutoPickerModal.module.css";

interface Produto {
  produto: string;
  descProduto: string;
  codigoBarra: string | null;
  corProduto: string | null;
  descCor: string;
  grade?: string | null;
  linha?: string | null;
  subgrupo?: string | null;
  tipoProduto?: string | null;
  colecao?: string | null;
  descColecao?: string | null;
}

type ImportacaoOption = {
  key: string;
  tipo: "colecao" | "grade";
  valor: string;
  label: string;
};

type BarcodeLookupRow = { produto: string; corProduto: string | null };

async function buscarPorCodigoBarras(codigoBarras: string, companyKey?: string) {
  const params = new URLSearchParams({ codigoBarras: codigoBarras.trim() });
  if (companyKey) params.set("company", companyKey);
  const res = await fetch(
    `/api/transferencia-produtos/produto-por-codigo-barras?${params.toString()}`,
    { cache: "no-store" }
  );
  if (!res.ok) return null;
  const json = (await res.json()) as { data: BarcodeLookupRow | null };
  return json.data || null;
}

function isSomenteDigitosCodigoBarras(term: string): boolean {
  const value = term.trim();
  return value.length >= 4 && /^\d+$/.test(value);
}

async function searchProdutos(
  term: string,
  companyKey?: string,
  corProduto?: string | null
): Promise<Produto[]> {
  if (!term || term.trim().length < 2) return [];
  const params = new URLSearchParams({ q: term.trim(), entrada: "true" });
  if (companyKey) params.set("company", companyKey);
  if (corProduto !== undefined && corProduto !== null) params.set("corProduto", corProduto.trim());
  const res = await fetch(`/api/transferencia-produtos/produtos?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) return [];
  const json = (await res.json()) as { data: Produto[] };
  return json.data || [];
}

async function produtoFromBarcodeLookup(
  porBarra: BarcodeLookupRow,
  companyKey?: string
): Promise<Produto | null> {
  const list = await searchProdutos(
    porBarra.produto,
    companyKey,
    porBarra.corProduto != null ? porBarra.corProduto : undefined
  );
  const desiredColor = (porBarra.corProduto ?? "").trim();
  if (desiredColor) {
    return list.find((item) => (item.corProduto ?? "").trim() === desiredColor) ?? null;
  }
  return list.length === 1 ? (list[0] ?? null) : null;
}

async function fetchProdutosPorColecao(colecao: string, companyKey?: string): Promise<Produto[]> {
  const value = colecao.trim();
  if (!value) return [];
  const params = new URLSearchParams({ porColecao: "true", colecao: value });
  if (companyKey) params.set("company", companyKey);
  const res = await fetch(`/api/transferencia-produtos/produtos?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) return [];
  const json = (await res.json()) as { data?: Produto[] };
  return json.data || [];
}

async function fetchProdutosPorGrade(grade: string, companyKey?: string): Promise<Produto[]> {
  const value = grade.trim();
  if (!value) return [];
  const params = new URLSearchParams({ porGrade: "true", grade: value });
  if (companyKey) params.set("company", companyKey);
  const res = await fetch(`/api/transferencia-produtos/produtos?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) return [];
  const json = (await res.json()) as { data?: Produto[] };
  return json.data || [];
}

function toSelectedItem(produto: Produto): CurvaPorProdutoSelectedItem {
  return {
    produto: produto.produto,
    descricao: produto.descProduto,
    codigoBarra: produto.codigoBarra ?? null,
    corProduto: produto.corProduto ?? null,
    corDescricao: (produto.descCor || "").trim() || null,
    grade: produto.grade ?? null,
    linha: produto.linha ?? null,
    subgrupo: produto.subgrupo ?? null,
    tipoProduto: produto.tipoProduto ?? null,
    colecao: produto.colecao ?? null,
    descColecao: produto.descColecao ?? null,
  };
}

interface Props {
  companyKey: CompanyKey;
  open: boolean;
  selectedItems: CurvaPorProdutoSelectedItem[];
  onClose: () => void;
  onApply: (items: CurvaPorProdutoSelectedItem[]) => void;
}

export default function CurvaPorProdutoPickerModal({
  companyKey,
  open,
  selectedItems,
  onClose,
  onApply,
}: Props) {
  const [draftItems, setDraftItems] = useState<CurvaPorProdutoSelectedItem[]>(selectedItems);
  const [searchTerm, setSearchTerm] = useState("");
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [loadingProdutos, setLoadingProdutos] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [batchCodes, setBatchCodes] = useState("");
  const [importacaoQuery, setImportacaoQuery] = useState("");
  const [importacaoSelecionada, setImportacaoSelecionada] = useState<ImportacaoOption | null>(null);
  const [importacaoDropdownAberto, setImportacaoDropdownAberto] = useState(false);
  const [loadingColecoesOpcoes, setLoadingColecoesOpcoes] = useState(false);
  const [loadingGradesOpcoes, setLoadingGradesOpcoes] = useState(false);
  const [colecoesDisponiveis, setColecoesDisponiveis] = useState<string[]>([]);
  const [gradesDisponiveis, setGradesDisponiveis] = useState<string[]>([]);
  const [importandoColecao, setImportandoColecao] = useState(false);
  const [importandoGrade, setImportandoGrade] = useState(false);
  const [importandoBatch, setImportandoBatch] = useState(false);
  const [colorPickerProduto, setColorPickerProduto] = useState<Produto | null>(null);
  const [colorPickerOpcoes, setColorPickerOpcoes] = useState<Produto[]>([]);
  const [loadingColorPicker, setLoadingColorPicker] = useState(false);

  const importacaoInputRef = useRef<HTMLInputElement>(null);

  const showFeedback = useCallback((message: string) => {
    setFeedback(message);
  }, []);

  useEffect(() => {
    if (!open) return;
    setDraftItems(selectedItems);
    setSearchTerm("");
    setProdutos([]);
    setFeedback(null);
    setBatchCodes("");
    setImportacaoQuery("");
    setImportacaoSelecionada(null);
    setImportacaoDropdownAberto(false);
    setColorPickerProduto(null);
    setColorPickerOpcoes([]);
  }, [open, selectedItems]);

  useEffect(() => {
    if (!open) return;
    if (!searchTerm || searchTerm.trim().length < 2) {
      setProdutos([]);
      return;
    }

    let active = true;
    setLoadingProdutos(true);
    const timeoutId = window.setTimeout(async () => {
      try {
        const term = searchTerm.trim();
        let results: Produto[] = [];

        if (term.length >= 3) {
          const porBarra = await buscarPorCodigoBarras(term, companyKey);
          if (porBarra) {
            const match = await produtoFromBarcodeLookup(porBarra, companyKey);
            if (match) results = [match];
          } else if (isSomenteDigitosCodigoBarras(term)) {
            results = [];
          }
        }

        if (results.length === 0 && !isSomenteDigitosCodigoBarras(term)) {
          results = await searchProdutos(term, companyKey);
        }

        if (active) setProdutos(results);
      } catch {
        if (active) setProdutos([]);
      } finally {
        if (active) setLoadingProdutos(false);
      }
    }, 300);

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [companyKey, open, searchTerm]);

  useEffect(() => {
    if (!open || companyKey !== "scarfme") return;
    let active = true;
    setLoadingColecoesOpcoes(true);
    setLoadingGradesOpcoes(true);

    void fetch("/api/stock-by-filial?company=scarfme&filtersOnly=true", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as { filterOptions?: { colecoes?: string[]; grades?: string[] } };
      })
      .then((json) => {
        if (!active) return;
        setColecoesDisponiveis(json?.filterOptions?.colecoes ?? []);
        setGradesDisponiveis(json?.filterOptions?.grades ?? []);
      })
      .catch(() => {
        if (!active) return;
        setColecoesDisponiveis([]);
        setGradesDisponiveis([]);
      })
      .finally(() => {
        if (!active) return;
        setLoadingColecoesOpcoes(false);
        setLoadingGradesOpcoes(false);
      });

    return () => {
      active = false;
    };
  }, [companyKey, open]);

  useEffect(() => {
    setColorPickerProduto(null);
    setColorPickerOpcoes([]);
  }, [searchTerm]);

  useEffect(() => {
    if (!colorPickerProduto) {
      setColorPickerOpcoes([]);
      return;
    }

    const coresNoResultado = produtos.filter(
      (item) => item.produto.trim() === colorPickerProduto.produto.trim() && item.corProduto !== null
    );
    if (coresNoResultado.length > 0) {
      setColorPickerOpcoes(coresNoResultado);
      return;
    }

    let cancelled = false;
    setLoadingColorPicker(true);
    searchProdutos(colorPickerProduto.produto, companyKey)
      .then((result) => {
        if (cancelled) return;
        setColorPickerOpcoes(
          result.filter(
            (item) => item.produto.trim() === colorPickerProduto.produto.trim() && item.corProduto !== null
          )
        );
      })
      .catch(() => {
        if (!cancelled) setColorPickerOpcoes([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingColorPicker(false);
      });

    return () => {
      cancelled = true;
    };
  }, [colorPickerProduto, companyKey, produtos]);

  const addSelectedItems = useCallback((items: CurvaPorProdutoSelectedItem[]) => {
    setDraftItems((prev) => {
      const next = [...prev];
      const existing = new Set(prev.map((item) => buildCurvaPorProdutoKey(item.produto, item.corProduto)));
      let added = 0;

      for (const item of items) {
        const key = buildCurvaPorProdutoKey(item.produto, item.corProduto);
        if (existing.has(key)) continue;
        existing.add(key);
        next.push(item);
        added += 1;
      }

      showFeedback(added > 0 ? `${added} item(ns) adicionado(s)` : "Todos os itens selecionados ja estavam na lista");
      return next;
    });
  }, [showFeedback]);

  const adicionarProduto = useCallback((produto: Produto) => {
    if (produto.corProduto === null) {
      const hasColorVariants = produtos.some(
        (item) => item.produto.trim() === produto.produto.trim() && item.corProduto !== null
      );
      if (hasColorVariants) {
        setColorPickerProduto(produto);
        return;
      }
    }

    addSelectedItems([toSelectedItem(produto)]);
  }, [addSelectedItems, produtos]);

  const removerItem = useCallback((key: string) => {
    setDraftItems((prev) => prev.filter((item) => buildCurvaPorProdutoKey(item.produto, item.corProduto) !== key));
  }, []);

  const importarColecaoProdutos = useCallback(async (colecao: string) => {
    if (!colecao.trim()) {
      showFeedback("Selecione uma colecao");
      return;
    }

    setImportandoColecao(true);
    try {
      const lista = await fetchProdutosPorColecao(colecao, companyKey);
      if (lista.length === 0) {
        showFeedback("Nenhum item encontrado para esta colecao");
        return;
      }
      addSelectedItems(lista.map(toSelectedItem));
    } finally {
      setImportandoColecao(false);
    }
  }, [addSelectedItems, companyKey, showFeedback]);

  const importarGradeProdutos = useCallback(async (grade: string) => {
    if (!grade.trim()) {
      showFeedback("Selecione uma grade");
      return;
    }

    setImportandoGrade(true);
    try {
      const lista = await fetchProdutosPorGrade(grade, companyKey);
      if (lista.length === 0) {
        showFeedback("Nenhum item encontrado para esta grade");
        return;
      }
      addSelectedItems(lista.map(toSelectedItem));
    } finally {
      setImportandoGrade(false);
    }
  }, [addSelectedItems, companyKey, showFeedback]);

  const importarSelecionado = useCallback(async () => {
    if (!importacaoSelecionada) {
      showFeedback("Selecione uma colecao ou grade");
      return;
    }

    if (importacaoSelecionada.tipo === "colecao") {
      await importarColecaoProdutos(importacaoSelecionada.valor);
      return;
    }

    await importarGradeProdutos(importacaoSelecionada.valor);
  }, [importacaoSelecionada, importarColecaoProdutos, importarGradeProdutos, showFeedback]);

  const importarBatchProdutos = useCallback(async () => {
    const codigos = batchCodes
      .split(/\r?\n|,|;|\t/g)
      .map((codigo) => codigo.trim())
      .filter(Boolean);

    if (codigos.length === 0) {
      showFeedback("Cole pelo menos um codigo para importar");
      return;
    }

    setImportandoBatch(true);
    try {
      const resolvidos = await Promise.all(
        codigos.map(async (codigoOriginal) => {
          try {
            const porBarra = await buscarPorCodigoBarras(codigoOriginal, companyKey);
            if (porBarra) {
              const matchBarra = await produtoFromBarcodeLookup(porBarra, companyKey);
              return matchBarra;
            }

            if (isSomenteDigitosCodigoBarras(codigoOriginal)) return null;

            const candidatos = await searchProdutos(codigoOriginal, companyKey);
            if (candidatos.length === 0) return null;

            return (
              candidatos.find((item) => item.produto.trim() === codigoOriginal.trim()) ??
              candidatos.find((item) => (item.codigoBarra || "").trim() === codigoOriginal.trim()) ??
              null
            );
          } catch {
            return null;
          }
        })
      );

      const encontrados = resolvidos.filter((item): item is Produto => item !== null);
      if (encontrados.length === 0) {
        showFeedback("Nenhum codigo foi reconhecido");
        return;
      }

      addSelectedItems(encontrados.map(toSelectedItem));
      setBatchCodes("");
    } finally {
      setImportandoBatch(false);
    }
  }, [addSelectedItems, batchCodes, companyKey, showFeedback]);

  const opcoesImportacao = useMemo<ImportacaoOption[]>(() => {
    if (companyKey !== "scarfme") return [];
    return [
      ...colecoesDisponiveis.map((value) => ({
        key: `colecao:${value}`,
        tipo: "colecao" as const,
        valor: value,
        label: `Colecao: ${value}`,
      })),
      ...gradesDisponiveis.map((value) => ({
        key: `grade:${value}`,
        tipo: "grade" as const,
        valor: value,
        label: `Grade: ${value}`,
      })),
    ];
  }, [colecoesDisponiveis, companyKey, gradesDisponiveis]);

  const opcoesImportacaoFiltradas = useMemo(() => {
    const query = importacaoQuery.trim().toUpperCase();
    if (!query) return opcoesImportacao.slice(0, 30);
    return opcoesImportacao
      .filter((option) => option.valor.toUpperCase().includes(query) || option.label.toUpperCase().includes(query))
      .slice(0, 30);
  }, [importacaoQuery, opcoesImportacao]);

  const itensJaSelecionados = useMemo(
    () => new Set(draftItems.map((item) => buildCurvaPorProdutoKey(item.produto, item.corProduto))),
    [draftItems]
  );

  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(event) => event.stopPropagation()}>
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>Adicionar produtos</h2>
            <p className={styles.subtitle}>Busca individual, colecao, grade ou importacao em lote.</p>
          </div>
          <button type="button" className={styles.closeButton} onClick={onClose}>
            ×
          </button>
        </div>

        <div className={styles.body}>
          <div className={styles.column}>
            <div className={styles.section}>
              <div className={styles.sectionLabel}>Busca manual</div>
              <input
                className={styles.searchInput}
                placeholder="Produto, descricao ou codigo de barras"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                autoFocus
              />
            </div>

            {companyKey === "scarfme" && (
              <div className={styles.section}>
                <div className={styles.sectionLabel}>Colecao ou grade</div>
                <div className={styles.inlineRow}>
                  <div className={styles.autocomplete}>
                    <input
                      ref={importacaoInputRef}
                      className={styles.searchInput}
                      placeholder="Colecao ou grade"
                      value={importacaoQuery}
                      onFocus={() => setImportacaoDropdownAberto(true)}
                      onChange={(event) => {
                        setImportacaoQuery(event.target.value);
                        setImportacaoSelecionada(null);
                        setImportacaoDropdownAberto(true);
                      }}
                    />
                    {importacaoDropdownAberto && !loadingColecoesOpcoes && !loadingGradesOpcoes && (
                      <div className={styles.dropdown}>
                        {opcoesImportacaoFiltradas.length === 0 ? (
                          <div className={styles.dropdownEmpty}>Nenhuma opcao encontrada</div>
                        ) : (
                          opcoesImportacaoFiltradas.map((option) => (
                            <button
                              key={option.key}
                              type="button"
                              className={styles.dropdownItem}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => {
                                setImportacaoSelecionada(option);
                                setImportacaoQuery(option.label);
                                setImportacaoDropdownAberto(false);
                              }}
                            >
                              {option.label}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => void importarSelecionado()}
                    disabled={!importacaoSelecionada || importandoColecao || importandoGrade}
                  >
                    Importar
                  </button>
                </div>
              </div>
            )}

            <div className={styles.section}>
              <div className={styles.sectionLabel}>Importacao em lote</div>
              <textarea
                className={styles.textarea}
                placeholder="Cole um codigo por linha"
                rows={4}
                value={batchCodes}
                onChange={(event) => setBatchCodes(event.target.value)}
              />
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => void importarBatchProdutos()}
                disabled={importandoBatch}
              >
                {importandoBatch ? "Importando..." : "Importar codigos"}
              </button>
            </div>

            {feedback && <div className={styles.feedback}>{feedback}</div>}

            <div className={styles.results}>
              {loadingProdutos ? (
                <div className={styles.emptyState}>Buscando produtos...</div>
              ) : produtos.length === 0 && searchTerm.trim().length >= 2 ? (
                <div className={styles.emptyState}>Nenhum produto encontrado</div>
              ) : (
                produtos
                  .filter((produto) => !itensJaSelecionados.has(buildCurvaPorProdutoKey(produto.produto, produto.corProduto)))
                  .map((produto) => {
                    const isPickerActive =
                      colorPickerProduto?.produto === produto.produto && produto.corProduto === null;
                    return (
                      <div
                        key={`${produto.produto}-${produto.corProduto ?? "null"}`}
                        className={`${styles.resultCard}${isPickerActive ? ` ${styles.resultCardActive}` : ""}`}
                      >
                        <div className={styles.resultMain}>
                          <div className={styles.resultName}>{produto.descProduto}</div>
                          <div className={styles.resultMeta}>
                            {produto.produto}
                            {produto.descCor ? ` · ${produto.descCor}` : produto.corProduto ? ` · ${produto.corProduto}` : ""}
                            {produto.codigoBarra ? ` · ${produto.codigoBarra}` : ""}
                          </div>
                        </div>
                        {!isPickerActive && (
                          <button type="button" className={styles.addButton} onClick={() => adicionarProduto(produto)}>
                            +
                          </button>
                        )}
                        {isPickerActive && (
                          <div className={styles.colorPicker}>
                            {loadingColorPicker ? (
                              <span className={styles.colorHint}>Buscando cores...</span>
                            ) : colorPickerOpcoes.length > 0 ? (
                              colorPickerOpcoes.map((option) => (
                                <button
                                  key={`${option.produto}-${option.corProduto}`}
                                  type="button"
                                  className={styles.colorChip}
                                  onClick={() => {
                                    setColorPickerProduto(null);
                                    setColorPickerOpcoes([]);
                                    adicionarProduto(option);
                                  }}
                                >
                                  {option.descCor || option.corProduto}
                                </button>
                              ))
                            ) : (
                              <span className={styles.colorHint}>Nenhuma cor disponivel</span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
              )}
            </div>
          </div>

          <div className={styles.column}>
            <div className={styles.selectedHeader}>
              <div>
                <div className={styles.sectionLabel}>Selecionados</div>
                <div className={styles.selectedCount}>{draftItems.length} item(ns)</div>
              </div>
              {draftItems.length > 0 && (
                <button type="button" className={styles.linkButton} onClick={() => setDraftItems([])}>
                  Limpar
                </button>
              )}
            </div>

            <div className={styles.selectedList}>
              {draftItems.length === 0 ? (
                <div className={styles.emptyState}>Nenhum produto selecionado ainda.</div>
              ) : (
                draftItems.map((item) => {
                  const key = buildCurvaPorProdutoKey(item.produto, item.corProduto);
                  return (
                    <div key={key} className={styles.selectedCard}>
                      <div className={styles.resultMain}>
                        <div className={styles.resultName}>{item.descricao || item.produto}</div>
                        <div className={styles.resultMeta}>
                          {item.produto}
                          {item.corDescricao ? ` · ${item.corDescricao}` : item.corProduto ? ` · ${item.corProduto}` : ""}
                          {item.codigoBarra ? ` · ${item.codigoBarra}` : ""}
                        </div>
                      </div>
                      <button type="button" className={styles.removeButton} onClick={() => removerItem(key)}>
                        ×
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className={styles.footer}>
          <button type="button" className={styles.secondaryButton} onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className={styles.primaryButton} onClick={() => onApply(draftItems)}>
            Aplicar selecao
          </button>
        </div>
      </div>
    </div>
  );
}
