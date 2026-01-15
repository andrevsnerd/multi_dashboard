"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { CompanyKey } from "@/lib/config/company";

import styles from "./EstoqueDetalhado02Page.module.css";

interface EstoqueDetalhado02PageProps {
  companyKey: CompanyKey;
  companyName: string;
}

interface ProdutoVariacaoDetalhesPorFilial {
  produto: string;
  descricao: string;
  linha: string;
  subgrupo: string;
  grade: string;
  colecao: string;
  cor: string;
  filial: string;
  estoque: number;
  custoUnitario: number;
  custoTotal: number;
  vendasTotais: number;
}

interface ProdutoDetalhesResumoPorFilial {
  totalFiliais: number;
  estoqueTotal: number;
  custoTotal: number;
  vendasTotais: number;
}

interface ProdutoDetalhesCompletoPorFilial {
  nomeProduto: string;
  resumo: ProdutoDetalhesResumoPorFilial;
  variacoes: ProdutoVariacaoDetalhesPorFilial[];
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

async function fetchDetalhesPorFilial(
  company: string,
  filial: string | null,
  produtoNome?: string,
  linha?: string,
  subgrupo?: string,
  grade?: string,
  colecao?: string
): Promise<ProdutoDetalhesCompletoPorFilial> {
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

  const response = await fetch(`/api/controle-estoque/detalhes-por-filial?${searchParams.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Erro ao carregar detalhes");
  }

  const json = (await response.json()) as { data: ProdutoDetalhesCompletoPorFilial };
  return json.data;
}

export default function EstoqueDetalhado02Page({
  companyKey,
  companyName,
}: EstoqueDetalhado02PageProps) {
  const router = useRouter();
  const [detalhes, setDetalhes] = useState<ProdutoDetalhesCompletoPorFilial | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFilial, setSelectedFilial] = useState<string | null>(null);
  const [filtros, setFiltros] = useState<{
    linha?: string;
    subgrupo?: string;
    grade?: string;
    colecao?: string;
  }>({});

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
        const data = await fetchDetalhesPorFilial(
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

  // Função para voltar para estoquedetalhado01
  const handleVoltar = () => {
    const params = new URLSearchParams();
    if (filtros.linha || detalhes.variacoes[0]?.linha) params.set("linha", filtros.linha || detalhes.variacoes[0]?.linha || '');
    if (filtros.subgrupo || detalhes.variacoes[0]?.subgrupo) params.set("subgrupo", filtros.subgrupo || detalhes.variacoes[0]?.subgrupo || '');
    if (filtros.grade || detalhes.variacoes[0]?.grade) params.set("grade", filtros.grade || detalhes.variacoes[0]?.grade || '');
    if (filtros.colecao || detalhes.variacoes[0]?.colecao) params.set("colecao", filtros.colecao || detalhes.variacoes[0]?.colecao || '');
    if (selectedFilial) params.set("filial", selectedFilial);
    
    router.push(`/${companyKey}/controle-estoque/estoquedetalhado01?${params.toString()}`);
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

      {/* Cabeçalho com informações do produto */}
      <div className={styles.infoHeader}>
        <div className={styles.infoRow}>
          <div className={styles.infoItem}>
            <span className={styles.infoLabel}>PRODUTO:</span>
            <span className={styles.infoValue}>{detalhes.variacoes[0]?.produto || '-'}</span>
          </div>
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
          <div className={styles.metricLabel}>TOTAL DE FILIAIS</div>
          <div className={styles.metricValue}>{detalhes.resumo.totalFiliais}</div>
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

      {/* Tabela de Variações por Filial */}
      <div className={styles.tableWrapper}>
        <table className={styles.detailsTable}>
          <thead>
            <tr>
              <th>DESCRIÇÃO</th>
              <th>COR</th>
              <th>FILIAL</th>
              <th>ESTOQUE</th>
              <th>CUSTO UNIT.</th>
              <th>CUSTO TOTAL</th>
              <th>VENDAS TOTAIS</th>
            </tr>
          </thead>
          <tbody>
            {detalhes.variacoes.map((variacao, index) => (
              <tr key={`${variacao.produto}-${variacao.cor}-${variacao.filial}-${index}`} className={index % 2 === 0 ? styles.evenRow : styles.oddRow}>
                <td>{variacao.descricao}</td>
                <td>{variacao.cor}</td>
                <td>{variacao.filial}</td>
                <td>{formatNumber(variacao.estoque)}</td>
                <td>{formatCurrency(variacao.custoUnitario)}</td>
                <td>{formatCurrency(variacao.custoTotal)}</td>
                <td>{formatNumber(variacao.vendasTotais)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
