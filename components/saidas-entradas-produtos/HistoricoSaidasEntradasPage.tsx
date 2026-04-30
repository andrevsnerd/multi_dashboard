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

interface LogDetalheItem {
  produto: string;
  corProduto: string | null;
  descProduto: string;
  descCor: string;
  codigoBarra: string | null;
  qtde: number;
  estoqueOrigem: number;
  estoqueDestino: number;
  filialOrigem?: string;
  filialDestino?: string;
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
  return d.toLocaleString("pt-BR");
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

async function fetchDetalhes(
  tipo: TipoOperacao,
  romaneio: string,
  filialOrigem: string,
  filialDestino: string
): Promise<LogDetalheItem[]> {
  const params = new URLSearchParams({
    tipo,
    romaneio,
    filialOrigem,
    filialDestino,
  });
  const response = await fetch(`/api/transferencia-produtos/log-detalhes?${params.toString()}`, {
    cache: "no-store",
  });
  if (!response.ok) return [];
  const json = (await response.json()) as { data: LogDetalheItem[] };
  return json.data || [];
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
  const [logDetalhe, setLogDetalhe] = useState<TransferenciaLog | null>(null);
  const [detalhes, setDetalhes] = useState<LogDetalheItem[]>([]);
  const [loadingDetalhes, setLoadingDetalhes] = useState(false);

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
      if (tipo === "saida") {
        const destino = log.destinoCodigo || log.filialDestino;
        return getFilialLabelForDisplay(company, destino || "—");
      }
      return getFilialLabelForDisplay(company, log.filialDestino || "—");
    },
    [company, tipo]
  );


  useEffect(() => {
    loadHistorico();
  }, [loadHistorico]);

  useEffect(() => {
    setPage(1);
  }, [tipo, romaneioAplicado]);

  const abrirDetalhes = useCallback(async (log: TransferenciaLog) => {
    setLogDetalhe(log);
    setLoadingDetalhes(true);
    try {
      const data = await fetchDetalhes(tipo, log.romaneio, log.filialOrigem, log.filialDestino);
      setDetalhes(data);
    } finally {
      setLoadingDetalhes(false);
    }
  }, [tipo]);

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
            <button
              key={`${tipo}-${log.romaneio}-${log.filialOrigem}-${log.filialDestino}`}
              className={styles.item}
              onClick={() => abrirDetalhes(log)}
            >
              <div className={styles.itemTop}>
                <strong>#{log.romaneio}</strong>
                <span>{formatDate(log.dataEmissao)}</span>
              </div>
              <div className={styles.itemMeta}>
                {getFilialLabelForDisplay(company, log.filialOrigem)} → {destinoLabel(log)}
              </div>
              <div className={styles.itemMeta}>
                {log.qtdProdutos} produtos · {log.qtdItens} itens · {log.responsavel || "Sem responsável"}
              </div>
              <div className={styles.itemMeta}>
                Tipo de romaneio: {log.tipoRomaneio?.trim() || "—"}
              </div>
            </button>
          ))
        )}
      </div>

      <div className={styles.pagination}>
        <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</button>
        <span>Página {page} de {totalPages}</span>
        <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Próxima</button>
      </div>

      {logDetalhe && (
        <div className={styles.modalOverlay} onClick={() => setLogDetalhe(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>Romaneio #{logDetalhe.romaneio}</h2>
              <button onClick={() => setLogDetalhe(null)}>×</button>
            </div>
            <div className={styles.detailList} style={{ paddingBottom: 0 }}>
              <div className={styles.detailItem}>
                <div><strong>Tipo de romaneio:</strong> {logDetalhe.tipoRomaneio?.trim() || "—"}</div>
              </div>
            </div>
            {loadingDetalhes ? (
              <div className={styles.empty}>Carregando itens...</div>
            ) : detalhes.length === 0 ? (
              <div className={styles.empty}>Sem itens para este romaneio.</div>
            ) : (
              <div className={styles.detailList}>
                {detalhes.map((item, idx) => (
                  <div key={`${item.produto}-${item.corProduto}-${idx}`} className={styles.detailItem}>
                    <div><strong>{item.descProduto || item.produto}</strong></div>
                    <div>{item.produto} {item.descCor ? `· ${item.descCor}` : ""}</div>
                    <div>Quantidade enviada: <strong>{item.qtde}</strong></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
