"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import type { CompanyKey } from "@/lib/config/company";
import type { ProdutoDetalheEstoque } from "@/lib/repositories/controleEstoque";

import styles from "./CategoriaDetalhesPage.module.css";

interface ProdutoDetalhesPageProps {
  companyKey: CompanyKey;
  companyName: string;
  categoria: string;
  produto: string;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(value);
}

export default function ProdutoDetalhesPage({
  companyKey,
  companyName,
  categoria,
  produto,
}: ProdutoDetalhesPageProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [detalhes, setDetalhes] = useState<ProdutoDetalheEstoque[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadDetalhes() {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          company: companyKey,
          categoria: encodeURIComponent(categoria),
        });

        // Adicionar filtros do produto
        params.set('produto', produto);
        const cor = searchParams.get('cor');
        if (cor) params.set('cor', cor);
        const linha = searchParams.get('linha');
        if (linha) params.set('linhas', linha);
        const subgrupo = searchParams.get('subgrupo');
        if (subgrupo) params.set('subgrupos', subgrupo);
        const grade = searchParams.get('grade');
        if (grade) params.set('grades', grade);
        const colecao = searchParams.get('colecao');
        if (colecao) params.set('colecoes', colecao);

        // Adicionar outros filtros da URL se existirem
        const filial = searchParams.get('filial');
        if (filial) params.set('filial', filial);
        
        const grupos = searchParams.get('grupos');
        if (grupos) params.set('grupos', grupos);

        const response = await fetch(`/api/controle-estoque/detalhes?${params.toString()}`);
        
        if (!response.ok) {
          throw new Error('Erro ao carregar detalhes');
        }

        const json = await response.json();
        setDetalhes(json.data || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao carregar detalhes');
      } finally {
        setLoading(false);
      }
    }

    loadDetalhes();
  }, [companyKey, categoria, produto, searchParams]);

  const totalEstoque = detalhes.reduce((sum, item) => sum + item.estoque, 0);
  const totalCusto = detalhes.reduce((sum, item) => sum + item.custoTotal, 0);

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <button onClick={() => router.back()} className={styles.backButton}>
            ← Voltar
          </button>
          <h1 className={styles.title}>Detalhes: {produto}</h1>
        </div>
        <div className={styles.loading}>Carregando...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <button onClick={() => router.back()} className={styles.backButton}>
            ← Voltar
          </button>
          <h1 className={styles.title}>Detalhes: {produto}</h1>
        </div>
        <div className={styles.error}>Erro: {error}</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button onClick={() => router.back()} className={styles.backButton}>
          ← Voltar
        </button>
        <h1 className={styles.title}>Detalhes: {produto}</h1>
      </div>

      <div className={styles.summary}>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>Total de Filiais:</span>
          <span className={styles.summaryValue}>{detalhes.length}</span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>Estoque Total:</span>
          <span className={styles.summaryValue}>{formatNumber(totalEstoque)} unidades</span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>Custo Total:</span>
          <span className={styles.summaryValue}>{formatCurrency(totalCusto)}</span>
        </div>
      </div>

      <div className={styles.tableContainer}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Produto</th>
              <th>Descrição</th>
              {companyKey !== 'nerd' && <th>Linha</th>}
              {companyKey !== 'nerd' && <th>Subgrupo</th>}
              {companyKey !== 'nerd' && <th>Grade</th>}
              {companyKey !== 'nerd' && <th>Coleção</th>}
              <th>Cor</th>
              <th>Filial</th>
              <th className={styles.numberCell}>Estoque</th>
              <th className={styles.numberCell}>Custo Unit.</th>
              <th className={styles.numberCell}>Custo Total</th>
            </tr>
          </thead>
          <tbody>
            {detalhes.length === 0 ? (
              <tr>
                <td colSpan={companyKey !== 'nerd' ? 11 : 7} className={styles.emptyMessage}>
                  Nenhum item encontrado
                </td>
              </tr>
            ) : (
              detalhes.map((item, index) => (
                <tr key={`${item.filial}-${index}`}>
                  <td className={styles.produtoCell}>{item.produto}</td>
                  <td className={styles.descricaoCell}>{item.descricao}</td>
                  {companyKey !== 'nerd' && (
                    <>
                      <td>{item.linha || '-'}</td>
                      <td>{item.subgrupo || '-'}</td>
                      <td>{item.grade || '-'}</td>
                      <td>{item.colecao || '-'}</td>
                    </>
                  )}
                  <td>{item.descCor || item.cor || '-'}</td>
                  <td>{item.filial}</td>
                  <td className={styles.numberCell}>{formatNumber(item.estoque)}</td>
                  <td className={styles.numberCell}>{formatCurrency(item.custoUnitario)}</td>
                  <td className={styles.numberCell}>{formatCurrency(item.custoTotal)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
