"use client";

import { useMemo } from "react";

import { resolveCompany, type CompanyKey } from "@/lib/config/company";
import type { StockByFilialItem } from "@/lib/repositories/stockByFilial";
import type { DateRangeValue } from "@/components/filters/DateRangeFilter";

import styles from "./StockByFilialTable.module.css";

interface StockByFilialTableProps {
  companyKey: CompanyKey;
  data: StockByFilialItem[];
  loading?: boolean;
  showItemsWithoutSales?: boolean;
  dateRange?: DateRangeValue;
}

interface ActionRecommendation {
  type: "SEM_VENDAS_AGUARDAR" | "TRANSFERIR" | "COMPRAR" | "MONITORAR" | "ESTOQUE_NORMAL";
  quantity?: number;
  message: string;
}

/**
 * Identifica a matriz e organiza as filiais baseado na configuração da empresa
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

  // Definir matriz baseado na empresa
  let matriz: string | null = null;
  let ecommerce: string | null = null;
  if (companyKey === "nerd") {
    matriz = "NERD";
  } else if (companyKey === "scarfme") {
    // Para scarfme, a matriz é "SCARF ME - MATRIZ" e o e-commerce é "SCARFME MATRIZ CMS"
    matriz = "SCARF ME - MATRIZ";
    ecommerce = "SCARFME MATRIZ CMS";
  }

  // Obter todas as filiais da configuração de inventory
  const allFiliais = company.filialFilters['inventory'] ?? [];
  
  // Filtrar ecommerce filiais se necessário (para ScarfMe)
  // Excluir tanto a matriz quanto o ecommerce da lista de outras filiais
  const ecommerceFilials = company.ecommerceFilials ?? [];
  const normalFiliais = allFiliais.filter(f => 
    !ecommerceFilials.includes(f) && f !== matriz
  );

  // Separar matriz e ecommerce das outras filiais
  const otherFiliais = normalFiliais.sort();

  return {
    matriz,
    ecommerce,
    filiais: otherFiliais, // Todas as filiais, sem limite
  };
}

/**
 * Formata a descrição do produto com código em duas linhas
 */
function formatProductDescription(descricao: string, produto: string): {
  name: string;
  code: string;
} {
  // Se a descrição já contém o código, extrair
  if (descricao.includes(`(${produto})`)) {
    const parts = descricao.split(`(${produto})`);
    return {
      name: parts[0].trim(),
      code: produto,
    };
  }
  // Caso contrário, retornar descrição e código separados
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
    // Se não houver período, assumir 30 dias
    return totalVendas;
  }

  const start = new Date(dateRange.startDate);
  const end = new Date(dateRange.endDate);
  
  // Calcular dias do período
  const daysInPeriod = Math.max(
    1,
    Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
  );

  // Projetar para 30 dias
  const vendaDiaria = totalVendas / daysInPeriod;
  return vendaDiaria * 30;
}

/**
 * Calcula a recomendação de ação para um produto
 */
function calculateActionRecommendation(
  item: StockByFilialItem,
  dateRange: DateRangeValue | undefined,
  filiaisCount: number,
  matriz: string | null
): ActionRecommendation {
  const totalEstoque = item.totalEstoque;
  const totalVendas = item.totalVendas;
  
  // Calcular projeção de venda do mês
  const projecaoVendaMes = calculateMonthlyProjection(totalVendas, dateRange);
  
  // Final EST Mês = Estoque - Projeção venda MÊS
  const finalEstoqueMes = totalEstoque - projecaoVendaMes;
  
  // REGRA 1: SEM VENDAS - AGUARDAR
  // Se Qtd_Vendida == 0 ou Projeção venda MÊS == 0
  if (totalVendas === 0 || projecaoVendaMes === 0) {
    return {
      type: "SEM_VENDAS_AGUARDAR",
      message: "SEM VENDAS - AGUARDAR",
    };
  }
  
  // Calcular número de filiais sem matriz (já calculado em filiaisCount)
  // Verificar se alguma filial com vendas tem estoque < 1
  const filiaisComVendas = item.filiais.filter(f => f.sales > 0);
  const algumaFilialComEstoqueBaixo = filiaisComVendas.some(f => f.stock < 1);
  
  // REGRA 2: TRANSFERIR
  // Se estoque total >= (número de filiais sem matriz) × 2 E alguma filial com vendas tem estoque < 1
  if (totalEstoque >= (filiaisCount * 2) && algumaFilialComEstoqueBaixo) {
    return {
      type: "TRANSFERIR",
      message: "TRANSFERIR",
    };
  }
  
  // Calcular venda diária e estoques
  const vendaDiaria = projecaoVendaMes / 30;
  const estoqueMinimo = Math.max(15, vendaDiaria * 15);
  const estoqueIdeal = Math.max(20, vendaDiaria * 25);
  
  // REGRA 3: COMPRAR X UN
  // Se Final EST MÊS < estoque_minimo
  if (finalEstoqueMes < estoqueMinimo) {
    const quantidade = estoqueIdeal - finalEstoqueMes;
    return {
      type: "COMPRAR",
      quantity: Math.ceil(quantidade),
      message: `COMPRAR ${Math.ceil(quantidade)} UN`,
    };
  }
  
  // REGRA 4: MONITORAR
  // Se Final EST MÊS entre mínimo e ideal
  if (finalEstoqueMes >= estoqueMinimo && finalEstoqueMes < estoqueIdeal) {
    return {
      type: "MONITORAR",
      message: "MONITORAR",
    };
  }
  
  // REGRA 5: ESTOQUE NORMAL
  // Se Final EST MÊS >= estoque_ideal
  return {
    type: "ESTOQUE_NORMAL",
    message: "ESTOQUE NORMAL",
  };
}

export default function StockByFilialTable({
  companyKey,
  data,
  loading,
  showItemsWithoutSales = false,
  dateRange,
}: StockByFilialTableProps) {
  const company = resolveCompany(companyKey);
  const { matriz, ecommerce, filiais } = useMemo(
    () => organizeFiliais(companyKey, data),
    [companyKey, data]
  );
  
  const filiaisCount = filiais.length;

  // Filtrar dados baseado no checkbox
  const filteredData = useMemo(() => {
    if (showItemsWithoutSales) {
      return data;
    }
    return data.filter((item) => item.totalVendas > 0);
  }, [data, showItemsWithoutSales]);

  const getFilialData = (
    item: StockByFilialItem,
    filialName: string | null
  ) => {
    if (!filialName) {
      return { stock: 0, sales: 0, salesLast30Days: 0, hasEntry: false };
    }
    // Normalizar nome da filial para comparação (trim e case-insensitive)
    // Usar a mesma normalização que foi usada no backend
    const normalizeFilial = (name: string) => (name || '').trim().toUpperCase();
    const normalizedTarget = normalizeFilial(filialName);
    
    const filialData = item.filiais.find((f) => 
      normalizeFilial(f.filial) === normalizedTarget
    );
    return filialData || { stock: 0, sales: 0, salesLast30Days: 0, hasEntry: false };
  };

  // Função para determinar a classe CSS baseada nas regras de cores
  const getFilialCellClass = (
    stock: number,
    sales: number,
    salesLast30Days: number,
    hasEntry: boolean
  ): string => {
    // Verificar se o produto existe no estoque da filial (stock > 0 ou stock < 0)
    const produtoExiste = stock !== 0;
    
    // ROXO: Produto não existe no estoque (stock === 0) E nunca teve entrada registrada nessa filial
    // Se tem estoque, logicamente deve ter tido entrada, então não aplica roxo
    if (!produtoExiste && !hasEntry) {
      return styles.filialCellPurple;
    }

    if (!produtoExiste) {
      return ''; // Sem cor (produto não existe no estoque mas teve entrada em algum momento)
    }

    // AZUL: Estoque ≤ 1 E teve venda no período E produto existe
    if (stock <= 1 && sales > 0) {
      return styles.filialCellBlue;
    }

    // LARANJA: Estoque > 1 E não teve venda no período E não teve venda nos últimos 30 dias E produto existe
    if (stock > 1 && sales === 0 && salesLast30Days === 0) {
      return styles.filialCellOrange;
    }

    // SEM COR: situação normal
    return '';
  };

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Carregando dados...</div>
      </div>
    );
  }

  if (filteredData.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>Nenhum dado disponível</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>{companyKey === "nerd" ? "GRUPO" : "SUBGRUPO"}</th>
            {companyKey !== "nerd" && <th>GRADE</th>}
            <th>DESCRIÇÃO</th>
            <th>COR</th>
            <th>VENDAS</th>
            <th>ESTOQUE</th>
            {matriz && <th>MATRIZ</th>}
            {ecommerce && companyKey === "scarfme" && (
              <th>{company?.filialDisplayNames?.[ecommerce] || ecommerce}</th>
            )}
            {filiais.map((filial) => {
              const displayName = company?.filialDisplayNames?.[filial] || filial;
              return (
                <th key={filial}>{displayName}</th>
              );
            })}
            <th>AÇÃO</th>
          </tr>
        </thead>
        <tbody>
          {filteredData.map((item, rowIndex) => {
            const matrizData = getFilialData(item, matriz);
            const ecommerceData = ecommerce ? getFilialData(item, ecommerce) : { stock: 0, sales: 0, salesLast30Days: 0, hasEntry: false };
            const productInfo = formatProductDescription(item.descricao, item.produto);
            return (
              <tr key={`${item.produto}-${item.cor}-${item.grade}-${rowIndex}`}>
                <td className={styles.subgrupoCell}>{companyKey === "nerd" ? item.grupo : item.subgrupo}</td>
                {companyKey !== "nerd" && (
                  <td>
                    <div className={styles.gradeCell}>{item.grade}</div>
                  </td>
                )}
                <td className={styles.descricaoCell}>
                  <div className={styles.productName}>{productInfo.name}</div>
                  <div className={styles.productCode}>{productInfo.code}</div>
                </td>
                <td>{item.cor}</td>
                <td className={styles.numberCell}>{item.totalVendas}</td>
                <td className={styles.numberCell}>{item.totalEstoque}</td>
                {matriz && (
                  <td>
                    <div className={`${styles.filialCell} ${styles.filialCellMatriz}`}>
                      <span className={styles.stockValue}>
                        {matrizData.stock}
                      </span>
                    </div>
                  </td>
                )}
                {ecommerce && companyKey === "scarfme" && (
                  <td>
                    <div className={`${styles.filialCell} ${getFilialCellClass(ecommerceData.stock, ecommerceData.sales, ecommerceData.salesLast30Days, ecommerceData.hasEntry)}`}>
                      <span className={styles.stockValue}>
                        {ecommerceData.stock}
                      </span>
                      <span className={styles.salesValue}>
                        {ecommerceData.sales} vendas
                      </span>
                    </div>
                  </td>
                )}
                {filiais.map((filial) => {
                  const filialData = getFilialData(item, filial);
                  return (
                    <td key={filial}>
                      <div className={`${styles.filialCell} ${getFilialCellClass(filialData.stock, filialData.sales, filialData.salesLast30Days, filialData.hasEntry)}`}>
                        <span className={styles.stockValue}>
                          {filialData.stock}
                        </span>
                        <span className={styles.salesValue}>
                          {filialData.sales} vendas
                        </span>
                      </div>
                    </td>
                  );
                })}
                <td>
                  {(() => {
                    const recommendation = calculateActionRecommendation(
                      item,
                      dateRange,
                      filiaisCount,
                      matriz
                    );
                    const actionClass = styles[`action${recommendation.type}`] || styles.actionButton;
                    return (
                      <button className={`${styles.actionButton} ${actionClass}`} type="button">
                        {recommendation.message}
                      </button>
                    );
                  })()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

