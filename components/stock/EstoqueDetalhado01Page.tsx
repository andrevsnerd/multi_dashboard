"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
  custoUnitario: number;
  custoTotal: number;
}

interface ProdutoDetalhesResumo {
  totalItens: number;
  estoqueTotal: number;
  custoTotal: number;
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

export default function EstoqueDetalhado01Page({
  companyKey,
  companyName,
}: EstoqueDetalhado01PageProps) {
  const router = useRouter();
  const [detalhes, setDetalhes] = useState<ProdutoDetalhesCompleto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFilial, setSelectedFilial] = useState<string | null>(null);
  const [filtros, setFiltros] = useState<{
    linha?: string;
    subgrupo?: string;
    grade?: string;
    colecao?: string;
  }>({});

  // Scroll para o topo quando o componente montar
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  // Obter parâmetros da URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const produtoNome = params.get("produtoNome") || undefined;
    const linha = params.get("linha") || undefined;
    const subgrupo = params.get("subgrupo") || undefined;
    const grade = params.get("grade") || undefined;
    const colecao = params.get("colecao") || undefined;
    const filial = params.get("filial") || null;

    setSelectedFilial(filial);
    setFiltros({ linha, subgrupo, grade, colecao });

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
          subgrupo,
          grade,
          colecao
        );

        if (active) {
          setDetalhes(data);
          // Se não tiver filtros da URL, usar os dados da primeira variação
          if (!linha && !subgrupo && !grade && !colecao && data.variacoes.length > 0) {
            const primeiraVariacao = data.variacoes[0];
            setFiltros({
              linha: primeiraVariacao.linha,
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
          onClick={() => router.back()}
          className={styles.backButton}
        >
          ← Voltar
        </button>
        <h1 className={styles.title}>Detalhes: {detalhes.nomeProduto}</h1>
      </div>

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

      {/* Resumo de Métricas */}
      <div className={styles.metricsGrid}>
        <div className={styles.metricCard}>
          <div className={styles.metricLabel}>TOTAL DE ITENS</div>
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
      </div>

      {/* Tabela de Variações */}
      <div className={styles.tableWrapper}>
        <table className={styles.detailsTable}>
          <thead>
            <tr>
              <th>PRODUTO</th>
              <th>DESCRIÇÃO</th>
              <th>COR</th>
              <th>ESTOQUE</th>
              <th>CUSTO UNIT.</th>
              <th>CUSTO TOTAL</th>
            </tr>
          </thead>
          <tbody>
            {detalhes.variacoes.map((variacao, index) => {
              // Construir URL para estoquedetalhado02 com os parâmetros necessários
              const params = new URLSearchParams();
              if (variacao.produto) params.set("produtoNome", variacao.produto);
              if (filtros.linha || variacao.linha) params.set("linha", filtros.linha || variacao.linha || '');
              if (filtros.subgrupo || variacao.subgrupo) params.set("subgrupo", filtros.subgrupo || variacao.subgrupo || '');
              if (filtros.grade || variacao.grade) params.set("grade", filtros.grade || variacao.grade || '');
              if (filtros.colecao || variacao.colecao) params.set("colecao", filtros.colecao || variacao.colecao || '');
              if (selectedFilial) params.set("filial", selectedFilial);

              return (
                <tr key={`${variacao.produto}-${variacao.cor}-${index}`} className={index % 2 === 0 ? styles.evenRow : styles.oddRow}>
                  <td>
                    <Link
                      href={`/${companyKey}/controle-estoque/estoquedetalhado02?${params.toString()}`}
                      className={styles.productLink}
                    >
                      {variacao.produto}
                    </Link>
                  </td>
                  <td>{variacao.descricao}</td>
                  <td>{variacao.cor}</td>
                  <td>{formatNumber(variacao.estoque)}</td>
                  <td>{formatCurrency(variacao.custoUnitario)}</td>
                  <td>{formatCurrency(variacao.custoTotal)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
