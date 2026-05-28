"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import styles from "./ControleTransferenciasTable.module.css";

/**
 * Painel "Realizadas" exibido dentro de um destinationGroup quando o usuário
 * troca para a aba. Mostra os últimos 30 dias de transferências executadas
 * para esse origem→destino, com status derivado:
 *   - amarelo (pendente): saída registrada, entrada não confirmada
 *   - verde (confirmada): entrada confirmada na página de romaneios
 */
export interface RealizadasPanelRow {
  id: number;
  produto: string;
  corDescricao: string | null;
  corCodigo: string | null;
  descricao: string | null;
  romaneioSaida: string;
  quantidade: number;
  qtdConfirmada: number;
  dataSaida: string;
  status: "pendente" | "confirmada";
}

interface RealizadasPanelProps {
  companyKey: string;
  companySlug: string;
  origemCanonico: string;
  origemLabel: string;
  destinoCanonico: string;
  destinoLabel: string;
}

const LIMIT_PREVIEW = 30;
const SINCE_DAYS = 30;

function formatarData(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }) + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export default function RealizadasPanel({
  companyKey,
  companySlug,
  origemCanonico,
  origemLabel,
  destinoCanonico,
  destinoLabel,
}: RealizadasPanelProps) {
  const [rows, setRows] = useState<RealizadasPanelRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    // Lifecycle de fetch: marcamos loading e limpamos estados via microtask.
    // (Evita o warning react-hooks/set-state-in-effect sobre setState síncrono no body.)
    queueMicrotask(() => {
      if (!active) return;
      setLoading(true);
      setError(null);
    });

    const params = new URLSearchParams({
      company: companyKey,
      origem: origemCanonico,
      destino: destinoCanonico,
      days: String(SINCE_DAYS),
      limit: String(LIMIT_PREVIEW),
      offset: "0",
    });

    fetch(`/api/transferencias-pendentes?${params.toString()}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Erro ao carregar realizadas.");
        }
        const json = (await res.json()) as { data: RealizadasPanelRow[] };
        if (!active) return;
        setRows(json.data || []);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Erro ao carregar realizadas.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [companyKey, origemCanonico, destinoCanonico]);

  const historicoUrl =
    `/${companySlug}/historico-transferencias` +
    `?origem=${encodeURIComponent(origemCanonico)}` +
    `&destino=${encodeURIComponent(destinoCanonico)}`;

  if (loading && !rows) {
    return (
      <div className={styles.realizadasWrap}>
        <div className={styles.realizadasEmpty}>Carregando histórico…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.realizadasWrap}>
        <div className={styles.realizadasEmpty}>Não foi possível carregar: {error}</div>
      </div>
    );
  }

  if (!rows || rows.length === 0) {
    return (
      <div className={styles.realizadasWrap}>
        <div className={styles.realizadasEmpty}>
          Nenhuma transferência registrada para {origemLabel} → {destinoLabel} nos últimos {SINCE_DAYS} dias.
        </div>
        <div className={styles.realizadasFooter}>
          <span />
          <Link href={historicoUrl} className={styles.realizadasFooterLink}>
            Ver tudo no histórico →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.realizadasWrap}>
      <table className={styles.realizadasTable}>
        <thead>
          <tr>
            <th>Status</th>
            <th>Produto</th>
            <th>Cor</th>
            <th>Qtd</th>
            <th>Romaneio</th>
            <th>Data saída</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const statusClass =
              row.status === "confirmada"
                ? `${styles.realizadasStatus} ${styles.realizadasStatusConfirmada}`
                : `${styles.realizadasStatus} ${styles.realizadasStatusPendente}`;
            const statusLabel =
              row.status === "confirmada"
                ? "Confirmada"
                : `Pendente${row.qtdConfirmada > 0 ? ` · ${row.qtdConfirmada}/${row.quantidade}` : ""}`;
            return (
              <tr key={row.id}>
                <td>
                  <span className={statusClass} title={statusLabel}>
                    <span className={styles.realizadasStatusDot} aria-hidden />
                    {statusLabel}
                  </span>
                </td>
                <td>
                  <strong>{row.produto}</strong>
                  {row.descricao ? (
                    <div style={{ fontSize: 11, color: "#6b7280" }}>{row.descricao}</div>
                  ) : null}
                </td>
                <td>{row.corDescricao || row.corCodigo || "—"}</td>
                <td>{row.quantidade}</td>
                <td className={styles.realizadasRomaneio}>{row.romaneioSaida}</td>
                <td className={styles.realizadasData}>{formatarData(row.dataSaida)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className={styles.realizadasFooter}>
        <span>
          Últimos {rows.length} {rows.length === 1 ? "registro" : "registros"} ({SINCE_DAYS} dias)
        </span>
        <Link href={historicoUrl} className={styles.realizadasFooterLink}>
          Ver tudo no histórico →
        </Link>
      </div>
    </div>
  );
}
