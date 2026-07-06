"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { ClienteCorporativoDetalhe } from "@/lib/corporativo/types";
import { ClienteCorporativoForm } from "../_components/ClienteCorporativoForm";
import { detalheToFormState, detalheToViewOptions } from "../_components/mapDetalhe";
import styles from "../corporativo.module.css";

function fmtData(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR");
}

export default function DetalheClienteCorporativoPage() {
  const params = useParams<{ codigo: string }>();
  const codigo = params?.codigo ?? "";
  const [data, setData] = useState<ClienteCorporativoDetalhe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!codigo) return;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/corporativo/clientes/${codigo}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Cliente não encontrado.");
        setData(json.data as ClienteCorporativoDetalhe);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao carregar cliente.");
      } finally {
        setLoading(false);
      }
    })();
  }, [codigo]);

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.topbar}>
          <div>
            <div className={styles.eyebrow}>Corporativo</div>
            <h1 className={styles.title}>
              {data ? data.nomeClifor : "Cliente"}{" "}
              {data && <span className={styles.pill}>{data.codigo}</span>}
            </h1>
            <p className={styles.subtitle}>
              {data
                ? `Cadastrado em ${fmtData(data.cadastramento)}${data.inativo ? " — inativo" : ""}. Somente leitura.`
                : "Carregando cadastro…"}
            </p>
          </div>
          <div className={styles.headerActions}>
            <Link href="/corporativo" className={styles.linkBack}>← Voltar para a lista</Link>
          </div>
        </div>

        {error && <div className={`${styles.alert} ${styles.alertError}`}>{error}</div>}
        {loading && <div className={styles.card}><p className={styles.muted}>Carregando…</p></div>}

        {data && (
          <ClienteCorporativoForm
            readOnly
            form={detalheToFormState(data)}
            options={detalheToViewOptions(data)}
          />
        )}
      </div>
    </div>
  );
}
