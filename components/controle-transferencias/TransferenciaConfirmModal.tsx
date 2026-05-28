"use client";

import { useEffect } from "react";

import styles from "./ControleTransferenciasTable.module.css";

export interface TransferenciaConfirmModalItem {
  codigo: string;
  descricao: string;
  cor: string;
  codigoBarra?: string;
  quantidade: number;
}

export interface TransferenciaConfirmModalProps {
  open: boolean;
  origemLabel: string;
  destinoLabel: string;
  items: TransferenciaConfirmModalItem[];
  submitting: boolean;
  error: string | null;
  success: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function TransferenciaConfirmModal({
  open,
  origemLabel,
  destinoLabel,
  items,
  submitting,
  error,
  success,
  onConfirm,
  onCancel,
}: TransferenciaConfirmModalProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onCancel();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, submitting, onCancel]);

  if (!open) return null;

  const totalQuantidade = items.reduce((sum, it) => sum + it.quantidade, 0);
  const totalItens = items.length;

  return (
    <div
      className={styles.modalBackdrop}
      onClick={() => {
        if (!submitting) onCancel();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        <header className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Confirmar transferência</h2>
          <button
            type="button"
            className={styles.modalCloseBtn}
            onClick={onCancel}
            disabled={submitting}
            aria-label="Fechar"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>

        <div className={styles.modalBody}>
          <div className={styles.modalRoute}>
            <div className={styles.modalRouteSide}>
              <span className={styles.modalRouteLabel}>Origem</span>
              <span className={styles.modalRouteName}>{origemLabel}</span>
            </div>
            <svg
              className={styles.modalRouteArrow}
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
            <div className={styles.modalRouteSide}>
              <span className={styles.modalRouteLabel}>Destino</span>
              <span className={styles.modalRouteName}>{destinoLabel}</span>
            </div>
          </div>

          <div className={styles.modalItemsBlock}>
            <div className={styles.modalItemsHead}>
              <span>
                {totalItens === 1 ? "1 item selecionado" : `${totalItens} itens selecionados`}
              </span>
              <span className={styles.modalItemsCount}>
                Total: {totalQuantidade} {totalQuantidade === 1 ? "un." : "un."}
              </span>
            </div>
            <ul className={styles.modalItemsList}>
              {items.map((it, idx) => (
                <li key={`${it.codigo}-${it.cor}-${idx}`} className={styles.modalItemRow}>
                  <div className={styles.modalItemMain}>
                    <span className={styles.modalItemDesc} title={it.descricao}>
                      {it.descricao}
                    </span>
                    <span className={styles.modalItemMeta}>
                      <span>{it.codigo}</span>
                      <span>{it.cor}</span>
                      {it.codigoBarra ? <span>{it.codigoBarra}</span> : null}
                    </span>
                  </div>
                  <span className={styles.modalItemQty}>
                    <span className={styles.modalItemQtyNumber}>{it.quantidade}</span>
                    <span className={styles.modalItemQtyUnit}>un.</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className={styles.modalQuantidade}>
            <span className={styles.modalQuantidadeNumber}>{totalQuantidade}</span>
            <span className={styles.modalQuantidadeLabel}>
              {totalQuantidade === 1 ? "unidade total" : "unidades no total"}
            </span>
          </div>
        </div>

        {error ? <div className={styles.modalError}>{error}</div> : null}
        {success ? <div className={styles.modalSuccess}>{success}</div> : null}

        <footer className={styles.modalFooter}>
          <button
            type="button"
            className={styles.modalBtnSecondary}
            onClick={onCancel}
            disabled={submitting}
          >
            Cancelar
          </button>
          <button
            type="button"
            className={styles.modalBtnPrimary}
            onClick={onConfirm}
            disabled={submitting || totalQuantidade <= 0 || totalItens === 0}
          >
            {submitting ? (
              <>
                <span className={styles.modalSpinner} aria-hidden />
                Enviando…
              </>
            ) : (
              "Confirmar transferência"
            )}
          </button>
        </footer>
      </div>
    </div>
  );
}
