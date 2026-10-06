"use client";

import { useMemo, useState } from "react";

import type { CompanyKey } from "@/lib/config/company";
import { getLojasInventario, type InventarioLojaResumo } from "@/lib/reports/estoque-inventario";

import styles from "./GeradorRelatoriosPage.module.css";

interface EstoqueInventarioPanelProps {
  companyKey: CompanyKey;
}

/**
 * Painel do "Estoque inventário": escolhe as lojas (uma, várias ou todas) e baixa o
 * arquivo pronto — 1 loja = estoque-<slug>.xlsx; mais de uma = .zip com um xlsx por loja
 * (os mesmos arquivos que o estoque_inventario.py grava em relatorios/inventario).
 * Não tem pré-visualização: o arquivo é o resultado.
 */
export default function EstoqueInventarioPanel({ companyKey }: EstoqueInventarioPanelProps) {
  const lojas = useMemo(() => getLojasInventario(companyKey), [companyKey]);
  const [selecionadas, setSelecionadas] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumo, setResumo] = useState<InventarioLojaResumo[]>([]);

  const todasMarcadas = selecionadas.length === lojas.length;
  const toggle = (slug: string) =>
    setSelecionadas((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]));

  const handleGerar = async () => {
    setLoading(true);
    setError(null);
    setResumo([]);
    try {
      const res = await fetch("/api/relatorios/estoque-inventario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lojas: lojas.filter((l) => selecionadas.includes(l.slug)).map((l) => l.slug) }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.details || json?.error || "Erro ao gerar inventário");
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const nome = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "inventario.xlsx";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nome;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      const header = res.headers.get("X-Inventario-Resumo");
      if (header) setResumo(JSON.parse(decodeURIComponent(header)) as InventarioLojaResumo[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao gerar inventário");
    } finally {
      setLoading(false);
    }
  };

  const fmt = (n: number) => n.toLocaleString("pt-BR");
  const displayDe = (slug: string) => lojas.find((l) => l.slug === slug)?.display ?? slug;

  return (
    <>
      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>Lojas</h2>
        <div className={styles.saldoRow}>
          <label className={styles.checkLabel}>
            <input
              type="checkbox"
              checked={todasMarcadas}
              onChange={() => setSelecionadas(todasMarcadas ? [] : lojas.map((l) => l.slug))}
            />
            <strong>Todas</strong>
          </label>
          {lojas.map((l) => (
            <label key={l.slug} className={styles.checkLabel} title={`COD_FILIAL: ${l.cods.join(", ")}`}>
              <input type="checkbox" checked={selecionadas.includes(l.slug)} onChange={() => toggle(l.slug)} />
              {l.display}
            </label>
          ))}
        </div>
        <p className={styles.hint}>
          1 loja baixa o estoque-&lt;loja&gt;.xlsx; mais de uma baixa um .zip com um arquivo por loja.
        </p>
      </section>

      <section className={styles.actionsBar}>
        <button
          type="button"
          className={styles.btnPrimary}
          onClick={() => void handleGerar()}
          disabled={loading || selecionadas.length === 0}
        >
          {loading ? "Gerando..." : "Gerar e baixar"}
        </button>
        {selecionadas.length > 0 && !loading && (
          <span className={styles.resultMeta}>{selecionadas.length} loja(s) selecionada(s)</span>
        )}
      </section>

      {error && <div className={styles.error}>{error}</div>}

      {resumo.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Loja</th>
                <th className={styles.th}>Filial ativa</th>
                <th className={styles.th}>Filiais</th>
                <th className={`${styles.th} ${styles.thNumeric}`}>Linhas</th>
                <th className={`${styles.th} ${styles.thNumeric}`}>Com saldo</th>
                <th className={`${styles.th} ${styles.thNumeric}`}>Peças</th>
              </tr>
            </thead>
            <tbody>
              {resumo.map((r) => (
                <tr key={r.slug}>
                  <td className={styles.td}>{displayDe(r.slug)}</td>
                  <td className={styles.td}>{r.filialAtiva}</td>
                  <td className={styles.td}>{r.cods.join(", ")}</td>
                  <td className={`${styles.td} ${styles.tdNumeric}`}>{fmt(r.linhas)}</td>
                  <td className={`${styles.td} ${styles.tdNumeric}`}>{fmt(r.comSaldo)}</td>
                  <td className={`${styles.td} ${styles.tdNumeric}`}>{fmt(r.pecas)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
