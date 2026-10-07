"use client";

import { useState } from "react";

import {
  type MesCalc,
  brl,
  compacto,
  MESES_CURTOS,
  MESES_LONGOS,
  percentual,
  variacao,
} from "./calc";
import styles from "./PlanejamentoReceita.module.css";

interface Props {
  meses: MesCalc[];
  ano: number;
  diaHoje: number;
}

const W = 980;
const H = 300;
const PAD_L = 58;
const PAD_R = 14;
const PAD_T = 16;
const PAD_B = 54;

/** Retângulo com o topo arredondado — a ponta do dado, ancorada na linha de base. */
function topoArredondado(x: number, y: number, w: number, h: number, r = 4): string {
  if (h <= 0) return "";
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + rr}a${rr},${rr} 0 0 1 ${rr},${-rr}h${w - 2 * rr}a${rr},${rr} 0 0 1 ${rr},${rr}V${y + h}Z`;
}

export function passoEixo(maximo: number): number {
  if (maximo <= 0) return 1;
  const bruto = maximo / 5;
  const mag = 10 ** Math.floor(Math.log10(bruto));
  const n = bruto / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

export function classeAtingimento(v: number | null): string {
  if (v == null) return styles.muted;
  if (v >= 1) return styles.good;
  if (v >= 0.95) return styles.warn;
  return styles.crit;
}

export function iconeAtingimento(v: number | null): string {
  if (v == null) return "";
  if (v >= 1) return "▲";
  if (v >= 0.95) return "●";
  return "▼";
}

/**
 * Orçado × realizado por mês.
 *
 * Trilho claro = orçado do mês, com a meta tracejada no topo. Barra sólida = realizado;
 * no mês corrente o passo claro do mesmo matiz empilha o que falta no ritmo diário
 * (projeção). O ponto teal é o mesmo mês do ano anterior.
 */
export default function GraficoMensal({ meses, ano, diaHoje }: Props) {
  const [hover, setHover] = useState<{ mes: number; x: number; y: number } | null>(null);

  const iw = W - PAD_L - PAD_R;
  const ih = H - PAD_T - PAD_B;
  const slot = iw / meses.length;
  const bw = Math.min(40, slot * 0.56);

  const maior = meses.reduce(
    (max, m) => Math.max(max, m.orcado, m.projecaoMes ?? 0, m.realizado ?? 0, m.aa ?? 0),
    0
  );
  const passo = passoEixo(maior);
  const teto = Math.max(passo, Math.ceil(maior / passo) * passo);
  const y = (v: number) => PAD_T + ih - (v / teto) * ih;
  const base = PAD_T + ih;

  const grade: number[] = [];
  for (let g = 0; g <= teto + 1; g += passo) grade.push(g);

  const mh = hover ? meses.find((m) => m.mes === hover.mes) ?? null : null;

  return (
    <>
      <div className={styles.chartWrap}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Orçado e realizado por mês em ${ano}`}>
          {grade.map((g) => (
            <g key={g}>
              <line x1={PAD_L} y1={y(g)} x2={W - PAD_R} y2={y(g)} stroke="var(--chart-grid)" strokeWidth="1" />
              <text x={PAD_L - 9} y={y(g) + 4} textAnchor="end" fontSize="10.5" fill="var(--chart-axis-text)">
                {compacto(g)}
              </text>
            </g>
          ))}

          {meses.map((m, i) => {
            const cx = PAD_L + slot * i + slot / 2;
            const x = cx - bw / 2;
            const atual = m.status === "corrente";

            const real = m.realizado ?? 0;
            const resto = atual && m.projecaoMes != null ? Math.max(0, m.projecaoMes - real) : 0;
            const hReal = (real / teto) * ih;
            const hResto = (resto / teto) * ih;
            const gap = hResto > 0 && hReal > 0 ? 2 : 0;

            return (
              <g key={m.mes}>
                {m.orcado > 0 && (
                  <path d={topoArredondado(x, y(m.orcado), bw, base - y(m.orcado))} fill="var(--pr-track)" />
                )}

                {hReal > 0 &&
                  (hResto > 0 ? (
                    <rect x={x} y={base - hReal} width={bw} height={hReal} fill="var(--pr-real)" />
                  ) : (
                    <path d={topoArredondado(x, base - hReal, bw, hReal)} fill="var(--pr-real)" />
                  ))}
                {hResto > 0 && (
                  <path
                    d={topoArredondado(x, base - hReal - hResto, bw, hResto - gap)}
                    fill="var(--pr-proj)"
                  />
                )}

                {m.orcado > 0 && (
                  <line
                    x1={x - 5}
                    y1={y(m.orcado)}
                    x2={x + bw + 5}
                    y2={y(m.orcado)}
                    stroke="var(--t-500)"
                    strokeWidth="2"
                    strokeDasharray="4 3"
                    strokeLinecap="round"
                  />
                )}

                {m.aa != null && m.aa > 0 && (
                  <circle
                    cx={cx}
                    cy={y(m.aa)}
                    r="4.5"
                    fill={m.aaParcial ? "var(--s-white)" : "var(--pr-aa)"}
                    stroke={m.aaParcial ? "var(--pr-aa)" : "var(--s-white)"}
                    strokeWidth="2"
                  />
                )}

                <text
                  x={cx}
                  y={H - 34}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight={atual ? 700 : 400}
                  fill={atual ? "var(--t-900)" : "var(--chart-axis-text)"}
                >
                  {MESES_CURTOS[m.mes - 1]}
                </text>
                {m.atingimento != null && (
                  <text x={cx} y={H - 19} textAnchor="middle" fontSize="10.5" fill="var(--t-700)">
                    <tspan className={classeAtingimento(m.atingimento)} fill="currentColor">
                      {iconeAtingimento(m.atingimento)}
                    </tspan>{" "}
                    {percentual(m.atingimento)}
                  </text>
                )}
                {atual && (
                  <text
                    x={cx}
                    y={H - 6}
                    textAnchor="middle"
                    fontSize="9"
                    fontWeight="700"
                    letterSpacing="0.08em"
                    fill="var(--pr-real)"
                  >
                    {`ATÉ DIA ${diaHoje}`}
                  </text>
                )}

                <rect
                  x={PAD_L + slot * i}
                  y={PAD_T}
                  width={slot}
                  height={ih}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${MESES_LONGOS[m.mes - 1]}: orçado ${brl(m.orcado)}${m.realizado != null ? `, realizado ${brl(m.realizado)}` : ""}`}
                  onMouseMove={(e) => setHover({ mes: m.mes, x: e.clientX, y: e.clientY })}
                  onFocus={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setHover({ mes: m.mes, x: r.left + r.width / 2, y: r.top + 20 });
                  }}
                  onMouseLeave={() => setHover(null)}
                  onBlur={() => setHover(null)}
                />
              </g>
            );
          })}

          <line x1={PAD_L} y1={base} x2={W - PAD_R} y2={base} stroke="var(--b-300)" strokeWidth="1" />
        </svg>
      </div>

      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={styles.swatch} style={{ background: "var(--pr-real)" }} /> Realizado
        </span>
        <span className={styles.legendItem}>
          <span className={styles.swatch} style={{ background: "var(--pr-proj)" }} /> Projeção do mês (ritmo diário)
        </span>
        <span className={styles.legendItem}>
          <span className={styles.swatch} style={{ background: "var(--pr-track)" }} />
          <span className={styles.swatchDash} style={{ color: "var(--t-500)" }} /> Orçado
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.swatchDot}`} style={{ background: "var(--pr-aa)" }} />{" "}
          {ano - 1} (mês cheio)
        </span>
      </div>

      {mh && hover && (
        <div className={styles.tip} style={{ left: hover.x, top: hover.y }} role="status">
          <div className={styles.tipTitle}>
            {MESES_LONGOS[mh.mes - 1]} de {ano}
            {mh.status === "corrente" ? ` · até dia ${diaHoje}` : ""}
          </div>
          <div className={styles.tipRow}>
            <span>
              <span className={styles.swatchDash} style={{ color: "var(--t-500)" }} /> Orçado
            </span>
            <b>{brl(mh.orcado)}</b>
          </div>
          {mh.status === "corrente" && (
            <div className={styles.tipRow}>
              <span>Orçado até hoje</span>
              <b>{brl(mh.orcadoProporcional)}</b>
            </div>
          )}
          <div className={styles.tipRow}>
            <span>
              <span className={styles.swatch} style={{ background: "var(--pr-real)" }} /> Realizado
            </span>
            <b>{mh.realizado != null ? brl(mh.realizado) : "—"}</b>
          </div>
          {mh.status === "corrente" && mh.projecaoMes != null && (
            <div className={styles.tipRow}>
              <span>
                <span className={styles.swatch} style={{ background: "var(--pr-proj)" }} /> Projeção do mês
              </span>
              <b>{brl(mh.projecaoMes)}</b>
            </div>
          )}
          <div className={styles.tipRow}>
            <span>Atingimento</span>
            <b className={classeAtingimento(mh.atingimento)}>
              {iconeAtingimento(mh.atingimento)} {percentual(mh.atingimento)}
            </b>
          </div>
          <div className={styles.tipSep} />
          <div className={styles.tipRow}>
            <span>
              <span className={`${styles.swatch} ${styles.swatchDot}`} style={{ background: "var(--pr-aa)" }} />{" "}
              {MESES_CURTOS[mh.mes - 1]}/{String(ano - 1).slice(2)}
              {mh.aaParcial ? " (parcial)" : ""}
            </span>
            <b>{mh.aa != null ? brl(mh.aa) : "—"}</b>
          </div>
          <div className={styles.tipRow}>
            <span>Crescimento realizado</span>
            <b>{variacao(mh.crescRealizado)}</b>
          </div>
          <div className={styles.tipRow}>
            <span>Crescimento orçado</span>
            <b>{variacao(mh.crescOrcado)}</b>
          </div>
        </div>
      )}
    </>
  );
}
