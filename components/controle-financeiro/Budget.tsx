"use client";

import { useEffect, useMemo, useState } from "react";

import { type AbaInfo, type AbaResposta, brl, mesCurto, percentual, useFinanceiroApi } from "./shared";
import styles from "./ControleFinanceiro.module.css";

/** Aba "Budget x Realizado": previsto × realizado por linha, mês a mês. */
export default function Budget({ companyKey, aba }: { companyKey: string; aba: AbaInfo }) {
  const api = useFinanceiroApi(companyKey);
  const [dados, setDados] = useState<AbaResposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [mes, setMes] = useState<string>("");

  useEffect(() => {
    if (!api.pronto) return;
    api
      .get<AbaResposta>("/aba", { aba: aba.aba, porPagina: 5000 })
      .then((d) => {
        setDados(d);
        const meses = [...new Set(d.itens.map((i) => String(i.c.mes_competencia ?? "")).filter(Boolean))].sort();
        setMes((m) => m || meses[meses.length - 1] || "");
      })
      .catch((e) => setErro(e instanceof Error ? e.message : "Erro"));
  }, [api, aba.aba]);

  const chavePrevisto = aba.colunas.find((c) => !c.campo && /previs/i.test(c.titulo))?.chave ?? "Previsão";
  const meses = useMemo(
    () => [...new Set((dados?.itens ?? []).map((i) => String(i.c.mes_competencia ?? "")).filter(Boolean))].sort(),
    [dados]
  );
  const linhas = (dados?.itens ?? []).filter((i) => String(i.c.mes_competencia ?? "") === mes);

  if (erro) return <div className={`${styles.aviso} ${styles.avisoErro}`}>{erro}</div>;
  if (!dados) return <div className={styles.aviso}>Carregando o budget…</div>;

  return (
    <div className={styles.corpo}>
      <div className={styles.filtros}>
        <div className={styles.segmented} role="tablist" aria-label="Mês">
          {meses.map((m) => (
            <button key={m} type="button" className={m === mes ? styles.segAtivo : undefined} onClick={() => setMes(m)}>
              {mesCurto(m)}
            </button>
          ))}
        </div>
      </div>
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>Budget × realizado · {mesCurto(mes)}</h2>
          <span className={styles.cardNote}>despesa realizada vem negativa na planilha; a comparação usa o valor absoluto</span>
        </div>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Linha</th>
                <th className={styles.num}>Previsto</th>
                <th className={styles.num}>Realizado</th>
                <th className={styles.num}>Diferença</th>
                <th className={styles.num}>Realizado / previsto</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((i) => {
                const prev = typeof i.x[chavePrevisto] === "number" ? Number(i.x[chavePrevisto]) : null;
                const real = i.c.valor == null ? null : Number(i.c.valor);
                const razao = prev && real != null ? Math.abs(real) / Math.abs(prev) : null;
                const estourou = razao != null && razao > 1 && real != null && real < 0;
                return (
                  <tr key={i.id}>
                    <td>{String(i.c.classificacao ?? "")}</td>
                    <td className={styles.num}>{prev == null ? "—" : brl(prev)}</td>
                    <td className={`${styles.num} ${(real ?? 0) < 0 ? styles.neg : ""}`}>{brl(real)}</td>
                    <td className={styles.num}>
                      {prev == null || real == null ? "—" : brl(Math.abs(real) - Math.abs(prev))}
                    </td>
                    <td className={`${styles.num} ${estourou ? styles.crit : ""}`}>
                      {razao == null ? "—" : `${estourou ? "▲ " : ""}${percentual(razao)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
