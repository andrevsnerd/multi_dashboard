"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import { resolveCompany, type CompanyKey } from "@/lib/config/company";
import type { ProdutoTransferencia } from "@/lib/repositories/controleTransferencias";
import type { DateRangeValue } from "@/components/filters/DateRangeFilter";

import styles from "./ControleTransferenciasTable.module.css";

interface TransferByOrigin {
  origem: string;
  items: TransferItem[];
  totalItens: number;
  totalQuantidade: number;
}

interface ControleTransferenciasTableProps {
  companyKey: CompanyKey;
  data: ProdutoTransferencia[];
  loading?: boolean;
  dateRange?: DateRangeValue;
  selectedFilial?: string | null;
}

interface TransferItem {
  produto: string;
  descricao: string;
  codigo: string;
  cor: string;
  origem: string;
  destino: string;
  quantidade: number;
  itemOriginal: ProdutoTransferencia;
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
  items: ProdutoTransferencia[]
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
 * Mesma lógica da versão antiga, mas otimizada
 */
export function calculateTransfers(
  data: ProdutoTransferencia[],
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

    // FILTRO 1: Produto deve ter vendas
    // Se totalVendas === 0 OU projecaoVendaMes === 0 → Ignora o produto
    if (totalVendas === 0 || projecaoVendaMes === 0) {
      return;
    }

    // FILTRO 2: Condição básica de transferência
    // Se alguma filial com vendas tem estoque < 1
    // E há estoque disponível em outras filiais (≥ 1 unidade)
    // → Produto pode ser transferido
    const filiaisComVendas = item.filiais.filter(f => f.sales > 0);
    const algumaFilialComEstoqueBaixo = filiaisComVendas.some(f => f.stock < 1);
    const temEstoqueDisponivel = item.filiais.some(f => f.stock >= 1);

    if (!algumaFilialComEstoqueBaixo || !temEstoqueDisponivel) {
      return;
    }

    const productInfo = formatProductDescription(item.descricao, item.produto);

    // Identificar filiais que precisam de estoque
    // Critérios: Tem vendas no período (sales > 0) E Estoque < 1 (zero ou negativo)
    // Ordenação de Prioridade:
    // 1. Quem vendeu mais primeiro
    // 2. Em caso de empate, quem tem menos estoque primeiro
    const filiaisQuePrecisam = filiaisComVendas
      .filter(f => f.stock < 1)
      .map(f => ({
        filial: f.filial,
        stock: f.stock,
        sales: f.sales,
        salesLast30Days: f.salesLast30Days,
      }))
      .sort((a, b) => {
        // Priorizar: quem vendeu mais primeiro
        if (b.sales !== a.sales) {
          return b.sales - a.sales;
        }
        // Em caso de empate, quem tem menos estoque primeiro
        return a.stock - b.stock;
      });

    if (filiaisQuePrecisam.length === 0) {
      return;
    }

    // Identificar filiais com estoque disponível
    // Critérios:
    // - Se a filial também vende: Estoque ≥ 2 (pode transferir pelo menos 1, deixando 1 na origem)
    // - Se a filial não vende (loja parada): Estoque ≥ 1 (pode transferir mesmo tendo apenas 1)
    // - Matriz: sempre pode transferir (mesmo com 1 unidade, pois não vende)
    const filiaisComEstoque = item.filiais
      .filter(f => {
        // Matriz sempre pode transferir (mesmo com 1 unidade)
        if (f.filial === matriz) {
          return f.stock >= 1;
        }
        // Se a filial também vende: precisa ter pelo menos 2 para transferir (deixar 1)
        if (f.sales > 0) {
          return f.stock >= 2;
        }
        // Se não tem vendas (loja parada): pode transferir mesmo tendo apenas 1
        return f.stock >= 1;
      })
      .map(f => ({
        filial: f.filial,
        stock: f.stock,
        sales: f.sales,
        salesLast30Days: f.salesLast30Days,
        // Identificação de Lojas Paradas: estoque > 1 E vendas no período === 0 E vendas últimos 30 dias === 0
        isParada: f.stock > 1 && f.sales === 0 && f.salesLast30Days === 0,
        // Identificação de E-commerce Parado
        isEcommerceParado: f.filial === ecommerce && f.stock > 1 && f.sales === 0 && f.salesLast30Days === 0,
      }))
      .sort((a, b) => {
        // Ordenação de Prioridade para Origem:
        // 1. Matriz (sempre primeiro)
        if (a.filial === matriz) return -1;
        if (b.filial === matriz) return 1;
        
        // 2. Lojas Paradas e E-commerce Parado (mesma prioridade)
        // Entre elas, ordenadas por maior estoque primeiro
        const aIsParadoOuEcommerceParado = a.isParada || a.isEcommerceParado;
        const bIsParadoOuEcommerceParado = b.isParada || b.isEcommerceParado;
        
        if (aIsParadoOuEcommerceParado !== bIsParadoOuEcommerceParado) {
          return aIsParadoOuEcommerceParado ? -1 : 1;
        }
        
        // Se ambos são parados/e-commerce parado, ordenar por maior estoque primeiro
        if (aIsParadoOuEcommerceParado && bIsParadoOuEcommerceParado) {
          return b.stock - a.stock;
        }
        
        // 3. Outras Filiais: ordenadas por maior estoque
        return b.stock - a.stock;
      });

    if (filiaisComEstoque.length === 0) {
      return;
    }

    // Mapa para rastrear estoque disponível por origem
    const estoqueDisponivelPorOrigem = new Map<string, number>();
    filiaisComEstoque.forEach(f => {
      estoqueDisponivelPorOrigem.set(f.filial, f.stock);
    });

    const daysInPeriod = dateRange ? 
      Math.max(1, Math.ceil((new Date(dateRange.endDate).getTime() - new Date(dateRange.startDate).getTime()) / (1000 * 60 * 60 * 24))) : 30;

    // Calcular total de vendas de TODAS as lojas que vendem (incluindo origens)
    const totalVendasTodasLojas = item.filiais
      .filter(f => f.sales > 0)
      .reduce((sum, f) => sum + f.sales, 0);
    
    const temMultiplasLojas = filiaisQuePrecisam.length > 1;
    
    // Calcular estoque total disponível (soma de todas as origens)
    let estoqueTotalDisponivel = 0;
    filiaisComEstoque.forEach(f => {
      estoqueTotalDisponivel += f.stock;
    });
    
    const usarDistribuicaoProporcional = temMultiplasLojas;

    filiaisQuePrecisam.forEach((filialDestino) => {
      const destinoKey = `${item.produto}|${item.cor}|${filialDestino.filial}`;
      const quantidadeJaTransferida = quantidadeTransferidaPorDestino.get(destinoKey) || 0;

      let quantidadeTotalNecessaria: number;
      
      if (usarDistribuicaoProporcional) {
        // Distribuição proporcional: considera TODAS as lojas que vendem (incluindo origens)
        // Proporção desta loja destino = vendas desta loja / total de vendas de todas as lojas
        const proporcaoDestino = filialDestino.sales / totalVendasTodasLojas;
        
        // Quantidade que esta loja destino deveria ter = proporção × estoque total disponível
        const quantidadeIdealDestino = Math.floor(estoqueTotalDisponivel * proporcaoDestino);
        
        // Quantidade necessária = quantidade ideal - estoque atual
        // Garantir mínimo de 1 unidade se necessário
        quantidadeTotalNecessaria = Math.max(1, quantidadeIdealDestino - filialDestino.stock);
      } else {
        // Caso 1: Uma única loja precisa
        // estoqueMinimo = max(2, vendas do período)
        // quantidadeNecessaria = max(estoqueMinimo - estoqueAtual, 2)
        const estoqueMinimo = Math.max(2, filialDestino.sales);
        const estoqueAtualDestino = filialDestino.stock;
        quantidadeTotalNecessaria = Math.max(estoqueMinimo - estoqueAtualDestino, 2);
      }
      
      if (quantidadeJaTransferida >= quantidadeTotalNecessaria) {
        return;
      }

      const quantidadeFaltante = quantidadeTotalNecessaria - quantidadeJaTransferida;
      
      if (quantidadeJaTransferida >= 2 && quantidadeFaltante < 2) {
        return;
      }

      // Seleção da Origem
      // Processo:
      // 1. Verifica Matriz (Sempre Prioridade) - Matriz pode transferir mesmo tendo apenas 1 unidade
      // 2. Se não houver matriz disponível: Busca lojas paradas ou e-commerce parado (maior estoque primeiro)
      // 3. Se não houver lojas paradas: Usa outras filiais com estoque disponível
      let melhorOrigem: typeof filiaisComEstoque[0] | null = null;
      
      // 1. Primeiro, verificar se matriz tem estoque disponível
      const matrizDisponivel = filiaisComEstoque.find(f => {
        const disponivel = estoqueDisponivelPorOrigem.get(f.filial) || 0;
        return f.filial === matriz && disponivel >= 1;
      });
      
      if (matrizDisponivel) {
        melhorOrigem = matrizDisponivel;
      } else {
        // 2. Depois, tentar encontrar lojas paradas ou e-commerce parado
        const lojasParadasOuEcommerceParado = filiaisComEstoque.filter(f => {
          const disponivel = estoqueDisponivelPorOrigem.get(f.filial) || 0;
          return (f.isParada || f.isEcommerceParado) && disponivel >= 1;
        });
        
        if (lojasParadasOuEcommerceParado.length > 0) {
          // Entre lojas paradas, escolher a com maior estoque primeiro
          lojasParadasOuEcommerceParado.sort((a, b) => {
            const estoqueA = estoqueDisponivelPorOrigem.get(a.filial) || 0;
            const estoqueB = estoqueDisponivelPorOrigem.get(b.filial) || 0;
            return estoqueB - estoqueA;
          });
          melhorOrigem = lojasParadasOuEcommerceParado[0];
        } else {
          // 3. Por último, usar outras filiais com estoque disponível
          melhorOrigem = filiaisComEstoque.find(f => {
            const disponivel = estoqueDisponivelPorOrigem.get(f.filial) || 0;
            const minimoNecessario = f.sales > 0 ? 2 : 1;
            return disponivel >= minimoNecessario;
          }) || null;
        }
      }

      if (!melhorOrigem) {
        return;
      }

      const estoqueOrigem = estoqueDisponivelPorOrigem.get(melhorOrigem.filial) || 0;

      let estoqueMinimoNaOrigem = 0;
      if (melhorOrigem.filial === matriz) {
        estoqueMinimoNaOrigem = 0;
      } else if (melhorOrigem.sales > 0) {
        estoqueMinimoNaOrigem = 1;
      } else {
        estoqueMinimoNaOrigem = 0;
      }
      
      let quantidade = Math.min(quantidadeFaltante, estoqueOrigem - estoqueMinimoNaOrigem);

      if (usarDistribuicaoProporcional) {
        // Quando há distribuição proporcional (múltiplas lojas precisando):
        // A distribuição proporcional já garante justiça
        // Lojas que vendem deixam apenas 1 unidade (mínimo)
        // Não calcula estoque mínimo baseado em vendas da origem
        if (melhorOrigem.sales > 0 && melhorOrigem.filial !== matriz) {
          // Lojas que vendem deixam pelo menos 1 unidade
          quantidade = Math.min(quantidade, estoqueOrigem - 1);
        }
        // Matriz e lojas paradas podem transferir tudo se necessário
      } else {
        // Quando há apenas uma loja precisando:
        // Lojas que vendem deixam pelo menos 1 unidade
        // Transfere o necessário para a loja destino
        if (melhorOrigem.sales > 0 && melhorOrigem.filial !== matriz) {
          quantidade = Math.min(quantidade, estoqueOrigem - 1);
        } else {
          // Se é loja parada:
          // Normalmente: transfere só o necessário
          // Exceção: se loja parada tem ≤ 5 unidades E é obrigatório enviar: pode transferir tudo
          const isLojaparadaOuEcommerceParado = melhorOrigem.isParada || melhorOrigem.isEcommerceParado;
          const isLojaparadaComPoucasUnidades = isLojaparadaOuEcommerceParado && estoqueOrigem <= 5;
          
          if (!isLojaparadaComPoucasUnidades) {
            // Limitar a quantidade ao necessário, não transferir tudo
            quantidade = Math.min(quantidade, quantidadeFaltante);
          }
          // Se for loja parada/e-commerce parado com poucas unidades, pode transferir tudo se necessário
        }
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
          itemOriginal: item,
        });

        const novoEstoque = estoqueOrigem - quantidade;
        estoqueDisponivelPorOrigem.set(melhorOrigem.filial, novoEstoque);

        let quantidadeTotalTransferida = quantidadeJaTransferida + quantidade;
        quantidadeTransferidaPorDestino.set(destinoKey, quantidadeTotalTransferida);
        
        let quantidadeAindaFaltante = quantidadeTotalNecessaria - quantidadeTotalTransferida;
        
        while (quantidadeAindaFaltante > 0) {
          const outrasOrigensDisponiveis = filiaisComEstoque.filter(f => {
            const disponivel = estoqueDisponivelPorOrigem.get(f.filial) || 0;
            if (f.filial === melhorOrigem.filial) return false;
            
            if (f.filial === matriz) {
              return disponivel >= 1;
            }
            const minimoNecessario = f.sales > 0 ? 2 : 1;
            return disponivel >= minimoNecessario;
          });
          
          if (outrasOrigensDisponiveis.length === 0) break;
          
          outrasOrigensDisponiveis.sort((a, b) => {
            if (a.filial === matriz) return -1;
            if (b.filial === matriz) return 1;
            const aIsParada = a.isParada || a.isEcommerceParado;
            const bIsParada = b.isParada || b.isEcommerceParado;
            if (aIsParada !== bIsParada) {
              return aIsParada ? -1 : 1;
            }
            const estoqueA = estoqueDisponivelPorOrigem.get(a.filial) || 0;
            const estoqueB = estoqueDisponivelPorOrigem.get(b.filial) || 0;
            return bIsParada ? estoqueB - estoqueA : estoqueB - estoqueA;
          });
          
          const outraOrigem = outrasOrigensDisponiveis[0];
          const estoqueOutraOrigem = estoqueDisponivelPorOrigem.get(outraOrigem.filial) || 0;
          
          if (estoqueOutraOrigem <= 0) break;
          
          let estoqueMinimoOutraOrigem = 0;
          if (outraOrigem.filial === matriz) {
            estoqueMinimoOutraOrigem = 0;
          } else if (outraOrigem.sales > 0) {
            estoqueMinimoOutraOrigem = 1;
          }
          
          const quantidadeCompletar = Math.min(quantidadeAindaFaltante, estoqueOutraOrigem - estoqueMinimoOutraOrigem);
          
          if (quantidadeCompletar > 0) {
            const origemDisplayNameCompletar = company.filialDisplayNames?.[outraOrigem.filial] || outraOrigem.filial;
            
            transfers.push({
              produto: item.produto,
              descricao: productInfo.name,
              codigo: productInfo.code,
              cor: item.cor,
              origem: origemDisplayNameCompletar,
              destino: destinoDisplayName,
              quantidade: Math.ceil(quantidadeCompletar),
              itemOriginal: item,
            });
            
            const novoEstoqueOutraOrigem = estoqueOutraOrigem - quantidadeCompletar;
            estoqueDisponivelPorOrigem.set(outraOrigem.filial, novoEstoqueOutraOrigem);
            
            quantidadeTotalTransferida += quantidadeCompletar;
            quantidadeTransferidaPorDestino.set(destinoKey, quantidadeTotalTransferida);
            
            quantidadeAindaFaltante = quantidadeTotalNecessaria - quantidadeTotalTransferida;
            
            if (quantidadeAindaFaltante <= 0) break;
          } else {
            break;
          }
        }
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
      return a.origem.localeCompare(b.origem);
    });

  return result;
}

interface TransferByDestinationGroup {
  destino: string;
  items: TransferItem[];
  totalQuantidade: number;
}

export default function ControleTransferenciasTable({
  companyKey,
  data,
  loading,
  dateRange,
  selectedFilial,
}: ControleTransferenciasTableProps) {
  const company = resolveCompany(companyKey);
  
  // Agrupar por origem, e dentro de cada origem, agrupar por destino
  const transfersByOriginAndDestination = useMemo(() => {
    const allTransfers = calculateTransfers(data, companyKey, dateRange);
    
    // Se uma filial foi selecionada, filtrar apenas transferências dessa filial como origem
    let filteredTransfers = allTransfers;
    if (selectedFilial) {
      const selectedFilialDisplayName = company?.filialDisplayNames?.[selectedFilial] || selectedFilial;
      filteredTransfers = allTransfers.filter(group => {
        return group.origem === selectedFilial || 
               group.origem === selectedFilialDisplayName;
      });
    }
    
    // Para cada grupo de origem, agrupar itens por destino
    return filteredTransfers.map(group => {
      // Agrupar itens por destino dentro desta origem
      const itemsByDest = new Map<string, TransferItem[]>();
      
      group.items.forEach(item => {
        if (!itemsByDest.has(item.destino)) {
          itemsByDest.set(item.destino, []);
        }
        itemsByDest.get(item.destino)!.push(item);
      });
      
      // Converter para array de grupos por destino
      const destinationGroups: TransferByDestinationGroup[] = Array.from(itemsByDest.entries())
        .map(([destino, items]) => {
          const totalQuantidade = items.reduce((sum, item) => sum + item.quantidade, 0);
          return {
            destino,
            items: items.sort((a, b) => {
              // Ordenar por produto, depois por cor
              if (a.produto !== b.produto) {
                return a.produto.localeCompare(b.produto);
              }
              return a.cor.localeCompare(b.cor);
            }),
            totalQuantidade,
          };
        })
        .sort((a, b) => {
          // Ordenar destinos alfabeticamente
          return a.destino.localeCompare(b.destino);
        });
      
      return {
        ...group,
        destinationGroups,
      };
    });
  }, [data, companyKey, dateRange, selectedFilial, company]);

  const [hoveredItem, setHoveredItem] = useState<TransferItem | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const tooltipRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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

  if (transfersByOriginAndDestination.length === 0) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.empty}>
          {selectedFilial 
            ? `Nenhuma transferência necessária para ${company?.filialDisplayNames?.[selectedFilial] || selectedFilial} no momento.`
            : "Nenhuma transferência necessária no momento."}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      {transfersByOriginAndDestination.map((group) => (
        <div key={group.origem} className={styles.transferGroup}>
          {/* Header principal: Filial de origem */}
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

          {/* Grupos por destino dentro desta origem */}
          {group.destinationGroups.map((destGroup, destIndex) => (
            <div key={`${group.origem}-${destGroup.destino}-${destIndex}`} className={styles.destinationSection}>
              {/* Header menor: Filial de destino */}
              <div className={styles.destinationHeader}>
                <div className={styles.destinationInfo}>
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className={styles.destinationIcon}>
                    <path d="M16.6667 10L10 3.33333M10 3.33333L3.33333 10M10 3.33333V16.6667" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <div className={styles.destinationText}>
                    <span className={styles.destinationLabel}>Transferir para</span>
                    <span className={styles.destinationName}>{destGroup.destino}</span>
                  </div>
                </div>
                <div className={styles.destinationTotal}>
                  {destGroup.totalQuantidade} un
                </div>
              </div>

              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.produtoHeader}>Produto</th>
                    <th className={styles.estoqueHeader}>Estoque {group.origem}</th>
                    <th className={styles.descricaoHeader}>Descrição</th>
                    <th className={styles.corHeader}>Cor</th>
                    <th className={styles.destinoHeader}>Destino</th>
                    <th className={styles.quantidadeHeader}>Quantidade</th>
                  </tr>
                </thead>
                <tbody>
                  {destGroup.items.map((item, index) => {
                    // Buscar estoque atual da filial origem
                    // item.origem pode ser o display name, então precisamos verificar tanto o nome canônico quanto o display name
                    const filialOrigemData = item.itemOriginal.filiais.find(
                      f => {
                        const filialDisplayName = company?.filialDisplayNames?.[f.filial] || f.filial;
                        // Verificar se corresponde ao nome canônico ou ao display name
                        return f.filial === item.origem || filialDisplayName === item.origem;
                      }
                    ) || item.itemOriginal.filiais.find(
                      f => {
                        // Tentar encontrar pelo nome canônico reverso (se item.origem é display name, buscar o canônico)
                        if (company?.filialDisplayNames) {
                          for (const [canonico, display] of Object.entries(company.filialDisplayNames)) {
                            if (display === item.origem && canonico === f.filial) {
                              return true;
                            }
                          }
                        }
                        return false;
                      }
                    );
                    const estoqueOrigem = filialOrigemData?.stock || 0;
                    
                    return (
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
                  <td className={styles.estoqueCell}>
                    <span className={styles.estoqueBadge}>{estoqueOrigem}</span>
                  </td>
                  <td 
                    className={styles.descricaoCell}
                    onMouseMove={(e) => {
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
                  );
                  })}
                </tbody>
              </table>
            </div>
          ))}

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
                  const matriz = companyKey === "nerd" ? "NERD" : companyKey === "scarfme" ? "SCARF ME - MATRIZ" : null;
                  if (a.filial === matriz) return -1;
                  if (b.filial === matriz) return 1;
                  return a.filial.localeCompare(b.filial);
                })
                .map((filial) => {
                  const displayName = company?.filialDisplayNames?.[filial.filial] || filial.filial;
                  const isParada = filial.stock > 1 && filial.sales === 0 && filial.salesLast30Days === 0;
                  
                  let diasParado: number | null = null;
                  if (filial.stock > 0 && filial.sales === 0 && filial.salesLast30Days === 0) {
                    const daysInPeriod = dateRange ? 
                      Math.max(1, Math.ceil((new Date(dateRange.endDate).getTime() - new Date(dateRange.startDate).getTime()) / (1000 * 60 * 60 * 24))) : 30;
                    diasParado = Math.max(30, daysInPeriod);
                  } else if (filial.stock > 0 && filial.sales === 0 && filial.salesLast30Days > 0) {
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
