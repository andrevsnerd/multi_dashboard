"use client";

import { useEffect } from "react";

import styles from "./ControleTransferenciasTable.module.css";

export interface TransferenciaConfirmModalProps {
  open: boolean;
  produto: string;
  descricao: string;
  cor: string;
  codigoBarra?: string;
  origemLabel: string;
  destinoLabel: string;
  quantidade: number;
  submitting: boolean;
  error: string | null;
  success: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function TransferenciaConfirmModal({
  open,
  produto,
  descricao,
  cor,
  codigoBarra,
  origemLabel,
  destinoLabel,
  quantidade,
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

          <div className={styles.modalRow}>
            <span className={styles.modalRowLabel}>Código</span>
            <span className={styles.modalRowValue}>{produto}</span>
          </div>
          <div className={styles.modalRow}>
            <span className={styles.modalRowLabel}>Descrição</span>
            <span className={styles.modalRowValue}>{descricao}</span>
          </div>
          <div className={styles.modalRow}>
            <span className={styles.modalRowLabel}>Cor</span>
            <span className={styles.modalRowValue}>{cor}</span>
          </div>
          {codigoBarra ? (
            <div className={styles.modalRow}>
              <span className={styles.modalRowLabel}>Cód. barras</span>
              <span className={styles.modalRowValue}>{codigoBarra}</span>
            </div>
          ) : null}

          <div className={styles.modalQuantidade}>
            <span className={styles.modalQuantidadeNumber}>{quantidade}</span>
            <span className={styles.modalQuantidadeLabel}>
              {quantidade === 1 ? "unidade" : "unidades"}
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
            disabled={submitting || quantidade <= 0}
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
