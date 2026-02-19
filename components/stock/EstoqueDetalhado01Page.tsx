"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { CompanyKey } from "@/lib/config/company";

import styles from "./EstoqueDetalhado01Page.module.css";

interface EstoqueDetalhado01PageProps {
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
  colecao?: string,
  start?: string,
  end?: string,
  giroDias?: string
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

  if (giroDias && start && end) {
    searchParams.set("giroDias", giroDias);
    searchParams.set("start", start);
    searchParams.set("end", end);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000); // 45s timeout

  const response = await fetch(`/api/controle-estoque/detalhes?${searchParams.toString()}`, {
    cache: "no-store",
    signal: controller.signal,
  }).finally(() => clearTimeout(timeoutId));

  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body?.error || `Erro ao carregar detalhes (${response.status})`);
  }

  const json = (await response.json()) as { data: ProdutoDetalhesCompleto };
  return json.data;
}

export default function EstoqueDetalhado01Page({
  companyKey,
  companyName,
}: EstoqueDetalhado01PageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
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
  const [giroAtivo, setGiroAtivo] = useState<string | null>(null);

  // Scroll para o topo quando o componente montar
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  // Obter parâmetros da URL (useSearchParams garante reação ao giro/start/end ao abrir com giro 60+)
  useEffect(() => {
    const params = searchParams;
    const produtoNome = params.get("produtoNome") || undefined;
    const linha = params.get("linha") || undefined;
    const grupo = params.get("grupo") || undefined;
    const subgrupo = params.get("subgrupo") || undefined;
    const grade = params.get("grade") || undefined;
    const colecao = params.get("colecao") || undefined;
    const filial = params.get("filial") || null;
    const giroDias = params.get("giroDias") || undefined;
    const start = params.get("start") || undefined;
    const end = params.get("end") || undefined;

    setGiroAtivo(giroDias && start && end ? giroDias : null);
    setSelectedFilial(filial);
    setFiltros({
      linha: companyKey === 'nerd' ? undefined : linha,
      grupo: companyKey === 'nerd' ? grupo : undefined,
      subgrupo,
      grade,
      colecao,
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
          grupo,
          subgrupo,
          grade,
          colecao,
          start,
          end,
          giroDias
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
  }, [companyKey, searchParams.toString()]);

  // Função para ordenar variações usando useMemo para garantir recálculo quando estado mudar
  // DEVE estar antes dos returns condicionais para seguir as regras dos Hooks
  const sortedVariacoes = useMemo(() => {
    if (!detalhes) return [];
    
    return [...detalhes.variacoes].sort((a, b) => {
      if (!sortColumn) {
        // Ordenação padrão: por estoque (maior para menor)
        return b.estoque - a.estoque;
      }
      
      let aValue: number;
      let bValue: number;
      
      if (sortColumn === 'estoque') {
        aValue = a.estoque;
        bValue = b.estoque;
      } else if (sortColumn === 'vendasTotais') {
        aValue = a.vendasTotais;
        bValue = b.vendasTotais;
      } else {
        return b.estoque - a.estoque;
      }
      
      if (sortDirection === 'asc') {
        return aValue - bValue;
      } else {
        return bValue - aValue;
      }
    });
  }, [detalhes?.variacoes, sortColumn, sortDirection]);

  // Totais calculados a partir das linhas listadas (fonte da verdade para exibição)
  const totaisFromLinhas = useMemo(() => {
    if (!detalhes?.variacoes?.length) {
      return { totalItens: 0, estoqueTotal: 0, custoTotal: 0, vendasTotais: 0 };
    }
    const variacoes = detalhes.variacoes;
    return {
      totalItens: variacoes.length,
      estoqueTotal: variacoes.reduce((s, v) => s + v.estoque, 0),
      custoTotal: variacoes.reduce((s, v) => s + v.custoTotal, 0),
      vendasTotais: variacoes.reduce((s, v) => s + v.vendasTotais, 0),
    };
  }, [detalhes?.variacoes]);

  // Divergência entre resumo da API e soma das linhas (debug)
  const divergencia = useMemo(() => {
    if (!detalhes) return null;
    const r = detalhes.resumo;
    const t = totaisFromLinhas;
    const diffEstoque = r.estoqueTotal !== t.estoqueTotal;
    const diffCusto = Math.abs(r.custoTotal - t.custoTotal) > 0.01;
    const diffVendas = r.vendasTotais !== t.vendasTotais;
    const diffItens = r.totalItens !== t.totalItens;
    if (!diffEstoque && !diffCusto && !diffVendas && !diffItens) return null;
    return {
      resumo: r,
      somaLinhas: t,
      diffEstoque,
      diffCusto,
      diffVendas,
      diffItens,
    };
  }, [detalhes, totaisFromLinhas]);

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

  // Função para voltar progressivamente pelos níveis
  // Volta progressivamente: colecao -> grade -> subgrupo -> linha/grupo -> principal
  const handleVoltar = () => {
    // Ler parâmetros diretamente da URL para garantir que temos os valores corretos
    const urlParams = new URLSearchParams(window.location.search);
    const linha = urlParams.get("linha");
    const grupo = urlParams.get("grupo");
    const subgrupo = urlParams.get("subgrupo");
    const grade = urlParams.get("grade");
    const colecao = urlParams.get("colecao");
    const filial = urlParams.get("filial");
    
    // Verificar se os valores não estão vazios
    const temColecao = colecao && colecao.trim() !== '';
    const temGrade = grade && grade.trim() !== '';
    const temSubgrupo = subgrupo && subgrupo.trim() !== '';
    
    let targetUrl = '';
    
    if (companyKey === 'nerd') {
      // NERD: usar grupo
      if (grupo && grupo.trim() !== '') {
        // Voltar progressivamente removendo níveis mais específicos
        if (temColecao && temGrade && temSubgrupo) {
          // Tem tudo: voltar removendo colecao, grade e subgrupo, mantendo apenas grupo
          const params = new URLSearchParams();
          params.set("grupo", grupo.trim());
          if (filial) params.set("filial", filial);
          targetUrl = `/${companyKey}/controle-estoque/estoquedetalhado01?${params.toString()}`;
        } else if (temGrade && temSubgrupo) {
          // Tem grade e subgrupo: voltar removendo grade e subgrupo, mantendo apenas grupo
          const params = new URLSearchParams();
          params.set("grupo", grupo.trim());
          if (filial) params.set("filial", filial);
          targetUrl = `/${companyKey}/controle-estoque/estoquedetalhado01?${params.toString()}`;
        } else if (temSubgrupo) {
          // Tem só subgrupo: voltar removendo subgrupo, mantendo apenas grupo
          const params = new URLSearchParams();
          params.set("grupo", grupo.trim());
          if (filial) params.set("filial", filial);
          targetUrl = `/${companyKey}/controle-estoque/estoquedetalhado01?${params.toString()}`;
        } else {
          // Só tem grupo: voltar para página principal sem filtros
          targetUrl = `/${companyKey}/controle-estoque`;
        }
      }
    } else {
      // SCARFME: usar linha
      if (linha && linha.trim() !== '') {
        // Voltar progressivamente removendo níveis mais específicos
        if (temColecao && temGrade && temSubgrupo) {
          // Tem tudo: voltar removendo colecao, grade e subgrupo, mantendo apenas linha
          const params = new URLSearchParams();
          params.set("linha", linha.trim());
          if (filial) params.set("filial", filial);
          targetUrl = `/${companyKey}/controle-estoque/estoquedetalhado01?${params.toString()}`;
        } else if (temGrade && temSubgrupo) {
          // Tem grade e subgrupo: voltar removendo grade e subgrupo, mantendo apenas linha
          const params = new URLSearchParams();
          params.set("linha", linha.trim());
          if (filial) params.set("filial", filial);
          targetUrl = `/${companyKey}/controle-estoque/estoquedetalhado01?${params.toString()}`;
        } else if (temSubgrupo) {
          // Tem só subgrupo: voltar removendo subgrupo, mantendo apenas linha
          const params = new URLSearchParams();
          params.set("linha", linha.trim());
          if (filial) params.set("filial", filial);
          targetUrl = `/${companyKey}/controle-estoque/estoquedetalhado01?${params.toString()}`;
        } else {
          // Só tem linha: voltar para página principal sem filtros
          targetUrl = `/${companyKey}/controle-estoque`;
        }
      }
    }
    
    // Se não há nenhum filtro ou targetUrl não foi definido, voltar para página principal limpa
    if (!targetUrl) {
      targetUrl = `/${companyKey}/controle-estoque`;
    }
    
    // Usar window.location.href para forçar uma navegação completa
    window.location.href = targetUrl;
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <button
          onClick={handleVoltar}
          className={styles.backButton}
        >
          ← Voltar
        </button>
        <h1 className={styles.title}>Detalhes: {detalhes.nomeProduto}</h1>
      </div>

      {giroAtivo && (
        <div
          style={{
            padding: "8px 12px",
            background: "var(--color-info-bg, #e8f4fd)",
            borderRadius: "6px",
            marginBottom: "12px",
            fontSize: "0.85rem",
          }}
        >
          Mostrando itens das combinações com vendas no período do giro ({giroAtivo} dias). Total igual ao card.
        </div>
      )}

      {/* Cabeçalho com informações do produto */}
      <div className={styles.infoHeader}>
        <div className={styles.infoRow}>
          <div className={styles.infoItem}>
            <span className={styles.infoLabel}>LINHA:</span>
            <span className={styles.infoValue}>{filtros.linha || detalhes.variacoes[0]?.linha || '-'}</span>
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

      {/* Resumo de Métricas (valores = soma das linhas da tabela, para garantir consistência) */}
      <div className={styles.metricsGrid}>
        <div className={styles.metricCard}>
          <div className={styles.metricLabel}>TOTAL DE ITENS</div>
          <div className={styles.metricValue}>{totaisFromLinhas.totalItens}</div>
        </div>
        <div className={styles.metricCard}>
          <div className={styles.metricLabel}>ESTOQUE TOTAL</div>
          <div className={styles.metricValue}>
            {formatNumber(totaisFromLinhas.estoqueTotal)} unidades
          </div>
        </div>
        <div className={styles.metricCard}>
          <div className={styles.metricLabel}>CUSTO TOTAL</div>
          <div className={styles.metricValue}>
            {formatCurrency(totaisFromLinhas.custoTotal)}
          </div>
        </div>
        <div className={styles.metricCard}>
          <div className={styles.metricLabel}>VENDAS TOTAIS</div>
          <div className={styles.metricValue}>
            {formatNumber(totaisFromLinhas.vendasTotais)} unidades
          </div>
        </div>
      </div>

      {/* Verificação: totais = soma das linhas; alerta se API enviou valores diferentes */}
      <div className={styles.verificacao}>
        <div className={styles.verificacaoLabel}>Verificação</div>
        <div className={styles.verificacaoText}>
          Totais exibidos = soma das <strong>{totaisFromLinhas.totalItens}</strong> linhas da tabela abaixo.
        </div>
        {divergencia && (
          <div className={styles.verificacaoAlerta} role="alert">
            <strong>Divergência com resumo da API:</strong>
            <ul style={{ margin: "4px 0 0 0", paddingLeft: "20px" }}>
              {divergencia.diffItens && (
                <li>Itens: API {divergencia.resumo.totalItens} vs soma linhas {divergencia.somaLinhas.totalItens}</li>
              )}
              {divergencia.diffEstoque && (
                <li>Estoque: API {divergencia.resumo.estoqueTotal} vs soma linhas {divergencia.somaLinhas.estoqueTotal}</li>
              )}
              {divergencia.diffCusto && (
                <li>Custo: API {divergencia.resumo.custoTotal.toFixed(2)} vs soma linhas {divergencia.somaLinhas.custoTotal.toFixed(2)}</li>
              )}
              {divergencia.diffVendas && (
                <li>Vendas: API {divergencia.resumo.vendasTotais} vs soma linhas {divergencia.somaLinhas.vendasTotais}</li>
              )}
            </ul>
          </div>
        )}
      </div>

      {/* Tabela de Variações */}
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
              // Construir URL para estoquedetalhado01 (produto específico com todas as cores) - sem cor
              const paramsProduto = new URLSearchParams();
              if (variacao.produto) paramsProduto.set("produtoNome", variacao.produto);
              // Não passar cor aqui - queremos ver todas as cores do produto
              
              // Para NERD, passar grupo; para SCARFME, passar linha
              if (companyKey === 'nerd') {
                if (filtros.grupo || variacao.linha) paramsProduto.set("grupo", filtros.grupo || variacao.linha || ''); // Para NERD, linha é grupo
              } else {
                if (filtros.linha || variacao.linha) paramsProduto.set("linha", filtros.linha || variacao.linha || '');
              }
              
              if (filtros.subgrupo || variacao.subgrupo) paramsProduto.set("subgrupo", filtros.subgrupo || variacao.subgrupo || '');
              if (filtros.grade || variacao.grade) paramsProduto.set("grade", filtros.grade || variacao.grade || '');
              if (filtros.colecao || variacao.colecao) paramsProduto.set("colecao", filtros.colecao || variacao.colecao || '');
              if (selectedFilial) paramsProduto.set("filial", selectedFilial);

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
                  <td>
                    <Link
                      href={`/${companyKey}/controle-estoque/estoquedetalhado01-produto?${paramsProduto.toString()}`}
                      className={styles.productLink}
                    >
                      {variacao.produto}
                    </Link>
                  </td>
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
              <td colSpan={3} className={styles.footerLabel}><strong>Soma ({totaisFromLinhas.totalItens} linhas)</strong></td>
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
