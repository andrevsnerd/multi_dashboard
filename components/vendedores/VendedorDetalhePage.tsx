"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import type { VendedorProdutoItem, VendedorClienteItem } from "@/lib/repositories/vendedores-v2";
import type { DateRangeValue } from "@/components/filters/DateRangeFilter";
import DateRangeFilter from "@/components/filters/DateRangeFilter";
import { getCurrentMonthRange } from "@/lib/utils/date";
import type { CompanyKey } from "@/lib/config/company";
import { exportVendedorProdutosToExcel } from "@/lib/utils/exportVendedores";

import styles from "./VendedorDetalhePage.module.css";

interface VendedorDetalhePageProps {
  companyKey: CompanyKey;
  companyName: string;
  vendedorNome: string;
  filial: string;
  initialStart: string;
  initialEnd: string;
}

async function fetchProdutos(
  company: string,
  vendedor: string,
  filial: string,
  start: string,
  end: string
): Promise<VendedorProdutoItem[]> {
  const searchParams = new URLSearchParams({ company, filial, start, end });
  const vendedorEncoded = encodeURIComponent(vendedor);
  const response = await fetch(
    `/api/vendedores/${vendedorEncoded}/produtos?${searchParams.toString()}`,
    { cache: "no-store" }
  );
  if (!response.ok) throw new Error("Erro ao carregar produtos");
  const json = (await response.json()) as { data: VendedorProdutoItem[] };
  return json.data ?? [];
}

async function fetchClientes(
  company: string,
  vendedor: string,
  filial: string,
  start: string,
  end: string
): Promise<VendedorClienteItem[]> {
  const searchParams = new URLSearchParams({ company, filial, start, end });
  const vendedorEncoded = encodeURIComponent(vendedor);
  const response = await fetch(
    `/api/vendedores/${vendedorEncoded}/clientes?${searchParams.toString()}`,
    { cache: "no-store" }
  );
  if (!response.ok) throw new Error("Erro ao carregar clientes");
  const json = (await response.json()) as { data: VendedorClienteItem[] };
  return json.data ?? [];
}

type TabKey = "produtos" | "clientes";

export default function VendedorDetalhePage({
  companyKey,
  companyName,
  vendedorNome,
  filial,
  initialStart,
  initialEnd,
}: VendedorDetalhePageProps) {
  const initialRange = useMemo(() => {
    try {
      return {
        startDate: new Date(initialStart),
        endDate: new Date(initialEnd),
      };
    } catch {
      const r = getCurrentMonthRange();
      return { startDate: r.start, endDate: r.end };
    }
  }, [initialStart, initialEnd]);

  const [range, setRange] = useState<DateRangeValue>(initialRange);
  const [activeTab, setActiveTab] = useState<TabKey>("produtos");

  // Produtos tab state
  const [produtos, setProdutos] = useState<VendedorProdutoItem[]>([]);
  const [loadingProdutos, setLoadingProdutos] = useState(true);
  const [errorProdutos, setErrorProdutos] = useState<string | null>(null);

  // Clientes tab state
  const [clientes, setClientes] = useState<VendedorClienteItem[]>([]);
  const [loadingClientes, setLoadingClientes] = useState(false);
  const [errorClientes, setErrorClientes] = useState<string | null>(null);
  const [clientesFetched, setClientesFetched] = useState(false);

  useEffect(() => {
    let active = true;
    setLoadingProdutos(true);
    setErrorProdutos(null);
    fetchProdutos(
      companyKey,
      vendedorNome,
      filial,
      range.startDate.toISOString(),
      range.endDate.toISOString()
    )
      .then((list) => { if (active) setProdutos(list); })
      .catch((err) => { if (active) setErrorProdutos(err instanceof Error ? err.message : "Erro ao carregar"); })
      .finally(() => { if (active) setLoadingProdutos(false); });
    return () => { active = false; };
  }, [companyKey, vendedorNome, filial, range.startDate, range.endDate]);

  // Reset clientes fetch when range changes
  useEffect(() => {
    setClientesFetched(false);
    setClientes([]);
  }, [range.startDate, range.endDate]);

  // Fetch clientes when tab is opened (lazy)
  useEffect(() => {
    if (activeTab !== "clientes" || clientesFetched) return;
    let active = true;
    setLoadingClientes(true);
    setErrorClientes(null);
    fetchClientes(
      companyKey,
      vendedorNome,
      filial,
      range.startDate.toISOString(),
      range.endDate.toISOString()
    )
      .then((list) => { if (active) { setClientes(list); setClientesFetched(true); } })
      .catch((err) => { if (active) setErrorClientes(err instanceof Error ? err.message : "Erro ao carregar"); })
      .finally(() => { if (active) setLoadingClientes(false); });
    return () => { active = false; };
  }, [activeTab, clientesFetched, companyKey, vendedorNome, filial, range.startDate, range.endDate]);

  const formatCurrency = (value: number) =>
    value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const formatNumber = (value: number) =>
    value.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const formatDate = (dateStr: string) => {
    if (!dateStr) return "–";
    const [y, m, d] = dateStr.split("-");
    return `${d}/${m}/${y}`;
  };

  const totalFaturamento = produtos.reduce((acc, p) => acc + p.faturamento, 0);
  const totalQuantidade = produtos.reduce((acc, p) => acc + p.quantidade, 0);

  const buildProdutoUrl = useCallback(
    (p: (typeof produtos)[0]) => {
      if (!p.codigo) return null;
      const params = new URLSearchParams({
        vendedor: vendedorNome,
        filial,
        produto: p.codigo,
        descricao: p.descricao,
        start: range.startDate.toISOString(),
        end: range.endDate.toISOString(),
      });
      return `/${companyKey}/vendedores/detalhe/produto?${params.toString()}`;
    },
    [companyKey, vendedorNome, filial, range]
  );

  const vendedoresListHref = useMemo(() => {
    const params = new URLSearchParams({
      start: initialStart,
      end: initialEnd,
    });
    const filialTrim = filial.trim();
    if (filialTrim) {
      params.set("filial", filialTrim);
    }
    return `/${companyKey}/vendedores?${params.toString()}`;
  }, [companyKey, initialStart, initialEnd, filial]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.topNav}>
        <Link href={vendedoresListHref} className={styles.backButton}>
          ← Voltar
        </Link>
        <nav className={styles.breadcrumb}>
          <Link href={vendedoresListHref} className={styles.breadcrumbLink}>
            Vendedores
          </Link>
          <span className={styles.breadcrumbSep}>/</span>
          <span className={styles.breadcrumbCurrent}>{vendedorNome}</span>
        </nav>
      </div>

      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>{vendedorNome}</h1>
          <span className={styles.filial}>Filial {filial}</span>
        </div>
        <div className={styles.headerRight}>
          <DateRangeFilter value={range} onChange={setRange} />
          {activeTab === "produtos" && (
            <button
              type="button"
              className={styles.exportButton}
              onClick={() => exportVendedorProdutosToExcel(produtos, companyKey, vendedorNome, range)}
              disabled={loadingProdutos || produtos.length === 0}
              title="Exportar produtos para Excel"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8 2V11M8 11L5 8M8 11L11 8M2 14H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Exportar XLSX
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className={styles.tabs}>
        <button
          type="button"
          className={`${styles.tab} ${activeTab === "produtos" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("produtos")}
        >
          Produtos
        </button>
        <button
          type="button"
          className={`${styles.tab} ${activeTab === "clientes" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("clientes")}
        >
          Clientes
        </button>
      </div>

      {/* ── PRODUTOS TAB ── */}
      {activeTab === "produtos" && (
        <>
          {errorProdutos && <div className={styles.error}>{errorProdutos}</div>}
          {loadingProdutos && (
            <div className={styles.loadingBanner}>
              <span className={styles.loadingSpinner} />
              <span>Carregando produtos…</span>
            </div>
          )}
          {!loadingProdutos && produtos.length === 0 && !errorProdutos && (
            <div className={styles.empty}>Nenhum produto encontrado no período.</div>
          )}
          {!loadingProdutos && produtos.length > 0 && (
            <div className={styles.summary}>
              <span className={styles.summaryItem}>
                <strong>Faturamento:</strong> {formatCurrency(totalFaturamento)}
              </span>
              <span className={styles.summaryItem}>
                <strong>Quantidade:</strong> {formatNumber(totalQuantidade)}
              </span>
            </div>
          )}
          {!loadingProdutos && produtos.length > 0 && (
            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    {companyKey === "scarfme" ? (
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
                    <tr key={`${p.descricao}-${i}`}>
                      {companyKey === "scarfme" ? (
                        <>
                          <td className={styles.td}>{p.linha || "–"}</td>
                          <td className={styles.td}>
                            {(() => {
                              const url = buildProdutoUrl(p);
                              return url ? (
                                <Link href={url} className={styles.produtoLink}>{p.descricao}</Link>
                              ) : (
                                <div>{p.descricao}</div>
                              );
                            })()}
                            {p.codigo && <div className={styles.codigo}>{p.codigo}</div>}
                          </td>
                          <td className={styles.td}>{p.cor || "–"}</td>
                          <td className={styles.td}>{p.grade || "–"}</td>
                          <td className={styles.td}>{p.subgrupo || "–"}</td>
                          <td className={styles.td}>{p.colecao || "–"}</td>
                        </>
                      ) : (
                        <>
                          <td className={styles.td}>{p.grupo || "–"}</td>
                          <td className={styles.td}>
                            {(() => {
                              const url = buildProdutoUrl(p);
                              return url ? (
                                <Link href={url} className={styles.produtoLink}>{p.descricao}</Link>
                              ) : (
                                <div>{p.descricao}</div>
                              );
                            })()}
                            {p.codigo && <div className={styles.codigo}>{p.codigo}</div>}
                          </td>
                          <td className={styles.td}>{p.cor || "–"}</td>
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
        </>
      )}

      {/* ── CLIENTES TAB ── */}
      {activeTab === "clientes" && (
        <>
          {errorClientes && <div className={styles.error}>{errorClientes}</div>}
          {loadingClientes && (
            <div className={styles.loadingBanner}>
              <span className={styles.loadingSpinner} />
              <span>Carregando clientes…</span>
            </div>
          )}
          {!loadingClientes && clientes.length === 0 && !errorClientes && clientesFetched && (
            <div className={styles.empty}>Nenhum cliente encontrado no período.</div>
          )}
          {!loadingClientes && clientes.length > 0 && (
            <div className={styles.summary}>
              <span className={styles.summaryItem}>
                <strong>Clientes cadastrados:</strong> {formatNumber(clientes.length)}
              </span>
            </div>
          )}
          {!loadingClientes && clientes.length > 0 && (
            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.th}>DATA</th>
                    <th className={styles.th}>NOME</th>
                    <th className={styles.th}>TELEFONE</th>
                    <th className={styles.th}>CPF</th>
                    <th className={styles.th}>ENDEREÇO</th>
                    <th className={styles.th}>CIDADE</th>
                  </tr>
                </thead>
                <tbody>
                  {clientes.map((c, i) => (
                    <tr key={i}>
                      <td className={styles.td}>{formatDate(c.data)}</td>
                      <td className={styles.td}>
                        {c.nome ? (
                          (() => {
                            const params = new URLSearchParams({
                              vendedor: vendedorNome,
                              filial,
                              cliente: c.nome,
                              start: range.startDate.toISOString(),
                              end: range.endDate.toISOString(),
                            });
                            if (c.cpf) params.set('cpf', c.cpf);
                            return (
                              <Link
                                href={`/${companyKey}/vendedores/detalhe/cliente?${params.toString()}`}
                                className={styles.produtoLink}
                              >
                                {c.nome}
                              </Link>
                            );
                          })()
                        ) : "–"}
                      </td>
                      <td className={styles.td}>{c.telefone || "–"}</td>
                      <td className={styles.td}>{c.cpf || "–"}</td>
                      <td className={styles.td}>{c.endereco || "–"}</td>
                      <td className={styles.td}>{c.cidade || "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
