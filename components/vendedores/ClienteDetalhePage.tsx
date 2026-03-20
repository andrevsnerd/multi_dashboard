"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import type { ClienteProdutoItem } from "@/lib/repositories/vendedores-v2";
import type { CompanyKey } from "@/lib/config/company";

import styles from "./VendedorDetalhePage.module.css";

interface ClienteDetalhePageProps {
  companyKey: CompanyKey;
  vendedorNome: string;
  filial: string;
  clienteNome: string;
  cpf?: string;
  initialStart: string;
  initialEnd: string;
}

async function fetchProdutos(
  clienteNome: string,
  filial: string,
  cpf: string | undefined,
  start: string,
  end: string,
  company: string
): Promise<ClienteProdutoItem[]> {
  const searchParams = new URLSearchParams({ filial, start, end, company });
  if (cpf) searchParams.set('cpf', cpf);
  const clienteEncoded = encodeURIComponent(clienteNome);
  const response = await fetch(
    `/api/clientes/${clienteEncoded}/produtos?${searchParams.toString()}`,
    { cache: 'no-store' }
  );
  if (!response.ok) throw new Error('Erro ao carregar produtos');
  const json = (await response.json()) as { data: ClienteProdutoItem[] };
  return json.data ?? [];
}

export default function ClienteDetalhePage({
  companyKey,
  vendedorNome,
  filial,
  clienteNome,
  cpf,
  initialStart,
  initialEnd,
}: ClienteDetalhePageProps) {
  const [produtos, setProdutos] = useState<ClienteProdutoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const detalheVendedorUrl = useMemo(() => {
    const p = new URLSearchParams({ vendedor: vendedorNome, filial, start: initialStart, end: initialEnd });
    return `/${companyKey}/vendedores/detalhe?${p.toString()}`;
  }, [companyKey, vendedorNome, filial, initialStart, initialEnd]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetchProdutos(clienteNome, filial, cpf, initialStart, initialEnd, companyKey)
      .then((list) => { if (active) setProdutos(list); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : 'Erro ao carregar'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [clienteNome, filial, cpf, initialStart, initialEnd, companyKey]);

  const formatCurrency = (value: number) =>
    value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const formatNumber = (value: number) =>
    value.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  const totalFaturamento = produtos.reduce((acc, p) => acc + p.faturamento, 0);
  const totalQuantidade = produtos.reduce((acc, p) => acc + p.quantidade, 0);

  const isScarfme = companyKey === 'scarfme';

  return (
    <div className={styles.wrapper}>
      <nav className={styles.breadcrumb}>
        <Link href={`/${companyKey}/vendedores`} className={styles.breadcrumbLink}>
          Vendedores
        </Link>
        <span className={styles.breadcrumbSep}>/</span>
        <Link href={detalheVendedorUrl} className={styles.breadcrumbLink}>
          {vendedorNome}
        </Link>
        <span className={styles.breadcrumbSep}>/</span>
        <span className={styles.breadcrumbCurrent}>{clienteNome}</span>
      </nav>

      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>{clienteNome}</h1>
          <span className={styles.filial}>
            Filial {filial} · Vendedor {vendedorNome}
          </span>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {loading && (
        <div className={styles.loadingBanner}>
          <span className={styles.loadingSpinner} />
          <span>Carregando produtos…</span>
        </div>
      )}

      {!loading && produtos.length === 0 && !error && (
        <div className={styles.empty}>Nenhum produto encontrado para este cliente no período.</div>
      )}

      {!loading && produtos.length > 0 && (
        <div className={styles.summary}>
          <span className={styles.summaryItem}>
            <strong>Faturamento:</strong> {formatCurrency(totalFaturamento)}
          </span>
          <span className={styles.summaryItem}>
            <strong>Quantidade:</strong> {formatNumber(totalQuantidade)}
          </span>
        </div>
      )}

      {!loading && produtos.length > 0 && (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                {isScarfme ? (
                  <>
                    <th className={styles.th}>LINHA</th>
                    <th className={styles.th}>DESCRIÇÃO</th>
                    <th className={styles.th}>COR</th>
                    <th className={styles.th}>GRADE</th>
                    <th className={styles.th}>SUBGRUPO</th>
                    <th className={styles.th}>COLEÇÃO</th>
                  </>
                ) : (
                  <>
                    <th className={styles.th}>GRUPO</th>
                    <th className={styles.th}>DESCRIÇÃO</th>
                    <th className={styles.th}>COR</th>
                  </>
                )}
                <th className={styles.th}>FATURAMENTO</th>
                <th className={styles.th}>QTD</th>
              </tr>
            </thead>
            <tbody>
              {produtos.map((p, i) => (
                <tr key={`${p.codigo ?? p.descricao}-${i}`}>
                  {isScarfme ? (
                    <>
                      <td className={styles.td}>{p.linha || '–'}</td>
                      <td className={styles.td}>
                        <div>{p.descricao}</div>
                        {p.codigo && <div className={styles.codigo}>{p.codigo}</div>}
                      </td>
                      <td className={styles.td}>{p.cor || '–'}</td>
                      <td className={styles.td}>{p.grade || '–'}</td>
                      <td className={styles.td}>{p.subgrupo || '–'}</td>
                      <td className={styles.td}>{p.colecao || '–'}</td>
                    </>
                  ) : (
                    <>
                      <td className={styles.td}>{p.grupo || '–'}</td>
                      <td className={styles.td}>
                        <div>{p.descricao}</div>
                        {p.codigo && <div className={styles.codigo}>{p.codigo}</div>}
                      </td>
                      <td className={styles.td}>{p.cor || '–'}</td>
                    </>
                  )}
                  <td className={styles.td}>{formatCurrency(p.faturamento)}</td>
                  <td className={styles.td}>{formatNumber(p.quantidade)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
