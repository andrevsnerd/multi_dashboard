"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { CompanyKey } from "@/lib/config/company";
import type { CompraSalvaListEntry, CompraSalvaListSummary } from "@/lib/types/compra-salva";

import styles from "./ComprasSalvasListPanel.module.css";

function fmt(n: number) {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

function fmtBRL(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function fmtData(iso: string) {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function fmtHora(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export default function ComprasSalvasListPanel({
  companyKey,
  companySlug,
  source = "lista-compra",
}: {
  companyKey: CompanyKey;
  companySlug: string;
  source?: "lista-compra" | "lista-loja" | "operacoes";
}) {
  const [items, setItems] = useState<CompraSalvaListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [summary, setSummary] = useState<CompraSalvaListSummary>({
    totalGeralPeriodo: 0,
    totalCompras: 0,
    porData: [],
  });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    params.set("company", companyKey);
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    fetch(`/api/controle-estoque/compras-salvas?${params}`, { cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json()) as {
          data?: CompraSalvaListEntry[];
          summary?: CompraSalvaListSummary;
          error?: string;
        };
        if (!r.ok) throw new Error(j.error ?? "Erro ao carregar");
        return {
          data: j.data ?? [],
          summary: j.summary ?? { totalGeralPeriodo: 0, totalCompras: 0, porData: [] },
        };
      })
      .then((payload) => {
        if (!cancelled) {
          setItems(payload.data);
          setSummary(payload.summary);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Erro");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyKey, fromDate, toDate]);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) =>
        it.title.toLowerCase().includes(q) ||
        fmtData(it.savedAt).toLowerCase().includes(q)
    );
  }, [items, searchTerm]);

  const handleToggleComprada = useCallback(
    async (e: React.SyntheticEvent, it: CompraSalvaListEntry) => {
      e.preventDefault();
      e.stopPropagation();
      if (toggling.has(it.id)) return;
      setToggling((prev) => new Set(prev).add(it.id));
      const novaComprada = !it.comprada;
      // Optimistic update
      setItems((prev) =>
        prev.map((x) => (x.id === it.id ? { ...x, comprada: novaComprada } : x))
      );
      try {
        const params = new URLSearchParams({ company: companyKey });
        const res = await fetch(
          `/api/controle-estoque/compras-salvas/${it.id}?${params}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ comprada: novaComprada }),
          }
        );
        if (!res.ok) {
          // Reverte em caso de erro
          setItems((prev) =>
            prev.map((x) => (x.id === it.id ? { ...x, comprada: it.comprada } : x))
          );
        }
      } catch {
        setItems((prev) =>
          prev.map((x) => (x.id === it.id ? { ...x, comprada: it.comprada } : x))
        );
      } finally {
        setToggling((prev) => {
          const next = new Set(prev);
          next.delete(it.id);
          return next;
        });
      }
    },
    [companyKey, toggling]
  );

  const base =
    source === "operacoes"
      ? `/${companySlug}/compras-salvas`
      : `/${companySlug}/controle-estoque/projecao/lista-compra/compras-salvas`;
  const detailQuery =
    source === "lista-loja" ? "?from=lista-loja" : source === "operacoes" ? "?from=operacoes" : "";

  return (
    <div className={styles.wrapper}>
      <p className={styles.subtitle}>
        Histórico de snapshots da Compra Final. Abra uma compra para acompanhar e editar quantidades.
      </p>

      <div className={styles.kpiRow}>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Total comprado no período</span>
          <strong className={styles.kpiValue}>{fmtBRL(summary.totalGeralPeriodo)}</strong>
          <span className={styles.kpiSub}>{summary.totalCompras} compras no intervalo</span>
        </div>
      </div>

      <div className={styles.filterRow}>
        <label className={styles.dateField}>
          <span>De</span>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </label>
        <label className={styles.dateField}>
          <span>Até</span>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </label>
        {(fromDate || toDate) && (
          <button
            type="button"
            className={styles.clearDates}
            onClick={() => {
              setFromDate("");
              setToDate("");
            }}
          >
            Limpar período
          </button>
        )}
      </div>

      <div className={styles.searchBox}>
        <svg viewBox="0 0 24 24" fill="none" className={styles.searchIcon} aria-hidden="true">
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
          <path d="M16.5 16.5 21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Buscar por título ou data..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        {searchTerm && (
          <button type="button" className={styles.searchClear} onClick={() => setSearchTerm("")} aria-label="Limpar">
            ×
          </button>
        )}
      </div>

      {loading && <div className={styles.loading}>Carregando compras salvas...</div>}
      {error && <div className={styles.error}>{error}</div>}
      {!loading && !error && items.length === 0 && (
        <div className={styles.empty}>Nenhuma compra salva ainda. Use &quot;Salvar compra atual&quot; na aba Compra Final.</div>
      )}
      {!loading && !error && filtered.length > 0 && (
        <div className={styles.list}>
          {filtered.map((it) => (
            <Link
              key={it.id}
              href={`${base}/${it.id}${detailQuery}`}
              className={`${styles.card} ${it.comprada ? styles.cardComprada : ""}`}
            >
              <div className={styles.cardMain}>
                <div className={styles.cardTitleRow}>
                  <input
                    type="checkbox"
                    className={styles.compradaCheckbox}
                    checked={!!it.comprada}
                    disabled={toggling.has(it.id)}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onChange={(e) => void handleToggleComprada(e, it)}
                    aria-label={it.comprada ? "Desmarcar como comprada" : "Marcar como comprada"}
                  />
                  <div className={styles.cardTitle}>{it.title}</div>
                  <span className={styles.cardHour}>{fmtHora(it.savedAt)}</span>
                </div>
              </div>
              <div className={styles.cardRight}>
                {it.comprada && <span className={styles.compradaBadge}>Comprada</span>}
                <div className={styles.cardMetaInline}>
                  <span>{it.itemCount} itens</span>
                  <span>{fmt(it.totalQtdManual)} un.</span>
                </div>
                {it.totalValor > 0 && (
                  <div className={styles.totalValorBox}>
                    <strong className={styles.totalValorValue}>{fmtBRL(it.totalValor)}</strong>
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
      {!loading && !error && items.length > 0 && filtered.length === 0 && (
        <div className={styles.empty}>Nenhum resultado para a busca.</div>
      )}
    </div>
  );
}
