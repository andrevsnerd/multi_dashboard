"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { CompanyKey } from "@/lib/config/company";
import { exportDetalhadoToXlsx } from "@/lib/utils/exportDetalhadoXlsx";

import styles from "./EstoqueDetalhado01Page.module.css";

interface EstoqueDetalhado01ProdutoPageProps {
  companyKey: CompanyKey;
  companyName: string;
}

interface ProdutoVariacaoDetalhes {
  produto: string;
  descricao: string;
  linha: string;
  subgrupo: string;
  grade: string;
  colecao: string;
  cor: string;
  estoque: number;
  preco: number;
  custoUnitario: number;
  custoTotal: number;
  vendasTotais: number;
}

interface ProdutoDetalhesResumo {
  totalItens: number;
  estoqueTotal: number;
  custoTotal: number;
  vendasTotais: number;
}

interface ProdutoDetalhesCompleto {
  nomeProduto: string;
  resumo: ProdutoDetalhesResumo;
  variacoes: ProdutoVariacaoDetalhes[];
}

function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2,
  });
}

function formatNumber(value: number): string {
  return value.toLocaleString("pt-BR", {
    maximumFractionDigits: 0,
  });
}

async function fetchDetalhes(
  company: string,
  filial: string | null,
  produtoNome?: string,
  linha?: string,
  grupo?: string,
  subgrupo?: string,
  grade?: string,
  colecao?: string
): Promise<ProdutoDetalhesCompleto> {
  const searchParams = new URLSearchParams({
    company,
  });

  if (filial) {
    searchParams.set("filial", filial);
  }

  if (produtoNome) {
    searchParams.set("produtoNome", produtoNome);
  }

  if (linha) {
    searchParams.set("linha", linha);
  }

  if (grupo) {
    searchParams.set("grupo", grupo);
  }

  if (subgrupo) {
    searchParams.set("subgrupo", subgrupo);
  }

  if (grade) {
    searchParams.set("grade", grade);
  }

  if (colecao) {
    searchParams.set("colecao", colecao);
  }

  const response = await fetch(`/api/controle-estoque/detalhes?${searchParams.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Erro ao carregar detalhes");
  }

  const json = (await response.json()) as { data: ProdutoDetalhesCompleto };
  return json.data;
}

export default function EstoqueDetalhado01ProdutoPage({
  companyKey,
  companyName,
}: EstoqueDetalhado01ProdutoPageProps) {
  const router = useRouter();
  const [detalhes, setDetalhes] = useState<ProdutoDetalhesCompleto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFilial, setSelectedFilial] = useState<string | null>(null);
  const [filtros, setFiltros] = useState<{
    linha?: string;
    grupo?: string; // Para NERD
    subgrupo?: string;
    grade?: string;
    colecao?: string;
  }>({});
  const [sortColumn, setSortColumn] = useState<'estoque' | 'vendasTotais' | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Scroll para o topo quando o componente montar
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  // Obter parâmetros da URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const produtoNome = params.get("produtoNome") || undefined;
    const linha = params.get("linha") || undefined;
    const grupo = params.get("grupo") || undefined; // Para NERD
    const subgrupo = params.get("subgrupo") || undefined;
    const grade = params.get("grade") || undefined;
    const colecao = params.get("colecao") || undefined;
    const filial = params.get("filial") || null;

    setSelectedFilial(filial);
    // Para NERD, usar grupo; para SCARFME, usar linha
    setFiltros({ 
      linha: companyKey === 'nerd' ? undefined : linha, 
      grupo: companyKey === 'nerd' ? grupo : undefined,
      subgrupo, 
      grade, 
      colecao 
    });

    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const data = await fetchDetalhes(
          companyKey,
          filial,
          produtoNome,
          linha,
          grupo, // Para NERD
          subgrupo,
          grade,
          colecao
        );

        if (active) {
          setDetalhes(data);
          // Se não tiver filtros da URL, usar os dados da primeira variação
          if (!linha && !grupo && !subgrupo && !grade && !colecao && data.variacoes.length > 0) {
            const primeiraVariacao = data.variacoes[0];
            setFiltros({
              linha: companyKey === 'nerd' ? undefined : primeiraVariacao.linha,
              grupo: companyKey === 'nerd' ? primeiraVariacao.linha : undefined, // Para NERD, linha é na verdade grupo
              subgrupo: primeiraVariacao.subgrupo,
              grade: primeiraVariacao.grade,
              colecao: primeiraVariacao.colecao,
            });
          }
          // Scroll para o topo quando os dados carregarem
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Erro ao carregar dados");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [companyKey]);

  const handleSort = (column: 'estoque' | 'vendasTotais') => {
    if (sortColumn === column) {
      // Se já está ordenando por essa coluna, inverte a direção
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // Se é uma nova coluna, verificar se a ordenação padrão já é por essa coluna
      // Se a ordenação padrão já é por estoque DESC e clicou em estoque, começar com ASC
      if (column === 'estoque' && !sortColumn) {
        // Primeira vez clicando em estoque: já está ordenado por estoque DESC, então inverte para ASC
        setSortColumn(column);
        setSortDirection('asc');
      } else {
        // Nova coluna ou mudando de coluna: começa com desc (maior para menor)
        setSortColumn(column);
        setSortDirection('desc');
      }
    }
  };

  // Função para voltar para estoquedetalhado01 (visão de linha/grupo)
  const handleVoltar = () => {
    const params = new URLSearchParams();
    
    // Obter valores dos filtros ou dos detalhes (prioridade para filtros)
    const primeiraVariacao = detalhes?.variacoes[0];
    
    // Para NERD, usar grupo; para SCARFME, usar linha
    if (companyKey === 'nerd') {
      const grupo = filtros.grupo || primeiraVariacao?.linha;
      if (grupo) {
        params.set("grupo", grupo);
      }
      
      // Na NERD, não precisamos filtrar por coleção/grade/subgrupo ao voltar
      // Vai direto para a visão do grupo apenas
      if (selectedFilial) {
        params.set("filial", selectedFilial);
      }
      
      // NÃO incluir produtoNome, subgrupo, grade ou colecao - queremos ver todos os produtos do grupo
      router.push(`/${companyKey}/controle-estoque/estoquedetalhado01?${params.toString()}`);
    } else {
      // SCARFME: manter a lógica original com todos os filtros
      const linha = filtros.linha || primeiraVariacao?.linha;
      if (linha) {
        params.set("linha", linha);
      }
      
      // Incluir filtros adicionais se existirem
      const subgrupo = filtros.subgrupo || primeiraVariacao?.subgrupo;
      if (subgrupo) {
        params.set("subgrupo", subgrupo);
      }
      
      const grade = filtros.grade || primeiraVariacao?.grade;
      if (grade) {
        params.set("grade", grade);
      }
      
      const colecao = filtros.colecao || primeiraVariacao?.colecao;
      if (colecao) {
        params.set("colecao", colecao);
      }
      
      if (selectedFilial) {
        params.set("filial", selectedFilial);
      }
      
      // NÃO incluir produtoNome - queremos ver todos os produtos da linha/grupo
      router.push(`/${companyKey}/controle-estoque/estoquedetalhado01?${params.toString()}`);
    }
  };

  // Ordenar variações
  const sortedVariacoes = useMemo(() => {
    if (!detalhes) return [];
    
    let sorted = [...detalhes.variacoes];
    
    if (sortColumn) {
      sorted.sort((a, b) => {
        const aValue = a[sortColumn];
        const bValue = b[sortColumn];
        
        if (sortDirection === 'asc') {
          return aValue - bValue;
        } else {
          return bValue - aValue;
        }
      });
    } else {
      // Ordenação padrão: por estoque DESC
      sorted.sort((a, b) => b.estoque - a.estoque);
    }
    
    return sorted;
  }, [detalhes, sortColumn, sortDirection]);

  const totaisFromLinhas = useMemo(() => {
    if (!detalhes?.variacoes?.length) {
      return { totalItens: 0, estoqueTotal: 0, custoTotal: 0, vendasTotais: 0 };
    }
    const v = detalhes.variacoes;
    return {
      totalItens: v.length,
      estoqueTotal: v.reduce((s, x) => s + x.estoque, 0),
      custoTotal: v.reduce((s, x) => s + x.custoTotal, 0),
      vendasTotais: v.reduce((s, x) => s + x.vendasTotais, 0),
    };
  }, [detalhes?.variacoes]);

  if (loading) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.loading}>Carregando dados...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.error}>{error}</div>
      </div>
    );
  }

  if (!detalhes) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.error}>Nenhum dado encontrado</div>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <button
          onClick={handleVoltar}
          className={styles.backButton}
        >
          ← Voltar
        </button>
        <h1 className={styles.title}>Produto: {detalhes.variacoes[0]?.produto || detalhes.nomeProduto}</h1>
        <button
          type="button"
          onClick={() => {
            const columns = ["PRODUTO", "DESCRIÇÃO", "COR", "ESTOQUE", "PREÇO", "CUSTO UNIT.", "CUSTO TOTAL", "VENDAS TOTAIS"];
            const rows = sortedVariacoes.map((v) => [
              v.produto,
              v.descricao,
              v.cor,
              v.estoque,
              v.preco ?? 0,
              v.custoUnitario,
              v.custoTotal,
              v.vendasTotais,
            ]);
            const safeName = (detalhes.variacoes[0]?.produto || detalhes.nomeProduto || "produto").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
            exportDetalhadoToXlsx(columns, rows, `detalhado-cores-${safeName}-${new Date().toISOString().slice(0, 10)}.xlsx`);
          }}
          className={styles.backButton}
          style={{ marginLeft: "auto" }}
        >
          Exportar XLSX
        </button>
      </div>

      {/* Cabeçalho com informações do produto */}
      <div className={styles.infoHeader}>
        <div className={styles.infoRow}>
          <div className={styles.infoItem}>
            <span className={styles.infoLabel}>{companyKey === 'nerd' ? 'GRUPO:' : 'LINHA:'}</span>
            <span className={styles.infoValue}>{companyKey === 'nerd' ? (filtros.grupo || detalhes.variacoes[0]?.linha || '-') : (filtros.linha || detalhes.variacoes[0]?.linha || '-')}</span>
          </div>
          <div className={styles.infoItem}>
            <span className={styles.infoLabel}>SUBGRUPO:</span>
            <span className={styles.infoValue}>{filtros.subgrupo || detalhes.variacoes[0]?.subgrupo || '-'}</span>
          </div>
          <div className={styles.infoItem}>
            <span className={styles.infoLabel}>GRADE:</span>
            <span className={styles.infoValue}>{filtros.grade || detalhes.variacoes[0]?.grade || '-'}</span>
          </div>
          <div className={styles.infoItem}>
            <span className={styles.infoLabel}>COLEÇÃO:</span>
            <span className={styles.infoValue}>{filtros.colecao || detalhes.variacoes[0]?.colecao || '-'}</span>
          </div>
        </div>
      </div>

      {/* Resumo de Métricas */}
      <div className={styles.metricsGrid}>
        <div className={styles.metricCard}>
          <div className={styles.metricLabel}>TOTAL DE CORES</div>
          <div className={styles.metricValue}>{detalhes.resumo.totalItens}</div>
        </div>
        <div className={styles.metricCard}>
          <div className={styles.metricLabel}>ESTOQUE TOTAL</div>
          <div className={styles.metricValue}>
            {formatNumber(detalhes.resumo.estoqueTotal)} unidades
          </div>
        </div>
        <div className={styles.metricCard}>
          <div className={styles.metricLabel}>CUSTO TOTAL</div>
          <div className={styles.metricValue}>
            {formatCurrency(detalhes.resumo.custoTotal)}
          </div>
        </div>
        <div className={styles.metricCard}>
          <div className={styles.metricLabel}>VENDAS TOTAIS</div>
          <div className={styles.metricValue}>
            {formatNumber(detalhes.resumo.vendasTotais)} unidades
          </div>
        </div>
      </div>

      {/* Tabela de Variações por Cor */}
      <div className={styles.tableWrapper}>
        <table className={styles.detailsTable}>
          <thead>
            <tr>
              <th>PRODUTO</th>
              <th>DESCRIÇÃO</th>
              <th>COR</th>
              <th 
                className={styles.sortableHeader}
                onClick={() => handleSort('estoque')}
              >
                ESTOQUE
                {sortColumn === 'estoque' && (
                  <span className={styles.sortIndicator}>
                    {sortDirection === 'asc' ? ' ↑' : ' ↓'}
                  </span>
                )}
              </th>
              <th>PREÇO</th>
              <th>CUSTO UNIT.</th>
              <th>CUSTO TOTAL</th>
              <th 
                className={styles.sortableHeader}
                onClick={() => handleSort('vendasTotais')}
              >
                VENDAS TOTAIS
                {sortColumn === 'vendasTotais' && (
                  <span className={styles.sortIndicator}>
                    {sortDirection === 'asc' ? ' ↑' : ' ↓'}
                  </span>
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedVariacoes.map((variacao, index) => {
              // Construir URL para estoquedetalhado02 (produto por cor e filial) - com cor
              const paramsCor = new URLSearchParams();
              if (variacao.produto) paramsCor.set("produtoNome", variacao.produto);
              if (variacao.cor) paramsCor.set("cor", variacao.cor); // Adicionar cor para filtrar
              
              // Para NERD, passar grupo; para SCARFME, passar linha
              if (companyKey === 'nerd') {
                if (filtros.grupo || variacao.linha) paramsCor.set("grupo", filtros.grupo || variacao.linha || ''); // Para NERD, linha é grupo
              } else {
                if (filtros.linha || variacao.linha) paramsCor.set("linha", filtros.linha || variacao.linha || '');
              }
              
              if (filtros.subgrupo || variacao.subgrupo) paramsCor.set("subgrupo", filtros.subgrupo || variacao.subgrupo || '');
              if (filtros.grade || variacao.grade) paramsCor.set("grade", filtros.grade || variacao.grade || '');
              if (filtros.colecao || variacao.colecao) paramsCor.set("colecao", filtros.colecao || variacao.colecao || '');
              if (selectedFilial) paramsCor.set("filial", selectedFilial);

              return (
                <tr key={`${variacao.produto}-${variacao.cor}-${index}`} className={index % 2 === 0 ? styles.evenRow : styles.oddRow}>
                  <td>{variacao.produto}</td>
                  <td>{variacao.descricao}</td>
                  <td>
                    <Link
                      href={`/${companyKey}/controle-estoque/estoquedetalhado02?${paramsCor.toString()}`}
                      className={styles.productLink}
                    >
                      {variacao.cor}
                    </Link>
                  </td>
                  <td>{formatNumber(variacao.estoque)}</td>
                  <td>{formatCurrency(variacao.preco ?? 0)}</td>
                  <td>{formatCurrency(variacao.custoUnitario)}</td>
                  <td>{formatCurrency(variacao.custoTotal)}</td>
                  <td>{formatNumber(variacao.vendasTotais)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className={styles.footerRow}>
              <td colSpan={3} className={styles.footerLabel}><strong>{totaisFromLinhas.totalItens} linhas</strong></td>
              <td className={styles.footerValue}>{formatNumber(totaisFromLinhas.estoqueTotal)}</td>
              <td>—</td>
              <td>—</td>
              <td className={styles.footerValue}>{formatCurrency(totaisFromLinhas.custoTotal)}</td>
              <td className={styles.footerValue}>{formatNumber(totaisFromLinhas.vendasTotais)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
