"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthContext";
import type { RegistroPendente, RegistroStatus } from "@/lib/corporativo/types";
import styles from "../corporativo.module.css";

const STATUS_LABEL: Record<RegistroStatus, string> = {
  pendente: "Pendente",
  aprovado: "Aprovado",
  rejeitado: "Rejeitado",
};

export default function AprovacoesPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [items, setItems] = useState<RegistroPendente[]>([]);
  const [filtro, setFiltro] = useState<RegistroStatus | "todos">("pendente");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (status: RegistroStatus | "todos") => {
      if (!user?.username) return;
      setLoading(true);
      setError(null);
      try {
        const qs = status === "todos" ? "" : `?status=${status}`;
        const res = await fetch(`/api/corporativo/registro${qs}`, {
          headers: { "x-auth-username": user.username },
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Erro ao carregar.");
        setItems(json.data as RegistroPendente[]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao carregar.");
      } finally {
        setLoading(false);
      }
    },
    [user?.username]
  );

  useEffect(() => {
    load(filtro);
  }, [load, filtro]);

  function fmtDoc(doc: string, tipo: string) {
    const d = (doc || "").replace(/\D/g, "");
    if (tipo === "PJ" && d.length === 14)
      return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
    if (tipo === "PF" && d.length === 11)
      return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
    return doc;
  }

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.topbar}>
          <div>
            <div className={styles.eyebrow}>Corporativo</div>
            <h1 className={styles.title}>Aprovação de cadastros</h1>
            <p className={styles.subtitle}>
              Autocadastros da loja. Aprovar efetiva o cliente no Linx e libera as compras.
            </p>
          </div>
          <div className={styles.headerActions}>
            <Link href="/corporativo" className={styles.linkBack}>← Clientes</Link>
          </div>
        </div>

        <div className={styles.searchRow}>
          {(["pendente", "aprovado", "rejeitado", "todos"] as const).map((s) => (
            <button key={s} type="button"
              className={`${styles.btn} ${filtro === s ? styles.btnPrimary : ""}`}
              onClick={() => setFiltro(s)}>
              {s === "todos" ? "Todos" : STATUS_LABEL[s]}
            </button>
          ))}
        </div>

        {error && <div className={`${styles.alert} ${styles.alertError}`}>{error}</div>}

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Enviado em</th>
                <th>Nome / Razão social</th>
                <th>CPF/CNPJ</th>
                <th>Tipo</th>
                <th>Usuário</th>
                <th>Status</th>
                <th>Código Linx</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className={styles.center}><span className={styles.muted}>Carregando…</span></td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={7} className={styles.center}><span className={styles.muted}>Nenhum cadastro.</span></td></tr>
              ) : (
                items.map((r) => (
                  <tr key={r.id} className={styles.rowLink}
                    onClick={() => router.push(`/corporativo/aprovacoes/${r.id}`)}
                    title="Revisar cadastro">
                    <td>{r.criadoEm ? new Date(r.criadoEm).toLocaleDateString("pt-BR") : "—"}</td>
                    <td>{r.razaoSocial}</td>
                    <td>{fmtDoc(r.cpfCnpj, r.tipoPessoa)}</td>
                    <td>
                      <span className={`${styles.tag} ${r.tipoPessoa === "PJ" ? styles.tagPJ : styles.tagPF}`}>
                        {r.tipoPessoa}
                      </span>
                    </td>
                    <td>{r.username}</td>
                    <td>
                      <span className={styles.tag}>{STATUS_LABEL[r.status]}</span>
                    </td>
                    <td className={styles.codeCell}>{r.clienteCodigo ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
