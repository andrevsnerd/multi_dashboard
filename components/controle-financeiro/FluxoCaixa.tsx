"use client";

import { useEffect, useMemo, useState } from "react";

import { GraficoLinhaDiaria } from "./Graficos";
import { type AbaInfo, type AbaResposta, brl, compacto, dataBr, mesCurto, numero, useFinanceiroApi } from "./shared";
import styles from "./ControleFinanceiro.module.css";

const hojeIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function somarMeses(iso: string, n: number) {
  const [a, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/** Aba "Caixa Diário_Evolucao": movimento diário por grupo + saldo projetado. */
export default function FluxoCaixa({ companyKey, aba }: { companyKey: string; aba: AbaInfo }) {
  const api = useFinanceiroApi(companyKey);
  const hoje = hojeIso();
  const [de, setDe] = useState(somarMeses(hoje, -6));
  const [ate, setAte] = useState(somarMeses(hoje, 7));
  const [dados, setDados] = useState<AbaResposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [visao, setVisao] = useState<"mes" | "dia">("mes");

  useEffect(() => {
    if (!api.pronto) return;
    let vivo = true;
    api
      .get<AbaResposta>("/aba", { aba: aba.aba, de, ate, campoData: "data_caixa", ordem: "data_asc", porPagina: 5000 })
      .then((d) => vivo && (setDados(d), setErro(null)))
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : "Erro"));
    return () => {
      vivo = false;
    };
  }, [api, aba.aba, de, ate]);

  // Colunas numéricas da aba (Pessoal, Fornecedores, Aluguéis…); saldo à parte.
  const { colunas, chaveSaldo } = useMemo(() => {
    const cols = aba.colunas.filter((c) => !c.campo && !/dia da semana|competencia caixa|^coluna /.test(norm(c.titulo)));
    const saldo = cols.find((c) => norm(c.titulo).startsWith("saldo"))?.chave ?? null;
    const numericas = cols.filter(
      (c) => c.chave !== saldo && (dados?.itens ?? []).some((i) => typeof i.x[c.chave] === "number" && i.x[c.chave] !== 0)
    );
    return { colunas: numericas, chaveSaldo: saldo };
  }, [aba.colunas, dados]);

  const pontos = useMemo(
    () =>
      (dados?.itens ?? [])
        .filter((i) => i.c.data_caixa && chaveSaldo && typeof i.x[chaveSaldo] === "number")
        .map((i) => ({ data: String(i.c.data_caixa), valor: Number(i.x[chaveSaldo!]) })),
    [dados, chaveSaldo]
  );

  const porMes = useMemo(() => {
    const mapa = new Map<string, { mes: string; net: number; saldo: number | null; cols: Record<string, number> }>();
    for (const i of dados?.itens ?? []) {
      const d = String(i.c.data_caixa ?? "");
      if (!d) continue;
      const mes = `${d.slice(0, 7)}-01`;
      const m = mapa.get(mes) ?? { mes, net: 0, saldo: null, cols: {} };
      m.net += Number(i.c.valor ?? 0);
      for (const c of colunas) m.cols[c.chave] = (m.cols[c.chave] ?? 0) + (typeof i.x[c.chave] === "number" ? Number(i.x[c.chave]) : 0);
      if (chaveSaldo && typeof i.x[chaveSaldo] === "number") m.saldo = Number(i.x[chaveSaldo]);
      mapa.set(mes, m);
    }
    return [...mapa.values()];
  }, [dados, colunas, chaveSaldo]);

  const saldoHoje = pontos.filter((p) => p.data <= hoje).pop();
  const minFuturo = pontos.filter((p) => p.data > hoje).reduce<{ data: string; valor: number } | null>(
    (min, p) => (!min || p.valor < min.valor ? p : min),
    null
  );
  const saldoFim = pontos[pontos.length - 1];
  const inicial = aba.preambulo.find((p) => typeof p.valor === "number");

  return (
    <div className={styles.corpo}>
      <div className={styles.filtros}>
        <label className={styles.campo}>
          <span>De</span>
          <input type="date" className={styles.input} value={de} onChange={(e) => setDe(e.target.value)} />
        </label>
        <label className={styles.campo}>
          <span>Até</span>
          <input type="date" className={styles.input} value={ate} onChange={(e) => setAte(e.target.value)} />
        </label>
        <div className={styles.segmented}>
          {[
            ["Últimos 6m + próximos 6m", -6, 7],
            ["Próximos 3 meses", 0, 3],
            ["Últimos 12 meses", -12, 1],
          ].map(([rot, a, b]) => (
            <button
              key={rot as string}
              type="button"
              onClick={() => {
                setDe(somarMeses(hoje, a as number));
                setAte(somarMeses(hoje, b as number));
              }}
            >
              {rot}
            </button>
          ))}
        </div>
      </div>

      {erro && <div className={`${styles.aviso} ${styles.avisoErro}`}>{erro}</div>}
      {!dados && !erro && <div className={styles.aviso}>Carregando o caixa…</div>}

      {dados && (
        <>
          <div className={styles.kpis}>
            <div className={`${styles.kpi} ${styles.kpiAccent}`}>
              <span className={styles.kpiLabel}>Saldo em {saldoHoje ? dataBr(saldoHoje.data) : "—"}</span>
              <span className={`${styles.kpiValue} ${(saldoHoje?.valor ?? 0) < 0 ? styles.neg : ""}`}>
                {compacto(saldoHoje?.valor)}
              </span>
              <span className={styles.kpiFoot}>saldo sem pipeline, como na planilha</span>
            </div>
            <div className={styles.kpi}>
              <span className={styles.kpiLabel}>Menor saldo à frente</span>
              <span className={`${styles.kpiValue} ${(minFuturo?.valor ?? 0) < 0 ? styles.neg : ""}`}>
                {compacto(minFuturo?.valor)}
              </span>
              <span className={styles.kpiFoot}>{minFuturo ? `em ${dataBr(minFuturo.data)}` : "sem datas futuras no período"}</span>
            </div>
            <div className={styles.kpi}>
              <span className={styles.kpiLabel}>Saldo no fim do período</span>
              <span className={`${styles.kpiValue} ${(saldoFim?.valor ?? 0) < 0 ? styles.neg : ""}`}>
                {compacto(saldoFim?.valor)}
              </span>
              <span className={styles.kpiFoot}>{saldoFim ? dataBr(saldoFim.data) : ""}</span>
            </div>
            <div className={styles.kpi}>
              <span className={styles.kpiLabel}>Movimento líquido</span>
              <span className={`${styles.kpiValue} ${dados.soma < 0 ? styles.neg : ""}`}>{compacto(dados.soma)}</span>
              <span className={styles.kpiFoot}>
                soma da coluna Net · {dados.total} dias
                {inicial ? ` · saldo inicial da aba ${brl(Number(inicial.valor))}` : ""}
              </span>
            </div>
          </div>

          <section className={styles.card}>
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle}>Saldo diário de caixa</h2>
              <span className={styles.cardNote}>a partir de hoje é projeção (contas a pagar e a receber lançadas)</span>
            </div>
            <GraficoLinhaDiaria pontos={pontos} hoje={hoje} label="Saldo (sem pipeline)" />
          </section>

          <section className={styles.card}>
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle}>Movimento {visao === "mes" ? "por mês" : "por dia"}</h2>
              <div className={styles.segmented}>
                <button type="button" className={visao === "mes" ? styles.segAtivo : undefined} onClick={() => setVisao("mes")}>
                  Mês
                </button>
                <button type="button" className={visao === "dia" ? styles.segAtivo : undefined} onClick={() => setVisao("dia")}>
                  Dia
                </button>
              </div>
            </div>
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{visao === "mes" ? "Mês" : "Data"}</th>
                    {colunas.map((c) => (
                      <th key={c.chave} className={styles.num}>
                        {c.titulo}
                      </th>
                    ))}
                    <th className={styles.num}>Net</th>
                    <th className={styles.num}>Saldo {visao === "mes" ? "fim do mês" : ""}</th>
                  </tr>
                </thead>
                <tbody>
                  {visao === "mes"
                    ? porMes.map((m) => (
                        <tr key={m.mes}>
                          <td className={styles.nowrap}>{mesCurto(m.mes)}</td>
                          {colunas.map((c) => (
                            <td key={c.chave} className={`${styles.num} ${(m.cols[c.chave] ?? 0) < 0 ? styles.neg : ""}`}>
                              {numero(Math.round(m.cols[c.chave] ?? 0))}
                            </td>
                          ))}
                          <td className={`${styles.num} ${m.net < 0 ? styles.neg : ""}`}>{numero(Math.round(m.net))}</td>
                          <td className={`${styles.num} ${(m.saldo ?? 0) < 0 ? styles.neg : ""}`}>
                            {m.saldo == null ? "—" : numero(Math.round(m.saldo))}
                          </td>
                        </tr>
                      ))
                    : dados.itens.map((i) => (
                        <tr key={i.id}>
                          <td className={styles.nowrap}>{dataBr(String(i.c.data_caixa ?? ""))}</td>
                          {colunas.map((c) => {
                            const v = typeof i.x[c.chave] === "number" ? Number(i.x[c.chave]) : 0;
                            return (
                              <td key={c.chave} className={`${styles.num} ${v < 0 ? styles.neg : ""}`}>
                                {v ? numero(Math.round(v)) : ""}
                              </td>
                            );
                          })}
                          <td className={`${styles.num} ${Number(i.c.valor ?? 0) < 0 ? styles.neg : ""}`}>
                            {numero(Math.round(Number(i.c.valor ?? 0)))}
                          </td>
                          <td className={styles.num}>
                            {chaveSaldo && typeof i.x[chaveSaldo] === "number" ? numero(Math.round(Number(i.x[chaveSaldo]))) : "—"}
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
