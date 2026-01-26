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
        <p className={styles.subtitle}>
          Explicação detalhada do motivo de cada transferência
        </p>
      </div>

      <div className={styles.transfersList}>
        {allTransfers.map((transfer, index) => {
          if (!transfer.motivoDetalhado) return null;

          const motivo = transfer.motivoDetalhado;

          return (
            <div key={`${transfer.produto}-${transfer.cor}-${transfer.destino}-${index}`} className={styles.transferCard}>
              <div className={styles.cardHeader}>
                <div className={styles.productInfo}>
                  <div className={styles.productCode}>{transfer.codigo}</div>
                  <div className={styles.productName}>{transfer.descricao}</div>
                  <div className={styles.productColor}>{transfer.cor}</div>
                </div>
                <div className={styles.transferArrow}>
                  <div className={styles.originBadge}>{transfer.origem}</div>
                  <div className={styles.arrow}>→</div>
                  <div className={styles.destinyBadge}>{transfer.destino}</div>
                  <div className={styles.quantityBadge}>{transfer.quantidade} unidades</div>
                </div>
              </div>

              <div className={styles.cardContent}>
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>
                    <span className={styles.icon}>🎯</span>
                    Prioridade do Destino
                  </div>
                  <div className={styles.sectionContent}>
                    <div className={styles.priorityBadge}>
                      Prioridade #{motivo.prioridadeDestino}
                    </div>
                    <p className={styles.explanation}>{motivo.motivoPrioridadeDestino}</p>
                    {motivo.outrasDestinosConsiderados.length > 0 && (
                      <div className={styles.otherOptions}>
                        <span className={styles.otherLabel}>Outras lojas que também precisam:</span>
                        <div className={styles.otherTags}>
                          {motivo.outrasDestinosConsiderados.map((dest, i) => (
                            <span key={i} className={styles.otherTag}>{dest}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className={styles.section}>
                  <div className={styles.sectionTitle}>
                    <span className={styles.icon}>📦</span>
                    Origem da Transferência
                  </div>
                  <div className={styles.sectionContent}>
                    <p className={styles.explanation}>{motivo.motivoOrigem}</p>
                    {motivo.outrasOrigensConsideradas.length > 0 && (
                      <div className={styles.otherOptions}>
                        <span className={styles.otherLabel}>Outras origens consideradas:</span>
                        <div className={styles.otherTags}>
                          {motivo.outrasOrigensConsideradas.map((orig, i) => (
                            <span key={i} className={styles.otherTag}>{orig}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className={styles.section}>
                  <div className={styles.sectionTitle}>
                    <span className={styles.icon}>🔢</span>
                    Quantidade Transferida
                  </div>
                  <div className={styles.sectionContent}>
                    <div className={styles.quantityDetails}>
                      <div className={styles.quantityRow}>
                        <span className={styles.quantityLabel}>Quantidade necessária:</span>
                        <span className={styles.quantityValue}>{motivo.quantidadeNecessaria} unidades</span>
                      </div>
                      {motivo.quantidadeJaTransferida > 0 && (
                        <div className={styles.quantityRow}>
                          <span className={styles.quantityLabel}>Já transferido anteriormente:</span>
                          <span className={styles.quantityValue}>{motivo.quantidadeJaTransferida} unidades</span>
                        </div>
                      )}
                      <div className={styles.quantityRow}>
                        <span className={styles.quantityLabel}>Quantidade faltante:</span>
                        <span className={styles.quantityValue}>{motivo.quantidadeFaltante} unidades</span>
                      </div>
                      <div className={styles.quantityRow}>
                        <span className={styles.quantityLabel}>Quantidade a transferir:</span>
                        <span className={styles.quantityValueHighlight}>{transfer.quantidade} unidades</span>
                      </div>
                    </div>
                    <p className={styles.explanation}>{motivo.motivoQuantidade}</p>
                  </div>
                </div>

                <div className={styles.section}>
                  <div className={styles.sectionTitle}>
                    <span className={styles.icon}>📊</span>
                    Estoque Antes e Depois
                  </div>
                  <div className={styles.sectionContent}>
                    <div className={styles.stockComparison}>
                      <div className={styles.stockBox}>
                        <div className={styles.stockLabel}>Origem ({transfer.origem})</div>
                        <div className={styles.stockValues}>
                          <div className={styles.stockBefore}>
                            <span className={styles.stockLabelSmall}>Antes:</span>
                            <span className={styles.stockNumber}>{motivo.estoqueOrigemAntes}</span>
                          </div>
                          <div className={styles.stockArrow}>→</div>
                          <div className={styles.stockAfter}>
                            <span className={styles.stockLabelSmall}>Depois:</span>
                            <span className={styles.stockNumber}>{motivo.estoqueOrigemDepois}</span>
                          </div>
                        </div>
                        <div className={styles.stockDifference}>
                          {motivo.estoqueOrigemDepois < motivo.estoqueOrigemAntes ? (
                            <span className={styles.stockNegative}>
                              -{motivo.estoqueOrigemAntes - motivo.estoqueOrigemDepois} unidades
                            </span>
                          ) : (
                            <span className={styles.stockNeutral}>Sem alteração</span>
                          )}
                        </div>
                      </div>

                      <div className={styles.stockBox}>
                        <div className={styles.stockLabel}>Destino ({transfer.destino})</div>
                        <div className={styles.stockValues}>
                          <div className={styles.stockBefore}>
                            <span className={styles.stockLabelSmall}>Antes:</span>
                            <span className={styles.stockNumber}>{motivo.estoqueDestinoAntes}</span>
                          </div>
                          <div className={styles.stockArrow}>→</div>
                          <div className={styles.stockAfter}>
                            <span className={styles.stockLabelSmall}>Depois:</span>
                            <span className={styles.stockNumber}>{motivo.estoqueDestinoDepois}</span>
                          </div>
                        </div>
                        <div className={styles.stockDifference}>
                          {motivo.estoqueDestinoDepois > motivo.estoqueDestinoAntes ? (
                            <span className={styles.stockPositive}>
                              +{motivo.estoqueDestinoDepois - motivo.estoqueDestinoAntes} unidades
                            </span>
                          ) : (
                            <span className={styles.stockNeutral}>Sem alteração</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
