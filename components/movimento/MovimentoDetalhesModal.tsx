"use client";

import { useEffect, useState, useMemo } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

import type { CompanyKey } from "@/lib/config/company";

import styles from "./MovimentoDetalhesModal.module.css";

interface MovimentoDetalhesModalProps {
  companyKey: CompanyKey;
  isOpen: boolean;
  onClose: () => void;
  tipo: "entradas" | "vendidos" | "parados";
  range: { startDate: Date; endDate: Date };
  filial: string | null;
  grupos: string[];
  linhas: string[];
  colecoes: string[];
  subgrupos: string[];
  grades: string[];
}

interface ProdutoDetalhe {
  produto: string;
  corProduto: string;
  descProduto: string;
  quantidade: number;
  custo?: number;
  valor?: number;
  linha?: string | null;
  grupo?: string | null;
  colecao?: string | null;
  subgrupo?: string | null;
  grade?: string | null;
}

async function fetchDetalhes(
  company: string,
  tipo: "entradas" | "vendidos" | "parados",
  range: { startDate: Date; endDate: Date },
  filial: string | null,
  grupos: string[],
  linhas: string[],
  colecoes: string[],
  subgrupos: string[],
  grades: string[]
): Promise<ProdutoDetalhe[]> {
  const searchParams = new URLSearchParams({
    company,
    tipo,
    start: range.startDate.toISOString(),
    end: range.endDate.toISOString(),
  });

  if (filial) {
    searchParams.set("filial", filial);
  }
  grupos.forEach(g => searchParams.append("grupos", g));
  linhas.forEach(l => searchParams.append("linhas", l));
  colecoes.forEach(c => searchParams.append("colecoes", c));
  subgrupos.forEach(s => searchParams.append("subgrupos", s));
  grades.forEach(g => searchParams.append("grades", g));

  const response = await fetch(`/api/controle-movimento/detalhes?${searchParams.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Erro ao carregar detalhes");
  }

  const json = (await response.json()) as { data: ProdutoDetalhe[] };
  return json.data;
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

export default function MovimentoDetalhesModal({
  companyKey,
  isOpen,
  onClose,
  tipo,
  range,
  filial,
  grupos,
  linhas,
  colecoes,
  subgrupos,
  grades,
}: MovimentoDetalhesModalProps) {
  const [detalhes, setDetalhes] = useState<ProdutoDetalhe[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      setError(null);
      fetchDetalhes(companyKey, tipo, range, filial, grupos, linhas, colecoes, subgrupos, grades)
        .then((data) => {
          setDetalhes(data);
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : "Erro ao carregar detalhes");
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [isOpen, companyKey, tipo, range, filial, grupos, linhas, colecoes, subgrupos, grades]);

  const titulo = useMemo(() => {
    switch (tipo) {
      case "entradas":
        return "Entradas do Período";
      case "vendidos":
        return "Produtos Vendidos";
      case "parados":
        return "Itens Parados";
      default:
        return "Detalhes";
    }
  }, [tipo]);

  const totalQuantidade = useMemo(() => {
    return detalhes.reduce((sum, item) => sum + item.quantidade, 0);
  }, [detalhes]);

  const totalCusto = useMemo(() => {
    return detalhes.reduce((sum, item) => sum + (item.custo || 0), 0);
  }, [detalhes]);

  const totalValor = useMemo(() => {
    return detalhes.reduce((sum, item) => sum + (item.valor || 0), 0);
  }, [detalhes]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>{titulo}</h2>
            <p className={styles.subtitle}>
              {format(range.startDate, "dd/MM/yyyy", { locale: ptBR })} até{" "}
              {format(range.endDate, "dd/MM/yyyy", { locale: ptBR })}
            </p>
          </div>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Fechar"
          >
            ×
          </button>
        </div>

        <div className={styles.content}>
          {loading ? (
            <div className={styles.loading}>Carregando detalhes...</div>
          ) : error ? (
            <div className={styles.error}>{error}</div>
          ) : detalhes.length === 0 ? (
            <div className={styles.empty}>Nenhum produto encontrado</div>
          ) : (
            <>
              <div className={styles.summary}>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Total de Produtos:</span>
                  <span className={styles.summaryValue}>{detalhes.length}</span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Quantidade Total:</span>
                  <span className={styles.summaryValue}>{formatNumber(totalQuantidade)}</span>
                </div>
                {tipo === "entradas" || tipo === "parados" ? (
                  <div className={styles.summaryItem}>
                    <span className={styles.summaryLabel}>Custo Total:</span>
                    <span className={styles.summaryValue}>{formatCurrency(totalCusto)}</span>
                  </div>
                ) : null}
                {tipo === "vendidos" ? (
                  <div className={styles.summaryItem}>
                    <span className={styles.summaryLabel}>Valor Total:</span>
                    <span className={styles.summaryValue}>{formatCurrency(totalValor)}</span>
                  </div>
                ) : null}
              </div>

              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>PRODUTO</th>
                      <th>COR</th>
                      <th>DESCRIÇÃO</th>
                      {companyKey === "scarfme" && <th>LINHA</th>}
                      {companyKey === "nerd" && <th>GRUPO</th>}
                      <th>QUANTIDADE</th>
                      {tipo === "entradas" || tipo === "parados" ? <th>CUSTO</th> : null}
                      {tipo === "vendidos" ? <th>VALOR</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {detalhes.map((item, index) => (
                      <tr key={`${item.produto}-${item.corProduto}-${index}`}>
                        <td className={styles.produtoCell}>{item.produto}</td>
                        <td className={styles.corCell}>{item.corProduto || "-"}</td>
                        <td className={styles.descCell}>{item.descProduto || "-"}</td>
                        {companyKey === "scarfme" && (
                          <td className={styles.categoriaCell}>{item.linha || "-"}</td>
                        )}
                        {companyKey === "nerd" && (
                          <td className={styles.categoriaCell}>{item.grupo || "-"}</td>
                        )}
                        <td className={styles.numberCell}>{formatNumber(item.quantidade)}</td>
                        {tipo === "entradas" || tipo === "parados" ? (
                          <td className={styles.currencyCell}>
                            {item.custo ? formatCurrency(item.custo) : "-"}
                          </td>
                        ) : null}
                        {tipo === "vendidos" ? (
                          <td className={styles.currencyCell}>
                            {item.valor ? formatCurrency(item.valor) : "-"}
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
