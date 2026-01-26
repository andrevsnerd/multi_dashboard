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
  // Informações detalhadas para o relatório
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
 * Exportada para uso no componente de relatório
 */
export function calculateTransfers(
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

    // Verificar se há necessidade de transferir
    // Se alguma filial com vendas tem estoque < 1 E há estoque disponível em outras filiais
    const filiaisComVendas = item.filiais.filter(f => f.sales > 0);
    const algumaFilialComEstoqueBaixo = filiaisComVendas.some(f => f.stock < 1);
    
    // Verificar se há estoque disponível (pelo menos 1 unidade em alguma filial)
    const temEstoqueDisponivel = item.filiais.some(f => f.stock >= 1);

    // Se não há loja precisando OU não há estoque disponível, pular
    if (!algumaFilialComEstoqueBaixo || !temEstoqueDisponivel) {
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

    // Identificar filiais com estoque disponível
    // Matriz sempre pode transferir (mesmo com 1 unidade, pois não vende)
    // Se a filial também tem vendas, precisa ter pelo menos 2 para poder transferir 1
    // Se não tem vendas (loja parada), pode transferir mesmo tendo apenas 1
    const filiaisComEstoque = item.filiais
      .filter(f => {
        // Matriz sempre pode transferir (mesmo com 1 unidade)
        if (f.filial === matriz) {
          return f.stock >= 1;
        }
        // Se tem vendas, precisa ter pelo menos 2 para transferir (deixar 1)
        if (f.sales > 0) {
          return f.stock >= 2;
        }
        // Se não tem vendas (loja parada), pode transferir mesmo tendo apenas 1
        return f.stock >= 1;
      })
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

    // Se há múltiplas lojas precisando, calcular distribuição proporcional
    // A distribuição deve considerar TODAS as lojas que vendem (incluindo origens)
    const totalVendasDestinos = filiaisQuePrecisam.reduce((sum, f) => sum + f.sales, 0);
    
    // Calcular total de vendas de TODAS as lojas (destinos + origens que vendem)
    const totalVendasTodasLojas = item.filiais
      .filter(f => f.sales > 0)
      .reduce((sum, f) => sum + f.sales, 0);
    
    const temMultiplasLojas = filiaisQuePrecisam.length > 1;
    
    // Calcular estoque total disponível (soma de todas as origens)
    let estoqueTotalDisponivel = 0;
    filiaisComEstoque.forEach(f => {
      estoqueTotalDisponivel += f.stock;
    });
    
    // Se há múltiplas lojas, usar distribuição proporcional baseada nas vendas
    // A distribuição considera TODAS as lojas que vendem (origens também participam)
    const usarDistribuicaoProporcional = temMultiplasLojas;

    filiaisQuePrecisam.forEach((filialDestino) => {
      // Chave única para rastrear transferências já feitas para este destino
      const destinoKey = `${item.produto}|${item.cor}|${filialDestino.filial}`;
      const quantidadeJaTransferida = quantidadeTransferidaPorDestino.get(destinoKey) || 0;

      // Calcular necessidade da filial destino
      let quantidadeTotalNecessaria: number;
      
      if (usarDistribuicaoProporcional) {
        // Distribuição proporcional baseada nas vendas de TODAS as lojas (incluindo origens)
        // A distribuição respeita a hierarquia: quem vende mais, recebe mais proporcionalmente
        // 
        // Primeiro, calcular quanto cada loja (incluindo origens) deveria ter proporcionalmente
        // Depois, calcular quanto esta loja destino precisa receber
        
        // Proporção desta loja destino = vendas desta loja / total de vendas de todas as lojas
        const proporcaoDestino = filialDestino.sales / totalVendasTodasLojas;
        
        // Quantidade que esta loja destino deveria ter = proporção × estoque total disponível
        const quantidadeIdealDestino = Math.floor(estoqueTotalDisponivel * proporcaoDestino);
        
        // Quantidade necessária = quantidade ideal - estoque atual
        // Garantir mínimo de 1 unidade se necessário
        quantidadeTotalNecessaria = Math.max(1, quantidadeIdealDestino - filialDestino.stock);
      } else {
        // Lógica normal: enviar pelo menos o equivalente às vendas do período
        // Estoque mínimo = vendas do período (ou mínimo de 2 unidades)
        const estoqueMinimoFinal = Math.max(2, filialDestino.sales);
        const estoqueAtualDestino = filialDestino.stock;
        quantidadeTotalNecessaria = Math.max(estoqueMinimoFinal - estoqueAtualDestino, 2);
      }
      
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
      // Matriz sempre prioridade, mesmo com apenas 1 unidade (não vende, serve só para abastecer)
      const matrizDisponivel = filiaisComEstoque.find(f => {
        const disponivel = estoqueDisponivelPorOrigem.get(f.filial) || 0;
        // Matriz pode transferir mesmo tendo apenas 1 unidade
        return f.filial === matriz && disponivel >= 1;
      });
      
      if (matrizDisponivel) {
        melhorOrigem = matrizDisponivel;
      } else {
        // 2. Depois, tentar encontrar lojas paradas ou e-commerce parado
        const lojasParadasOuEcommerceParado = filiaisComEstoque.filter(f => {
          const disponivel = estoqueDisponivelPorOrigem.get(f.filial) || 0;
          // Lojas paradas podem transferir mesmo tendo apenas 1 unidade
          return (f.isParada || f.isEcommerceParado) && disponivel >= 1;
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
            // Se também vende, precisa ter pelo menos 2, senão pode ter apenas 1
            const minimoNecessario = f.sales > 0 ? 2 : 1;
            return disponivel >= minimoNecessario;
          }) || null;
        }
      }

      if (!melhorOrigem) {
        return;
      }

      const estoqueOrigem = estoqueDisponivelPorOrigem.get(melhorOrigem.filial) || 0;

      // Calcular quantidade a transferir
      // Matriz pode transferir tudo (não vende, serve só para abastecer)
      // Se a origem também vende, deixar pelo menos 1 unidade
      // Se a origem não vende (loja parada), pode transferir tudo se necessário
      let estoqueMinimoNaOrigem = 0;
      if (melhorOrigem.filial === matriz) {
        // Matriz pode transferir tudo (não vende)
        estoqueMinimoNaOrigem = 0;
      } else if (melhorOrigem.sales > 0) {
        // Lojas que vendem deixam pelo menos 1
        estoqueMinimoNaOrigem = 1;
      } else {
        // Lojas paradas podem transferir tudo
        estoqueMinimoNaOrigem = 0;
      }
      
      let quantidade = Math.min(quantidadeFaltante, estoqueOrigem - estoqueMinimoNaOrigem);

      // Se há distribuição proporcional, não proteger tanto a origem que vende
      // A distribuição proporcional já garante justiça entre as lojas
      if (usarDistribuicaoProporcional) {
        // Na distribuição proporcional, apenas garantir que não zere completamente
        // Lojas que vendem deixam pelo menos 1 unidade
        if (melhorOrigem.sales > 0 && melhorOrigem.filial !== matriz) {
          quantidade = Math.min(quantidade, estoqueOrigem - 1);
        }
        // Matriz e lojas paradas podem transferir tudo se necessário
      } else if (melhorOrigem.sales > 0 && melhorOrigem.filial !== matriz) {
        // Se é apenas uma loja precisando e origem também vende
        // Deixar pelo menos 1 unidade na origem
        quantidade = Math.min(quantidade, estoqueOrigem - 1);
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

        // Calcular prioridade do destino (posição na lista ordenada)
        const prioridadeDestino = filiaisQuePrecisam.findIndex(f => f.filial === filialDestino.filial) + 1;
        const motivoPrioridadeDestino = prioridadeDestino === 1 
          ? `Primeira prioridade: vendeu ${filialDestino.sales} unidades (maior venda entre as lojas que precisam)`
          : `Prioridade ${prioridadeDestino}: vendeu ${filialDestino.sales} unidades`;

        // Motivo da origem
        let motivoOrigem = "";
        if (melhorOrigem.filial === matriz) {
          motivoOrigem = `Matriz sempre tem prioridade como origem (não vende, serve unicamente para abastecer lojas). ${origemDisplayName} tem ${melhorOrigem.stock} unidades disponíveis.`;
        } else if (melhorOrigem.isParada || melhorOrigem.isEcommerceParado) {
          motivoOrigem = `Lojas paradas têm prioridade. ${origemDisplayName} tem ${melhorOrigem.stock} unidades paradas (sem vendas no período nem nos últimos 30 dias)`;
        } else {
          motivoOrigem = `${origemDisplayName} foi escolhida por ter estoque disponível (${melhorOrigem.stock} unidades)`;
        }

        // Motivo da quantidade
        let motivoQuantidade = "";
        if (usarDistribuicaoProporcional) {
          const proporcao = ((filialDestino.sales / totalVendasTodasLojas) * 100).toFixed(1);
          const quantidadeIdeal = Math.floor(estoqueTotalDisponivel * (filialDestino.sales / totalVendasTodasLojas));
          motivoQuantidade = `Distribuição proporcional: ${filialDestino.sales} vendas de ${totalVendasTodasLojas} totais (${proporcao}%). Quantidade ideal: ${quantidadeIdeal} unidades. Respeita a hierarquia de vendas - lojas que vendem mais recebem mais proporcionalmente.`;
        } else if (melhorOrigem.sales > 0) {
          motivoQuantidade = `Quantidade limitada para manter estoque mínimo na origem (${melhorOrigem.sales} vendas no período). Origem ficará com ${Math.ceil(estoqueOrigem - quantidade)} unidades após transferência.`;
        } else if (melhorOrigem.isParada || melhorOrigem.isEcommerceParado) {
          if (melhorOrigem.stock <= 5) {
            motivoQuantidade = `Lojas paradas com poucas unidades (≤5) podem transferir tudo se necessário. Transferindo ${Math.ceil(quantidade)} unidades.`;
          } else {
            motivoQuantidade = `Transferindo apenas o necessário (${Math.ceil(quantidade)} unidades) para não esvaziar completamente a loja parada. Origem ficará com ${Math.ceil(estoqueOrigem - quantidade)} unidades.`;
          }
        } else {
          motivoQuantidade = `Transferindo ${Math.ceil(quantidade)} unidades (equivalente às vendas do período: ${filialDestino.sales} unidades).`;
        }

        // Outras origens consideradas
        const outrasOrigensConsideradas = filiaisComEstoque
          .filter(f => f.filial !== melhorOrigem.filial)
          .slice(0, 3)
          .map(f => company.filialDisplayNames?.[f.filial] || f.filial);

        // Outras destinos considerados
        const outrasDestinosConsiderados = filiaisQuePrecisam
          .filter(f => f.filial !== filialDestino.filial)
          .slice(0, 3)
          .map(f => company.filialDisplayNames?.[f.filial] || f.filial);

        transfers.push({
          produto: item.produto,
          descricao: productInfo.name,
          codigo: productInfo.code,
          cor: item.cor,
          origem: origemDisplayName,
          destino: destinoDisplayName,
          quantidade: Math.ceil(quantidade),
          itemOriginal: item, // Guardar dados originais
          motivoDetalhado: {
            prioridadeDestino,
            motivoPrioridadeDestino,
            motivoOrigem,
            estoqueOrigemAntes: melhorOrigem.stock,
            estoqueOrigemDepois: Math.ceil(estoqueOrigem - quantidade),
            estoqueDestinoAntes: filialDestino.stock,
            estoqueDestinoDepois: Math.ceil(filialDestino.stock + quantidade),
            quantidadeNecessaria: quantidadeTotalNecessaria,
            quantidadeFaltante,
            quantidadeJaTransferida,
            motivoQuantidade,
            outrasOrigensConsideradas,
            outrasDestinosConsiderados,
          },
        });

        // Atualizar estoque disponível na origem
        const novoEstoque = estoqueOrigem - quantidade;
        estoqueDisponivelPorOrigem.set(melhorOrigem.filial, novoEstoque);

        // Registrar quantidade transferida para este destino
        let quantidadeTotalTransferida = quantidadeJaTransferida + quantidade;
        quantidadeTransferidaPorDestino.set(destinoKey, quantidadeTotalTransferida);
        
        // Se ainda falta quantidade, tentar completar com outras origens
        // Isso permite que múltiplas origens transfiram para a mesma loja destino
        let quantidadeAindaFaltante = quantidadeTotalNecessaria - quantidadeTotalTransferida;
        
        while (quantidadeAindaFaltante > 0) {
          // Buscar outras origens disponíveis (exceto a que já foi usada)
          const outrasOrigensDisponiveis = filiaisComEstoque.filter(f => {
            const disponivel = estoqueDisponivelPorOrigem.get(f.filial) || 0;
            if (f.filial === melhorOrigem.filial) return false; // Já foi usada
            
            if (f.filial === matriz) {
              return disponivel >= 1; // Matriz pode ter apenas 1
            }
            const minimoNecessario = f.sales > 0 ? 2 : 1;
            return disponivel >= minimoNecessario;
          });
          
          if (outrasOrigensDisponiveis.length === 0) break;
          
          // Ordenar por prioridade: matriz primeiro, depois lojas paradas, depois outras
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
            estoqueMinimoOutraOrigem = 0; // Matriz pode transferir tudo
          } else if (outraOrigem.sales > 0) {
            estoqueMinimoOutraOrigem = 1; // Lojas que vendem deixam 1
          }
          
          const quantidadeCompletar = Math.min(quantidadeAindaFaltante, estoqueOutraOrigem - estoqueMinimoOutraOrigem);
          
          if (quantidadeCompletar > 0) {
            const origemDisplayNameCompletar = company.filialDisplayNames?.[outraOrigem.filial] || outraOrigem.filial;
            
            // Motivo da origem para completar
            let motivoOrigemCompletar = "";
            if (outraOrigem.filial === matriz) {
              motivoOrigemCompletar = `Matriz sempre tem prioridade como origem (não vende, serve unicamente para abastecer lojas). ${origemDisplayNameCompletar} tem ${outraOrigem.stock} unidades disponíveis.`;
            } else if (outraOrigem.isParada || outraOrigem.isEcommerceParado) {
              motivoOrigemCompletar = `Lojas paradas têm prioridade. ${origemDisplayNameCompletar} tem ${outraOrigem.stock} unidades paradas (sem vendas no período nem nos últimos 30 dias)`;
            } else {
              motivoOrigemCompletar = `${origemDisplayNameCompletar} foi escolhida para completar a transferência (${outraOrigem.stock} unidades disponíveis)`;
            }
            
            // Motivo da quantidade para completar
            let motivoQuantidadeCompletar = "";
            if (usarDistribuicaoProporcional) {
              const proporcao = ((filialDestino.sales / totalVendasTodasLojas) * 100).toFixed(1);
              motivoQuantidadeCompletar = `Distribuição proporcional: ${filialDestino.sales} vendas de ${totalVendasTodasLojas} totais (${proporcao}%). Completando transferência com ${quantidadeCompletar} unidades adicionais para atingir a quantidade proporcional.`;
            } else {
              motivoQuantidadeCompletar = `Completando transferência: ${quantidadeCompletar} unidades adicionais para atingir o necessário (${quantidadeTotalNecessaria} unidades totais).`;
            }
            
            transfers.push({
              produto: item.produto,
              descricao: productInfo.name,
              codigo: productInfo.code,
              cor: item.cor,
              origem: origemDisplayNameCompletar,
              destino: destinoDisplayName,
              quantidade: Math.ceil(quantidadeCompletar),
              itemOriginal: item,
              motivoDetalhado: {
                prioridadeDestino,
                motivoPrioridadeDestino,
                motivoOrigem: motivoOrigemCompletar,
                estoqueOrigemAntes: outraOrigem.stock,
                estoqueOrigemDepois: Math.ceil(estoqueOutraOrigem - quantidadeCompletar),
                estoqueDestinoAntes: filialDestino.stock + quantidadeTotalTransferida,
                estoqueDestinoDepois: Math.ceil(filialDestino.stock + quantidadeTotalTransferida + quantidadeCompletar),
                quantidadeNecessaria: quantidadeTotalNecessaria,
                quantidadeFaltante: quantidadeAindaFaltante,
                quantidadeJaTransferida: quantidadeTotalTransferida,
                motivoQuantidade: motivoQuantidadeCompletar,
                outrasOrigensConsideradas: [],
                outrasDestinosConsiderados: filiaisQuePrecisam
                  .filter(f => f.filial !== filialDestino.filial)
                  .slice(0, 3)
                  .map(f => company.filialDisplayNames?.[f.filial] || f.filial),
              },
            });
            
            // Atualizar estoque disponível
            const novoEstoqueOutraOrigem = estoqueOutraOrigem - quantidadeCompletar;
            estoqueDisponivelPorOrigem.set(outraOrigem.filial, novoEstoqueOutraOrigem);
            
            // Atualizar quantidade transferida
            quantidadeTotalTransferida += quantidadeCompletar;
            quantidadeTransferidaPorDestino.set(destinoKey, quantidadeTotalTransferida);
            
            // Recalcular quantidade faltante
            quantidadeAindaFaltante = quantidadeTotalNecessaria - quantidadeTotalTransferida;
            
            // Se completou, sair do loop
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
