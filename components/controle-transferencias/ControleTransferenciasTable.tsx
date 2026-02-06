"use client";

import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { resolveCompany, type CompanyKey } from "@/lib/config/company";
import type { ProdutoTransferencia } from "@/lib/repositories/controleTransferencias";
import type { DateRangeValue } from "@/components/filters/DateRangeFilter";
import { useAuth } from "@/components/auth/AuthContext";
import { exportTransfersToPDF } from "./exportToPDF";
import ConfirmarTransferenciaModal, { type TransferItemForModal } from "./ConfirmarTransferenciaModal";

import styles from "./ControleTransferenciasTable.module.css";

interface FilialApi {
  codFilial: string;
  filial: string;
}

interface TransferenciaPermissao {
  username: string;
  filiaisOrigem: string[];
  filiaisDestino: string[];
  tiposRomaneioPermitidos: string[];
  responsavelPadrao?: string;
  tipoRomaneioPadrao?: string;
  responsavelFixo: boolean;
  tipoRomaneioFixo: boolean;
}

async function fetchPermissoes(username: string): Promise<TransferenciaPermissao | null> {
  try {
    const response = await fetch("/api/transferencia-produtos/permissoes", {
      headers: { "x-auth-username": username },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const json = (await response.json()) as { data: TransferenciaPermissao | null };
    return json.data ?? null;
  } catch {
    return null;
  }
}

async function fetchFiliais(): Promise<FilialApi[]> {
  const response = await fetch("/api/transferencia-produtos/filiais", { cache: "no-store" });
  if (!response.ok) return [];
  const json = (await response.json()) as { data: FilialApi[] };
  return json.data ?? [];
}

async function executarTransferencia(
  produto: string,
  corProduto: string | null,
  filialOrigem: string,
  filialDestino: string,
  qtdeSaida: number,
  qtdeEntrada: number,
  tipoRomaneio: string,
  responsavel: string,
  username?: string
): Promise<{ success: boolean; message: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (username) headers["x-auth-username"] = username;
  const response = await fetch("/api/transferencia-produtos/executar", {
    method: "POST",
    headers,
    body: JSON.stringify({
      produto,
      corProduto,
      filialOrigem,
      filialDestino,
      qtdeSaida,
      qtdeEntrada,
      tipoRomaneio,
      responsavel,
    }),
  });
  if (!response.ok) {
    const err = (await response.json()) as { error?: string };
    throw new Error(err.error ?? "Erro ao executar transferência");
  }
  return response.json();
}

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
  codigoBarra?: string;
  subgrupo?: string;
  grade?: string;
  cor: string;
  origem: string;
  destino: string;
  /** Nome canônico da filial de origem (para API) */
  origemCanonico: string;
  /** Nome canônico da filial de destino (para API) */
  destinoCanonico: string;
  quantidade: number;
  itemOriginal: ProdutoTransferencia;
}

/** Chave estável do item para marcar como "realizada" (persiste só em produção). */
function getTransferItemKey(item: TransferItem): string {
  return `${item.produto}|${item.cor}|${item.origem}|${item.destino}`;
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
    // IMPORTANTE: Considerar apenas estoque positivo para verificar disponibilidade
    const filiaisComVendas = item.filiais.filter(f => f.sales > 0);
    const algumaFilialComEstoqueBaixo = filiaisComVendas.some(f => {
      const estoquePositivo = Math.max(0, f.stock);
      return estoquePositivo < 1;
    });
    const temEstoqueDisponivel = item.filiais.some(f => {
      const estoquePositivo = Math.max(0, f.stock);
      return estoquePositivo >= 1;
    });

    if (!algumaFilialComEstoqueBaixo || !temEstoqueDisponivel) {
      return;
    }

    const productInfo = formatProductDescription(item.descricao, item.produto);

    // Estoque agregado do e-commerce (soma das filiais que compõem "E-COMMERCE" no modal)
    // Se o canal e-commerce como um todo já tem estoque >= 1, não sugerir transferência para nenhuma filial de e-commerce
    const ecommerceFilialsList = company.ecommerceFilials ?? [];
    const estoqueAgregadoEcommerce = item.filiais
      .filter(f => ecommerceFilialsList.some(ec => (ec || '').trim().toUpperCase() === (f.filial || '').trim().toUpperCase()))
      .reduce((sum, f) => sum + Math.max(0, f.stock), 0);

    // Identificar filiais que precisam de estoque (e portanto podem ser DESTINO de transferência)
    // REGRA: Transferir APENAS para filial que VENDEU e está SEM ESTOQUE (estoque < 1).
    // E-COMMERCE: usar estoque AGREGADO das filiais de e-commerce; se agregado >= 1, não sugerir transferência para nenhuma delas.
    // Ordenação de Prioridade: 1) Quem vendeu mais primeiro  2) Em caso de empate, quem tem menos estoque primeiro
    const filiaisQuePrecisam = filiaisComVendas
      .filter(f => {
        const estoquePositivo = Math.max(0, f.stock);
        const isFilialEcommerce = ecommerceFilialsList.some(ec => (ec || '').trim().toUpperCase() === (f.filial || '').trim().toUpperCase());
        if (isFilialEcommerce && estoqueAgregadoEcommerce >= 1) {
          return false; // canal e-commerce já tem estoque; não sugerir transferência para nenhuma filial e-commerce
        }
        return estoquePositivo < 1; // somente sem estoque (0 ou negativo tratado como 0)
      })
      .map(f => {
        // IMPORTANTE: Usar apenas estoque positivo para ordenação
        const estoquePositivo = Math.max(0, f.stock);
        return {
          filial: f.filial,
          stock: estoquePositivo, // Usar apenas estoque positivo
          sales: f.sales,
          salesLast30Days: f.salesLast30Days,
        };
      })
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
      .map(f => {
        // IMPORTANTE: Usar apenas estoque positivo para cálculos
        const estoquePositivo = Math.max(0, f.stock);
        
        // Verificar se está parada há pelo menos 14 dias desde a última entrada
        // Regra: estoque positivo (>= 1) sem vendas há 14+ dias desde última entrada
        let isParada = false;
        let isEcommerceParado = false;
        
        if (estoquePositivo >= 1 && f.sales === 0 && f.salesLast30Days === 0) {
          // Verificar se a última entrada foi há pelo menos 14 dias
          if (f.ultimaEntrada) {
            const hoje = new Date();
            const dataUltimaEntrada = new Date(f.ultimaEntrada);
            const diasDesdeUltimaEntrada = Math.floor((hoje.getTime() - dataUltimaEntrada.getTime()) / (1000 * 60 * 60 * 24));
            
            // Só é considerada parada se a última entrada foi há 14+ dias
            if (diasDesdeUltimaEntrada >= 14) {
              isParada = true;
              isEcommerceParado = f.filial === ecommerce;
            }
          } else {
            // Se não há data de entrada registrada, considerar parada (comportamento antigo)
            isParada = true;
            isEcommerceParado = f.filial === ecommerce;
          }
        }
        
        return {
          filial: f.filial,
          stock: estoquePositivo, // Usar apenas estoque positivo
          sales: f.sales,
          salesLast30Days: f.salesLast30Days,
          ultimaEntrada: f.ultimaEntrada,
          // Identificação de Lojas Paradas: estoque >= 1 E vendas no período === 0 E vendas últimos 30 dias === 0 E última entrada há 14+ dias
          isParada,
          // Identificação de E-commerce Parado
          isEcommerceParado,
        };
      })
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
    // IMPORTANTE: Ignorar estoque negativo - usar apenas estoque positivo
    const estoqueDisponivelPorOrigem = new Map<string, number>();
    filiaisComEstoque.forEach(f => {
      // Usar apenas estoque positivo (ignorar negativo)
      const estoquePositivo = Math.max(0, f.stock);
      estoqueDisponivelPorOrigem.set(f.filial, estoquePositivo);
    });

    const daysInPeriod = dateRange ? 
      Math.max(1, Math.ceil((new Date(dateRange.endDate).getTime() - new Date(dateRange.startDate).getTime()) / (1000 * 60 * 60 * 24))) : 30;

    // Calcular total de vendas de TODAS as lojas que vendem (incluindo origens)
    const totalVendasTodasLojas = item.filiais
      .filter(f => f.sales > 0)
      .reduce((sum, f) => sum + f.sales, 0);
    
    const temMultiplasLojas = filiaisQuePrecisam.length > 1;
    
    // Calcular estoque total disponível (soma de todas as origens)
    // IMPORTANTE: Ignorar estoque negativo - usar apenas estoque positivo
    let estoqueTotalDisponivel = 0;
    filiaisComEstoque.forEach(f => {
      const estoquePositivo = Math.max(0, f.stock);
      estoqueTotalDisponivel += estoquePositivo;
    });
    
    const usarDistribuicaoProporcional = temMultiplasLojas;

    filiaisQuePrecisam.forEach((filialDestino) => {
      // Garantia: nunca transferir para filial que já tem estoque (rechecagem a partir dos dados atuais do item)
      const dadosDestinoAtual = item.filiais.find(f => f.filial === filialDestino.filial);
      const estoqueDestinoAtual = dadosDestinoAtual ? Math.max(0, dadosDestinoAtual.stock) : 0;
      if (estoqueDestinoAtual >= 1) {
        return; // filial destino já tem estoque deste item — não sugerir transferência
      }

      const destinoKey = `${item.produto}|${item.cor}|${filialDestino.filial}`;
      const quantidadeJaTransferida = quantidadeTransferidaPorDestino.get(destinoKey) || 0;

      let quantidadeTotalNecessaria: number;
      
      // IMPORTANTE: Ignorar estoque negativo - considerar apenas estoque positivo ou zero
      // A quantidade a transferir deve ser baseada nas vendas, não no déficit de estoque
      const estoqueAtualDestinoPositivo = Math.max(0, filialDestino.stock);
      
      if (usarDistribuicaoProporcional) {
        // Distribuição proporcional: considera TODAS as lojas que vendem (incluindo origens)
        // Proporção desta loja destino = vendas desta loja / total de vendas de todas as lojas
        const proporcaoDestino = filialDestino.sales / totalVendasTodasLojas;
        
        // Quantidade que esta loja destino deveria ter = proporção × estoque total disponível
        const quantidadeIdealDestino = Math.floor(estoqueTotalDisponivel * proporcaoDestino);
        
        // Quantidade necessária = quantidade ideal - estoque atual (apenas positivo)
        // Garantir mínimo de 1 unidade se necessário
        quantidadeTotalNecessaria = Math.max(1, quantidadeIdealDestino - estoqueAtualDestinoPositivo);
      } else {
        // Caso 1: Uma única loja precisa
        // estoqueMinimo = max(2, vendas do período)
        // quantidadeNecessaria = max(estoqueMinimo - estoqueAtual, 2)
        // IMPORTANTE: Se estoque é negativo, tratar como zero
        const estoqueMinimo = Math.max(2, filialDestino.sales);
        quantidadeTotalNecessaria = Math.max(estoqueMinimo - estoqueAtualDestinoPositivo, 2);
      }
      
      // GARANTIA: A quantidade nunca deve ser maior que as vendas do destino
      // Se uma loja tem -15 de estoque e vendeu 1, deve enviar apenas 1 (não 16)
      quantidadeTotalNecessaria = Math.min(quantidadeTotalNecessaria, filialDestino.sales);
      
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
        // Lojas que vendem sempre deixam pelo menos 1 unidade
        estoqueMinimoNaOrigem = 1;
      } else if (melhorOrigem.isParada || melhorOrigem.isEcommerceParado) {
        // Lojas paradas há 14+ dias podem transferir tudo (sem estoque mínimo)
        estoqueMinimoNaOrigem = 0;
      } else {
        // Lojas que não vendem mas entraram há menos de 14 dias: deixam pelo menos 1 unidade
        // (não podem ficar com 0, pois não estão paradas há tempo suficiente)
        estoqueMinimoNaOrigem = 1;
      }
      
      let quantidade = Math.min(quantidadeFaltante, estoqueOrigem - estoqueMinimoNaOrigem);
      
      // GARANTIA: A quantidade nunca deve ser maior que as vendas do destino
      // Se uma loja tem -15 de estoque e vendeu 1, deve enviar apenas 1 (não 16)
      quantidade = Math.min(quantidade, filialDestino.sales);

      if (usarDistribuicaoProporcional) {
        // Quando há distribuição proporcional (múltiplas lojas precisando):
        // A distribuição proporcional já garante justiça
        // Lojas que vendem deixam apenas 1 unidade (mínimo)
        // Não calcula estoque mínimo baseado em vendas da origem
        if (melhorOrigem.sales > 0 && melhorOrigem.filial !== matriz) {
          // Lojas que vendem deixam pelo menos 1 unidade
          quantidade = Math.min(quantidade, estoqueOrigem - 1);
        } else if (!melhorOrigem.isParada && !melhorOrigem.isEcommerceParado && melhorOrigem.filial !== matriz) {
          // Lojas que não vendem mas não estão paradas há 14+ dias: deixam pelo menos 1 unidade
          quantidade = Math.min(quantidade, estoqueOrigem - 1);
        }
        // Matriz e lojas paradas há 14+ dias podem transferir tudo se necessário
      } else {
        // Quando há apenas uma loja precisando:
        // Lojas que vendem deixam pelo menos 1 unidade
        // Transfere o necessário para a loja destino
        if (melhorOrigem.sales > 0 && melhorOrigem.filial !== matriz) {
          quantidade = Math.min(quantidade, estoqueOrigem - 1);
        } else {
          // Se é loja parada há 14+ dias:
          // Normalmente: transfere só o necessário
          // Exceção: se loja parada tem ≤ 5 unidades E é obrigatório enviar: pode transferir tudo
          const isLojaparadaOuEcommerceParado = melhorOrigem.isParada || melhorOrigem.isEcommerceParado;
          const isLojaparadaComPoucasUnidades = isLojaparadaOuEcommerceParado && estoqueOrigem <= 5;
          
          if (isLojaparadaOuEcommerceParado) {
            if (!isLojaparadaComPoucasUnidades) {
              // Limitar a quantidade ao necessário, não transferir tudo
              quantidade = Math.min(quantidade, quantidadeFaltante);
            }
            // Se for loja parada/e-commerce parado com poucas unidades, pode transferir tudo se necessário
          } else {
            // Se não está parada há 14+ dias: deixar pelo menos 1 unidade
            quantidade = Math.min(quantidade, estoqueOrigem - 1);
          }
        }
      }

      if (quantidade > 0) {
        const origemDisplayName = company.filialDisplayNames?.[melhorOrigem.filial] || melhorOrigem.filial;
        const destinoDisplayName = company.filialDisplayNames?.[filialDestino.filial] || filialDestino.filial;

        transfers.push({
          produto: item.produto,
          descricao: productInfo.name,
          codigo: productInfo.code,
          codigoBarra: item.codigoBarra,
          subgrupo: item.subgrupo,
          grade: item.grade,
          cor: item.cor,
          origem: origemDisplayName,
          destino: destinoDisplayName,
          origemCanonico: melhorOrigem.filial,
          destinoCanonico: filialDestino.filial,
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
            // Se está parada há 14+ dias, pode transferir mesmo tendo apenas 1
            if (f.isParada || f.isEcommerceParado) {
              return disponivel >= 1;
            }
            // Se não está parada há 14+ dias, precisa ter pelo menos 2 (deixa 1)
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
            // Lojas que vendem sempre deixam pelo menos 1 unidade
            estoqueMinimoOutraOrigem = 1;
          } else if (outraOrigem.isParada || outraOrigem.isEcommerceParado) {
            // Lojas paradas há 14+ dias podem transferir tudo (sem estoque mínimo)
            estoqueMinimoOutraOrigem = 0;
          } else {
            // Lojas que não vendem mas entraram há menos de 14 dias: deixam pelo menos 1 unidade
            estoqueMinimoOutraOrigem = 1;
          }
          
          let quantidadeCompletar = Math.min(quantidadeAindaFaltante, estoqueOutraOrigem - estoqueMinimoOutraOrigem);
          
          // GARANTIA: A quantidade nunca deve ser maior que as vendas do destino
          // Se uma loja tem -15 de estoque e vendeu 1, deve enviar apenas 1 (não 16)
          const quantidadeMaximaPermitida = filialDestino.sales - quantidadeTotalTransferida;
          quantidadeCompletar = Math.min(quantidadeCompletar, Math.max(0, quantidadeMaximaPermitida));
          
          if (quantidadeCompletar > 0) {
            const origemDisplayNameCompletar = company.filialDisplayNames?.[outraOrigem.filial] || outraOrigem.filial;
            
            transfers.push({
              produto: item.produto,
              descricao: productInfo.name,
              codigo: productInfo.code,
              codigoBarra: item.codigoBarra,
              subgrupo: item.subgrupo,
              grade: item.grade,
              cor: item.cor,
              origem: origemDisplayNameCompletar,
              destino: destinoDisplayName,
              origemCanonico: outraOrigem.filial,
              destinoCanonico: filialDestino.filial,
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

  // Consolidar itens duplicados (mesmo produto+cor+origem+destino): somar quantidades
  const transferKey = (t: TransferItem) =>
    `${t.produto}|${t.cor}|${t.origem}|${t.destino}`;
  const consolidatedMap = new Map<string, TransferItem>();
  transfers.forEach((t) => {
    const k = transferKey(t);
    const existente = consolidatedMap.get(k);
    if (existente) {
      existente.quantidade += t.quantidade;
    } else {
      consolidatedMap.set(k, { ...t });
    }
  });
  const consolidatedTransfers = Array.from(consolidatedMap.values());

  // Agrupar por origem
  const transfersByOrigin = new Map<string, TransferItem[]>();
  consolidatedTransfers.forEach((transfer) => {
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
              // Ordenar por estoque da origem (maior primeiro), depois por produto, depois por cor
              const estoqueA = (() => {
                const filialOrigemData = a.itemOriginal.filiais.find(
                  f => {
                    const filialDisplayName = company?.filialDisplayNames?.[f.filial] || f.filial;
                    return f.filial === a.origem || filialDisplayName === a.origem;
                  }
                );
                return filialOrigemData?.stock || 0;
              })();
              
              const estoqueB = (() => {
                const filialOrigemData = b.itemOriginal.filiais.find(
                  f => {
                    const filialDisplayName = company?.filialDisplayNames?.[f.filial] || f.filial;
                    return f.filial === b.origem || filialDisplayName === b.origem;
                  }
                );
                return filialOrigemData?.stock || 0;
              })();
              
              // Ordenar por estoque decrescente
              if (estoqueA !== estoqueB) {
                return estoqueB - estoqueA;
              }
              
              // Se estoque igual, ordenar por produto, depois por cor
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

  const [markedKeys, setMarkedKeys] = useState<Set<string>>(new Set());
  const [savingMarked, setSavingMarked] = useState(false);

  // Quantidades reais (Neon): item_key -> quantidade
  const [quantidadesReais, setQuantidadesReais] = useState<Record<string, number>>({});
  const [savingQuantidadeReal, setSavingQuantidadeReal] = useState(false);
  const [editingQuantidadeRealKey, setEditingQuantidadeRealKey] = useState<string | null>(null);
  const [inputQuantidadeReal, setInputQuantidadeReal] = useState("");
  const [hoveredCorTooltip, setHoveredCorTooltip] = useState<{ itemKey: string; codigoCor: string } | null>(null);

  const { user, isLoading: authLoading } = useAuth();
  const [permissoes, setPermissoes] = useState<TransferenciaPermissao | null>(null);
  const [filiais, setFiliais] = useState<FilialApi[]>([]);
  const [modalTransferItem, setModalTransferItem] = useState<TransferItemForModal | null>(null);
  const [onTransferSuccess, setOnTransferSuccess] = useState<(() => void) | null>(null);

  const filialToCodMap = useMemo(() => {
    const map = new Map<string, string>();
    filiais.forEach((f) => {
      const key = (f.filial || "").trim();
      const cod = (f.codFilial || "").trim();
      if (key && cod) {
        map.set(key, cod);
        map.set(key.toUpperCase(), cod);
        map.set(cod, cod);
        const keyLower = key.toLowerCase();
        if (key !== keyLower) map.set(keyLower, cod);
      }
    });
    if (company) {
      const allCanonical = new Set<string>();
      (company.filialFilters?.inventory ?? []).forEach((x) => allCanonical.add((x || "").trim()));
      Object.entries(company.filialDisplayNames ?? {}).forEach(([k, v]) => {
        allCanonical.add((k || "").trim());
        if (v) allCanonical.add((v || "").trim());
      });
      allCanonical.forEach((canon) => {
        if (!canon) return;
        const found = filiais.find(
          (fi) => (fi.filial || "").trim().toUpperCase() === canon.toUpperCase()
        );
        if (found?.codFilial) map.set(canon, found.codFilial.trim());
      });
    }
    return map;
  }, [filiais, company]);

  // Só buscar permissões depois do auth ter carregado (evita request sem header em local)
  useEffect(() => {
    if (authLoading || !user?.username) return;
    fetchPermissoes(user.username).then(setPermissoes);
  }, [authLoading, user?.username]);

  useEffect(() => {
    fetchFiliais().then(setFiliais);
  }, []);

  const getCodFilial = useCallback(
    (canonico: string): string | null => {
      const k = canonico.trim();
      return filialToCodMap.get(k) ?? filialToCodMap.get(k.toUpperCase()) ?? null;
    },
    [filialToCodMap]
  );

  /** Verifica se um valor de permissão corresponde à filial (origem ou destino).
   * permValue = codFilial (ex: "000001") armazenado nas permissões.
   * filialCanonico = nome canônico da filial no item (ex: "NERD", "NERD CENTER NORTE").
   */
  const permissaoMatchFilial = useCallback(
    (permValue: string, filialCanonico: string): boolean => {
      const perm = (permValue || "").trim();
      const canon = (filialCanonico || "").trim();
      if (!perm || !canon) return false;
      const cod = getCodFilial(filialCanonico);
      if (cod && perm === cod) return true;
      const filialFromPerm = filiais.find((f) => (f.codFilial || "").trim() === perm);
      if (filialFromPerm) {
        const fn = (filialFromPerm.filial || "").trim();
        return fn === canon || fn.toUpperCase() === canon.toUpperCase();
      }
      return false;
    },
    [getCodFilial, filiais]
  );

  const canTransfer = useCallback(
    (item: TransferItem): boolean => {
      if (user?.role === "admin") return true;
      if (!permissoes) return false;
      if (filiais.length === 0) return false;
      const origemOk =
        permissoes.filiaisOrigem.length === 0 ||
        permissoes.filiaisOrigem.some((p) => permissaoMatchFilial(p, item.origemCanonico));
      const destinoOk =
        permissoes.filiaisDestino.length === 0 ||
        permissoes.filiaisDestino.some((p) => permissaoMatchFilial(p, item.destinoCanonico));
      return Boolean(origemOk && destinoOk);
    },
    [user?.role, permissoes, permissaoMatchFilial, filiais.length]
  );

  const filteredTransfersByOriginAndDestination = useMemo(() => {
    if (user?.role === "admin") return transfersByOriginAndDestination;
    if (!permissoes || filiais.length === 0) return [];
    return transfersByOriginAndDestination
      .filter((group) => {
        const origemCanonico = group.items[0]?.origemCanonico ?? group.origem;
        const origemOk =
          permissoes.filiaisOrigem.length === 0 ||
          permissoes.filiaisOrigem.some((p) => permissaoMatchFilial(p, origemCanonico));
        return origemOk;
      })
      .map((group) => ({
        ...group,
        destinationGroups: group.destinationGroups.filter((dg) => {
          const destinoCanonico = dg.items[0]?.destinoCanonico ?? dg.destino;
          const destinoOk =
            permissoes.filiaisDestino.length === 0 ||
            permissoes.filiaisDestino.some((p) => permissaoMatchFilial(p, destinoCanonico));
          return destinoOk;
        }),
      }))
      .filter((group) => group.destinationGroups.length > 0);
  }, [
    transfersByOriginAndDestination,
    user?.role,
    permissoes,
    permissaoMatchFilial,
    filiais.length,
  ]);

  const visibleItemKeys = useMemo(() => {
    const set = new Set<string>();
    filteredTransfersByOriginAndDestination.forEach((group) => {
      group.destinationGroups.forEach((dg) => {
        dg.items.forEach((item) => set.add(getTransferItemKey(item)));
      });
    });
    return set;
  }, [filteredTransfersByOriginAndDestination]);

  const handleConfirmTransfer = useCallback(
    async (quantidade: number) => {
      if (!modalTransferItem || !onTransferSuccess) return;
      const codOrigem = getCodFilial(modalTransferItem.origemCanonico);
      const codDestino = getCodFilial(modalTransferItem.destinoCanonico);
      if (!codOrigem || !codDestino) {
        throw new Error("Filial de origem ou destino não encontrada. Verifique se as filiais estão cadastradas.");
      }
      const tipoRomaneio = permissoes?.tipoRomaneioPadrao ?? "TRANSFERENCIA ENTRE LOJAS";
      const responsavel = permissoes?.responsavelPadrao ?? "LOGISTICA";
      await executarTransferencia(
        modalTransferItem.produto,
        modalTransferItem.codigoCor ?? null,
        codOrigem,
        codDestino,
        quantidade,
        quantidade,
        tipoRomaneio,
        responsavel,
        user?.username
      );
      onTransferSuccess();
    },
    [modalTransferItem, onTransferSuccess, getCodFilial, permissoes, user?.username]
  );

  const codFilialOrigem = modalTransferItem ? getCodFilial(modalTransferItem.origemCanonico) : null;
  const codFilialDestino = modalTransferItem ? getCodFilial(modalTransferItem.destinoCanonico) : null;

  // Carregar marcações da API (Neon + Redis com migração automática)
  // IMPORTANTE: Carregamos TODOS os dados salvos, não apenas os visíveis.
  // Isso garante que dados não sejam perdidos quando itens saem da lista.
  // Apenas mostramos como marcados os itens que estão visíveis E salvos.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/transferencias-realizadas?company=${encodeURIComponent(companyKey)}`);
        if (!active) return;
        if (!res.ok) return;
        const json = await res.json();
        const stored: string[] = Array.isArray(json.markedKeys) ? json.markedKeys : [];
        // Filtrar apenas os visíveis para exibição, mas manter todos salvos no backend
        const visible = visibleItemKeys;
        const filtered = stored.filter((k) => visible.has(k));
        setMarkedKeys(new Set(filtered));
      } catch {
        if (active) setMarkedKeys(new Set());
      }
    })();
    return () => {
      active = false;
    };
  }, [companyKey, visibleItemKeys]);

  // Carregar quantidades reais da API (Neon)
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/transferencias-quantidade-real?company=${encodeURIComponent(companyKey)}`);
        if (!active) return;
        if (!res.ok) return;
        const json = await res.json();
        const stored = json.quantidadesReais && typeof json.quantidadesReais === "object" ? json.quantidadesReais : {};
        setQuantidadesReais(stored);
      } catch {
        if (active) setQuantidadesReais({});
      }
    })();
    return () => { active = false; };
  }, [companyKey]);

  const saveQuantidadeReal = async (itemKey: string, value: number | null) => {
    setSavingQuantidadeReal(true);
    try {
      await fetch("/api/transferencias-quantidade-real", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyKey, updates: { [itemKey]: value } }),
      });
      setQuantidadesReais((prev) => {
        const next = { ...prev };
        if (value === null) delete next[itemKey];
        else next[itemKey] = value;
        return next;
      });
      setEditingQuantidadeRealKey(null);
      setInputQuantidadeReal("");
    } finally {
      setSavingQuantidadeReal(false);
    }
  };

  const toggleMarked = async (item: TransferItem) => {
    const key = getTransferItemKey(item);
    const isCurrentlyMarked = markedKeys.has(key);
    const next = new Set(markedKeys);
    
    // Atualizar estado local imediatamente
    if (isCurrentlyMarked) {
      next.delete(key);
    } else {
      next.add(key);
    }
    setMarkedKeys(next);
    
    setSavingMarked(true);
    try {
      // Usar a nova API que faz merge - adiciona/remove apenas este item específico
      // Isso preserva todos os outros dados, mesmo os que não estão visíveis
      await fetch("/api/transferencias-realizadas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          companyKey, 
          markedKeys: isCurrentlyMarked ? [] : [key], // Adicionar apenas se não estava marcado
          removeKeys: isCurrentlyMarked ? [key] : []  // Remover apenas se estava marcado
        }),
      });
    } finally {
      setSavingMarked(false);
    }
  };

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

  if (filteredTransfersByOriginAndDestination.length === 0) {
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

  // Função para exportar PDF
  const handleExportPDF = () => {
    // Preparar dados para exportação incluindo estoqueOrigem
    const dataForExport = filteredTransfersByOriginAndDestination.map((group) => ({
      origem: group.origem,
      totalQuantidade: group.totalQuantidade,
      destinationGroups: group.destinationGroups.map((destGroup) => ({
        destino: destGroup.destino,
        totalQuantidade: destGroup.totalQuantidade,
        items: destGroup.items.map((item) => {
          // Buscar estoque da origem
          const filialOrigemData = item.itemOriginal.filiais.find(
            f => {
              const filialDisplayName = company?.filialDisplayNames?.[f.filial] || f.filial;
              return f.filial === item.origem || filialDisplayName === item.origem;
            }
          );
          return {
            produto: item.produto,
            descricao: item.descricao,
            codigo: item.codigo,
            codigoBarra: item.codigoBarra,
            subgrupo: item.subgrupo,
            grade: item.grade,
            cor: item.cor,
            origem: item.origem,
            destino: item.destino,
            quantidade: item.quantidade,
            estoqueOrigem: filialOrigemData?.stock || 0,
          };
        }),
      })),
    }));

    exportTransfersToPDF(dataForExport, companyKey, dateRange, markedKeys, quantidadesReais);
  };

  return (
    <div className={styles.wrapper}>
      <ConfirmarTransferenciaModal
        open={!!modalTransferItem}
        item={modalTransferItem}
        onClose={() => {
          setModalTransferItem(null);
          setOnTransferSuccess(null);
        }}
        onConfirm={handleConfirmTransfer}
        codFilialOrigem={codFilialOrigem}
        codFilialDestino={codFilialDestino}
        tipoRomaneio={permissoes?.tipoRomaneioPadrao ?? "TRANSFERENCIA ENTRE LOJAS"}
        responsavel={permissoes?.responsavelPadrao ?? "LOGISTICA"}
      />
      {/* Botão de exportar PDF */}
      <div className={styles.exportButtonContainer}>
        <button onClick={handleExportPDF} className={styles.exportButton}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M17.5 12.5V15.8333C17.5 16.2754 17.3244 16.6993 17.0118 17.0118C16.6993 17.3244 16.2754 17.5 15.8333 17.5H4.16667C3.72464 17.5 3.30072 17.3244 2.98816 17.0118C2.67559 16.6993 2.5 16.2754 2.5 15.8333V12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M14.1667 6.66667L10 2.5L5.83333 6.66667" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M10 2.5V12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Exportar PDF
        </button>
      </div>

      {filteredTransfersByOriginAndDestination.map((group) => (
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
                    <th className={styles.realizadaHeader} title="Marcar como já realizada (pendente de atualização no sistema)">
                      Realizada
                    </th>
                    <th className={styles.produtoHeader}>Produto</th>
                    <th className={styles.codigoBarraHeader}>Código de Barras</th>
                    <th className={styles.estoqueHeader}>Estoque {group.origem}</th>
                    {companyKey === 'scarfme' && (
                      <>
                        <th className={styles.subgrupoHeader}>Subgrupo</th>
                        <th className={styles.gradeHeader}>Grade</th>
                      </>
                    )}
                    <th className={styles.descricaoHeader}>Descrição</th>
                    <th className={styles.corHeader}>Cor</th>
                    <th className={styles.destinoHeader}>Destino</th>
                    <th className={styles.quantidadeHeader}>Quantidade</th>
                    <th className={styles.quantidadeRealHeader}>Quantidade real</th>
                    <th className={styles.transferirHeader}>Ação</th>
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
                    
                    // Calcular altura do tooltip baseada no número de filiais deste item
                    const numFiliais = item.itemOriginal.filiais.length;
                    const tooltipHeightEstimate = Math.min(700, 100 + (numFiliais * 28));
                    const itemKey = getTransferItemKey(item);
                    const isMarkedRealizada = markedKeys.has(itemKey);
                    
                    return (
                <tr
                  key={`${item.produto}-${item.cor}-${item.destino}-${index}`}
                  className={isMarkedRealizada ? styles.rowRealizada : undefined}
                >
                  <td className={styles.realizadaCell}>
                    <label className={styles.realizadaCheckboxLabel} title="Já realizada, pendente de atualização no sistema">
                      <input
                        type="checkbox"
                        checked={isMarkedRealizada}
                        onChange={() => toggleMarked(item)}
                        disabled={savingMarked}
                        className={styles.realizadaCheckbox}
                      />
                      {isMarkedRealizada && (
                        <span className={styles.realizadaCheckboxText}>Realizada</span>
                      )}
                    </label>
                  </td>
                  <td className={styles.produtoCell}>
                    <div className={styles.produtoIcon}>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="2" y="2" width="12" height="12" rx="1" stroke="currentColor" strokeWidth="1.5"/>
                        <path d="M6 2V14M10 2V14M2 6H14M2 10H14" stroke="currentColor" strokeWidth="1.5"/>
                      </svg>
                    </div>
                    {item.codigo}
                  </td>
                  <td className={styles.codigoBarraCell}>
                    {item.codigoBarra ? (
                      <span className={styles.codigoBarraBadge}>{item.codigoBarra}</span>
                    ) : (
                      <span className={styles.codigoBarraEmpty}>-</span>
                    )}
                  </td>
                  <td className={styles.estoqueCell}>
                    <span className={styles.estoqueBadge}>{estoqueOrigem}</span>
                  </td>
                  {companyKey === 'scarfme' && (
                    <>
                      <td className={styles.subgrupoCell}>
                        {item.subgrupo ? (
                          <span className={styles.subgrupoBadge}>{item.subgrupo}</span>
                        ) : (
                          <span className={styles.subgrupoEmpty}>-</span>
                        )}
                      </td>
                      <td className={styles.gradeCell}>
                        {item.grade ? (
                          <span className={styles.gradeBadge}>{item.grade}</span>
                        ) : (
                          <span className={styles.gradeEmpty}>-</span>
                        )}
                      </td>
                    </>
                  )}
                  <td 
                    className={styles.descricaoCell}
                    onMouseMove={(e) => {
                      if (hoverTimeoutRef.current) {
                        clearTimeout(hoverTimeoutRef.current);
                      }
                      const tooltipWidth = 480;
                      const tooltipHeight = tooltipHeightEstimate;
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
                      const tooltipWidth = 480;
                      const tooltipHeight = tooltipHeightEstimate;
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
                    <span
                      className={styles.corBadgeWrapper}
                      onMouseEnter={() =>
                        setHoveredCorTooltip({
                          itemKey,
                          codigoCor: item.itemOriginal.codigoCor ?? "—",
                        })
                      }
                      onMouseLeave={() => setHoveredCorTooltip(null)}
                    >
                      <span className={styles.corBadge}>{item.cor}</span>
                      {hoveredCorTooltip?.itemKey === itemKey && (
                        <span className={styles.corCodigoTooltip}>
                          Código: {item.itemOriginal.codigoCor ?? "—"}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className={styles.destinoCell}>
                    <span className={styles.destinoBadge}>{item.destino}</span>
                  </td>
                  <td className={styles.quantidadeCell}>
                    <span
                      className={
                        quantidadesReais[itemKey] !== undefined
                          ? `${styles.quantidadeBadge} ${styles.quantidadeOverridden}`
                          : styles.quantidadeBadge
                      }
                    >
                      {item.quantidade}
                    </span>
                  </td>
                  <td className={styles.quantidadeRealCell}>
                    {editingQuantidadeRealKey === itemKey ? (
                      <div className={styles.quantidadeRealEditWrap}>
                        <input
                          type="number"
                          min={0}
                          className={styles.quantidadeRealInput}
                          value={inputQuantidadeReal}
                          onChange={(e) => setInputQuantidadeReal(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              const n = parseInt(inputQuantidadeReal, 10);
                              if (!isNaN(n) && n >= 0) saveQuantidadeReal(itemKey, n);
                            }
                            if (e.key === "Escape") {
                              setEditingQuantidadeRealKey(null);
                              setInputQuantidadeReal("");
                            }
                          }}
                          autoFocus
                        />
                        <button
                          type="button"
                          className={styles.quantidadeRealSaveBtn}
                          disabled={savingQuantidadeReal}
                          onClick={() => {
                            const n = parseInt(inputQuantidadeReal, 10);
                            if (!isNaN(n) && n >= 0) saveQuantidadeReal(itemKey, n);
                          }}
                          title="Salvar"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className={styles.quantidadeRealCancelBtn}
                          disabled={savingQuantidadeReal}
                          onClick={() => {
                            setEditingQuantidadeRealKey(null);
                            setInputQuantidadeReal("");
                          }}
                          title="Cancelar"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>
                    ) : quantidadesReais[itemKey] !== undefined ? (
                      <div className={styles.quantidadeRealRow}>
                        <span className={styles.quantidadeRealBadge}>{quantidadesReais[itemKey]}</span>
                        <div className={styles.quantidadeRealIcons}>
                          <button
                            type="button"
                            className={styles.quantidadeRealIconBtn}
                            disabled={savingQuantidadeReal}
                            onClick={() => {
                              setEditingQuantidadeRealKey(itemKey);
                              setInputQuantidadeReal(String(quantidadesReais[itemKey]));
                            }}
                            title="Editar quantidade real"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            className={styles.quantidadeRealIconBtn}
                            disabled={savingQuantidadeReal}
                            onClick={() => saveQuantidadeReal(itemKey, null)}
                            title="Remover quantidade real"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              <line x1="10" y1="11" x2="10" y2="17" />
                              <line x1="14" y1="11" x2="14" y2="17" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className={styles.quantidadeRealAddBtn}
                        disabled={savingQuantidadeReal}
                        onClick={() => {
                          setEditingQuantidadeRealKey(itemKey);
                          setInputQuantidadeReal(String(item.quantidade));
                        }}
                        title="Inserir quantidade real"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                    )}
                  </td>
                  <td className={styles.transferirCell}>
                    {canTransfer(item) ? (
                      <button
                        type="button"
                        className={styles.transferirBtn}
                        onClick={() => {
                          const qtySugerida = quantidadesReais[itemKey] ?? item.quantidade;
                          setModalTransferItem({
                            ...item,
                            estoqueOrigem,
                            quantidade: Math.min(qtySugerida, Math.max(0, estoqueOrigem)),
                            codigoCor: item.itemOriginal.codigoCor,
                          });
                          setOnTransferSuccess(() => () => {
                            toggleMarked(item);
                            setModalTransferItem(null);
                            setOnTransferSuccess(null);
                          });
                        }}
                        title="Transferir este item"
                      >
                        TRANSFERIR
                      </button>
                    ) : (
                      <span className={styles.transferirDisabled}>—</span>
                    )}
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
              {(() => {
                const matriz = companyKey === "nerd" ? "NERD" : companyKey === "scarfme" ? "SCARF ME - MATRIZ" : null;
                const ecommerceFilials = company?.ecommerceFilials ?? [];
                const normalizedEcommerceFilials = ecommerceFilials.map(f => f.trim().toUpperCase());
                
                // Separar filiais normais e e-commerce
                const normalFiliais: typeof hoveredItem.itemOriginal.filiais = [];
                const ecommerceFiliais: typeof hoveredItem.itemOriginal.filiais = [];
                
                hoveredItem.itemOriginal.filiais.forEach(filial => {
                  const normalizedFilial = filial.filial.trim().toUpperCase();
                  if (normalizedEcommerceFilials.includes(normalizedFilial)) {
                    ecommerceFiliais.push(filial);
                  } else {
                    normalFiliais.push(filial);
                  }
                });
                
                // Agregar filiais de e-commerce
                let ecommerceAggregated: typeof hoveredItem.itemOriginal.filiais[0] | null = null;
                if (ecommerceFiliais.length > 0) {
                  const totalStock = ecommerceFiliais.reduce((sum, f) => sum + f.stock, 0);
                  const totalSales = ecommerceFiliais.reduce((sum, f) => sum + f.sales, 0);
                  const totalSalesLast30Days = ecommerceFiliais.reduce((sum, f) => sum + f.salesLast30Days, 0);
                  
                  // Pegar a data de entrada mais recente entre todas as filiais de e-commerce
                  const ultimaEntradaEcommerce = ecommerceFiliais
                    .map(f => f.ultimaEntrada)
                    .filter(date => date !== null && date !== undefined)
                    .map(date => new Date(date as Date | string))
                    .filter(date => !isNaN(date.getTime())) // Filtrar datas inválidas
                    .sort((a, b) => b.getTime() - a.getTime())[0] || null;
                  
                  ecommerceAggregated = {
                    filial: 'E-COMMERCE',
                    stock: totalStock,
                    sales: totalSales,
                    salesLast30Days: totalSalesLast30Days,
                    ultimaEntrada: ultimaEntradaEcommerce,
                  };
                }
                
                // Agrupar filiais que têm o mesmo display name (ex: PAULISTA pode vir de múltiplas filiais)
                const filiaisPorDisplayName = new Map<string, typeof hoveredItem.itemOriginal.filiais>();
                
                normalFiliais.forEach(filial => {
                  const displayName = company?.filialDisplayNames?.[filial.filial] || filial.filial;
                  if (!filiaisPorDisplayName.has(displayName)) {
                    filiaisPorDisplayName.set(displayName, []);
                  }
                  filiaisPorDisplayName.get(displayName)!.push(filial);
                });
                
                // Agregar filiais com mesmo display name
                const filiaisAgregadas = Array.from(filiaisPorDisplayName.entries()).map(([displayName, filiais]) => {
                  if (filiais.length === 1) {
                    // Se só tem uma filial, retornar como está
                    return {
                      ...filiais[0],
                      displayName,
                    };
                  } else {
                    // Se tem múltiplas filiais com mesmo display name, agregar
                    const totalStock = filiais.reduce((sum, f) => sum + f.stock, 0);
                    const totalSales = filiais.reduce((sum, f) => sum + f.sales, 0);
                    const totalSalesLast30Days = filiais.reduce((sum, f) => sum + f.salesLast30Days, 0);
                    
                    // Pegar a data de entrada mais recente
                    const ultimaEntradaAgregada = filiais
                      .map(f => f.ultimaEntrada)
                      .filter(date => date !== null && date !== undefined)
                      .map(date => new Date(date as Date | string))
                      .filter(date => !isNaN(date.getTime()))
                      .sort((a, b) => b.getTime() - a.getTime())[0] || null;
                    
                    return {
                      filial: displayName, // Usar display name como identificador
                      stock: totalStock,
                      sales: totalSales,
                      salesLast30Days: totalSalesLast30Days,
                      ultimaEntrada: ultimaEntradaAgregada,
                      displayName,
                    };
                  }
                });
                
                // Combinar e ordenar
                const allFiliaisToShow = [
                  ...filiaisAgregadas,
                  ...(ecommerceAggregated ? [ecommerceAggregated] : []),
                ].sort((a, b) => {
                  const filialA = (a as any).displayName || a.filial;
                  const filialB = (b as any).displayName || b.filial;
                  if (filialA === matriz) return -1;
                  if (filialB === matriz) return 1;
                  return filialA.localeCompare(filialB);
                });
                
                return allFiliaisToShow.map((filial) => {
                  const displayName = filial.filial === 'E-COMMERCE' 
                    ? 'E-COMMERCE'
                    : ((filial as any).displayName || company?.filialDisplayNames?.[filial.filial] || filial.filial);
                  // Verificar se está parada há pelo menos 14 dias desde a última entrada
                  let isParada = false;
                  let diasParado: number | null = null;
                  let dataUltimaEntradaFormatada: string | null = null;
                  
                  // SEMPRE formatar a data da última entrada se existir (independente de estar parada ou não)
                  if (filial.ultimaEntrada) {
                    const hoje = new Date();
                    const dataUltimaEntrada = new Date(filial.ultimaEntrada);
                    const diasDesdeUltimaEntrada = Math.floor((hoje.getTime() - dataUltimaEntrada.getTime()) / (1000 * 60 * 60 * 24));
                    
                    // Formatar data da última entrada
                    dataUltimaEntradaFormatada = dataUltimaEntrada.toLocaleDateString('pt-BR', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric'
                    });
                    
                    // Verificar se está parada (estoque >= 1, sem vendas, e última entrada há 14+ dias)
                    if (filial.stock >= 1 && filial.sales === 0 && filial.salesLast30Days === 0 && diasDesdeUltimaEntrada >= 14) {
                      isParada = true;
                      diasParado = diasDesdeUltimaEntrada;
                    }
                  } else if (filial.stock >= 1 && filial.sales === 0 && filial.salesLast30Days === 0) {
                    // Se não há data de entrada, usar o período selecionado como fallback
                    const daysInPeriod = dateRange ? 
                      Math.max(1, Math.ceil((new Date(dateRange.endDate).getTime() - new Date(dateRange.startDate).getTime()) / (1000 * 60 * 60 * 24))) : 30;
                    // Se o período for >= 14 dias, considerar parado
                    if (daysInPeriod >= 14) {
                      isParada = true;
                      diasParado = Math.max(14, daysInPeriod);
                    }
                  } else if (filial.stock > 0 && filial.sales === 0 && filial.salesLast30Days > 0) {
                    // Teve vendas nos últimos 30 dias, mas não no período: mostrar dias do período
                    const daysInPeriod = dateRange ? 
                      Math.max(1, Math.ceil((new Date(dateRange.endDate).getTime() - new Date(dateRange.startDate).getTime()) / (1000 * 60 * 60 * 24))) : 30;
                    if (daysInPeriod >= 14) {
                      diasParado = daysInPeriod;
                    }
                  }
                  
                  return (
                    <div key={displayName} className={styles.tooltipFilialRow}>
                      <div className={styles.tooltipFilialName}>{displayName}</div>
                      <div className={styles.tooltipFilialData}>
                        <span className={styles.tooltipEstoque}>
                          Est: <strong>{filial.stock}</strong>
                        </span>
                        <span className={styles.tooltipVendas}>
                          Vnd: <strong>{filial.sales}</strong>
                        </span>
                        {dataUltimaEntradaFormatada && (
                          <span className={styles.tooltipUltimaEntrada}>
                            Últ. Entrada: <strong>{dataUltimaEntradaFormatada}</strong>
                          </span>
                        )}
                        {isParada && diasParado !== null && (
                          <span className={styles.tooltipParado}>
                            Parado: <strong>{diasParado}+d</strong>
                          </span>
                        )}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
