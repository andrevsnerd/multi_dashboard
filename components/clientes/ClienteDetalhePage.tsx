"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { CompanyKey } from "@/lib/config/company";
import type { ClienteCompraDetalheItem, ClienteDetalheInfo } from "@/lib/clientes/cliente-types";
import { parseSemCadastroChave } from "@/lib/clientes/sem-cadastro-chave";

import styles from "../vendedores/VendedorDetalhePage.module.css";

interface ClienteDetalhePageProps {
  companyKey: CompanyKey;
  clienteNome: string;
  cpf?: string;
  /** Chave da lista (ex.: SEM_CAD_filial_pedido_ticket). */
  chaveCliente?: string;
  initialStart: string;
  initialEnd: string;
}

async function fetchClienteResumo(
  companyKey: string,
  clienteNome: string,
  cpf: string | undefined,
  chaveCliente: string | undefined,
  initialStart: string,
  initialEnd: string
): Promise<{
  detalhe: ClienteDetalheInfo | null;
  compras: ClienteCompraDetalheItem[];
}> {
  const params = new URLSearchParams({
    company: companyKey,
    start: initialStart,
    end: initialEnd,
  });
  if (cpf) params.set("cpf", cpf);
  if (chaveCliente) params.set("chave", chaveCliente);
  const clienteEncoded = encodeURIComponent(clienteNome);
  const response = await fetch(
    `/api/clientes/${clienteEncoded}/resumo?${params.toString()}`,
    { cache: "no-store" }
  );
  if (!response.ok) throw new Error("Erro ao carregar dados do cliente");
  const json = (await response.json()) as {
    detalhe: ClienteDetalheInfo | null;
    compras: ClienteCompraDetalheItem[];
  };
  return {
    detalhe: json.detalhe ?? null,
    compras: json.compras ?? [],
  };
}

export default function ClienteDetalhePage({
  companyKey,
  clienteNome,
  cpf,
  chaveCliente,
  initialStart,
  initialEnd,
}: ClienteDetalhePageProps) {
  const [detalhe, setDetalhe] = useState<ClienteDetalheInfo | null>(null);
  const [compras, setCompras] = useState<ClienteCompraDetalheItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    fetchClienteResumo(
      companyKey,
      clienteNome,
      cpf,
      chaveCliente,
      initialStart,
      initialEnd
    )
      .then(({ detalhe: detalheInfo, compras: comprasInfo }) => {
        if (!active) return;
        setDetalhe(detalheInfo);
        setCompras(comprasInfo);
      })
      .catch((err) => {
        if (!active) return;
        setError(
          err instanceof Error ? err.message : "Erro ao carregar detalhe do cliente"
        );
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [companyKey, clienteNome, cpf, chaveCliente, initialStart, initialEnd]);

  const totalGasto = useMemo(
    () => compras.reduce((acc, item) => acc + item.valor, 0),
    [compras]
  );

  const formatCurrency = (value: number) =>
    value.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const formatNumber = (value: number) =>
    value.toLocaleString("pt-BR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });

  const formatDate = (value: Date | string) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "Data invalida";
    return date.toLocaleDateString("pt-BR");
  };

  const cadastro = detalhe ?? {
    nomeCliente: clienteNome,
    telefone: "",
    cpf: cpf ?? "",
    endereco: "",
    cidade: "",
    vendedores: [],
  };

  const semCadParsed = chaveCliente ? parseSemCadastroChave(chaveCliente) : null;

  return (
    <div className={styles.wrapper}>
      <nav className={styles.breadcrumb}>
        <Link href={`/${companyKey}/clientes`} className={styles.breadcrumbLink}>
          Clientes
        </Link>
        <span className={styles.breadcrumbSep}>/</span>
        <span className={styles.breadcrumbCurrent}>{clienteNome}</span>
      </nav>

      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>{cadastro.nomeCliente}</h1>
          <span className={styles.filial}>
            {cadastro.semCadastroNoCaixa || semCadParsed
              ? "Venda sem cadastro de cliente no caixa — vendedor abaixo é quem registrou a venda."
              : "Detalhe do cliente"}
            {semCadParsed ? (
              <>
                {" "}
                Filial {semCadParsed.filial} · Pedido {semCadParsed.pedido} ·
                Ticket {semCadParsed.ticket}
              </>
            ) : null}
          </span>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {loading && (
        <div className={styles.loadingBanner}>
          <span className={styles.loadingSpinner} />
          <span>Carregando dados…</span>
        </div>
      )}

      {!loading && (
        <div className={styles.summary}>
          <span className={styles.summaryItem}>
            <strong>TELEFONE:</strong> {cadastro.telefone || "-"}
          </span>
          <span className={styles.summaryItem}>
            <strong>CPF:</strong> {cadastro.cpf || "-"}
          </span>
          <span className={styles.summaryItem}>
            <strong>ENDEREÇO:</strong> {cadastro.endereco || "-"}
          </span>
          <span className={styles.summaryItem}>
            <strong>CIDADE:</strong> {cadastro.cidade || "-"}
          </span>
          <span className={styles.summaryItem}>
            <strong>
              {cadastro.semCadastroNoCaixa
                ? "VENDEDOR (SEM CADASTRO NO CAIXA):"
                : "VENDEDOR(ES) (CADASTRO):"}
            </strong>{" "}
            {cadastro.vendedores.length
              ? cadastro.vendedores.join(", ")
              : cadastro.semCadastroNoCaixa
                ? "Não identificado"
                : "Sem cadastro de vendedor"}
          </span>
          <span className={styles.summaryItem}>
            <strong>TOTAL GASTO:</strong> {formatCurrency(totalGasto)}
          </span>
        </div>
      )}

      {!loading && compras.length === 0 && !error && (
        <div className={styles.empty}>
          Nenhum produto comprado encontrado para este cliente no período.
        </div>
      )}

      {!loading && compras.length > 0 && (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>DATA</th>
                <th className={styles.th}>PRODUTO</th>
                <th className={styles.th}>TICKET</th>
                <th className={styles.th}>VENDEDOR</th>
                <th className={styles.th}>QUANTIDADE</th>
                <th className={styles.th}>VALOR</th>
                <th className={styles.th}>FILIAL</th>
              </tr>
            </thead>
            <tbody>
              {compras.map((item, index) => (
                <tr
                  key={`${item.ticket}-${item.codigo}-${item.filial}-${index}`}
                >
                  <td className={styles.td}>{formatDate(item.dataCompra)}</td>
                  <td className={styles.td}>
                    <div>{item.produto}</div>
                    {item.codigo && (
                      <div className={styles.codigo}>{item.codigo}</div>
                    )}
                  </td>
                  <td className={styles.td}>{item.ticket}</td>
                  <td className={styles.td}>
                    {item.vendedor || "—"}
                  </td>
                  <td className={styles.td}>{formatNumber(item.quantidade)}</td>
                  <td className={styles.td}>{formatCurrency(item.valor)}</td>
                  <td className={styles.td}>{item.filial}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
