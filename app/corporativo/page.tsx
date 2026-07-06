"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { ClienteCorporativoListItem } from "@/lib/corporativo/types";
import styles from "./corporativo.module.css";

export default function CorporativoListPage() {
  const router = useRouter();
  const [items, setItems] = useState<ClienteCorporativoListItem[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (term: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/corporativo/clientes?limit=100${term ? `&search=${encodeURIComponent(term)}` : ""}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erro ao carregar.");
      setItems(json.data as ClienteCorporativoListItem[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load("");
  }, [load]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    load(search.trim());
  }

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
            <h1 className={styles.title}>Clientes corporativos</h1>
            <p className={styles.subtitle}>Cadastro de clientes atacado (Linx). Últimos cadastrados.</p>
          </div>
          <div className={styles.headerActions}>
            <Link href="/" className={styles.linkBack}>← Início</Link>
            <Link href="/corporativo/novo" className={`${styles.btn} ${styles.btnPrimary}`}>+ Novo cliente</Link>
          </div>
        </div>

        <form className={styles.searchRow} onSubmit={onSubmit}>
          <input className={styles.input} placeholder="Buscar por nome, razão social, CPF/CNPJ ou código…"
            value={search} onChange={(e) => setSearch(e.target.value)} />
          <button type="submit" className={styles.btn} disabled={loading}>
            {loading ? "Buscando…" : "Buscar"}
          </button>
          {search && (
            <button type="button" className={styles.btn} onClick={() => { setSearch(""); load(""); }}>
              Limpar
            </button>
          )}
        </form>

        {error && <div className={`${styles.alert} ${styles.alertError}`}>{error}</div>}

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Código</th>
                <th>Nome</th>
                <th>Razão social</th>
                <th>CPF/CNPJ</th>
                <th>Tipo</th>
                <th>Cidade/UF</th>
                <th>Telefone</th>
                <th>Filial</th>
                <th>Cadastro</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className={styles.center}><span className={styles.muted}>Carregando…</span></td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={9} className={styles.center}><span className={styles.muted}>Nenhum cliente encontrado.</span></td></tr>
              ) : (
                items.map((c) => (
                  <tr
                    key={c.codigo}
                    className={styles.rowLink}
                    title="Ver cadastro completo"
                    onClick={() => router.push(`/corporativo/${c.codigo}`)}
                  >
                    <td className={styles.codeCell}>{c.codigo}</td>
                    <td>{c.nomeClifor}{c.inativo && <span className={styles.tag} style={{ marginLeft: 6 }}>inativo</span>}</td>
                    <td>{c.razaoSocial}</td>
                    <td>{fmtDoc(c.cpfCnpj, c.tipoPessoa)}</td>
                    <td>
                      <span className={`${styles.tag} ${c.tipoPessoa === "PJ" ? styles.tagPJ : styles.tagPF}`}>
                        {c.tipoPessoa}
                      </span>
                    </td>
                    <td>{[c.cidade, c.uf].filter(Boolean).join(" / ")}</td>
                    <td>{c.telefone}</td>
                    <td>{c.filial}</td>
                    <td>{c.cadastramento ? new Date(c.cadastramento).toLocaleDateString("pt-BR") : "—"}</td>
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
