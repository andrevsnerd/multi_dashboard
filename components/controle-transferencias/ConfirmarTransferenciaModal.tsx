"use client";

import { useState, useEffect } from "react";
import styles from "./ConfirmarTransferenciaModal.module.css";

export interface TransferItemForModal {
  produto: string;
  descricao: string;
  codigo: string;
  codigoBarra?: string;
  subgrupo?: string;
  grade?: string;
  cor: string;
  origem: string;
  destino: string;
  origemCanonico: string;
  destinoCanonico: string;
  quantidade: number;
  estoqueOrigem: number;
  /** Código da cor no sistema (para API) */
  codigoCor?: string;
}

interface ConfirmarTransferenciaModalProps {
  open: boolean;
  item: TransferItemForModal | null;
  onClose: () => void;
  onConfirm: (quantidade: number) => Promise<void>;
  codFilialOrigem: string | null;
  codFilialDestino: string | null;
  /** Tipo de romaneio definido para o usuário */
  tipoRomaneio?: string;
  /** Responsável definido para o usuário */
  responsavel?: string;
}

export default function ConfirmarTransferenciaModal({
  open,
  item,
  onClose,
  onConfirm,
  codFilialOrigem,
  codFilialDestino,
  tipoRomaneio,
  responsavel,
}: ConfirmarTransferenciaModalProps) {
  const [quantidade, setQuantidade] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && item) {
      setQuantidade(item.quantidade);
      setError(null);
    }
  }, [open, item]);

  if (!open) return null;

  const handleConfirm = async () => {
    if (!item || !codFilialOrigem || !codFilialDestino) {
      setError("Dados incompletos para transferência.");
      return;
    }
    if (quantidade < 1) {
      setError("A quantidade deve ser pelo menos 1.");
      return;
    }
    if (quantidade > item.estoqueOrigem) {
      setError(`A quantidade não pode ser maior que o estoque disponível (${item.estoqueOrigem}).`);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onConfirm(quantidade);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao executar transferência.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  };

  if (!item) return null;

  return (
    <div
      className={styles.confirmarTransferenciaOverlay}
      onClick={onClose}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirmar-transferencia-title"
    >
      <div
        className={styles.confirmarTransferenciaModal}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.confirmarTransferenciaHeader}>
          <div className={styles.confirmarTransferenciaTitleRow}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={styles.confirmarTransferenciaBoxIcon}>
              <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2"/>
              <path d="M12 8V16M8 12H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <h2 id="confirmar-transferencia-title">Confirmar Transferência</h2>
          </div>
          <button
            type="button"
            className={styles.confirmarTransferenciaClose}
            onClick={onClose}
            aria-label="Fechar"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className={styles.confirmarTransferenciaContent}>
          {/* Origem e Destino */}
          <div className={styles.confirmarTransferenciaOrigemDestino}>
            <div className={`${styles.confirmarTransferenciaFilial} ${styles.origem}`}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className={`${styles.confirmarTransferenciaHouseIcon} ${styles.origemIcon}`}>
                <path d="M3 21H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <path d="M5 21V7L13 2L21 7V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M9 9V21M15 9V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              <span className={styles.confirmarTransferenciaFilialLabel}>Origem</span>
              <span className={`${styles.confirmarTransferenciaFilialBadge} ${styles.origemBadge}`}>{item.origem}</span>
              <span className={styles.confirmarTransferenciaEstoqueOrigem}>Estoque disponível: <strong>{item.estoqueOrigem}</strong></span>
            </div>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className={styles.confirmarTransferenciaArrow}>
              <path d="M5 12H19M19 12L12 5M19 12L12 19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <div className={`${styles.confirmarTransferenciaFilial} ${styles.destino}`}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className={`${styles.confirmarTransferenciaHouseIcon} ${styles.destinoIcon}`}>
                <path d="M3 21H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <path d="M5 21V7L13 2L21 7V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M9 9V21M15 9V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              <span className={styles.confirmarTransferenciaFilialLabel}>Destino</span>
              <span className={`${styles.confirmarTransferenciaFilialBadge} ${styles.destinoBadge}`}>{item.destino}</span>
            </div>
          </div>

          {/* Detalhes do produto */}
          <div className={styles.confirmarTransferenciaProdutoCard}>
            <div className={styles.confirmarTransferenciaProdutoHeader}>
              <span className={styles.confirmarTransferenciaProdutoIcon}>#</span>
              <div>
                <div className={styles.confirmarTransferenciaProdutoCodigo}>{item.codigo}</div>
                <div className={styles.confirmarTransferenciaProdutoDescricao}>{item.descricao}</div>
              </div>
            </div>
            <div className={styles.confirmarTransferenciaProdutoFields}>
              <div className={styles.confirmarTransferenciaProdutoField}>
                <span className={styles.confirmarTransferenciaFieldLabel}>Código de Barras</span>
                <span className={styles.confirmarTransferenciaFieldValue}>{item.codigoBarra || "-"}</span>
              </div>
              <div className={styles.confirmarTransferenciaProdutoField}>
                <span className={styles.confirmarTransferenciaFieldLabel}>Cor</span>
                <span className={styles.confirmarTransferenciaFieldValue}>{item.cor}</span>
              </div>
              <div className={styles.confirmarTransferenciaProdutoField}>
                <span className={styles.confirmarTransferenciaFieldLabel}>Grade</span>
                <span className={styles.confirmarTransferenciaFieldValue}>{item.grade || "-"}</span>
              </div>
            </div>
          </div>

          {/* Tipo de romaneio e responsável (definidos para o usuário) */}
          {(tipoRomaneio || responsavel) && (
            <div className={styles.confirmarTransferenciaInfoCard}>
              {tipoRomaneio && (
                <div className={styles.confirmarTransferenciaInfoField}>
                  <span className={styles.confirmarTransferenciaFieldLabel}>Tipo de romaneio</span>
                  <span className={styles.confirmarTransferenciaFieldValue}>{tipoRomaneio}</span>
                </div>
              )}
              {responsavel && (
                <div className={styles.confirmarTransferenciaInfoField}>
                  <span className={styles.confirmarTransferenciaFieldLabel}>Responsável</span>
                  <span className={styles.confirmarTransferenciaFieldValue}>{responsavel}</span>
                </div>
              )}
            </div>
          )}

          {/* Quantidade */}
          <div className={styles.confirmarTransferenciaQuantidadeWrap}>
            <label htmlFor="quantidade-transferir" className={styles.confirmarTransferenciaQuantidadeLabel}>
              Quantidade a transferir
            </label>
            <input
              id="quantidade-transferir"
              type="number"
              min={1}
              max={item.estoqueOrigem}
              value={quantidade}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                setQuantidade(isNaN(v) ? 0 : Math.max(0, v));
              }}
              className={styles.confirmarTransferenciaQuantidadeInput}
            />
          </div>

          {error && (
            <div className={styles.confirmarTransferenciaError}>{error}</div>
          )}
        </div>

        <div className={styles.confirmarTransferenciaFooter}>
          {(!codFilialOrigem || !codFilialDestino) && (
            <span className={styles.confirmarTransferenciaFooterHint}>
              Filiais não mapeadas. Verifique a conexão com o banco.
            </span>
          )}
          <button
            type="button"
            className={styles.confirmarTransferenciaCancel}
            onClick={onClose}
            disabled={submitting}
          >
            Cancelar
          </button>
          <button
            type="button"
            className={styles.confirmarTransferenciaConfirm}
            onClick={handleConfirm}
            disabled={submitting || !codFilialOrigem || !codFilialDestino}
            title={!codFilialOrigem || !codFilialDestino ? "Filiais de origem ou destino não encontradas no sistema" : undefined}
          >
            {submitting ? "Processando..." : "Confirmar Transferência"}
          </button>
        </div>
      </div>
    </div>
  );
}
