"use client";

import { useState, useEffect } from "react";
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
}

interface FilialOption {
  codFilial: string;
  filial: string;
}

interface RomaneiosPageProps {
  companySlug: string;
  companyName: string;
}

async function fetchLogSaidas(
  companySlug: string,
  username?: string | null
): Promise<RomaneioListItem[]> {
  const url = `/api/romaneios/saidas?company=${encodeURIComponent(companySlug)}`;
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
  const url = `/api/romaneios/entradas?company=${encodeURIComponent(companySlug)}`;
  const headers: Record<string, string> = {};
  if (username) headers["x-auth-username"] = username;
  const response = await fetch(url, { headers, cache: "no-store" });
  if (!response.ok) return [];
  const json = (await response.json()) as { data: Omit<RomaneioListItem, "tipo">[] };
  return (json.data || []).map((row) => ({ ...row, tipo: "entrada" as const }));
}

function getStatusClass(status: string): string {
  const s = (status || "").toLowerCase();
  if (s.includes("concluíd") || s.includes("concluida")) return styles.statusConcluida;
  if (s.includes("andamento") || s.includes("em andamento")) return styles.statusEmAndamento;
  return styles.statusPendente;
}

type TabType = "saida" | "entrada";

export default function RomaneiosPage({ companySlug, companyName }: RomaneiosPageProps) {
  const { user } = useAuth();
  const [saidas, setSaidas] = useState<RomaneioListItem[]>([]);
  const [entradas, setEntradas] = useState<RomaneioListItem[]>([]);
  const [filiais, setFiliais] = useState<FilialOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>("saida");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchLogSaidas(companySlug, user?.username),
      fetchLogEntradas(companySlug, user?.username),
      fetch("/api/transferencia-produtos/filiais", { cache: "no-store" }).then(async (r) => {
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
  }, [companySlug, user?.username]);

  const basePath = `/${companySlug}`;
  const romaneios = activeTab === "saida" ? saidas : entradas;

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <h1 className={styles.title}>Romaneios</h1>
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
            return (
              <Link key={`${rom.tipo}-${rom.romaneio}-${rom.filialOrigem}-${rom.filialDestino}-${index}`} href={detailUrl} className={styles.card}>
                <div className={styles.cardHeader}>
                  <span className={styles.romaneioId}>#{rom.romaneio}</span>
                  {rom.tipo === "saida" ? (
                    <span
                      className={`${styles.status} ${
                        rom.destinoCodigo ? styles.statusConcluida : styles.statusVazio
                      }`}
                    >
                      {rom.destinoCodigo
                        ? filiais.find((f) => f.codFilial === rom.destinoCodigo)?.filial ||
                          rom.destinoCodigo
                        : "—"}
                    </span>
                  ) : (
                    <span className={`${styles.status} ${styles.statusConcluida}`}>
                      {rom.filialDestino
                        ? filiais.find((f) => f.codFilial === rom.filialDestino)?.filial ||
                          rom.filialDestino
                        : "—"}
                    </span>
                  )}
                </div>
                <div className={styles.cardDetails}>
                  Responsável: {rom.responsavel || "—"}
                </div>
                <div className={styles.cardFooter}>
                  <span className={styles.counts}>
                    <span className={styles.countIcon}>👁</span> {rom.qtdProdutos} produtos • {rom.qtdItens} itens
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
