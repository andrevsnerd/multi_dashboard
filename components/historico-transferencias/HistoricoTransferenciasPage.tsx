"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import Link from "next/link";

import type { CompanyKey } from "@/lib/config/company";
import { resolveCompany } from "@/lib/config/company";

import styles from "./HistoricoTransferenciasPage.module.css";

interface HistoricoTransferenciasPageProps {
  companyKey: CompanyKey;
  companyName: string;
}

interface TransferenciaRow {
  id: number;
  itemKey: string;
  produto: string;
  corDescricao: string | null;
  corCodigo: string | null;
  descricao: string | null;
  codigoBarra: string | null;
  origemCanonico: string;
  destinoCanonico: string;
  origemLabel: string | null;
  destinoLabel: string | null;
  romaneioSaida: string;
  quantidade: number;
  qtdConfirmada: number;
  dataSaida: string;
  createdBy: string | null;
  status: "pendente" | "confirmada";
}

const PAGE_SIZE = 30;

function formatarData(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return (
    d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) +
    " " +
    d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
  );
}

export default function HistoricoTransferenciasPage({
  companyKey,
  companyName,
}: HistoricoTransferenciasPageProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const company = resolveCompany(companyKey);
  const filialDisplayNames = company?.filialDisplayNames ?? {};
  const inventoryFiliais = company?.filialFilters?.inventory ?? [];

  const initialOrigem = searchParams.get("origem") || "";
  const initialDestino = searchParams.get("destino") || "";
  const initialStatusParam = searchParams.get("status") || "";
  const initialStatus =
    initialStatusParam === "pendente" || initialStatusParam === "confirmada"
      ? (initialStatusParam as "pendente" | "confirmada")
      : "";
  const initialDays = parseInt(searchParams.get("days") || "", 10);
  const initialPage = Math.max(0, parseInt(searchParams.get("page") || "0", 10) || 0);

  const [origem, setOrigem] = useState<string>(initialOrigem);
  const [destino, setDestino] = useState<string>(initialDestino);
  const [status, setStatus] = useState<"" | "pendente" | "confirmada">(initialStatus);
  const [days, setDays] = useState<number>(
    Number.isFinite(initialDays) && initialDays > 0 ? initialDays : 90
  );
  const [page, setPage] = useState<number>(initialPage);

  const [rows, setRows] = useState<TransferenciaRow[]>([]);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Atualiza a URL sem recarregar
  const syncURL = useCallback(() => {
    const params = new URLSearchParams();
    if (origem) params.set("origem", origem);
    if (destino) params.set("destino", destino);
    if (status) params.set("status", status);
    if (days !== 90) params.set("days", String(days));
    if (page > 0) params.set("page", String(page));
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [origem, destino, status, days, page, pathname, router]);

  useEffect(() => {
    syncURL();
  }, [syncURL]);

  // Fetch
  useEffect(() => {
    let active = true;
    // Lifecycle de fetch: marca loading via microtask para evitar
    // setState síncrono no body do effect.
    queueMicrotask(() => {
      if (!active) return;
      setLoading(true);
      setError(null);
    });

    const params = new URLSearchParams({
      company: companyKey,
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
      days: String(days),
    });
    if (origem) params.set("origem", origem);
    if (destino) params.set("destino", destino);
    if (status) params.set("status", status);

    fetch(`/api/transferencias-pendentes?${params.toString()}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Erro ao carregar histórico.");
        }
        const json = (await res.json()) as { data: TransferenciaRow[]; total: number };
        if (!active) return;
        setRows(json.data || []);
        setHasMore((json.data?.length ?? 0) >= PAGE_SIZE && (json.total ?? 0) > PAGE_SIZE);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Erro ao carregar histórico.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [companyKey, page, days, origem, destino, status]);

  const filialOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: Array<{ value: string; label: string }> = [];
    for (const f of inventoryFiliais) {
      if (seen.has(f)) continue;
      seen.add(f);
      options.push({ value: f, label: filialDisplayNames[f] || f });
    }
    return options.sort((a, b) => a.label.localeCompare(b.label));
  }, [inventoryFiliais, filialDisplayNames]);

  const resetFilters = () => {
    setOrigem("");
    setDestino("");
    setStatus("");
    setDays(90);
    setPage(0);
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Histórico de Transferências</h1>
          <p className={styles.subtitle}>{companyName}</p>
        </div>
        <Link href={`/${companyKey}/controle-transferencias`} className={styles.backLink}>
          ← Voltar ao Controle
        </Link>
      </div>

      <div className={styles.filtersBar}>
        <label className={styles.filterField}>
          <span>Origem</span>
          <select value={origem} onChange={(e) => { setPage(0); setOrigem(e.target.value); }}>
            <option value="">Todas</option>
            {filialOptions.map((o) => (
              <option key={`o-${o.value}`} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className={styles.filterField}>
          <span>Destino</span>
          <select value={destino} onChange={(e) => { setPage(0); setDestino(e.target.value); }}>
            <option value="">Todos</option>
            {filialOptions.map((o) => (
              <option key={`d-${o.value}`} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className={styles.filterField}>
          <span>Status</span>
          <select
            value={status}
            onChange={(e) => {
              setPage(0);
              const v = e.target.value;
              setStatus(v === "pendente" || v === "confirmada" ? v : "");
            }}
          >
            <option value="">Todos</option>
            <option value="pendente">Pendente</option>
            <option value="confirmada">Confirmada</option>
          </select>
        </label>
        <label className={styles.filterField}>
          <span>Período</span>
          <select
            value={days}
            onChange={(e) => {
              setPage(0);
              setDays(parseInt(e.target.value, 10));
            }}
          >
            <option value={30}>Últimos 30 dias</option>
            <option value={90}>Últimos 90 dias</option>
            <option value={180}>Últimos 6 meses</option>
            <option value={365}>Último ano</option>
            <option value={3650}>Tudo</option>
          </select>
        </label>
        <button type="button" className={styles.resetBtn} onClick={resetFilters}>
          Limpar
        </button>
      </div>

      {error ? <div className={styles.errorBox}>{error}</div> : null}

      <div className={styles.tableCard}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Status</th>
              <th>Produto</th>
              <th>Cor</th>
              <th>Qtd</th>
              <th>Origem</th>
              <th>Destino</th>
              <th>Romaneio</th>
              <th>Data saída</th>
              <th>Por</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={9} className={styles.emptyCell}>Carregando…</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={9} className={styles.emptyCell}>
                  Nenhuma transferência encontrada para os filtros aplicados.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const statusClass =
                  row.status === "confirmada"
                    ? `${styles.statusBadge} ${styles.statusConfirmada}`
                    : `${styles.statusBadge} ${styles.statusPendente}`;
                const statusLabel =
                  row.status === "confirmada"
                    ? "Confirmada"
                    : `Pendente${row.qtdConfirmada > 0 ? ` · ${row.qtdConfirmada}/${row.quantidade}` : ""}`;
                return (
                  <tr key={row.id}>
                    <td>
                      <span className={statusClass}>
                        <span className={styles.statusDot} aria-hidden />
                        {statusLabel}
                      </span>
                    </td>
                    <td>
                      <strong>{row.produto}</strong>
                      {row.descricao ? <div className={styles.cellSub}>{row.descricao}</div> : null}
                    </td>
                    <td>{row.corDescricao || row.corCodigo || "—"}</td>
                    <td>{row.quantidade}</td>
                    <td>{row.origemLabel || row.origemCanonico}</td>
                    <td>{row.destinoLabel || row.destinoCanonico}</td>
                    <td className={styles.romaneioCell}>{row.romaneioSaida}</td>
                    <td className={styles.dateCell}>{formatarData(row.dataSaida)}</td>
                    <td className={styles.byCell}>{row.createdBy || "—"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className={styles.paginator}>
        <button
          type="button"
          className={styles.pageBtn}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={page === 0 || loading}
        >
          ← Anterior
        </button>
        <span className={styles.pageInfo}>
          Página {page + 1}
          {hasMore ? "" : " (fim)"}
        </span>
        <button
          type="button"
          className={styles.pageBtn}
          onClick={() => setPage((p) => p + 1)}
          disabled={!hasMore || loading}
        >
          Próxima →
        </button>
      </div>
    </div>
  );
}
