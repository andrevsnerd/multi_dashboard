"use client";

import { useEffect, useMemo, useState } from "react";

import { BLOCO_PRINCIPAL, indexarDre, mesesDoAno, papelDaLinha } from "./dre-util";
import {
  type DreLinha,
  type DreResposta,
  brl,
  dataBr,
  mesCurto,
  numero,
  percentual,
  useFinanceiroApi,
} from "./shared";
import styles from "./ControleFinanceiro.module.css";

interface Props {
  companyKey: string;
  anoInicial: number;
  mesRef: string | null;
  onAbrirLancamentos: (classificacao: string, mes: string) => void;
}

interface Drill {
  linha: DreLinha;
  mes: string;
  valorDre: number | null;
}

const fmtCelula = (l: DreLinha, v: number | null, texto: string | null) => {
  if (v == null) return texto ?? "";
  if (l.formato === "pct") return percentual(v);
  if (l.formato === "multiplo") return `${numero(v)}×`;
  return numero(Math.round(v));
};

export default function Dre({ companyKey, anoInicial, mesRef, onAbrirLancamentos }: Props) {
  const api = useFinanceiroApi(companyKey);
  const [ano, setAno] = useState(anoInicial);
  const [bloco, setBloco] = useState(BLOCO_PRINCIPAL);
  // A resposta guarda o ano pedido: "carregando" = a tela mostra outro ano.
  const [resp, setResp] = useState<{ ano: number; dre: DreResposta } | null>(null);
  const dre = resp?.dre ?? null;
  const [erro, setErro] = useState<string | null>(null);
  const [ocultarVazias, setOcultarVazias] = useState(true);
  const [drill, setDrill] = useState<Drill | null>(null);

  useEffect(() => {
    if (!api.pronto) return;
    let vivo = true;
    api
      .get<DreResposta>("/dre", { de: `${ano - 1}-01-01`, ate: `${ano}-12-01` })
      .then((d) => vivo && (setResp({ ano, dre: d }), setErro(null)))
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : "Erro ao carregar"))
    return () => {
      vivo = false;
    };
  }, [api, ano]);

  const idx = useMemo(() => (dre ? indexarDre(dre) : null), [dre]);
  const carregando = !!resp && resp.ano !== ano;
  const anos = useMemo(() => {
    if (!dre?.mesMin || !dre.mesMax) return [ano];
    const out: number[] = [];
    for (let a = Number(dre.mesMax.slice(0, 4)); a >= Number(dre.mesMin.slice(0, 4)); a--) out.push(a);
    return out;
  }, [dre, ano]);

  if (erro) return <div className={`${styles.aviso} ${styles.avisoErro}`}>{erro}</div>;
  if (!idx) return <div className={styles.aviso}>Carregando a DRE…</div>;

  const meses = mesesDoAno(ano);
  const mesesAA = mesesDoAno(ano - 1);
  const linhas = idx.linhas.filter((l) => l.bloco === bloco && !l.titulo);
  const visiveis = ocultarVazias
    ? linhas.filter((l) => meses.some((m) => idx.valor(l.linha, m)) || mesesAA.some((m) => idx.valor(l.linha, m)))
    : linhas;
  const projetado = (m: string) => !!mesRef && m >= mesRef;
  const clicavel = (l: DreLinha) => bloco === BLOCO_PRINCIPAL && papelDaLinha(l) === "detalhe" && !!l.rotulo;

  return (
    <div className={`${styles.corpo} ${carregando ? styles.carregando : ""}`}>
      <div className={styles.filtros}>
        <label className={styles.campo}>
          <span>Ano</span>
          <select className={styles.select} value={ano} onChange={(e) => setAno(Number(e.target.value))}>
            {anos.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.segmented} role="tablist" aria-label="Bloco da DRE">
          {idx.blocos.map((b) => (
            <button key={b} type="button" className={b === bloco ? styles.segAtivo : undefined} onClick={() => setBloco(b)}>
              {b === BLOCO_PRINCIPAL ? "DRE consolidada" : b}
            </button>
          ))}
        </div>
        <label className={styles.chip} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={ocultarVazias} onChange={(e) => setOcultarVazias(e.target.checked)} />
          ocultar linhas vazias
        </label>
      </div>

      {bloco === BLOCO_PRINCIPAL ? (
        <div className={`${styles.aviso} ${styles.avisoInfo}`}>
          Valores como estão na DRE da planilha. Clique num valor de linha de despesa para ver os lançamentos que
          a compõem (mesma classificação, mesmo mês de competência). Meses hachurados ainda não fecharam (a
          planilha foi atualizada{mesRef ? ` em ${mesCurto(mesRef)}` : ""}) — os valores deles são parciais ou projeção.
        </div>
      ) : null}

      <section className={styles.card}>
        <div className={styles.tableScroll}>
          <table className={`${styles.table} ${styles.dreTable}`}>
            <thead>
              <tr>
                <th>{bloco === BLOCO_PRINCIPAL ? "DRE" : bloco}</th>
                {meses.map((m) => (
                  <th key={m} className={`${styles.num} ${projetado(m) ? styles.dreProj : ""}`}>
                    {mesCurto(m)}
                  </th>
                ))}
                <th className={styles.num}>Total {ano}</th>
                <th className={styles.num}>Total {ano - 1}</th>
                <th className={styles.num}>Δ</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((l) => {
                const papel = papelDaLinha(l);
                const cls =
                  papel === "resultado"
                    ? styles.dreResultado
                    : papel === "total"
                      ? styles.dreTotal
                      : papel === "taxa"
                        ? styles.dreTaxa
                        : styles.dreIndent;
                const somaAno = meses.reduce((t, m) => t + (idx.valor(l.linha, m) ?? 0), 0);
                const somaAA = mesesAA.reduce((t, m) => t + (idx.valor(l.linha, m) ?? 0), 0);
                const moeda = l.formato === "moeda";
                const delta = moeda && somaAA ? (somaAno - somaAA) / Math.abs(somaAA) : null;
                return (
                  <tr key={l.linha} className={cls}>
                    <td title={`Linha ${l.linha} da aba DRE`}>{l.rotulo || <span className={styles.muted}>(sem rótulo)</span>}</td>
                    {meses.map((m) => {
                      const v = idx.valor(l.linha, m);
                      const ok = clicavel(l) && v != null;
                      return (
                        <td
                          key={m}
                          className={`${styles.num} ${projetado(m) ? styles.dreProj : ""} ${ok ? styles.celulaClick : ""} ${v != null && v < 0 && moeda ? styles.neg : ""}`}
                          onClick={ok ? () => setDrill({ linha: l, mes: m, valorDre: v }) : undefined}
                          title={v != null && moeda ? brl(v) : undefined}
                        >
                          {fmtCelula(l, v, idx.texto(l.linha, m))}
                        </td>
                      );
                    })}
                    <td className={`${styles.num} ${somaAno < 0 && moeda ? styles.neg : ""}`}>
                      {moeda ? numero(Math.round(somaAno)) : "—"}
                    </td>
                    <td className={styles.num}>{moeda ? numero(Math.round(somaAA)) : "—"}</td>
                    <td className={styles.num}>{delta == null ? "—" : `${delta > 0 ? "+" : ""}${percentual(delta)}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {drill && (
        <DrillDre
          companyKey={companyKey}
          drill={drill}
          onFechar={() => setDrill(null)}
          onAbrirLancamentos={() => {
            onAbrirLancamentos(drill.linha.rotulo, drill.mes);
            setDrill(null);
          }}
        />
      )}
    </div>
  );
}

interface LancResp {
  total: number;
  soma: number;
  itens: {
    id: number;
    aba: string;
    linha: number;
    dataCompetencia: string | null;
    dataCaixa: string | null;
    valor: number | null;
    descricao: string | null;
    matriz: string | null;
    loja: string | null;
    status: string | null;
  }[];
}

function DrillDre({
  companyKey,
  drill,
  onFechar,
  onAbrirLancamentos,
}: {
  companyKey: string;
  drill: Drill;
  onFechar: () => void;
  onAbrirLancamentos: () => void;
}) {
  const api = useFinanceiroApi(companyKey);
  const [dados, setDados] = useState<LancResp | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onFechar]);

  useEffect(() => {
    if (!api.pronto) return;
    api
      .get<LancResp>("/lancamentos", {
        classificacoes: [drill.linha.rotulo],
        mes: drill.mes,
        porPagina: 500,
        ordem: "valor_asc",
      })
      .then(setDados)
      .catch((e) => setErro(e instanceof Error ? e.message : "Erro"));
  }, [api, drill]);

  const diferenca = dados && drill.valorDre != null ? drill.valorDre - dados.soma : null;

  return (
    <>
      <div className={styles.overlay} onClick={onFechar} role="presentation" />
      <div className={styles.drawer} role="dialog" aria-modal="true">
        <div className={styles.modalHead}>
          <div>
            <h2>
              {drill.linha.rotulo} · {mesCurto(drill.mes)}
            </h2>
            <p>
              DRE: <b>{brl(drill.valorDre)}</b>
              {dados && (
                <>
                  {" "}
                  · {dados.total} lançamento(s) somam <b>{brl(dados.soma)}</b>
                  {diferenca != null && Math.abs(diferenca) >= 0.01 ? (
                    <span className={styles.warn}> · diferença {brl(diferenca)}</span>
                  ) : (
                    <span className={styles.good}> · bate com a DRE</span>
                  )}
                </>
              )}
            </p>
          </div>
          <button type="button" className={styles.fechar} onClick={onFechar} aria-label="Fechar">
            ×
          </button>
        </div>
        <div className={styles.modalBody}>
          {erro && <div className={`${styles.aviso} ${styles.avisoErro}`}>{erro}</div>}
          {!dados && !erro && <div className={styles.aviso}>Buscando lançamentos…</div>}
          {dados && dados.total === 0 && (
            <div className={styles.aviso}>
              Nenhum lançamento com a classificação “{drill.linha.rotulo}” neste mês. Esta linha é calculada direto
              na planilha (fórmula ou digitação na DRE).
            </div>
          )}
          {dados && dados.total > 0 && (
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Aba</th>
                    <th>Competência</th>
                    <th>Caixa</th>
                    <th>Descrição</th>
                    <th>Matriz</th>
                    <th>Loja</th>
                    <th>Status</th>
                    <th className={styles.num}>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.itens.map((l) => (
                    <tr key={l.id}>
                      <td className={styles.nowrap} title={`linha ${l.linha}`}>
                        {l.aba}
                      </td>
                      <td className={styles.nowrap}>{dataBr(l.dataCompetencia)}</td>
                      <td className={styles.nowrap}>{dataBr(l.dataCaixa)}</td>
                      <td className={styles.desc}>{l.descricao}</td>
                      <td>{l.matriz}</td>
                      <td>{l.loja}</td>
                      <td>{l.status}</td>
                      <td className={`${styles.num} ${(l.valor ?? 0) < 0 ? styles.neg : ""}`}>{brl(l.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className={styles.modalFoot}>
          <button type="button" className={styles.btn} onClick={onAbrirLancamentos}>
            Abrir na aba Lançamentos
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onFechar}>
            Fechar
          </button>
        </div>
      </div>
    </>
  );
}
