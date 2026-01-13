"use client";

import { useEffect, useState, useMemo } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import Link from "next/link";
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
  const pathname = usePathname();
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

  // Agregar dados por produto (sem filial) para primeira visão
  const produtosAgregados = useMemo(() => {
    const agregados = new Map<string, {
      produto: string;
      descricao: string;
      cor?: string;
      descCor?: string;
      linha?: string;
      subgrupo?: string;
      grade?: string;
      colecao?: string;
      estoqueTotal: number;
      custoUnitario: number;
      custoTotal: number;
      detalhesPorFilial: ProdutoDetalheEstoque[];
    }>();

    detalhes.forEach(item => {
      // Criar chave única para o produto (produto + cor + linha + subgrupo + grade + coleção)
      const chave = `${item.produto}|${item.cor || ''}|${item.linha || ''}|${item.subgrupo || ''}|${item.grade || ''}|${item.colecao || ''}`;
      
      if (!agregados.has(chave)) {
        agregados.set(chave, {
          produto: item.produto,
          descricao: item.descricao,
          cor: item.cor,
          descCor: item.descCor,
          linha: item.linha,
          subgrupo: item.subgrupo,
          grade: item.grade,
          colecao: item.colecao,
          estoqueTotal: 0,
          custoUnitario: item.custoUnitario, // Mesmo custo unitário para todas as filiais
          custoTotal: 0,
          detalhesPorFilial: [],
        });
      }

      const agregado = agregados.get(chave)!;
      agregado.estoqueTotal += item.estoque;
      agregado.custoTotal += item.custoTotal;
      agregado.detalhesPorFilial.push(item);
    });

    return Array.from(agregados.values());
  }, [detalhes]);

  const totalEstoque = produtosAgregados.reduce((sum, item) => sum + item.estoqueTotal, 0);
  const totalCusto = produtosAgregados.reduce((sum, item) => sum + item.custoTotal, 0);

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
          <span className={styles.summaryValue}>{produtosAgregados.length}</span>
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
              <th className={styles.numberCell}>Estoque</th>
              <th className={styles.numberCell}>Custo Unit.</th>
              <th className={styles.numberCell}>Custo Total</th>
            </tr>
          </thead>
          <tbody>
            {produtosAgregados.length === 0 ? (
              <tr>
                <td colSpan={companyKey !== 'nerd' ? 10 : 6} className={styles.emptyMessage}>
                  Nenhum produto encontrado
                </td>
              </tr>
            ) : (
              produtosAgregados.map((produto, index) => {
                const chave = `${produto.produto}|${produto.cor || ''}|${produto.linha || ''}|${produto.subgrupo || ''}|${produto.grade || ''}|${produto.colecao || ''}`;
                
                // Construir URL para página de detalhes do produto
                const produtoParams = new URLSearchParams();
                if (produto.cor) produtoParams.set('cor', produto.cor);
                if (produto.linha) produtoParams.set('linha', produto.linha);
                if (produto.subgrupo) produtoParams.set('subgrupo', produto.subgrupo);
                if (produto.grade) produtoParams.set('grade', produto.grade);
                if (produto.colecao) produtoParams.set('colecao', produto.colecao);
                
                // Manter filtros da URL atual
                const filial = searchParams.get('filial');
                if (filial) produtoParams.set('filial', filial);
                const grupos = searchParams.get('grupos');
                if (grupos) produtoParams.set('grupos', grupos);
                const linhas = searchParams.get('linhas');
                if (linhas) produtoParams.set('linhas', linhas);
                const colecoes = searchParams.get('colecoes');
                if (colecoes) produtoParams.set('colecoes', colecoes);
                const subgrupos = searchParams.get('subgrupos');
                if (subgrupos) produtoParams.set('subgrupos', subgrupos);
                const grades = searchParams.get('grades');
                if (grades) produtoParams.set('grades', grades);
                
                const produtoUrl = `${pathname}/${encodeURIComponent(produto.produto)}${produtoParams.toString() ? '?' + produtoParams.toString() : ''}`;
                
                return (
                  <tr 
                    key={chave}
                    className={styles.produtoRow}
                  >
                    <td className={styles.produtoCell}>
                      <Link href={produtoUrl} className={styles.produtoLink}>
                        {produto.produto}
                      </Link>
                    </td>
                    <td className={styles.descricaoCell}>{produto.descricao}</td>
                    {companyKey !== 'nerd' && (
                      <>
                        <td>{produto.linha || '-'}</td>
                        <td>{produto.subgrupo || '-'}</td>
                        <td>{produto.grade || '-'}</td>
                        <td>{produto.colecao || '-'}</td>
                      </>
                    )}
                    <td>{produto.descCor || produto.cor || '-'}</td>
                    <td className={styles.numberCell}>{formatNumber(produto.estoqueTotal)}</td>
                    <td className={styles.numberCell}>{formatCurrency(produto.custoUnitario)}</td>
                    <td className={styles.numberCell}>{formatCurrency(produto.custoTotal)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
