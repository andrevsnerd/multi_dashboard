"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

import { useAuth } from "@/components/auth/AuthContext";
import {
  formatRomaneioDateTimeBrasilia,
  parseRomaneioDateTime,
} from "@/lib/utils/romaneios-date";
import RomaneioDeleteModal from "./RomaneioDeleteModal";
import RomaneiosDuplicadosPanel from "./RomaneiosDuplicadosPanel";
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
  members?: string[];
}

interface RomaneiosPageProps {
  companySlug: string;
  companyName: string;
}

async function fetchLogSaidas(
  companySlug: string,
  username?: string | null
): Promise<RomaneioListItem[]> {
  const params = new URLSearchParams({ company: companySlug });
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
  username?: string | null
): Promise<RomaneioListItem[]> {
  const params = new URLSearchParams({ company: companySlug });
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
  username?: string | null
): Promise<RomaneioListItem[]> {
  const params = new URLSearchParams({ company: companySlug });
  const url = `/api/romaneios/transito?${params.toString()}`;
  const headers: Record<string, string> = {};
  if (username) headers["x-auth-username"] = username;
  const response = await fetch(url, { headers, cache: "no-store" });
  if (!response.ok) return [];
  const json = (await response.json()) as { data: Omit<RomaneioListItem, "tipo">[] };
  return (json.data || []).map((row) => ({ ...row, tipo: "transito" as const }));
}

type TabType = "saida" | "entrada" | "transito" | "duplicados";

export default function RomaneiosPage({ companySlug }: RomaneiosPageProps) {
  const { user, isLoading: authLoading } = useAuth();
  const [saidas, setSaidas] = useState<RomaneioListItem[]>([]);
  const [entradas, setEntradas] = useState<RomaneioListItem[]>([]);
  const [transitos, setTransitos] = useState<RomaneioListItem[]>([]);
  const [filiais, setFiliais] = useState<FilialOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>("saida");
  const [searchTerm, setSearchTerm] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<RomaneioListItem | null>(null);

  const isAdmin = user?.role === "admin";
  const isLogistica = user?.role === "logistica";
  const podeVerFilialConsiderada = isAdmin || isLogistica;

  function handleDeleted(rom: RomaneioListItem) {
    const matches = (r: RomaneioListItem) =>
      !(r.romaneio === rom.romaneio && r.filialOrigem === rom.filialOrigem && r.filialDestino === rom.filialDestino);
    if (rom.tipo === "saida") setSaidas((prev) => prev.filter(matches));
    else if (rom.tipo === "entrada") setEntradas((prev) => prev.filter(matches));
    setDeleteTarget(null);
  }

  function getFilialOption(filialValue: string | null | undefined) {
    const filial = (filialValue || "").trim();
    if (!filial) return null;
    const filialKey = filial.toUpperCase();
    return filiais.find((f) =>
      f.codFilial.trim().toUpperCase() === filialKey ||
      f.filial.trim().toUpperCase() === filialKey ||
      (f.activeFilial || "").trim().toUpperCase() === filialKey ||
      (f.aliases ?? []).some((alias) => alias.trim().toUpperCase() === filialKey)
    );
  }

  function getFilialDisplayName(filialValue: string | null | undefined) {
    const filial = (filialValue || "").trim();
    if (!filial) return "";
    const option = getFilialOption(filial);
    return option?.displayName || option?.filial || filial;
  }

  function getFilialSearchValues(filialValue: string | null | undefined) {
    const filial = (filialValue || "").trim();
    const option = getFilialOption(filial);
    const values = [
      filial,
      option?.codFilial,
      option?.filial,
      option?.displayName,
      option?.activeFilial,
      ...(option?.aliases ?? []),
    ];

    return Array.from(
      new Set(values.map((value) => (value || "").trim()).filter(Boolean))
    );
  }

  // Parte do nome que distingue esta filial das demais do mesmo grupo (rodízio).
  // Ex.: E-COMMERCE pode ser "MSC COMERCIO DE LENCOS LT" ou "AKS ..." → "MSC"/"AKS".
  // Só retorna algo quando o grupo tem >1 membro (há o que distinguir).
  function getFilialConsideradaSigla(filialValue: string | null | undefined) {
    const raw = (filialValue || "").trim();
    if (!raw) return "";
    const option = getFilialOption(raw);
    const members = option?.members ?? [];
    if (members.length <= 1) return "";

    const norm = (s: string) => s.trim().toUpperCase();
    const tokenize = (s: string) =>
      s
        .replace(/[-‐-―−]/g, " ")
        .split(/\s+/)
        .map((t) => t.trim())
        .filter(Boolean);

    // O nome específico considerado: o membro que casa com o valor bruto salvo,
    // ou o próprio valor bruto (preserva o histórico, mesmo se hoje o ativo é outro).
    const rawKey = norm(raw);
    const considerado =
      members.find((m) => norm(m) === rawKey) || raw;

    const rawTokens = tokenize(considerado);
    const outrosTokens = new Set(
      members
        .filter((m) => norm(m) !== norm(considerado))
        .flatMap(tokenize)
        .map((t) => t.toUpperCase())
    );
    const unicos = rawTokens.filter((t) => !outrosTokens.has(t.toUpperCase()));
    if (unicos.length === 0) return rawTokens[rawTokens.length - 1] || "";

    // Preferir códigos curtos (MSC, AKS, CMS, LLL, FFF) quando existirem.
    const curtos = unicos.filter((t) => t.length <= 4);
    return (curtos.length > 0 ? curtos : unicos).join(" ");
  }

  function getDestinoFiltroValue(romaneio: RomaneioListItem) {
    return romaneio.tipo === "saida"
      ? cleanDestinoValue(romaneio.destinoCodigo) || cleanDestinoValue(romaneio.filialDestino)
      : cleanDestinoValue(romaneio.filialDestino);
  }

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    Promise.all([
      fetchLogSaidas(companySlug, user?.username),
      fetchLogEntradas(companySlug, user?.username),
      fetchLogTransito(companySlug, user?.username),
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
  }, [companySlug, user?.username, authLoading]);

  const basePath = `/${companySlug}`;
  const romaneiosBase =
    activeTab === "saida" ? saidas : activeTab === "entrada" ? entradas : transitos;
  const romaneios = (() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return romaneiosBase;

    return romaneiosBase.filter((r) => {
      if (r.romaneio.toLowerCase().includes(q)) return true;
      if ((r.responsavel || "").toLowerCase().includes(q)) return true;
      if ((r.tipoRomaneio || "").toLowerCase().includes(q)) return true;

      return getFilialSearchValues(getDestinoFiltroValue(r)).some((value) =>
        value.toLowerCase().includes(q)
      );
    });
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
            {isAdmin && (
              <button
                type="button"
                className={`${styles.tab} ${activeTab === "duplicados" ? styles.tabActiveDuplicados : ""}`}
                onClick={() => setActiveTab("duplicados")}
              >
                Duplicados
              </button>
            )}
          </div>
        )}
        {activeTab !== "duplicados" && (
          <>
            <div className={styles.searchBox}>
              <svg viewBox="0 0 24 24" fill="none" className={styles.searchIcon} aria-hidden="true">
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                <path d="M16.5 16.5 21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <input
                type="text"
                className={styles.searchInput}
                placeholder="Buscar por romaneio, responsavel, filial destino, tipo..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              {searchTerm && (
                <button
                  type="button"
                  className={styles.searchClear}
                  onClick={() => setSearchTerm("")}
                  aria-label="Limpar"
                >
                  x
                </button>
              )}
            </div>
            <p className={styles.subtitle}>{loading ? "Carregando..." : `${romaneios.length} registros`}</p>
          </>
        )}
      </div>

      {activeTab === "duplicados" ? (
        isAdmin ? (
          <RomaneiosDuplicadosPanel companySlug={companySlug} />
        ) : null
      ) : loading ? (
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
            const destinoEfetivo = getDestinoFiltroValue(rom);
            const detailUrl = `${basePath}/romaneios/${encodeURIComponent(rom.romaneio)}?tipo=${rom.tipo}&filialOrigem=${encodeURIComponent(rom.filialOrigem)}&filialDestino=${encodeURIComponent(destinoEfetivo)}&dataEmissao=${encodeURIComponent(rom.dataEmissao)}&responsavel=${encodeURIComponent(rom.responsavel || "")}&tipoRomaneio=${encodeURIComponent(rom.tipoRomaneio || "")}`;
            const confirmados = rom.qtdConfirmados ?? 0;
            const todosConfirmados = rom.qtdProdutos > 0 && confirmados >= rom.qtdProdutos;
            const isTransito = rom.tipo === "transito";
            const isTransitoLiberado = rom.tipo === "entrada" && rom.status === "Transito liberado";
            const destinoBadge = destinoEfetivo ? getFilialDisplayName(destinoEfetivo) : "-";
            const filialConsideradaRaw = cleanDestinoValue(rom.filialDestino) || destinoEfetivo;
            const filialConsideradaSigla = podeVerFilialConsiderada
              ? getFilialConsideradaSigla(filialConsideradaRaw)
              : "";

            const podeExcluir = isAdmin && !isTransito;

            return (
              <Link
                key={`${rom.tipo}-${rom.romaneio}-${rom.filialOrigem}-${rom.filialDestino}-${index}`}
                href={detailUrl}
                className={`${styles.card} ${todosConfirmados ? styles.cardConfirmado : ""} ${isTransito ? styles.cardTransit : ""}`}
              >
                {podeExcluir && (
                  <button
                    type="button"
                    className={styles.deleteBtn}
                    title="Excluir romaneio"
                    aria-label="Excluir romaneio"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDeleteTarget(rom);
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M3 6h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M6 6l1 14a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
                <div className={styles.cardHeader}>
                  <span className={styles.romaneioId}>#{rom.romaneio}</span>
                  <span className={`${styles.status} ${destinoEfetivo ? styles.statusConcluida : styles.statusVazio}`}>
                    {destinoBadge}
                  </span>
                  {filialConsideradaSigla && (
                    <span
                      className={styles.filialConsiderada}
                      title={`Filial considerada neste destino: ${getFilialDisplayName(filialConsideradaRaw)} · ${filialConsideradaRaw}`}
                    >
                      {filialConsideradaSigla}
                    </span>
                  )}
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

      {deleteTarget && (deleteTarget.tipo === "saida" || deleteTarget.tipo === "entrada") && (
        <RomaneioDeleteModal
          tipo={deleteTarget.tipo}
          romaneio={deleteTarget.romaneio}
          filial={deleteTarget.tipo === "saida" ? deleteTarget.filialOrigem : deleteTarget.filialDestino}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => handleDeleted(deleteTarget)}
        />
      )}
    </div>
  );
}
