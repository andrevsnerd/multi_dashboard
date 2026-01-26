"use client";

import { useMemo } from "react";
import { resolveCompany, type CompanyKey } from "@/lib/config/company";
import type { StockByFilialItem } from "@/lib/repositories/stockByFilial";
import type { DateRangeValue } from "@/components/filters/DateRangeFilter";
import { calculateTransfers } from "@/components/transfers/TransfersTable";

import styles from "./TransfersByDestination.module.css";

interface TransfersByDestinationProps {
  companyKey: CompanyKey;
  data: StockByFilialItem[];
  loading?: boolean;
  dateRange?: DateRangeValue;
}

interface TransferItem {
  produto: string;
  descricao: string;
  codigo: string;
  cor: string;
  origem: string;
  destino: string;
  quantidade: number;
  itemOriginal: StockByFilialItem;
  vendasNoDestino?: number;
  estoqueAtualNoDestino?: number;
  motivoDetalhado?: {
    prioridadeDestino: number;
    motivoPrioridadeDestino: string;
    motivoOrigem: string;
    estoqueOrigemAntes: number;
    estoqueOrigemDepois: number;
    estoqueDestinoAntes: number;
    estoqueDestinoDepois: number;
    quantidadeNecessaria: number;
    quantidadeFaltante: number;
    quantidadeJaTransferida: number;
    motivoQuantidade: string;
    outrasOrigensConsideradas: string[];
    outrasDestinosConsiderados: string[];
  };
}

interface TransferByDestination {
  destino: string;
  items: TransferItem[];
  totalItens: number;
  totalQuantidade: number;
  totalVendas: number;
  totalEstoqueAtual: number;
}

export default function TransfersByDestination({
  companyKey,
  data,
  loading,
  dateRange,
}: TransfersByDestinationProps) {
  const company = resolveCompany(companyKey);

  // Calcular transferências e agrupar por destino
  const transfersByDestination = useMemo(() => {
    const transfersByOrigin = calculateTransfers(data, companyKey, dateRange);
    
    // Flatten todas as transferências
    const allTransfers: TransferItem[] = [];
    transfersByOrigin.forEach(group => {
      allTransfers.push(...group.items);
    });

    // Agrupar por destino
    const groupedByDestination = new Map<string, TransferItem[]>();
    
    allTransfers.forEach(transfer => {
      const destino = transfer.destino;
      if (!groupedByDestination.has(destino)) {
        groupedByDestination.set(destino, []);
      }
      groupedByDestination.get(destino)!.push(transfer);
    });

    // Converter para array e calcular totais
    const result: TransferByDestination[] = [];
    
    groupedByDestination.forEach((items, destino) => {
      // Calcular totais
      const totalQuantidade = items.reduce((sum, item) => sum + item.quantidade, 0);
      
      // Calcular vendas e estoque atual do destino (soma de todos os itens)
      let totalVendas = 0;
      let totalEstoqueAtual = 0;
      
      items.forEach(item => {
        const destinoData = item.itemOriginal.filiais.find(f => f.filial === destino);
        if (destinoData) {
          totalVendas += destinoData.sales || 0;
          totalEstoqueAtual += destinoData.stock || 0;
        }
      });
      
      // Enriquecer cada item com dados específicos da loja destino
      const enrichedItems = items.map(item => {
        const destinoData = item.itemOriginal.filiais.find(f => f.filial === destino);
        return {
          ...item,
          vendasNoDestino: destinoData?.sales || 0,
          estoqueAtualNoDestino: destinoData?.stock || 0,
        };
      });
      
      result.push({
        destino,
        items: enrichedItems.sort((a, b) => {
          // Ordenar por maior venda primeiro
          if (b.vendasNoDestino !== a.vendasNoDestino) {
            return b.vendasNoDestino - a.vendasNoDestino;
          }
          // Se vendas iguais, ordenar por maior quantidade a transferir
          return b.quantidade - a.quantidade;
        }),
        totalItens: items.length,
        totalQuantidade,
        totalVendas,
        totalEstoqueAtual,
      });
    });

    // Ordenar por total de quantidade (maior primeiro)
    result.sort((a, b) => b.totalQuantidade - a.totalQuantidade);

    return result;
  }, [data, companyKey, dateRange]);

  if (loading) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.loading}>Carregando dados...</div>
      </div>
    );
  }

  if (transfersByDestination.length === 0) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.empty}>Nenhuma transferência necessária no momento.</div>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.summary}>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>Lojas que receberão:</span>
          <span className={styles.summaryValue}>{transfersByDestination.length}</span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>Total de itens:</span>
          <span className={styles.summaryValue}>
            {transfersByDestination.reduce((sum, g) => sum + g.totalItens, 0)}
          </span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>Total de unidades:</span>
          <span className={styles.summaryValue}>
            {transfersByDestination.reduce((sum, g) => sum + g.totalQuantidade, 0)}
          </span>
        </div>
      </div>

      <div className={styles.destinationsList}>
        {transfersByDestination.map((group) => {
          const destinoDisplayName = company.filialDisplayNames?.[group.destino] || group.destino;

          return (
            <div key={group.destino} className={styles.destinationGroup}>
              <div className={styles.destinationHeader}>
                <div className={styles.destinationInfo}>
                  <h3 className={styles.destinationName}>{destinoDisplayName}</h3>
                  <div className={styles.destinationStats}>
                    <span className={styles.statItem}>
                      <span className={styles.statLabel}>Vendas no período:</span>
                      <span className={styles.statValue}>{group.totalVendas}</span>
                    </span>
                    <span className={styles.statItem}>
                      <span className={styles.statLabel}>Estoque atual:</span>
                      <span className={styles.statValue}>{group.totalEstoqueAtual}</span>
                    </span>
                    <span className={styles.statItem}>
                      <span className={styles.statLabel}>Itens a receber:</span>
                      <span className={styles.statValue}>{group.totalItens}</span>
                    </span>
                    <span className={styles.statItem}>
                      <span className={styles.statLabel}>Total unidades:</span>
                      <span className={styles.statValueHighlight}>{group.totalQuantidade}</span>
                    </span>
                  </div>
                </div>
              </div>

              <div className={styles.transfersTable}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.thProduct}>Produto</th>
                      <th className={styles.thSales}>Vendas</th>
                      <th className={styles.thStock}>Estoque Atual</th>
                      <th className={styles.thOrigin}>Origem</th>
                      <th className={styles.thQuantity}>Quantidade</th>
                      <th className={styles.thAfterStock}>Estoque Após</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((transfer, index) => {
                      const origemDisplayName = company.filialDisplayNames?.[transfer.origem] || transfer.origem;
                      
                      return (
                        <tr key={`${transfer.produto}-${transfer.cor}-${transfer.origem}-${index}`}>
                          <td className={styles.tdProduct}>
                            <div className={styles.productInfo}>
                              <div className={styles.productCode}>{transfer.codigo}</div>
                              <div className={styles.productName}>{transfer.descricao}</div>
                              <div className={styles.productColor}>{transfer.cor}</div>
                            </div>
                          </td>
                          <td className={styles.tdSales}>
                            <span className={styles.salesBadge}>{transfer.vendasNoDestino || 0}</span>
                          </td>
                          <td className={styles.tdStock}>
                            <span className={styles.stockBadge}>{transfer.estoqueAtualNoDestino || 0}</span>
                          </td>
                          <td className={styles.tdOrigin}>
                            <span className={styles.originBadge}>{origemDisplayName}</span>
                          </td>
                          <td className={styles.tdQuantity}>
                            <span className={styles.quantityBadge}>{transfer.quantidade} un</span>
                          </td>
                          <td className={styles.tdAfterStock}>
                            <span className={styles.afterStockBadge}>
                              {transfer.motivoDetalhado?.estoqueDestinoDepois || (transfer.estoqueAtualNoDestino || 0) + transfer.quantidade}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
