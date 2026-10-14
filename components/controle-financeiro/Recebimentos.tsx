"use client";

import { useEffect, useMemo, useState } from "react";

import { GraficoBarrasMensal } from "./Graficos";
import {
  type AbaInfo,
  type AbaResposta,
  brl,
  dataBr,
  inteiro,
  mesCurto,
  numero,
  percentual,
  useFinanceiroApi,
} from "./shared";
import styles from "./ControleFinanceiro.module.css";

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

const hojeIso = () => new Date().toISOString().slice(0, 10);

export default function Recebimentos({
  companyKey,
  abaBancos,
  abaAtacado,
  anoPadrao,
}: {
  companyKey: string;
  abaBancos: AbaInfo | null;
  abaAtacado: AbaInfo | null;
  anoPadrao: number;
}) {
  return (
    <div className={styles.corpo}>
      {abaBancos && <EntradasBancos companyKey={companyKey} aba={abaBancos} anoPadrao={anoPadrao} />}
      {abaAtacado && <Atacado companyKey={companyKey} aba={abaAtacado} />}
      {!abaBancos && !abaAtacado && <div className={styles.aviso}>A planilha não trouxe abas de recebimento.</div>}
    </div>
  );
}

function EntradasBancos({ companyKey, aba, anoPadrao }: { companyKey: string; aba: AbaInfo; anoPadrao: number }) {
  const api = useFinanceiroApi(companyKey);
  const [ano, setAno] = useState(anoPadrao);
  const [dados, setDados] = useState<AbaResposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const colunas = useMemo(
    () => aba.colunas.filter((c) => !c.campo && !/^(dia semana|semana|coluna )/.test(norm(c.titulo))),
    [aba.colunas]
  );

  useEffect(() => {
    if (!api.pronto) return;
    let vivo = true;
    api
      .get<AbaResposta>("/aba", {
        aba: aba.aba,
        de: `${ano}-01-01`,
        ate: `${ano}-12-31`,
        campoData: "data_caixa",
        serie: 1,
        somar: colunas.map((c) => c.chave),
        porPagina: 10,
      })
      .then((d) => vivo && (setDados(d), setErro(null)))
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : "Erro"));
    return () => {
      vivo = false;
    };
  }, [api, aba.aba, ano, colunas]);

  const meses = (dados?.serie ?? []).map((s) => s.mes);
  const usadas = colunas.filter((c) => (dados?.serie ?? []).some((s) => s.extras[c.chave]));

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>Entradas por banco · aba {aba.aba}</h2>
        <div className={styles.filtros}>
          <button type="button" className={styles.btn} onClick={() => setAno(ano - 1)}>
            ‹ {ano - 1}
          </button>
          <b>{ano}</b>
          <button type="button" className={styles.btn} onClick={() => setAno(ano + 1)}>
            {ano + 1} ›
          </button>
        </div>
      </div>
      {erro && <div className={`${styles.aviso} ${styles.avisoErro}`}>{erro}</div>}
      {dados && meses.length === 0 && <div className={styles.cardBody}>Sem entradas em {ano}.</div>}
      {dados && meses.length > 0 && (
        <>
          <GraficoBarrasMensal
            meses={meses}
            series={[{ key: "t", label: "Total recebíveis", cor: "var(--cf-s1)", valores: dados.serie.map((s) => s.soma) }]}
            empilhado={false}
            altura={220}
          />
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Mês</th>
                  {usadas.map((c) => (
                    <th key={c.chave} className={styles.num}>
                      {c.titulo}
                    </th>
                  ))}
                  <th className={styles.num}>Total recebíveis</th>
                </tr>
              </thead>
              <tbody>
                {dados.serie.map((s) => (
                  <tr key={s.mes}>
                    <td>{mesCurto(s.mes)}</td>
                    {usadas.map((c) => (
                      <td key={c.chave} className={styles.num}>
                        {s.extras[c.chave] ? numero(Math.round(s.extras[c.chave])) : ""}
                      </td>
                    ))}
                    <td className={styles.num}>
                      <b>{numero(Math.round(s.soma))}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function Atacado({ companyKey, aba }: { companyKey: string; aba: AbaInfo }) {
  const api = useFinanceiroApi(companyKey);
  const hoje = hojeIso();
  const [de, setDe] = useState(hoje);
  const [ate, setAte] = useState(`${Number(hoje.slice(0, 4)) + 1}${hoje.slice(4)}`);
  const [q, setQ] = useState("");
  const [busca, setBusca] = useState("");
  const [dados, setDados] = useState<AbaResposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setBusca(q), 350);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!api.pronto) return;
    let vivo = true;
    api
      .get<AbaResposta>("/aba", {
        aba: aba.aba,
        de,
        ate,
        q: busca,
        campoData: "data_caixa",
        ordem: "data_asc",
        serie: 1,
        porPagina: 1000,
      })
      .then((d) => vivo && (setDados(d), setErro(null)))
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : "Erro"));
    return () => {
      vivo = false;
    };
  }, [api, aba.aba, de, ate, busca]);

  const obs = aba.colunas.filter((c) => !c.campo);
  const fechado = (dados?.itens ?? []).reduce((t, i) => t + Number(i.c.valor ?? 0), 0);

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>Recebíveis do atacado · aba {aba.aba}</h2>
        <span className={styles.cardNote}>por data prevista de caixa</span>
      </div>
      <div className={styles.cardBody}>
        <div className={styles.filtros}>
          <label className={styles.campo}>
            <span>Previsto de</span>
            <input type="date" className={styles.input} value={de} onChange={(e) => setDe(e.target.value)} />
          </label>
          <label className={styles.campo}>
            <span>até</span>
            <input type="date" className={styles.input} value={ate} onChange={(e) => setAte(e.target.value)} />
          </label>
          <label className={styles.campo}>
            <span>Cliente / observação</span>
            <input className={styles.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="buscar…" />
          </label>
          {dados && (
            <span className={styles.cardNote}>
              {inteiro(dados.total)} títulos · <b>{brl(dados.soma)}</b>
              {dados.total > dados.itens.length ? ` · mostrando os ${dados.itens.length} primeiros` : ""}
            </span>
          )}
        </div>
      </div>
      {erro && <div className={`${styles.aviso} ${styles.avisoErro}`}>{erro}</div>}
      {dados && dados.serie.length > 1 && (
        <GraficoBarrasMensal
          meses={dados.serie.map((s) => s.mes)}
          series={[{ key: "v", label: "Valor fechado", cor: "var(--cf-s2)", valores: dados.serie.map((s) => s.soma) }]}
          empilhado={false}
          altura={200}
        />
      )}
      {dados && (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Prevista caixa</th>
                <th>Faturamento</th>
                <th>Cliente</th>
                <th>Valor pipeline</th>
                {obs.map((c) => (
                  <th key={c.chave}>{c.titulo}</th>
                ))}
                <th className={styles.num}>Valor fechado</th>
                <th className={styles.num}>% do período</th>
              </tr>
            </thead>
            <tbody>
              {dados.itens.map((i) => (
                <tr key={i.id}>
                  <td className={styles.nowrap}>{dataBr(String(i.c.data_caixa ?? ""))}</td>
                  <td className={styles.nowrap}>{dataBr(String(i.c.data_competencia ?? ""))}</td>
                  <td>{String(i.c.cliente ?? "")}</td>
                  <td>{String(i.c.descricao ?? "")}</td>
                  {obs.map((c) => (
                    <td key={c.chave}>{i.x[c.chave] == null ? "" : String(i.x[c.chave])}</td>
                  ))}
                  <td className={styles.num}>{brl(Number(i.c.valor ?? 0))}</td>
                  <td className={styles.num}>{fechado ? percentual(Number(i.c.valor ?? 0) / fechado) : "—"}</td>
                </tr>
              ))}
              {!dados.itens.length && (
                <tr>
                  <td colSpan={6 + obs.length} className={styles.muted}>
                    Nenhum título previsto no período.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
