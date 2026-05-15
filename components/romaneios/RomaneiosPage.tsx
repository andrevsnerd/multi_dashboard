"use client";

import { useState, useEffect, useDeferredValue } from "react";
import Link from "next/link";

import { useAuth } from "@/components/auth/AuthContext";
import {
  formatRomaneioDateTimeBrasilia,
  parseRomaneioDateTime,
} from "@/lib/utils/romaneios-date";
import styles from "./RomaneiosPage.module.css";

export interface RomaneioListItem {
  tipo: "saida" | "entrada" | "transito";
  romaneio: string;
  filialOrigem: string;
  filialDestino: string;
  filialOrigemCodigo?: string;
  filialDestinoCodigo?: string;
  dataEmissao: string;
  responsavel: string;
  qtdProdutos: number;
  qtdItens: number;
  status: string;
  destinoCodigo?: string | null;
  tipoRomaneio?: string;
  qtdConfirmados?: number;
}

function cleanDestinoValue(value: string | null | undefined): string {
  const trimmed = (value || "").trim();
  if (!trimmed || trimmed === "-" || trimmed === "\u2014") return "";
  return trimmed;
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

async function fetchLogTransito(
  companySlug: string,
  username?: string | null,
  searchTerm = ""
): Promise<RomaneioListItem[]> {
  const params = new URLSearchParams({ company: companySlug });
  const search = searchTerm.trim();
  if (search) params.set("search", search);
  const url = `/api/romaneios/transito?${params.toString()}`;
  const headers: Record<string, string> = {};
  if (username) headers["x-auth-username"] = username;
  const response = await fetch(url, { headers, cache: "no-store" });
  if (!response.ok) return [];
  const json = (await response.json()) as { data: Omit<RomaneioListItem, "tipo">[] };
  return (json.data || []).map((row) => ({ ...row, tipo: "transito" as const }));
}

type TabType = "saida" | "entrada" | "transito";

export default function RomaneiosPage({ companySlug }: RomaneiosPageProps) {
  const { user, isLoading: authLoading } = useAuth();
  const [saidas, setSaidas] = useState<RomaneioListItem[]>([]);
  const [entradas, setEntradas] = useState<RomaneioListItem[]>([]);
  const [transitos, setTransitos] = useState<RomaneioListItem[]>([]);
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
    if (authLoading) return;
    let cancelled = false;
    Promise.all([
      fetchLogSaidas(companySlug, user?.username, deferredSearchTerm),
      fetchLogEntradas(companySlug, user?.username, deferredSearchTerm),
      fetchLogTransito(companySlug, user?.username, deferredSearchTerm),
      fetch(
        `/api/transferencia-produtos/filiais?${new URLSearchParams({ company: companySlug }).toString()}`,
        { cache: "no-store" }
      ).then(async (r) => {
        if (!r.ok) return [];
        const j = (await r.json()) as { data: FilialOption[] };
        return j.data || [];
      }),
    ])
      .then(([saidasData, entradasData, transitosData, filiaisData]) => {
        if (cancelled) return;
        const byDateDesc = (a: RomaneioListItem, b: RomaneioListItem) =>
          parseRomaneioDateTime(b.dataEmissao).getTime() - parseRomaneioDateTime(a.dataEmissao).getTime();
        setSaidas([...saidasData].sort(byDateDesc));
        setEntradas([...entradasData].sort(byDateDesc));
        setTransitos([...transitosData].sort(byDateDesc));
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
  const romaneiosBase =
    activeTab === "saida" ? saidas : activeTab === "entrada" ? entradas : transitos;
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
        {(user?.role === "admin" || user?.role === "logistica" || user?.username === "ed") && (
          <div className={styles.tabs}>
            <button
              type="button"
              className={`${styles.tab} ${activeTab === "saida" ? styles.tabActive : ""}`}
              onClick={() => setActiveTab("saida")}
            >
              Saida
            </button>
            <button
              type="button"
              className={`${styles.tab} ${activeTab === "entrada" ? styles.tabActive : ""}`}
              onClick={() => setActiveTab("entrada")}
            >
              Entrada
            </button>
            <button
              type="button"
              className={`${styles.tab} ${activeTab === "transito" ? styles.tabActiveTransit : ""}`}
              onClick={() => setActiveTab("transito")}
            >
              Transito
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
            placeholder="Buscar por romaneio, responsavel, filial, tipo..."
            value={searchTerm}
            onChange={(e) => {
              setLoading(true);
              setSearchTerm(e.target.value);
            }}
          />
          {searchTerm && (
            <button className={styles.searchClear} onClick={() => setSearchTerm("")} aria-label="Limpar">
              x
            </button>
          )}
        </div>
        <p className={styles.subtitle}>{loading ? "Carregando..." : `${romaneios.length} registros`}</p>
      </div>

      {loading ? (
        <div className={styles.emptyState}>
          <div>Carregando romaneios...</div>
        </div>
      ) : romaneios.length === 0 ? (
        <div className={styles.emptyState}>
          <div>
            Nenhum romaneio de {activeTab === "saida" ? "saida" : activeTab === "entrada" ? "entrada" : "transito"} encontrado
          </div>
        </div>
      ) : (
        <div className={styles.list}>
          {romaneios.map((rom, index) => {
            const destinoEfetivo =
              rom.tipo === "saida"
                ? cleanDestinoValue(rom.destinoCodigo) || cleanDestinoValue(rom.filialDestino)
                : cleanDestinoValue(rom.filialDestino);
            const detailUrl = `${basePath}/romaneios/${encodeURIComponent(rom.romaneio)}?tipo=${rom.tipo}&filialOrigem=${encodeURIComponent(rom.filialOrigem)}&filialDestino=${encodeURIComponent(destinoEfetivo)}&dataEmissao=${encodeURIComponent(rom.dataEmissao)}&responsavel=${encodeURIComponent(rom.responsavel || "")}&tipoRomaneio=${encodeURIComponent(rom.tipoRomaneio || "")}`;
            const confirmados = rom.qtdConfirmados ?? 0;
            const todosConfirmados = rom.qtdProdutos > 0 && confirmados >= rom.qtdProdutos;
            const isTransito = rom.tipo === "transito";
            const isTransitoLiberado = rom.tipo === "entrada" && rom.status === "Transito liberado";
            const destinoBadge = destinoEfetivo ? getFilialDisplayName(destinoEfetivo) : "-";

            return (
              <Link
                key={`${rom.tipo}-${rom.romaneio}-${rom.filialOrigem}-${rom.filialDestino}-${index}`}
                href={detailUrl}
                className={`${styles.card} ${todosConfirmados ? styles.cardConfirmado : ""} ${isTransito ? styles.cardTransit : ""}`}
              >
                <div className={styles.cardHeader}>
                  <span className={styles.romaneioId}>#{rom.romaneio}</span>
                  <span className={`${styles.status} ${destinoEfetivo ? styles.statusConcluida : styles.statusVazio}`}>
                    {destinoBadge}
                  </span>
                  {isTransito ? (
                    <span className={`${styles.status} ${styles.statusTransito}`}>Em transito</span>
                  ) : isTransitoLiberado ? (
                    <span className={`${styles.status} ${styles.statusTransitoLiberado}`}>Transito liberado</span>
                  ) : !isTransito && todosConfirmados ? (
                    <span className={styles.badgeConfirmado}>Confirmado</span>
                  ) : null}
                </div>

                <div className={styles.cardDetails}>Responsavel: {rom.responsavel || "-"}</div>
                {isTransito && (
                  <div className={styles.cardDetails}>
                    Origem: {getFilialDisplayName(rom.filialOrigem) || "-"}
                  </div>
                )}
                <div className={styles.cardDetails}>Tipo de romaneio: {rom.tipoRomaneio?.trim() || "-"}</div>

                <div className={styles.cardFooter}>
                  <span className={styles.counts}>
                    <span className={styles.countIcon}>Itens</span> {rom.qtdProdutos} produtos • {rom.qtdItens} itens
                    {!isTransito && !todosConfirmados && confirmados > 0 && (
                      <span className={styles.confirmadosParcial}>{confirmados}/{rom.qtdProdutos} confirmados</span>
                    )}
                  </span>
                  <span className={styles.date}>{formatRomaneioDateTimeBrasilia(rom.dataEmissao)}</span>
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
