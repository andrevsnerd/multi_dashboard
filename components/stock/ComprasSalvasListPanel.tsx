"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { CompanyKey } from "@/lib/config/company";
import type { CompraSalvaListEntry } from "@/lib/types/compra-salva";

import styles from "./ComprasSalvasListPanel.module.css";

function fmt(n: number) {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
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

export default function ComprasSalvasListPanel({
  companyKey,
  companySlug,
}: {
  companyKey: CompanyKey;
  companySlug: string;
}) {
  const [items, setItems] = useState<CompraSalvaListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    params.set("company", companyKey);
    fetch(`/api/controle-estoque/compras-salvas?${params}`, { cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json()) as { data?: CompraSalvaListEntry[]; error?: string };
        if (!r.ok) throw new Error(j.error ?? "Erro ao carregar");
        return j.data ?? [];
      })
      .then((data) => {
        if (!cancelled) setItems(data);
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
  }, [companyKey]);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) =>
        it.title.toLowerCase().includes(q) ||
        fmtData(it.savedAt).toLowerCase().includes(q)
    );
  }, [items, searchTerm]);

  const base = `/${companySlug}/controle-estoque/projecao/lista-compra/compras-salvas`;

  return (
    <div className={styles.wrapper}>
      <p className={styles.subtitle}>
        Histórico de snapshots da Compra Final. Abra uma compra para acompanhar e editar quantidades.
      </p>

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
            <Link key={it.id} href={`${base}/${it.id}`} className={styles.card}>
              <div className={styles.cardTitle}>{it.title}</div>
              <div className={styles.cardMeta}>
                <span>{it.itemCount} itens</span>
                <span>{fmt(it.totalQtdManual)} un.</span>
                <span>Salva em {fmtData(it.savedAt)}</span>
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
