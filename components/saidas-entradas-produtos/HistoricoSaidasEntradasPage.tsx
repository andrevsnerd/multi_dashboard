"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { getFilialLabelForDisplay, resolveCompany, type CompanyKey } from "@/lib/config/company";
import styles from "./HistoricoSaidasEntradasPage.module.css";

type TipoOperacao = "saida" | "entrada";

interface TransferenciaLog {
  romaneio: string;
  filialOrigem: string;
  filialDestino: string;
  destinoCodigo?: string | null;
  tipoRomaneio?: string;
  dataEmissao: string;
  responsavel?: string;
  observacao?: string;
  qtdProdutos: number;
  qtdItens: number;
  status: string;
}

interface HistoricoResponse {
  data: TransferenciaLog[];
  pagination: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
  };
}

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

async function fetchHistorico(
  companyKey: CompanyKey,
  tipo: TipoOperacao,
  filial: string,
  page: number,
  romaneio: string
): Promise<HistoricoResponse> {
  const params = new URLSearchParams({
    company: companyKey,
    tipo,
    filial,
    page: String(page),
    perPage: "30",
  });
  if (romaneio.trim()) params.set("romaneio", romaneio.trim());

  const response = await fetch(`/api/saidas-entradas-produtos/historico?${params.toString()}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Erro ao carregar histórico");
  return (await response.json()) as HistoricoResponse;
}

export default function HistoricoSaidasEntradasPage({ companyKey }: { companyKey: CompanyKey }) {
  const searchParams = useSearchParams();
  const company = useMemo(() => resolveCompany(companyKey), [companyKey]);
  const filialInicial = (searchParams.get("filial") || "").trim();
  const tipoInicial = (searchParams.get("tipo") || "saida").trim().toLowerCase() === "entrada" ? "entrada" : "saida";

  const [tipo, setTipo] = useState<TipoOperacao>(tipoInicial);
  const [filial] = useState(filialInicial);
  const [romaneioFiltro, setRomaneioFiltro] = useState("");
  const [romaneioAplicado, setRomaneioAplicado] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<TransferenciaLog[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const loadHistorico = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetchHistorico(companyKey, tipo, filial, page, romaneioAplicado);
      setLogs(response.data);
      setTotal(response.pagination.total);
      setTotalPages(response.pagination.totalPages);
    } finally {
      setLoading(false);
    }
  }, [companyKey, tipo, filial, page, romaneioAplicado]);
  const destinoLabel = useCallback(
    (log: TransferenciaLog) => {
      const raw = tipo === "saida" ? (log.destinoCodigo || log.filialDestino) : log.filialDestino;
      const t = (raw || "").trim();
      if (!t || t === "—") return "";
      return getFilialLabelForDisplay(company, t);
    },
    [company, tipo]
  );


  useEffect(() => {
    loadHistorico();
  }, [loadHistorico]);

  useEffect(() => {
    setPage(1);
  }, [tipo, romaneioAplicado]);

  const buildDetailUrl = useCallback(
    (log: TransferenciaLog) => {
      const destino = tipo === "saida" ? (log.destinoCodigo || log.filialDestino) : log.filialDestino;
      return `/${companyKey}/romaneios/${encodeURIComponent(log.romaneio)}?tipo=${tipo}&filialOrigem=${encodeURIComponent(log.filialOrigem)}&filialDestino=${encodeURIComponent(destino || "")}&dataEmissao=${encodeURIComponent(log.dataEmissao)}&responsavel=${encodeURIComponent(log.responsavel || "")}&tipoRomaneio=${encodeURIComponent(log.tipoRomaneio || "")}`;
    },
    [companyKey, tipo]
  );

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Histórico completo de {tipo === "saida" ? "saídas" : "entradas"}</h1>
          <p className={styles.subtitle}>
            Filial: {getFilialLabelForDisplay(company, filial || "todas")} · {total} registro(s)
          </p>
        </div>
        <Link href={`/${companyKey}/saidas-entradas-produtos`} className={styles.backLink}>
          Voltar
        </Link>
      </div>

      <div className={styles.filters}>
        <div className={styles.toggle}>
          <button
            type="button"
            className={tipo === "saida" ? styles.toggleActive : ""}
            onClick={() => setTipo("saida")}
          >
            Saídas
          </button>
          <button
            type="button"
            className={tipo === "entrada" ? styles.toggleActive : ""}
            onClick={() => setTipo("entrada")}
          >
            Entradas
          </button>
        </div>
        <input
          className={styles.input}
          placeholder="Filtrar por número do romaneio"
          value={romaneioFiltro}
          onChange={(e) => setRomaneioFiltro(e.target.value)}
        />
        <button
          className={styles.searchBtn}
          onClick={() => {
            setPage(1);
            setRomaneioAplicado(romaneioFiltro);
          }}
        >
          Filtrar
        </button>
      </div>

      <div className={styles.list}>
        {loading ? (
          <div className={styles.empty}>Carregando...</div>
        ) : logs.length === 0 ? (
          <div className={styles.empty}>Nenhum histórico encontrado.</div>
        ) : (
          logs.map((log) => (
            <div
              key={`${tipo}-${log.romaneio}-${log.filialOrigem}-${log.filialDestino}`}
              className={styles.item}
            >
              <div className={styles.itemMain}>
                <div className={styles.itemTopLine}>
                  <span className={styles.itemRomaneio}>#{log.romaneio}</span>
                  <span className={styles.itemCount}>
                    {log.qtdProdutos} prod · {log.qtdItens} {log.qtdItens === 1 ? "item" : "itens"}
                  </span>
                </div>
                <div className={styles.itemRoute}>
                  <span className={styles.itemRouteText}>
                    {getFilialLabelForDisplay(company, log.filialOrigem)}
                    {destinoLabel(log) ? ` → ${destinoLabel(log)}` : ""}
                  </span>
                  <Link
                    href={buildDetailUrl(log)}
                    className={styles.itemOpenLink}
                    title="Abrir romaneio detalhado"
                    aria-label={`Abrir romaneio #${log.romaneio}`}
                  >
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="m10 4 8-1m0 0 1 8m-1-8-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </Link>
                </div>
                <div className={styles.itemSub}>{log.responsavel || "Sem responsável"}</div>
                <div className={styles.itemSub}>Tipo de romaneio: {log.tipoRomaneio?.trim() || "—"}</div>
              </div>
              <div className={styles.itemRight}>
                <span className={styles.itemStatusPill}>
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {log.status}
                </span>
                <span className={styles.itemDate}>{formatDate(log.dataEmissao)}</span>
              </div>
            </div>
          ))
        )}
      </div>

      <div className={styles.pagination}>
        <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</button>
        <span>Página {page} de {totalPages}</span>
        <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Próxima</button>
      </div>

    </div>
  );
}
