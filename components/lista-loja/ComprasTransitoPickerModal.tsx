"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchControleEstoqueItemMetricasClient } from "@/lib/client/controle-estoque-metricas";
import type { CompanyKey } from "@/lib/config/company";
import { resolveCicloCompra } from "@/lib/config/compra-ciclo";
import type { CompraTransitoItemRow } from "@/lib/types/compra-transito";
import { buildControleEstoqueItemKey } from "@/lib/utils/controle-estoque-metricas";

/** Hoje + `dias` em YYYY-MM-DD (local). Usado para o preview da data de recebimento. */
function addDiasHojeIso(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + Math.max(0, Math.round(dias)));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

import styles from "../performance/CurvaPorProdutoPickerModal.module.css";

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
  estoques?: Array<{ filial: string; nomeFilial: string; estoque: number }>;
}

type ImportacaoOption = {
  key: string;
  tipo: "colecao" | "grade";
  valor: string;
  label: string;
};

type BarcodeLookupRow = { produto: string; corProduto: string | null };

function mapDraftItemToProduto(item: CompraTransitoItemRow): Produto {
  return {
    produto: item.produto,
    descProduto: item.descricao || item.produto,
    codigoBarra: item.codigoBarra ?? null,
    corProduto: item.corProduto ?? null,
    descCor: item.corDescricao || item.corProduto || "",
    grade: item.grade ?? null,
    linha: null,
    subgrupo: null,
    tipoProduto: null,
    colecao: null,
    descColecao: null,
    estoques: [],
  };
}

function sumEstoque(produto: Produto): number {
  return Math.round(
    (produto.estoques ?? []).reduce((sum, row) => sum + Math.max(0, Number(row.estoque ?? 0)), 0)
  );
}

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

interface Props {
  companyKey: CompanyKey;
  open: boolean;
  draftItems: CompraTransitoItemRow[];
  onClose: () => void;
  onApply: (items: CompraTransitoItemRow[]) => void;
}

export default function ComprasTransitoPickerModal({
  companyKey,
  open,
  draftItems,
  onClose,
  onApply,
}: Props) {
  const [selectedProdutos, setSelectedProdutos] = useState<Produto[]>([]);
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
  const [applying, setApplying] = useState(false);

  const showFeedback = useCallback((message: string) => {
    setFeedback(message);
  }, []);

  const handleRequestClose = useCallback(() => {
    if (applying) return;
    onClose();
  }, [applying, onClose]);

  useEffect(() => {
    if (!open) return;
    setSelectedProdutos(draftItems.map(mapDraftItemToProduto));
    setSearchTerm("");
    setProdutos([]);
    setFeedback(null);
    setBatchCodes("");
    setImportacaoQuery("");
    setImportacaoSelecionada(null);
    setImportacaoDropdownAberto(false);
    setColorPickerProduto(null);
    setColorPickerOpcoes([]);
  }, [draftItems, open]);

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

  const addSelectedProdutos = useCallback((items: Produto[]) => {
    setSelectedProdutos((prev) => {
      const next = [...prev];
      const existing = new Set(prev.map((item) => buildControleEstoqueItemKey(item.produto, item.corProduto)));
      let added = 0;

      for (const item of items) {
        const key = buildControleEstoqueItemKey(item.produto, item.corProduto);
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

    addSelectedProdutos([produto]);
  }, [addSelectedProdutos, produtos]);

  const removerItem = useCallback((key: string) => {
    setSelectedProdutos((prev) => prev.filter((item) => buildControleEstoqueItemKey(item.produto, item.corProduto) !== key));
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
      addSelectedProdutos(lista);
    } finally {
      setImportandoColecao(false);
    }
  }, [addSelectedProdutos, companyKey, showFeedback]);

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
      addSelectedProdutos(lista);
    } finally {
      setImportandoGrade(false);
    }
  }, [addSelectedProdutos, companyKey, showFeedback]);

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

      addSelectedProdutos(encontrados);
      setBatchCodes("");
    } finally {
      setImportandoBatch(false);
    }
  }, [addSelectedProdutos, batchCodes, companyKey, showFeedback]);

  const handleApply = useCallback(async () => {
    setApplying(true);
    try {
      const existingMap = new Map(draftItems.map((item) => [item.itemKey, item]));
      const nextItems = await Promise.all(
        selectedProdutos.map(async (produto) => {
          const itemKey = buildControleEstoqueItemKey(produto.produto, produto.corProduto);
          const existing = existingMap.get(itemKey);
          if (existing) return existing;

          // Data de recebimento AUTOMÁTICA (preview): hoje + tempo de produção do ciclo do
          // produto. Marcada como não-manual; na confirmação o servidor recalcula a partir
          // da data real de confirmação. O usuário pode editar (vira manual).
          const producaoDias = resolveCicloCompra(companyKey, {
            linha: produto.linha,
            subgrupo: produto.subgrupo,
          }).producaoDias;
          const dataRecebimentoAuto = addDiasHojeIso(producaoDias);

          try {
            const metricas = await fetchControleEstoqueItemMetricasClient({
              company: companyKey,
              filial: null,
              includeHistorico: false,
              item: {
                produto: produto.produto,
                corProduto: produto.corProduto,
              },
            });

            return {
              itemKey,
              produto: produto.produto,
              descricao: produto.descProduto || produto.produto,
              codigoBarra: produto.codigoBarra ?? undefined,
              corProduto: produto.corProduto ?? undefined,
              corDescricao: produto.descCor || undefined,
              grade: produto.grade ?? undefined,
              dataRecebimento: dataRecebimentoAuto,
              dataRecebimentoManual: false,
              quantidade: 1,
              custoUnitario: metricas?.resumo.custoUnitario ?? undefined,
              estoqueAtual: metricas?.resumo.estoqueTotal ?? sumEstoque(produto),
              status: "em_transito" as const,
            } satisfies CompraTransitoItemRow;
          } catch {
            return {
              itemKey,
              produto: produto.produto,
              descricao: produto.descProduto || produto.produto,
              codigoBarra: produto.codigoBarra ?? undefined,
              corProduto: produto.corProduto ?? undefined,
              corDescricao: produto.descCor || undefined,
              grade: produto.grade ?? undefined,
              dataRecebimento: dataRecebimentoAuto,
              dataRecebimentoManual: false,
              quantidade: 1,
              custoUnitario: undefined,
              estoqueAtual: sumEstoque(produto),
              status: "em_transito" as const,
            } satisfies CompraTransitoItemRow;
          }
        })
      );

      onApply(nextItems);
    } finally {
      setApplying(false);
    }
  }, [companyKey, draftItems, onApply, selectedProdutos]);

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
    () => new Set(selectedProdutos.map((item) => buildControleEstoqueItemKey(item.produto, item.corProduto))),
    [selectedProdutos]
  );

  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={handleRequestClose}>
      <div className={styles.modal} onClick={(event) => event.stopPropagation()}>
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>Adicionar produtos</h2>
            <p className={styles.subtitle}>Busca individual, colecao, grade ou importacao em lote.</p>
          </div>
          <button type="button" className={styles.closeButton} onClick={handleRequestClose} disabled={applying}>
            x
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
                    disabled={!importacaoSelecionada || importandoColecao || importandoGrade || applying}
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
                disabled={importandoBatch || applying}
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
                  .filter((produto) => !itensJaSelecionados.has(buildControleEstoqueItemKey(produto.produto, produto.corProduto)))
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
                            {produto.descCor ? ` | ${produto.descCor}` : produto.corProduto ? ` | ${produto.corProduto}` : ""}
                            {produto.codigoBarra ? ` | ${produto.codigoBarra}` : ""}
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
                <div className={styles.selectedCount}>{selectedProdutos.length} item(ns)</div>
              </div>
              {selectedProdutos.length > 0 && (
                <button type="button" className={styles.linkButton} onClick={() => setSelectedProdutos([])} disabled={applying}>
                  Limpar
                </button>
              )}
            </div>

            <div className={styles.selectedList}>
              {selectedProdutos.length === 0 ? (
                <div className={styles.emptyState}>Nenhum produto selecionado ainda.</div>
              ) : (
                selectedProdutos.map((item) => {
                  const key = buildControleEstoqueItemKey(item.produto, item.corProduto);
                  return (
                    <div key={key} className={styles.selectedCard}>
                      <div className={styles.resultMain}>
                        <div className={styles.resultName}>{item.descProduto || item.produto}</div>
                        <div className={styles.resultMeta}>
                          {item.produto}
                          {item.descCor ? ` | ${item.descCor}` : item.corProduto ? ` | ${item.corProduto}` : ""}
                          {item.codigoBarra ? ` | ${item.codigoBarra}` : ""}
                        </div>
                      </div>
                      <button type="button" className={styles.removeButton} onClick={() => removerItem(key)} disabled={applying}>
                        x
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className={styles.footer}>
          <button type="button" className={styles.secondaryButton} onClick={handleRequestClose} disabled={applying}>
            Cancelar
          </button>
          <button type="button" className={styles.primaryButton} onClick={() => void handleApply()} disabled={applying}>
            {applying ? "Aplicando..." : "Aplicar selecao"}
          </button>
        </div>
      </div>
    </div>
  );
}
