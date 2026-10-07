"use client";

import { Fragment, useState } from "react";

import {
  type Canal,
  type MesCalc,
  type ResumoCalc,
  inteiro,
  MESES_CURTOS,
  percentual,
  variacao,
} from "./calc";
import { classeAtingimento, iconeAtingimento } from "./GraficoMensal";
import styles from "./PlanejamentoReceita.module.css";

export interface GrupoTabela {
  canal: Canal;
  label: string;
  meses: MesCalc[];
  resumo: ResumoCalc;
}

interface Props {
  ano: number;
  grupos: GrupoTabela[];
}

interface Linha {
  key: string;
  label: string;
  forte?: boolean;
  fraca?: boolean;
  celula: (m: MesCalc) => React.ReactNode;
  total: (r: ResumoCalc, meses: MesCalc[]) => React.ReactNode;
}

const traco = <span className={styles.muted}>—</span>;

function sinalizado(v: number | null) {
  if (v == null) return traco;
  return <span className={v >= 0 ? styles.good : styles.crit}>{variacao(v)}</span>;
}

function atingimento(v: number | null) {
  if (v == null) return traco;
  return (
    <span className={`${styles.status} ${classeAtingimento(v)}`}>
      {iconeAtingimento(v)} {percentual(v)}
    </span>
  );
}

function dinheiroDif(v: number) {
  return <span className={v >= 0 ? styles.good : styles.crit}>{`${v >= 0 ? "+" : "−"}${inteiro(Math.abs(v))}`}</span>;
}

export default function TabelaPlanejamento({ ano, grupos }: Props) {
  const [fechados, setFechados] = useState<Set<Canal>>(new Set());
  const aaCurto = String(ano - 1);

  const linhas: Linha[] = [
    {
      key: "orcado",
      label: "Orçado",
      forte: true,
      celula: (m) => inteiro(m.orcado),
      total: (r) => inteiro(r.orcadoAno),
    },
    {
      key: "realizado",
      label: "Realizado",
      forte: true,
      celula: (m) =>
        m.realizado == null ? (
          traco
        ) : (
          <>
            {inteiro(m.realizado)}
            {m.status === "corrente" && <span className={styles.parcial} title="Mês em andamento">●</span>}
          </>
        ),
      total: (r) => (r.status === "nao-iniciado" ? traco : inteiro(r.realizadoAno)),
    },
    {
      key: "atingimento",
      label: "Atingimento",
      celula: (m) => atingimento(m.atingimento),
      total: (r) => atingimento(r.atingimento),
    },
    {
      key: "dif",
      label: "Dif. vs orçado",
      celula: (m) => (m.realizado == null ? traco : dinheiroDif(m.realizado - m.orcadoProporcional)),
      total: (r) => (r.status === "nao-iniciado" ? traco : dinheiroDif(r.diferenca)),
    },
    {
      key: "aa",
      label: `Realizado ${aaCurto}`,
      fraca: true,
      celula: (m) =>
        m.aa == null ? (
          traco
        ) : (
          <>
            {inteiro(m.aa)}
            {m.aaParcial && <span className={styles.parcial} title="Mês em andamento">●</span>}
          </>
        ),
      total: (r) => (
        <>
          {inteiro(r.aaAno)}
          {!r.aaAnoCompleto && <span className={styles.parcial} title="Ano anterior ainda não fechou">●</span>}
        </>
      ),
    },
    {
      key: "crescReal",
      label: `Cresc. realizado vs ${aaCurto}`,
      celula: (m) => sinalizado(m.crescRealizado),
      total: (r) => sinalizado(r.crescimentoPeriodo),
    },
    {
      key: "crescOrc",
      label: `Cresc. orçado vs ${aaCurto}`,
      fraca: true,
      celula: (m) => sinalizado(m.crescOrcado),
      total: (r) => sinalizado(r.crescOrcadoVsAA),
    },
  ];

  const alternar = (canal: Canal) =>
    setFechados((prev) => {
      const next = new Set(prev);
      if (next.has(canal)) next.delete(canal);
      else next.add(canal);
      return next;
    });

  return (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>{ano}</th>
            {MESES_CURTOS.map((mes, i) => (
              <th
                key={mes}
                className={grupos[0]?.meses[i]?.status === "corrente" ? styles.thAtual : undefined}
              >
                {mes}
              </th>
            ))}
            <th className={styles.colTotal}>Ano</th>
          </tr>
        </thead>
        <tbody>
          {grupos.map((g) => {
            const aberto = !fechados.has(g.canal);
            return (
              <Fragment key={g.canal}>
                <tr className={styles.grupoRow} onClick={() => alternar(g.canal)}>
                  <td colSpan={14}>
                    <span className={`${styles.caret} ${aberto ? styles.caretOpen : ""}`}>▶</span>
                    {g.label}
                  </td>
                </tr>
                {aberto &&
                  linhas.map((l) => (
                    <tr
                      key={`${g.canal}-${l.key}`}
                      className={l.forte ? styles.rowForte : l.fraca ? styles.rowFraca : undefined}
                    >
                      <td className={styles.rowLabel}>{l.label}</td>
                      {g.meses.map((m) => (
                        <td key={m.mes} className={m.status === "corrente" ? styles.colAtual : undefined}>
                          {l.celula(m)}
                        </td>
                      ))}
                      <td className={styles.colTotal}>{l.total(g.resumo, g.meses)}</td>
                    </tr>
                  ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
