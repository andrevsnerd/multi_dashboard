"use client";

import { useEffect, useMemo, useState } from "react";

import type { SincronizacaoFilial, SincronizacaoStatus } from "@/lib/repositories/sincronizacao";

import styles from "./SincronizacaoPage.module.css";

interface SincronizacaoPayload {
  data: {
    geradoEm: string;
    totalFiliais: number;
    filiais: SincronizacaoFilial[];
  };
}

const STATUS_LABEL: Record<SincronizacaoStatus, string> = {
  OK: "Sincronizado",
  ATENCAO: "Atenção",
  ATRASADO: "Atrasado",
  SEM_VENDAS: "Sem vendas",
};

export default function SincronizacaoPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geradoEm, setGeradoEm] = useState<string | null>(null);
  const [filiais, setFiliais] = useState<SincronizacaoFilial[]>([]);

  const filiaisAgrupadas = useMemo(() => {
    const grupos = new Map<string, SincronizacaoFilial[]>();
    for (const filial of filiais) {
      const empresa = filial.filial.toUpperCase().startsWith("NERD") ? "NERD" : "SCARF ME";
      const atual = grupos.get(empresa) ?? [];
      atual.push(filial);
      grupos.set(empresa, atual);
    }

    return ["NERD", "SCARF ME"]
      .filter((empresa) => (grupos.get(empresa)?.length ?? 0) > 0)
      .map((empresa) => ({
        empresa,
        filiais: grupos.get(empresa) ?? [],
      }));
  }, [filiais]);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/sincronizacao", { cache: "no-store" });
        if (!response.ok) {
          throw new Error("Erro ao carregar a sincronizacao.");
        }

        const payload = (await response.json()) as SincronizacaoPayload;
        if (!active) return;
        setGeradoEm(payload.data.geradoEm);
        setFiliais(payload.data.filiais);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Falha ao carregar a sincronizacao.");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <h1 className={styles.title}>Sincronizacao</h1>
        <p className={styles.subtitle}>
          Status por filial seguindo a mesma regra do script de sincronizacao de vendas.
        </p>
        <div className={styles.meta}>
          <span>Total de filiais: {filiais.length}</span>
          <span>
            Ultima verificacao:{" "}
            {geradoEm ? new Date(geradoEm).toLocaleString("pt-BR") : "-"}
          </span>
        </div>
      </div>

      {error ? <div className={styles.error}>{error}</div> : null}
      {loading ? <div className={styles.loading}>Carregando sincronizacao...</div> : null}

      <div className={styles.groupContainer}>
        {filiaisAgrupadas.map((grupo) => (
          <section key={grupo.empresa} className={styles.groupSection}>
            <div className={styles.groupHeader}>
              <h2 className={styles.groupTitle}>{grupo.empresa}</h2>
              <span className={styles.groupCount}>{grupo.filiais.length} filial(is)</span>
            </div>
            <ul className={styles.list}>
              {grupo.filiais.map((filial) => (
                <li key={`${filial.codFilial}-${filial.filial}`} className={styles.listItem}>
                  <div className={styles.leftBlock}>
                    <span
                      className={`${styles.dot} ${styles[`dot${filial.status}`]}`}
                      title={STATUS_LABEL[filial.status]}
                    />
                    <div>
                      <div className={styles.filialName}>
                        {filial.displayName}
                        {filial.filial !== filial.displayName && (
                          <span className={styles.filialAtiva}> ({filial.filial})</span>
                        )}
                      </div>
                      <div className={styles.statusText}>{STATUS_LABEL[filial.status]}</div>
                    </div>
                  </div>

                  <div className={styles.details}>
                    <span>
                      Ultima venda:{" "}
                      {filial.ultimaVenda ? new Date(filial.ultimaVenda).toLocaleString("pt-BR") : "-"}
                    </span>
                    <span>Tempo: {filial.deltaDescricao}</span>
                    <span>Vendas hoje: {filial.vendasHoje}</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {filiaisAgrupadas.length === 0 && !loading && !error ? (
          <div className={styles.loading}>Nenhuma filial encontrada.</div>
        ) : null}
      </div>
    </div>
  );
}
