"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { CompanyKey } from "@/lib/config/company";
import type {
  CompraTransito,
  CompraTransitoItemRow,
  CompraTransitoListEntry,
  CompraTransitoStatus,
} from "@/lib/types/compra-transito";
import { getCompraTransitoItemStatus } from "@/lib/utils/compra-transito-status";

import ComprasTransitoPickerModal from "./ComprasTransitoPickerModal";
import styles from "./ComprasTransitoPage.module.css";

type ViewMode = "list" | "editor" | "detail";

type ToastState = {
  tipo: "success" | "error";
  mensagem: string;
} | null;

async function fetchCompras(companyKey: CompanyKey): Promise<CompraTransitoListEntry[]> {
  const params = new URLSearchParams({ company: companyKey });
  const res = await fetch(`/api/compras-transito?${params.toString()}`, { cache: "no-store" });
  const json = (await res.json()) as { data?: CompraTransitoListEntry[]; error?: string };
  if (!res.ok) throw new Error(json.error ?? "Erro ao carregar compras em transito");
  return json.data ?? [];
}

async function fetchCompra(companyKey: CompanyKey, id: string): Promise<CompraTransito> {
  const params = new URLSearchParams({ company: companyKey });
  const res = await fetch(`/api/compras-transito/${id}?${params.toString()}`, { cache: "no-store" });
  const json = (await res.json()) as { data?: CompraTransito; error?: string };
  if (!res.ok || !json.data) throw new Error(json.error ?? "Erro ao carregar compra");
  return json.data;
}

function fmt(n: number) {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

function fmtBRL(n: number) {
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}

function fmtBRL2(n: number) {
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtDate(value?: string | null) {
  if (!value) return "-";
  const d = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("pt-BR");
}

function fmtDateTime(value?: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getStatusLabel(status: CompraTransitoStatus) {
  if (status === "em_transito") return "Em trânsito";
  if (status === "rascunho") return "Rascunho";
  return "Recebida";
}

function calcDurationDays(createdAt: string, dataRecebimento: string): number | null {
  if (!dataRecebimento) return null;
  const created = new Date(createdAt);
  const received = new Date(`${dataRecebimento.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(created.getTime()) || Number.isNaN(received.getTime())) return null;
  return Math.round((received.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
}

function fmtDuration(days: number | null): string | null {
  if (days === null) return null;
  if (days === 0) return "chegou hoje";
  if (days < 0) return `levou ${Math.abs(days)} dia${Math.abs(days) !== 1 ? "s" : ""}`;
  return `em ${days} dia${days !== 1 ? "s" : ""}`;
}

export default function ComprasTransitoPage({
  companyKey,
  companyName,
}: {
  companyKey: CompanyKey;
  companyName: string;
  companySlug: string;
}) {
  const [view, setView] = useState<ViewMode>("list");
  const [compras, setCompras] = useState<CompraTransitoListEntry[]>([]);
  const [selectedCompra, setSelectedCompra] = useState<CompraTransito | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [draftItems, setDraftItems] = useState<CompraTransitoItemRow[]>([]);
  const [draftTitle, setDraftTitle] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [bulkDate, setBulkDate] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  const loadCompras = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCompras(companyKey);
      setCompras(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar compras em transito");
    } finally {
      setLoading(false);
    }
  }, [companyKey]);

  useEffect(() => {
    void loadCompras();
  }, [loadCompras]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const totals = useMemo(() => {
    const totalItens = draftItems.length;
    const totalQuantidade = draftItems.reduce(
      (sum, item) => sum + Math.max(0, Math.round(item.quantidade ?? 0)),
      0
    );
    const totalValor = draftItems.reduce((sum, item) => {
      const custo = Number(item.custoUnitario ?? 0);
      return custo > 0 ? sum + Math.round((item.quantidade ?? 0) * custo) : sum;
    }, 0);
    return { totalItens, totalQuantidade, totalValor };
  }, [draftItems]);

  const statusCounts = useMemo(() => {
    let emTransito = 0;
    let recebidas = 0;
    let rascunhos = 0;
    compras.forEach((compra) => {
      if (compra.status === "em_transito") emTransito += 1;
      else if (compra.status === "rascunho") rascunhos += 1;
      else recebidas += 1;
    });
    return { emTransito, recebidas, rascunhos };
  }, [compras]);

  const canConfirm = useMemo(
    () =>
      draftItems.length > 0 &&
      draftItems.every(
        (item) => item.dataRecebimento.trim() && Math.max(0, Math.round(item.quantidade ?? 0)) > 0
      ),
    [draftItems]
  );

  const canSaveDraft = draftItems.length > 0;

  const startNew = useCallback(() => {
    setDraftItems([]);
    setDraftTitle("");
    setEditingId(null);
    setBulkDate("");
    setSelectedCompra(null);
    setView("editor");
  }, []);

  const startEdit = useCallback((compra: CompraTransito) => {
    setDraftItems(compra.items);
    setDraftTitle(compra.title);
    setEditingId(compra.id);
    setBulkDate("");
    setView("editor");
  }, []);

  const applyBulkDate = useCallback((date: string) => {
    if (!date) return;
    setDraftItems((prev) => prev.map((item) => ({ ...item, dataRecebimento: date })));
  }, []);

  const openList = useCallback(() => {
    setSelectedCompra(null);
    setEditingId(null);
    setBulkDate("");
    setView("list");
  }, []);

  const openDetail = useCallback(
    async (id: string) => {
      setLoadingDetail(true);
      setError(null);
      try {
        const data = await fetchCompra(companyKey, id);
        setSelectedCompra(data);
        setView("detail");
      } catch (err) {
        setToast({
          tipo: "error",
          mensagem: err instanceof Error ? err.message : "Erro ao abrir compra",
        });
      } finally {
        setLoadingDetail(false);
      }
    },
    [companyKey]
  );

  const updateDraftItem = useCallback(
    (itemKey: string, patch: Partial<CompraTransitoItemRow>) => {
      setDraftItems((prev) =>
        prev.map((item) => (item.itemKey === itemKey ? { ...item, ...patch } : item))
      );
    },
    []
  );

  const removeDraftItem = useCallback((itemKey: string) => {
    setDraftItems((prev) => prev.filter((item) => item.itemKey !== itemKey));
  }, []);

  const saveCompra = useCallback(
    async (isDraft: boolean) => {
      if (saving) return;
      if (!isDraft && !canConfirm) return;
      if (isDraft && !canSaveDraft) return;
      setSaving(true);
      try {
        let res: Response;
        if (editingId) {
          res = await fetch(`/api/compras-transito/${editingId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              companyKey,
              title: draftTitle.trim() || undefined,
              items: draftItems,
              draft: isDraft,
            }),
          });
        } else {
          res = await fetch("/api/compras-transito", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              companyKey,
              title: draftTitle.trim() || undefined,
              items: draftItems,
              draft: isDraft,
            }),
          });
        }
        const json = (await res.json()) as { data?: CompraTransito; error?: string };
        if (!res.ok || !json.data) {
          throw new Error(json.error ?? "Erro ao salvar compra");
        }
        setDraftItems([]);
        setDraftTitle("");
        setEditingId(null);
        setModalOpen(false);
        await loadCompras();
        setView("list");
        setToast({
          tipo: "success",
          mensagem: isDraft
            ? "Rascunho salvo. Você pode editar as datas depois."
            : "Compra confirmada e marcada como em trânsito.",
        });
      } catch (err) {
        setToast({
          tipo: "error",
          mensagem: err instanceof Error ? err.message : "Erro ao salvar compra",
        });
      } finally {
        setSaving(false);
      }
    },
    [canConfirm, canSaveDraft, companyKey, draftItems, draftTitle, editingId, loadCompras, saving]
  );

  const cancelCompra = useCallback(async () => {
    if (!selectedCompra || deleting) return;
    if (!window.confirm("Cancelar e remover esta compra? Essa acao nao pode ser desfeita.")) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/compras-transito/${selectedCompra.id}?company=${encodeURIComponent(companyKey)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error ?? "Erro ao cancelar compra");
      }
      setSelectedCompra(null);
      await loadCompras();
      setView("list");
      setToast({ tipo: "success", mensagem: "Compra cancelada e removida." });
    } catch (err) {
      setToast({
        tipo: "error",
        mensagem: err instanceof Error ? err.message : "Erro ao cancelar compra",
      });
    } finally {
      setDeleting(false);
    }
  }, [selectedCompra, deleting, companyKey, loadCompras]);

  const renderTableRows = (items: CompraTransitoItemRow[], readOnly: boolean, createdAt?: string) => (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Data Recebimento</th>
            <th>Produto</th>
            <th>Descricao</th>
            <th>Cor</th>
            <th className={styles.right}>Qtd</th>
            <th>Grade</th>
            <th className={styles.right}>Custo</th>
            <th className={styles.right}>Custo Total</th>
            <th className={styles.right}>Estoque</th>
            <th className={styles.right}>Estoque Final</th>
            {!readOnly && <th aria-hidden="true" />}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const custo = Number(item.custoUnitario ?? 0);
            const estoque = Math.round(Number(item.estoqueAtual ?? 0));
            const qtd = Math.max(0, Math.round(item.quantidade ?? 0));
            const custoTotal = custo > 0 ? Math.round(custo * qtd) : 0;
            const estoqueFinal = estoque + qtd;
            const itemStatus = item.dataRecebimento
              ? getCompraTransitoItemStatus(item.dataRecebimento)
              : "rascunho";
            const durationLabel =
              readOnly && createdAt && item.dataRecebimento
                ? fmtDuration(calcDurationDays(createdAt, item.dataRecebimento))
                : null;
            return (
              <tr
                key={item.itemKey}
                className={
                  readOnly
                    ? itemStatus === "em_transito"
                      ? styles.rowConfirmed
                      : itemStatus === "rascunho"
                      ? styles.rowDraft
                      : styles.rowReceived
                    : undefined
                }
              >
                <td>
                  {readOnly ? (
                    <div className={styles.readOnlyDateCell}>
                      <span>{item.dataRecebimento ? fmtDate(item.dataRecebimento) : "Sem data"}</span>
                      <span
                        className={`${styles.inlineStatusBadge} ${
                          itemStatus === "em_transito"
                            ? styles.inlineStatusBadgeTransit
                            : itemStatus === "rascunho"
                            ? styles.inlineStatusBadgeDraft
                            : styles.inlineStatusBadgeReceived
                        }`}
                      >
                        {getStatusLabel(itemStatus)}
                      </span>
                      {durationLabel && (
                        <span className={styles.durationChip}>{durationLabel}</span>
                      )}
                    </div>
                  ) : (
                    <input
                      type="date"
                      className={styles.input}
                      value={item.dataRecebimento}
                      onChange={(e) =>
                        updateDraftItem(item.itemKey, { dataRecebimento: e.target.value })
                      }
                    />
                  )}
                </td>
                <td className={styles.codeCell}>{item.produto}</td>
                <td>
                  <div className={styles.descriptionCell}>{item.descricao}</div>
                </td>
                <td>{item.corDescricao || item.corProduto || "-"}</td>
                <td className={styles.right}>
                  {readOnly ? (
                    fmt(qtd)
                  ) : (
                    <input
                      type="number"
                      min={1}
                      className={`${styles.input} ${styles.inputQty}`}
                      value={qtd}
                      onChange={(e) =>
                        updateDraftItem(item.itemKey, {
                          quantidade: Math.max(0, Math.round(Number(e.target.value ?? 0))),
                        })
                      }
                    />
                  )}
                </td>
                <td>{item.grade || "-"}</td>
                <td className={styles.right}>{custo > 0 ? fmtBRL2(custo) : "-"}</td>
                <td className={styles.right}>{custoTotal > 0 ? fmtBRL(custoTotal) : "-"}</td>
                <td className={styles.right}>{fmt(estoque)}</td>
                <td className={styles.right}>{fmt(estoqueFinal)}</td>
                {!readOnly && (
                  <td className={styles.right}>
                    <button
                      type="button"
                      className={styles.removeBtn}
                      onClick={() => removeDraftItem(item.itemKey)}
                    >
                      Remover
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className={styles.wrapper}>
      {toast && (
        <div
          className={`${styles.toast} ${
            toast.tipo === "error" ? styles.toastError : styles.toastSuccess
          }`}
        >
          {toast.mensagem}
        </div>
      )}

      <div className={styles.topBar}>
        <div>
          <h1 className={styles.title}>Compras em Trânsito</h1>
          <p className={styles.subtitle}>{companyName}</p>
        </div>
        <div className={styles.topBarActions}>
          {view !== "editor" && (
            <button type="button" className={styles.primaryBtn} onClick={startNew}>
              + Nova Compra
            </button>
          )}
          {view === "editor" && (
            <>
              <button type="button" className={styles.secondaryBtn} onClick={openList}>
                Ver Compras
              </button>
              <button type="button" className={styles.secondaryBtn} onClick={() => setModalOpen(true)}>
                {draftItems.length > 0 ? "Editar produtos" : "Adicionar produtos"}
              </button>
              <button
                type="button"
                className={styles.draftBtn}
                onClick={() => void saveCompra(true)}
                disabled={!canSaveDraft || saving}
              >
                {saving ? "Salvando..." : "Salvar rascunho"}
              </button>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={() => void saveCompra(false)}
                disabled={!canConfirm || saving}
              >
                {saving ? "Confirmando..." : "Confirmar Compra"}
              </button>
            </>
          )}
        </div>
      </div>

      {view === "list" && (
        <>
          <div className={styles.summaryCard}>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Compras confirmadas</span>
              <strong className={styles.summaryValue}>{fmt(compras.length)}</strong>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Em trânsito</span>
              <strong className={styles.summaryValueGreen}>{fmt(statusCounts.emTransito)}</strong>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Recebidas</span>
              <strong className={styles.summaryValue}>{fmt(statusCounts.recebidas)}</strong>
            </div>
            {statusCounts.rascunhos > 0 && (
              <div className={styles.summaryItem}>
                <span className={styles.summaryLabel}>Rascunhos</span>
                <strong className={styles.summaryValueDraft}>{fmt(statusCounts.rascunhos)}</strong>
              </div>
            )}
          </div>

          {loading && <div className={styles.emptyState}>Carregando compras em trânsito...</div>}
          {!loading && error && <div className={styles.errorBox}>{error}</div>}
          {!loading && !error && compras.length === 0 && (
            <div className={styles.emptyState}>
              <p>Nenhuma compra em trânsito confirmada ainda.</p>
              <button type="button" className={styles.primaryBtn} onClick={startNew}>
                Criar primeira compra
              </button>
            </div>
          )}
          {!loading && !error && compras.length > 0 && (
            <div className={styles.cardsGrid}>
              {compras.map((compra) => {
                const periodoRecebimento =
                  compra.minDataRecebimento && compra.maxDataRecebimento
                    ? compra.minDataRecebimento === compra.maxDataRecebimento
                      ? fmtDate(compra.minDataRecebimento)
                      : `${fmtDate(compra.minDataRecebimento)} ate ${fmtDate(compra.maxDataRecebimento)}`
                    : "Sem data";
                const isTransit = compra.status === "em_transito";
                const isDraft = compra.status === "rascunho";

                return (
                  <button
                    key={compra.id}
                    type="button"
                    className={`${styles.card} ${isDraft ? styles.cardDraft : !isTransit ? styles.cardReceived : ""}`}
                    onClick={() => void openDetail(compra.id)}
                    disabled={loadingDetail}
                  >
                    <div className={styles.cardHeader}>
                      <span className={`${styles.cardTitle} ${isDraft ? styles.cardTitleDraft : ""}`}>{compra.title}</span>
                      <span
                        className={`${styles.statusBadge} ${
                          isDraft
                            ? styles.statusBadgeDraft
                            : isTransit
                            ? styles.statusBadgeTransit
                            : styles.statusBadgeReceived
                        }`}
                      >
                        {getStatusLabel(compra.status)}
                      </span>
                    </div>
                    <div className={`${styles.cardMeta} ${isDraft ? styles.cardMetaDraft : ""}`}>
                      <span>{compra.itemCount} item(ns)</span>
                      <span>{fmt(compra.totalQuantidade)} un.</span>
                      <span>{fmtBRL(compra.totalValor)}</span>
                    </div>
                    <div className={`${styles.cardSubmeta} ${isDraft ? styles.cardSubmetaDraft : ""}`}>
                      <span>Recebimento: {periodoRecebimento}</span>
                      <span>Criada em {fmtDateTime(compra.confirmedAt)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {view === "editor" && (
        <>
          <div className={styles.titleInputWrap}>
            <label className={styles.titleInputLabel} htmlFor="draft-title">
              Nome da compra
            </label>
            <input
              id="draft-title"
              type="text"
              className={styles.titleInput}
              placeholder="Ex: Compra fornecedor X – maio 2026 (opcional)"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
            />
          </div>

          <div className={styles.summaryCard}>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Itens</span>
              <strong className={styles.summaryValue}>{fmt(totals.totalItens)}</strong>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Quantidade total</span>
              <strong className={styles.summaryValue}>{fmt(totals.totalQuantidade)}</strong>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Custo total</span>
              <strong className={styles.summaryValue}>{fmtBRL(totals.totalValor)}</strong>
            </div>
          </div>

          {draftItems.length === 0 ? (
            <div className={styles.emptyState}>
              <p>Adicione produtos para montar a compra em trânsito.</p>
              <button type="button" className={styles.primaryBtn} onClick={() => setModalOpen(true)}>
                Adicionar produtos
              </button>
              <button type="button" className={styles.ghostBtn} onClick={openList}>
                Voltar para lista
              </button>
            </div>
          ) : (
            <>
              <div className={styles.bulkDateBar}>
                <label className={styles.bulkDateLabel} htmlFor="bulk-date">
                  Definir data para todos os itens:
                </label>
                <div className={styles.bulkDateControls}>
                  <input
                    id="bulk-date"
                    type="date"
                    className={styles.input}
                    value={bulkDate}
                    onChange={(e) => setBulkDate(e.target.value)}
                  />
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    disabled={!bulkDate}
                    onClick={() => {
                      applyBulkDate(bulkDate);
                      setBulkDate("");
                    }}
                  >
                    Aplicar a todos
                  </button>
                </div>
              </div>
              {renderTableRows(draftItems, false)}
              {!canConfirm && (
                <div className={styles.helperText}>
                  Para confirmar, preencha a data de recebimento e a quantidade em todos os itens. Ou salve como rascunho para definir as datas depois.
                </div>
              )}
            </>
          )}
        </>
      )}

      {view === "detail" && (
        <>
          <div className={styles.detailHeader}>
            <button type="button" className={styles.secondaryBtn} onClick={openList}>
              Voltar para lista
            </button>
            <div className={styles.detailHeaderRight}>
              {selectedCompra && (
                <button
                  type="button"
                  className={
                    selectedCompra.status === "rascunho"
                      ? styles.draftBtn
                      : styles.secondaryBtn
                  }
                  onClick={() => startEdit(selectedCompra)}
                  disabled={loadingDetail}
                >
                  {selectedCompra.status === "rascunho"
                    ? "Editar rascunho"
                    : "Editar / Reabrir"}
                </button>
              )}
              <button
                type="button"
                className={styles.dangerBtn}
                onClick={() => void cancelCompra()}
                disabled={deleting || loadingDetail}
              >
                {deleting ? "Cancelando..." : "Cancelar compra"}
              </button>
              <button type="button" className={styles.primaryBtn} onClick={startNew}>
                + Nova Compra
              </button>
            </div>
          </div>

          {loadingDetail && <div className={styles.emptyState}>Carregando compra...</div>}
          {!loadingDetail && selectedCompra && (
            <>
              <div
                className={`${styles.summaryCard} ${
                  selectedCompra.status === "em_transito"
                    ? styles.summaryCardConfirmed
                    : selectedCompra.status === "rascunho"
                    ? styles.summaryCardDraft
                    : styles.summaryCardReceived
                }`}
              >
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Status</span>
                  <strong
                    className={
                      selectedCompra.status === "em_transito"
                        ? styles.summaryValueGreen
                        : selectedCompra.status === "rascunho"
                        ? styles.summaryValueDraft
                        : styles.summaryValue
                    }
                  >
                    {getStatusLabel(selectedCompra.status)}
                  </strong>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Criada em</span>
                  <strong className={styles.summaryValue}>{fmtDateTime(selectedCompra.confirmedAt)}</strong>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Itens</span>
                  <strong className={styles.summaryValue}>{fmt(selectedCompra.items.length)}</strong>
                </div>
              </div>
              <div className={styles.detailTitleBox}>
                <h2 className={styles.detailTitle}>{selectedCompra.title}</h2>
              </div>
              {renderTableRows(selectedCompra.items, true, selectedCompra.createdAt)}
            </>
          )}
        </>
      )}

      <ComprasTransitoPickerModal
        companyKey={companyKey}
        open={modalOpen}
        draftItems={draftItems}
        onClose={() => setModalOpen(false)}
        onApply={(items) => {
          setDraftItems(items);
          setModalOpen(false);
        }}
      />
    </div>
  );
}
