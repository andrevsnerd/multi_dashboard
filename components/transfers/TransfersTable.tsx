"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import { resolveCompany, type CompanyKey } from "@/lib/config/company";
import type { StockByFilialItem } from "@/lib/repositories/stockByFilial";
import type { DateRangeValue } from "@/components/filters/DateRangeFilter";

import styles from "./TransfersTable.module.css";

interface TransfersTableProps {
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
  itemOriginal: StockByFilialItem; // Dados originais do produto
}

interface TransferByOrigin {
  origem: string;
  items: TransferItem[];
  totalItens: number;
  totalQuantidade: number;
}

/**
 * Formata a descrição do produto com código
 */
function formatProductDescription(descricao: string, produto: string): {
  name: string;
  code: string;
} {
  if (descricao.includes(`(${produto})`)) {
    const parts = descricao.split(`(${produto})`);
    return {
      name: parts[0].trim(),
      code: produto,
    };
  }
  return {
    name: descricao.trim() || "Sem descrição",
    code: produto,
  };
}

/**
 * Calcula a projeção de venda do mês baseado no período selecionado
 */
function calculateMonthlyProjection(
  totalVendas: number,
  dateRange?: DateRangeValue
): number {
  if (!dateRange) {
    return totalVendas;
  }

  const start = new Date(dateRange.startDate);
  const end = new Date(dateRange.endDate);
  
  const daysInPeriod = Math.max(
    1,
    Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
  );

  const vendaDiaria = totalVendas / daysInPeriod;
  return vendaDiaria * 30;
}

/**
 * Organiza as filiais baseado na configuração da empresa
 */
function organizeFiliais(
  companyKey: CompanyKey,
  items: StockByFilialItem[]
): {
  matriz: string | null;
  ecommerce: string | null;
  filiais: string[];
} {
  const company = resolveCompany(companyKey);
  if (!company) {
    return { matriz: null, ecommerce: null, filiais: [] };
  }

  let matriz: string | null = null;
  let ecommerce: string | null = null;
  if (companyKey === "nerd") {
    matriz = "NERD";
  } else if (companyKey === "scarfme") {
    matriz = "SCARF ME - MATRIZ";
    ecommerce = "SCARFME MATRIZ CMS";
  }

  const allFiliais = company.filialFilters['inventory'] ?? [];
  const ecommerceFilials = company.ecommerceFilials ?? [];
  const normalFiliais = allFiliais.filter(f => 
    !ecommerceFilials.includes(f) && f !== matriz
  );

  return {
    matriz,
    ecommerce,
    filiais: normalFiliais.sort(),
  };
}

/**
 * Calcula as transferências necessárias
 */
function calculateTransfers(
  data: StockByFilialItem[],
  companyKey: CompanyKey,
  dateRange?: DateRangeValue
): TransferByOrigin[] {
  const company = resolveCompany(companyKey);
  if (!company) {
    return [];
  }

  const { matriz, ecommerce, filiais } = organizeFiliais(companyKey, data);
  const filiaisCount = filiais.length;
  const allFiliais = [matriz, ecommerce, ...filiais].filter(Boolean) as string[];

  const transfers: TransferItem[] = [];

  // Mapa para rastrear quantidades já transferidas para cada destino (produto+cor+destino)
  const quantidadeTransferidaPorDestino = new Map<string, number>();

  data.forEach((item) => {
    const totalEstoque = item.totalEstoque;
    const totalVendas = item.totalVendas;
    const projecaoVendaMes = calculateMonthlyProjection(totalVendas, dateRange);

    // Ignorar produtos sem vendas
    if (totalVendas === 0 || projecaoVendaMes === 0) {
      return;
    }

    // Verificar se há estoque suficiente para transferir
    // Estoque total >= (número de filiais sem matriz) × 2 E alguma filial com vendas tem estoque < 1
    const filiaisComVendas = item.filiais.filter(f => f.sales > 0);
    const algumaFilialComEstoqueBaixo = filiaisComVendas.some(f => f.stock < 1);

    if (!(totalEstoque >= (filiaisCount * 2) && algumaFilialComEstoqueBaixo)) {
      return;
    }

    const productInfo = formatProductDescription(item.descricao, item.produto);

    // Identificar filiais que precisam de estoque (estoque baixo/zero com vendas)
    const filiaisQuePrecisam = filiaisComVendas
      .filter(f => f.stock < 1)
      .map(f => ({
        filial: f.filial,
        stock: f.stock,
        sales: f.sales,
        salesLast30Days: f.salesLast30Days,
        hasEntry: f.hasEntry,
      }))
      .sort((a, b) => {
        // Priorizar: quem vendeu mais, depois quem tem menos estoque
        if (b.sales !== a.sales) {
          return b.sales - a.sales;
        }
        return a.stock - b.stock;
      });

    if (filiaisQuePrecisam.length === 0) {
      return;
    }

    // Identificar filiais com estoque disponível (estoque >= 2)
    const filiaisComEstoque = item.filiais
      .filter(f => f.stock >= 2)
      .map(f => ({
        filial: f.filial,
        stock: f.stock,
        sales: f.sales,
        salesLast30Days: f.salesLast30Days,
        hasEntry: f.hasEntry,
        // Identificar se é loja com produtos parados (laranja)
        isParada: f.stock > 1 && f.sales === 0 && f.salesLast30Days === 0,
        // Identificar se é e-commerce parado
        isEcommerceParado: f.filial === ecommerce && f.stock > 1 && f.sales === 0 && f.salesLast30Days === 0,
      }))
      .sort((a, b) => {
        // Priorizar: matriz sempre primeiro
        if (a.filial === matriz) return -1;
        if (b.filial === matriz) return 1;
        
        // Depois: lojas paradas e e-commerce parado têm mesma prioridade
        const aIsParadoOuEcommerceParado = a.isParada || a.isEcommerceParado;
        const bIsParadoOuEcommerceParado = b.isParada || b.isEcommerceParado;
        
        if (aIsParadoOuEcommerceParado !== bIsParadoOuEcommerceParado) {
          return aIsParadoOuEcommerceParado ? -1 : 1;
        }
        
        // Se ambos são parados/e-commerce parado, ordenar por maior estoque primeiro
        if (aIsParadoOuEcommerceParado && bIsParadoOuEcommerceParado) {
          return b.stock - a.stock;
        }
        
        // Para outras filiais, ordenar por maior estoque
        return b.stock - a.stock;
      });

    if (filiaisComEstoque.length === 0) {
      return;
    }

    // Para cada filial que precisa, tentar encontrar uma origem
    // Usar um mapa para rastrear estoque disponível por origem
    const estoqueDisponivelPorOrigem = new Map<string, number>();
    
    filiaisComEstoque.forEach(f => {
      estoqueDisponivelPorOrigem.set(f.filial, f.stock);
    });

    const daysInPeriod = dateRange ? 
      Math.max(1, Math.ceil((new Date(dateRange.endDate).getTime() - new Date(dateRange.startDate).getTime()) / (1000 * 60 * 60 * 24))) : 30;

    filiaisQuePrecisam.forEach((filialDestino) => {
      // Chave única para rastrear transferências já feitas para este destino
      const destinoKey = `${item.produto}|${item.cor}|${filialDestino.filial}`;
      const quantidadeJaTransferida = quantidadeTransferidaPorDestino.get(destinoKey) || 0;

      // Calcular necessidade da filial destino
      const vendaDiariaDestino = filialDestino.sales / daysInPeriod;
      const estoqueMinimoDestino = Math.max(15, vendaDiariaDestino * 15);
      const estoqueIdealDestino = Math.max(20, vendaDiariaDestino * 25);
      const estoqueAtualDestino = filialDestino.stock;
      
      // Calcular quantidade total necessária
      const quantidadeTotalNecessaria = Math.max(estoqueMinimoDestino - estoqueAtualDestino, 2);
      
      // Verificar se já foi transferida quantidade suficiente
      // Se já foi transferido pelo menos o mínimo necessário, pular esta loja
      if (quantidadeJaTransferida >= quantidadeTotalNecessaria) {
        return;
      }

      // Calcular quanto ainda falta transferir
      const quantidadeFaltante = quantidadeTotalNecessaria - quantidadeJaTransferida;
      
      // Se já foi transferida pelo menos 2 unidades, só transferir mais se realmente necessário
      // (ex: só foi transferida 1 unidade e precisa de pelo menos 2)
      if (quantidadeJaTransferida >= 2 && quantidadeFaltante < 2) {
        return;
      }

      // Encontrar a melhor origem disponível
      // Prioridade: 1) Matriz, 2) Lojas paradas/E-commerce parado, 3) Outras filiais
      let melhorOrigem: typeof filiaisComEstoque[0] | null = null;
      
      // 1. Primeiro, verificar se matriz tem estoque disponível
      const matrizDisponivel = filiaisComEstoque.find(f => {
        const disponivel = estoqueDisponivelPorOrigem.get(f.filial) || 0;
        return f.filial === matriz && disponivel >= 2;
      });
      
      if (matrizDisponivel) {
        melhorOrigem = matrizDisponivel;
      } else {
        // 2. Depois, tentar encontrar lojas paradas ou e-commerce parado
        const lojasParadasOuEcommerceParado = filiaisComEstoque.filter(f => {
          const disponivel = estoqueDisponivelPorOrigem.get(f.filial) || 0;
          return (f.isParada || f.isEcommerceParado) && disponivel >= 2;
        });
        
        if (lojasParadasOuEcommerceParado.length > 0) {
          // Ordenar por maior estoque primeiro (mesma lógica das lojas paradas)
          lojasParadasOuEcommerceParado.sort((a, b) => {
            const estoqueA = estoqueDisponivelPorOrigem.get(a.filial) || 0;
            const estoqueB = estoqueDisponivelPorOrigem.get(b.filial) || 0;
            return estoqueB - estoqueA;
          });
          melhorOrigem = lojasParadasOuEcommerceParado[0];
        } else {
          // 3. Por último, usar outras filiais com estoque
          melhorOrigem = filiaisComEstoque.find(f => {
            const disponivel = estoqueDisponivelPorOrigem.get(f.filial) || 0;
            return disponivel >= 2;
          }) || null;
        }
      }

      if (!melhorOrigem) {
        return;
      }

      const estoqueOrigem = estoqueDisponivelPorOrigem.get(melhorOrigem.filial) || 0;

      // Calcular quantidade a transferir (só o que falta, não mais que o necessário)
      let quantidade = Math.min(quantidadeFaltante, estoqueOrigem - 1);

      // Se a origem também tem vendas, não zerar completamente
      // Deixar pelo menos estoque mínimo para a origem
      if (melhorOrigem.sales > 0) {
        const vendaDiariaOrigem = melhorOrigem.sales / daysInPeriod;
        const estoqueMinimoOrigem = Math.max(15, vendaDiariaOrigem * 15);
        const estoqueAtualOrigem = melhorOrigem.stock;
        const estoqueAposTransferencia = estoqueAtualOrigem - quantidade;
        
        // Se após transferência ficar abaixo do mínimo, ajustar quantidade
        if (estoqueAposTransferencia < estoqueMinimoOrigem) {
          quantidade = Math.max(1, estoqueAtualOrigem - estoqueMinimoOrigem);
        }
      } else {
        // Se é loja parada ou e-commerce parado, só transferir o necessário
        // Só transferir tudo se a loja parada/e-commerce parado tiver poucas unidades (<= 5) e for obrigatório
        const isLojaparadaOuEcommerceParado = melhorOrigem.isParada || melhorOrigem.isEcommerceParado;
        const isLojaparadaComPoucasUnidades = isLojaparadaOuEcommerceParado && estoqueOrigem <= 5;
        
        if (!isLojaparadaComPoucasUnidades) {
          // Limitar a quantidade ao necessário, não transferir tudo
          quantidade = Math.min(quantidade, quantidadeFaltante);
        }
        // Se for loja parada/e-commerce parado com poucas unidades, pode transferir tudo se necessário
      }

      if (quantidade > 0) {
        const origemDisplayName = company.filialDisplayNames?.[melhorOrigem.filial] || melhorOrigem.filial;
        const destinoDisplayName = company.filialDisplayNames?.[filialDestino.filial] || filialDestino.filial;

        transfers.push({
          produto: item.produto,
          descricao: productInfo.name,
          codigo: productInfo.code,
          cor: item.cor,
          origem: origemDisplayName,
          destino: destinoDisplayName,
          quantidade: Math.ceil(quantidade),
          itemOriginal: item, // Guardar dados originais
        });

        // Atualizar estoque disponível na origem
        const novoEstoque = estoqueOrigem - quantidade;
        estoqueDisponivelPorOrigem.set(melhorOrigem.filial, novoEstoque);

        // Registrar quantidade transferida para este destino
        quantidadeTransferidaPorDestino.set(destinoKey, quantidadeJaTransferida + quantidade);
      }
    });
  });

  // Agrupar por origem
  const transfersByOrigin = new Map<string, TransferItem[]>();
  transfers.forEach(transfer => {
    if (!transfersByOrigin.has(transfer.origem)) {
      transfersByOrigin.set(transfer.origem, []);
    }
    transfersByOrigin.get(transfer.origem)!.push(transfer);
  });

  // Converter para array e ordenar
  const result: TransferByOrigin[] = Array.from(transfersByOrigin.entries())
    .map(([origem, items]) => {
      const totalQuantidade = items.reduce((sum, item) => sum + item.quantidade, 0);
      return {
        origem,
        items,
        totalItens: items.length,
        totalQuantidade,
      };
    })
    .sort((a, b) => {
      // Ordenar por nome da origem
      return a.origem.localeCompare(b.origem);
    });

  return result;
}

export default function TransfersTable({
  companyKey,
  data,
  loading,
  dateRange,
}: TransfersTableProps) {
  const company = resolveCompany(companyKey);
  const transfersByOrigin = useMemo(
    () => calculateTransfers(data, companyKey, dateRange),
    [data, companyKey, dateRange]
  );

  const [hoveredItem, setHoveredItem] = useState<TransferItem | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const tooltipRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Limpar timeout ao desmontar
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  if (loading) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.loading}>Carregando dados...</div>
      </div>
    );
  }

  if (transfersByOrigin.length === 0) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.empty}>Nenhuma transferência necessária no momento.</div>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      {transfersByOrigin.map((group) => (
        <div key={group.origem} className={styles.transferGroup}>
          <div className={styles.header}>
            <div className={styles.originInfo}>
              <div className={styles.originIcon}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M3 21H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M5 21V7L13 2L21 7V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M9 9V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M15 9V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </div>
              <div className={styles.originText}>
                <div className={styles.originName}>{group.origem}</div>
                <div className={styles.originLabel}>Filial de origem</div>
              </div>
            </div>
            <div className={styles.totalBox}>
              <div className={styles.totalLabel}>Total de itens</div>
              <div className={styles.totalValue}>{group.totalQuantidade}</div>
            </div>
          </div>

          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.produtoHeader}>Produto</th>
                <th className={styles.descricaoHeader}>Descrição</th>
                <th className={styles.corHeader}>Cor</th>
                <th className={styles.destinoHeader}>→ Transferir para</th>
                <th className={styles.quantidadeHeader}>Quantidade</th>
              </tr>
            </thead>
            <tbody>
              {group.items.map((item, index) => (
                <tr key={`${item.produto}-${item.cor}-${item.destino}-${index}`}>
                  <td className={styles.produtoCell}>
                    <div className={styles.produtoIcon}>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="2" y="2" width="12" height="12" rx="1" stroke="currentColor" strokeWidth="1.5"/>
                        <path d="M6 2V14M10 2V14M2 6H14M2 10H14" stroke="currentColor" strokeWidth="1.5"/>
                      </svg>
                    </div>
                    {item.codigo}
                  </td>
                  <td 
                    className={styles.descricaoCell}
                    onMouseMove={(e) => {
                      if (hoverTimeoutRef.current) {
                        clearTimeout(hoverTimeoutRef.current);
                      }
                      const tooltipWidth = 400;
                      const tooltipHeight = 300;
                      const offset = 15; // Distância do cursor
                      
                      // Posição baseada no cursor
                      let x = e.clientX + offset;
                      let y = e.clientY + offset;
                      
                      // Verificar se sai da tela à direita
                      if (x + tooltipWidth > window.innerWidth) {
                        x = e.clientX - tooltipWidth - offset;
                      }
                      
                      // Verificar se sai da tela embaixo
                      if (y + tooltipHeight > window.innerHeight) {
                        y = e.clientY - tooltipHeight - offset;
                      }
                      
                      // Garantir que não saia da tela à esquerda
                      if (x < 10) {
                        x = 10;
                      }
                      
                      // Garantir que não saia da tela em cima
                      if (y < 10) {
                        y = 10;
                      }
                      
                      setTooltipPosition({ x, y });
                      if (!hoveredItem || hoveredItem.produto !== item.produto || hoveredItem.cor !== item.cor) {
                        setHoveredItem(item);
                      }
                    }}
                    onMouseEnter={(e) => {
                      if (hoverTimeoutRef.current) {
                        clearTimeout(hoverTimeoutRef.current);
                      }
                      const tooltipWidth = 400;
                      const tooltipHeight = 300;
                      const offset = 15;
                      
                      let x = e.clientX + offset;
                      let y = e.clientY + offset;
                      
                      if (x + tooltipWidth > window.innerWidth) {
                        x = e.clientX - tooltipWidth - offset;
                      }
                      
                      if (y + tooltipHeight > window.innerHeight) {
                        y = e.clientY - tooltipHeight - offset;
                      }
                      
                      if (x < 10) x = 10;
                      if (y < 10) y = 10;
                      
                      setTooltipPosition({ x, y });
                      setHoveredItem(item);
                    }}
                    onMouseLeave={() => {
                      hoverTimeoutRef.current = setTimeout(() => {
                        setHoveredItem(null);
                      }, 200);
                    }}
                    style={{ cursor: 'help' }}
                  >
                    {item.descricao}
                  </td>
                  <td className={styles.corCell}>
                    <span className={styles.corBadge}>{item.cor}</span>
                  </td>
                  <td className={styles.destinoCell}>
                    <span className={styles.destinoBadge}>{item.destino}</span>
                  </td>
                  <td className={styles.quantidadeCell}>
                    <span className={styles.quantidadeBadge}>{item.quantidade}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className={styles.footer}>
            <div className={styles.footerLeft}>
              {group.totalItens} itens para transferência
            </div>
            <div className={styles.footerRight}>
              Total: <span className={styles.footerTotal}>{group.totalQuantidade}</span>
            </div>
          </div>
        </div>
      ))}
      
      {/* Tooltip com detalhes do produto */}
      {hoveredItem && (
        <div
          ref={tooltipRef}
          className={styles.tooltip}
          style={{
            left: `${tooltipPosition.x}px`,
            top: `${tooltipPosition.y}px`,
          }}
          onMouseEnter={() => {
            if (hoverTimeoutRef.current) {
              clearTimeout(hoverTimeoutRef.current);
            }
          }}
          onMouseLeave={() => {
            setHoveredItem(null);
          }}
        >
          <div className={styles.tooltipHeader}>
            <div className={styles.tooltipTitle}>{hoveredItem.descricao}</div>
            <div className={styles.tooltipSubtitle}>
              {hoveredItem.codigo} • {hoveredItem.cor}
            </div>
          </div>
          <div className={styles.tooltipContent}>
            <div className={styles.tooltipSection}>
              <div className={styles.tooltipSectionTitle}>Estoque e Vendas por Filial</div>
              {hoveredItem.itemOriginal.filiais
                .sort((a, b) => {
                  // Ordenar: matriz primeiro, depois por nome
                  const company = resolveCompany(companyKey);
                  const matriz = companyKey === "nerd" ? "NERD" : companyKey === "scarfme" ? "SCARF ME - MATRIZ" : null;
                  if (a.filial === matriz) return -1;
                  if (b.filial === matriz) return 1;
                  return a.filial.localeCompare(b.filial);
                })
                .map((filial) => {
                  const displayName = company?.filialDisplayNames?.[filial.filial] || filial.filial;
                  const isParada = filial.stock > 1 && filial.sales === 0 && filial.salesLast30Days === 0;
                  
                  // Calcular dias parado (se não teve venda no período e nos últimos 30 dias e tem estoque)
                  let diasParado: number | null = null;
                  if (filial.stock > 0 && filial.sales === 0 && filial.salesLast30Days === 0) {
                    // Se não teve venda no período nem nos últimos 30 dias, está parado há pelo menos 30 dias
                    // Se teve venda nos últimos 30 dias mas não no período, calcular baseado no período
                    const daysInPeriod = dateRange ? 
                      Math.max(1, Math.ceil((new Date(dateRange.endDate).getTime() - new Date(dateRange.startDate).getTime()) / (1000 * 60 * 60 * 24))) : 30;
                    diasParado = Math.max(30, daysInPeriod);
                  } else if (filial.stock > 0 && filial.sales === 0 && filial.salesLast30Days > 0) {
                    // Teve venda nos últimos 30 dias mas não no período atual
                    const daysInPeriod = dateRange ? 
                      Math.max(1, Math.ceil((new Date(dateRange.endDate).getTime() - new Date(dateRange.startDate).getTime()) / (1000 * 60 * 60 * 24))) : 30;
                    diasParado = daysInPeriod;
                  }
                  
                  return (
                    <div key={filial.filial} className={styles.tooltipFilialRow}>
                      <div className={styles.tooltipFilialName}>{displayName}</div>
                      <div className={styles.tooltipFilialData}>
                        <span className={styles.tooltipEstoque}>
                          Estoque: <strong>{filial.stock}</strong>
                        </span>
                        <span className={styles.tooltipVendas}>
                          Vendas: <strong>{filial.sales}</strong>
                        </span>
                        {isParada && diasParado !== null && (
                          <span className={styles.tooltipParado}>
                            Parado há: <strong>{diasParado}+ dias</strong>
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
