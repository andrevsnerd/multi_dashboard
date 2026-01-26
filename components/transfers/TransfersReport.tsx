"use client";

import { useMemo } from "react";
import { resolveCompany, type CompanyKey } from "@/lib/config/company";
import type { StockByFilialItem } from "@/lib/repositories/stockByFilial";
import type { DateRangeValue } from "@/components/filters/DateRangeFilter";
import { calculateTransfers } from "@/components/transfers/TransfersTable";

import styles from "./TransfersReport.module.css";

interface TransfersReportProps {
  companyKey: CompanyKey;
  data: StockByFilialItem[];
  loading?: boolean;
  dateRange?: DateRangeValue;
}

export default function TransfersReport({
  companyKey,
  data,
  loading,
  dateRange,
}: TransfersReportProps) {
  const company = resolveCompany(companyKey);
  const transfersByOrigin = useMemo(
    () => calculateTransfers(data, companyKey, dateRange),
    [data, companyKey, dateRange]
  );

  // Flatten all transfers
  const allTransfers = useMemo(() => {
    return transfersByOrigin.flatMap(group => 
      group.items.map(item => ({
        ...item,
        origemGroup: group.origem,
      }))
    );
  }, [transfersByOrigin]);

  if (loading) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.loading}>Carregando dados...</div>
      </div>
    );
  }

  if (allTransfers.length === 0) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.empty}>Nenhuma transferência necessária no momento.</div>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <h2 className={styles.title}>Relatório Detalhado de Transferências</h2>
      </div>

      <div className={styles.transfersList}>
        {allTransfers.map((transfer, index) => {
          if (!transfer.motivoDetalhado) return null;

          const motivo = transfer.motivoDetalhado;

          return (
            <div key={`${transfer.produto}-${transfer.cor}-${transfer.destino}-${index}`} className={styles.transferCard}>
              {/* Header compacto com produto e transferência */}
              <div className={styles.cardHeader}>
                <div className={styles.productInfo}>
                  <span className={styles.productCode}>{transfer.codigo}</span>
                  <span className={styles.productName}>{transfer.descricao}</span>
                  <span className={styles.productColor}>{transfer.cor}</span>
                </div>
                <div className={styles.transferFlow}>
                  <span className={styles.originBadge}>{transfer.origem}</span>
                  <span className={styles.arrow}>→</span>
                  <span className={styles.destinyBadge}>{transfer.destino}</span>
                  <span className={styles.quantityBadge}>{transfer.quantidade} un</span>
                </div>
              </div>

              {/* Conteúdo em layout horizontal compacto */}
              <div className={styles.cardContent}>
                {/* Linha 1: Prioridade e Origem lado a lado */}
                <div className={styles.infoRow}>
                  <div className={styles.infoItem}>
                    <div className={styles.infoLabel}>🎯 Prioridade</div>
                    <div className={styles.infoValue}>
                      <span className={styles.priorityBadge}>#{motivo.prioridadeDestino}</span>
                      <span className={styles.infoText}>{motivo.motivoPrioridadeDestino}</span>
                    </div>
                  </div>
                  <div className={styles.infoItem}>
                    <div className={styles.infoLabel}>📦 Origem</div>
                    <div className={styles.infoValue}>
                      <span className={styles.infoText}>{motivo.motivoOrigem}</span>
                    </div>
                  </div>
                </div>

                {/* Linha 2: Quantidades em formato compacto */}
                <div className={styles.quantityRow}>
                  <div className={styles.quantityItem}>
                    <span className={styles.quantityLabel}>Necessária:</span>
                    <span className={styles.quantityValue}>{motivo.quantidadeNecessaria}</span>
                  </div>
                  {motivo.quantidadeJaTransferida > 0 && (
                    <div className={styles.quantityItem}>
                      <span className={styles.quantityLabel}>Já transferido:</span>
                      <span className={styles.quantityValue}>{motivo.quantidadeJaTransferida}</span>
                    </div>
                  )}
                  <div className={styles.quantityItem}>
                    <span className={styles.quantityLabel}>Faltante:</span>
                    <span className={styles.quantityValue}>{motivo.quantidadeFaltante}</span>
                  </div>
                  <div className={styles.quantityItem}>
                    <span className={styles.quantityLabel}>A transferir:</span>
                    <span className={styles.quantityValueHighlight}>{transfer.quantidade}</span>
                  </div>
                </div>

                {/* Linha 3: Estoque antes/depois lado a lado */}
                <div className={styles.stockRow}>
                  <div className={styles.stockItem}>
                    <div className={styles.stockHeader}>Origem ({transfer.origem})</div>
                    <div className={styles.stockValues}>
                      <span className={styles.stockBefore}>{motivo.estoqueOrigemAntes}</span>
                      <span className={styles.arrow}>→</span>
                      <span className={styles.stockAfter}>{motivo.estoqueOrigemDepois}</span>
                      <span className={styles.stockChange}>
                        {motivo.estoqueOrigemDepois < motivo.estoqueOrigemAntes 
                          ? `-${motivo.estoqueOrigemAntes - motivo.estoqueOrigemDepois}` 
                          : '0'}
                      </span>
                    </div>
                  </div>
                  <div className={styles.stockItem}>
                    <div className={styles.stockHeader}>Destino ({transfer.destino})</div>
                    <div className={styles.stockValues}>
                      <span className={styles.stockBefore}>{motivo.estoqueDestinoAntes}</span>
                      <span className={styles.arrow}>→</span>
                      <span className={styles.stockAfter}>{motivo.estoqueDestinoDepois}</span>
                      <span className={styles.stockChange}>
                        {motivo.estoqueDestinoDepois > motivo.estoqueDestinoAntes 
                          ? `+${motivo.estoqueDestinoDepois - motivo.estoqueDestinoAntes}` 
                          : '0'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Motivo da quantidade */}
                <div className={styles.explanationRow}>
                  <span className={styles.explanationLabel}>💡 Motivo:</span>
                  <span className={styles.explanationText}>{motivo.motivoQuantidade}</span>
                </div>

                {/* Outras opções se houver */}
                {(motivo.outrasDestinosConsiderados.length > 0 || motivo.outrasOrigensConsideradas.length > 0) && (
                  <div className={styles.otherOptionsRow}>
                    {motivo.outrasDestinosConsiderados.length > 0 && (
                      <div className={styles.otherItem}>
                        <span className={styles.otherLabel}>Outras lojas:</span>
                        <div className={styles.otherTags}>
                          {motivo.outrasDestinosConsiderados.map((dest, i) => (
                            <span key={i} className={styles.otherTag}>{dest}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {motivo.outrasOrigensConsideradas.length > 0 && (
                      <div className={styles.otherItem}>
                        <span className={styles.otherLabel}>Outras origens:</span>
                        <div className={styles.otherTags}>
                          {motivo.outrasOrigensConsideradas.map((orig, i) => (
                            <span key={i} className={styles.otherTag}>{orig}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
