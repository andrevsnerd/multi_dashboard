"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import type { CompanyKey } from "@/lib/config/company";
import type { ProdutoDetalheEstoque } from "@/lib/repositories/controleEstoque";

import styles from "./CategoriaDetalhesPage.module.css";

interface CategoriaDetalhesPageProps {
  companyKey: CompanyKey;
  companyName: string;
  categoria: string;
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

export default function CategoriaDetalhesPage({
  companyKey,
  companyName,
  categoria,
}: CategoriaDetalhesPageProps) {
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

        // Adicionar filtros da URL se existirem
        const filial = searchParams.get('filial');
        if (filial) params.set('filial', filial);
        
        const grupos = searchParams.get('grupos');
        if (grupos) params.set('grupos', grupos);
        
        const linhas = searchParams.get('linhas');
        if (linhas) params.set('linhas', linhas);
        
        const colecoes = searchParams.get('colecoes');
        if (colecoes) params.set('colecoes', colecoes);
        
        const subgrupos = searchParams.get('subgrupos');
        if (subgrupos) params.set('subgrupos', subgrupos);
        
        const grades = searchParams.get('grades');
        if (grades) params.set('grades', grades);

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
  }, [companyKey, categoria, searchParams]);

  const totalEstoque = detalhes.reduce((sum, item) => sum + item.estoque, 0);
  const totalCusto = detalhes.reduce((sum, item) => sum + item.custoTotal, 0);

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <button onClick={() => router.back()} className={styles.backButton}>
            ← Voltar
          </button>
          <h1 className={styles.title}>Detalhes: {categoria}</h1>
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
          <h1 className={styles.title}>Detalhes: {categoria}</h1>
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
        <h1 className={styles.title}>Detalhes: {categoria}</h1>
      </div>

      <div className={styles.summary}>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>Total de Itens:</span>
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
                  Nenhum produto encontrado
                </td>
              </tr>
            ) : (
              detalhes.map((item, index) => (
                <tr key={`${item.produto}-${item.filial}-${index}`}>
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
                  <td>{item.cor || '-'}</td>
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
