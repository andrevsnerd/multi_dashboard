"use client";

import { useState, useEffect, useDeferredValue } from "react";
import Link from "next/link";

import { useAuth } from "@/components/auth/AuthContext";
import styles from "./RomaneiosPage.module.css";

export interface RomaneioListItem {
  tipo: "saida" | "entrada";
  romaneio: string;
  filialOrigem: string;
  filialDestino: string;
  dataEmissao: string;
  responsavel: string;
  qtdProdutos: number;
  qtdItens: number;
  status: string;
  /** Código da filial destino (apenas saídas, quando definido no detalhe). */
  destinoCodigo?: string | null;
  tipoRomaneio?: string;
  /** Número de itens já confirmados na filial destino. */
  qtdConfirmados?: number;
}

interface FilialOption {
  codFilial: string;
  filial: string;
  displayName?: string;
  activeFilial?: string;
  aliases?: string[];
}

interface RomaneiosPageProps {
  companySlug: string;
  companyName: string;
}

async function fetchLogSaidas(
  companySlug: string,
  username?: string | null,
  searchTerm = ""
): Promise<RomaneioListItem[]> {
  const params = new URLSearchParams({ company: companySlug });
  const search = searchTerm.trim();
  if (search) params.set("search", search);
  const url = `/api/romaneios/saidas?${params.toString()}`;
  const headers: Record<string, string> = {};
  if (username) headers["x-auth-username"] = username;
  const response = await fetch(url, { headers, cache: "no-store" });
  if (!response.ok) return [];
  const json = (await response.json()) as { data: Omit<RomaneioListItem, "tipo">[] };
  return (json.data || []).map((row) => ({ ...row, tipo: "saida" as const }));
}

async function fetchLogEntradas(
  companySlug: string,
  username?: string | null,
  searchTerm = ""
): Promise<RomaneioListItem[]> {
  const params = new URLSearchParams({ company: companySlug });
  const search = searchTerm.trim();
  if (search) params.set("search", search);
  const url = `/api/romaneios/entradas?${params.toString()}`;
  const headers: Record<string, string> = {};
  if (username) headers["x-auth-username"] = username;
  const response = await fetch(url, { headers, cache: "no-store" });
  if (!response.ok) return [];
  const json = (await response.json()) as { data: Omit<RomaneioListItem, "tipo">[] };
  return (json.data || []).map((row) => ({ ...row, tipo: "entrada" as const }));
}

type TabType = "saida" | "entrada";

export default function RomaneiosPage({ companySlug }: RomaneiosPageProps) {
  const { user, isLoading: authLoading } = useAuth();
  const [saidas, setSaidas] = useState<RomaneioListItem[]>([]);
  const [entradas, setEntradas] = useState<RomaneioListItem[]>([]);
  const [filiais, setFiliais] = useState<FilialOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>("saida");
  const [searchTerm, setSearchTerm] = useState("");
  const deferredSearchTerm = useDeferredValue(searchTerm);

  function getFilialDisplayName(filialValue: string | null | undefined) {
    const filial = (filialValue || "").trim();
    if (!filial) return "";
    const filialKey = filial.toUpperCase();
    const option = filiais.find((f) =>
      f.codFilial.trim().toUpperCase() === filialKey ||
      f.filial.trim().toUpperCase() === filialKey ||
      (f.activeFilial || "").trim().toUpperCase() === filialKey ||
      (f.aliases ?? []).some((alias) => alias.trim().toUpperCase() === filialKey)
    );
    return option?.displayName || option?.filial || filial;
  }

  useEffect(() => {
    if (authLoading) return; // Aguardar auth terminar antes de buscar dados do usuário
    let cancelled = false;
    Promise.all([
      fetchLogSaidas(companySlug, user?.username, deferredSearchTerm),
      fetchLogEntradas(companySlug, user?.username, deferredSearchTerm),
      fetch(`/api/transferencia-produtos/filiais?${new URLSearchParams({ company: companySlug }).toString()}`, { cache: "no-store" }).then(async (r) => {
        if (!r.ok) return [];
        const j = (await r.json()) as { data: FilialOption[] };
        return j.data || [];
      }),
    ])
      .then(([saidasData, entradasData, filiaisData]) => {
        if (cancelled) return;
        const saidasSorted = [...saidasData].sort((a, b) => {
          return new Date(b.dataEmissao).getTime() - new Date(a.dataEmissao).getTime();
        });
        const entradasSorted = [...entradasData].sort((a, b) => {
          return new Date(b.dataEmissao).getTime() - new Date(a.dataEmissao).getTime();
        });
        setSaidas(saidasSorted);
        setEntradas(entradasSorted);
        setFiliais(filiaisData);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companySlug, user?.username, authLoading, deferredSearchTerm]);

  const basePath = `/${companySlug}`;
  const romaneiosBase = activeTab === "saida" ? saidas : entradas;
  const romaneios = (() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return romaneiosBase;
    return romaneiosBase.filter((r) =>
      r.romaneio.toLowerCase().includes(q) ||
      (r.responsavel || "").toLowerCase().includes(q) ||
      (r.filialOrigem || "").toLowerCase().includes(q) ||
      (r.filialDestino || "").toLowerCase().includes(q) ||
      getFilialDisplayName(r.filialOrigem).toLowerCase().includes(q) ||
      getFilialDisplayName(r.filialDestino).toLowerCase().includes(q) ||
      getFilialDisplayName(r.destinoCodigo).toLowerCase().includes(q) ||
      (r.tipoRomaneio || "").toLowerCase().includes(q)
    );
  })();

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <h1 className={styles.title}>Romaneios</h1>
        {(user?.role === "admin" || user?.username === "ed") && (
          <div className={styles.tabs}>
            <button
              type="button"
              className={`${styles.tab} ${activeTab === "saida" ? styles.tabActive : ""}`}
              onClick={() => setActiveTab("saida")}
            >
              Saída
            </button>
            <button
              type="button"
              className={`${styles.tab} ${activeTab === "entrada" ? styles.tabActive : ""}`}
              onClick={() => setActiveTab("entrada")}
            >
              Entrada
            </button>
          </div>
        )}
        <div className={styles.searchBox}>
          <svg viewBox="0 0 24 24" fill="none" className={styles.searchIcon} aria-hidden="true">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="M16.5 16.5 21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Buscar por romaneio, responsável, filial, tipo..."
            value={searchTerm}
            onChange={(e) => {
              setLoading(true);
              setSearchTerm(e.target.value);
            }}
          />
          {searchTerm && (
            <button className={styles.searchClear} onClick={() => setSearchTerm("")} aria-label="Limpar">×</button>
          )}
        </div>
        <p className={styles.subtitle}>
          {loading ? "Carregando..." : `${romaneios.length} registros`}
        </p>
      </div>

      {loading ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>📄</div>
          <div>Carregando romaneios...</div>
        </div>
      ) : romaneios.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>📄</div>
          <div>Nenhum romaneio de {activeTab === "saida" ? "saída" : "entrada"} encontrado</div>
        </div>
      ) : (
        <div className={styles.list}>
          {romaneios.map((rom, index) => {
            const detailUrl = `${basePath}/romaneios/${encodeURIComponent(rom.romaneio)}?tipo=${rom.tipo}&filialOrigem=${encodeURIComponent(rom.filialOrigem)}&filialDestino=${encodeURIComponent(rom.filialDestino)}&dataEmissao=${encodeURIComponent(rom.dataEmissao)}&responsavel=${encodeURIComponent(rom.responsavel || "")}&tipoRomaneio=${encodeURIComponent(rom.tipoRomaneio || "")}`;
            const confirmados = rom.qtdConfirmados ?? 0;
            const todosConfirmados = rom.qtdProdutos > 0 && confirmados >= rom.qtdProdutos;
            return (
              <Link key={`${rom.tipo}-${rom.romaneio}-${rom.filialOrigem}-${rom.filialDestino}-${index}`} href={detailUrl} className={`${styles.card} ${todosConfirmados ? styles.cardConfirmado : ""}`}>
                <div className={styles.cardHeader}>
                  <span className={styles.romaneioId}>#{rom.romaneio}</span>
                  {rom.tipo === "saida" ? (
                    <span
                      className={`${styles.status} ${
                        rom.destinoCodigo ? styles.statusConcluida : styles.statusVazio
                      }`}
                    >
                      {rom.destinoCodigo
                        ? getFilialDisplayName(rom.destinoCodigo)
                        : "—"}
                    </span>
                  ) : (
                    <span className={`${styles.status} ${styles.statusConcluida}`}>
                      {rom.filialDestino
                        ? getFilialDisplayName(rom.filialDestino)
                        : "—"}
                    </span>
                  )}
                  {todosConfirmados && (
                    <span className={styles.badgeConfirmado}>✓ Confirmado</span>
                  )}
                </div>
                <div className={styles.cardDetails}>
                  Responsável: {rom.responsavel || "—"}
                </div>
                <div className={styles.cardDetails}>
                  Tipo de romaneio: {rom.tipoRomaneio?.trim() || "—"}
                </div>
                <div className={styles.cardFooter}>
                  <span className={styles.counts}>
                    <span className={styles.countIcon}>👁</span> {rom.qtdProdutos} produtos • {rom.qtdItens} itens
                    {!todosConfirmados && confirmados > 0 && (
                      <span className={styles.confirmadosParcial}>{confirmados}/{rom.qtdProdutos} confirmados</span>
                    )}
                  </span>
                  <span className={styles.date}>
                    {new Date(rom.dataEmissao).toLocaleString("pt-BR")}
                  </span>
                </div>
                <span className={styles.chevron}>›</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
