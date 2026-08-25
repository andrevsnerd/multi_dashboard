"use client";

import { useState } from "react";

import type { CompraGastoMes } from "@/lib/types/compra-gasto";

import styles from "./GastosCompra.module.css";
import { brl, compacto, mesCurto, mesLongo } from "./gastos-compra-format";

interface Props {
  meses: CompraGastoMes[];
  /** YYYY-MM-DD */
  hoje: string;
  onSelectMes?: (ym: string) => void;
}

const W = 980;
const H = 288;
const PAD_L = 56;
const PAD_R = 14;
const PAD_T = 18;
const PAD_B = 44;

/** Retângulo com o topo arredondado — a ponta do dado, ancorada na linha de base. */
function topoArredondado(x: number, y: number, w: number, h: number, r = 4): string {
  if (h <= 0) return "";
  const rr = Math.min(r, h, w / 2);
  return [
    `M${x},${y + h}`,
    `V${y + rr}`,
    `a${rr},${rr} 0 0 1 ${rr},${-rr}`,
    `h${w - 2 * rr}`,
    `a${rr},${rr} 0 0 1 ${rr},${rr}`,
    `V${y + h}`,
    "Z",
  ].join("");
}

/**
 * Orçamento × comprometido por mês.
 *
 * Pilha de um só matiz (pago = passo escuro, a pagar = passo claro, estimativa =
 * hachura do passo claro) contra um alvo tracejado que é o orçamento do mês.
 * Mês sem orçamento não tem alvo — e portanto não tem estouro a apontar.
 */
export default function GastosCompraGrafico({ meses, hoje, onSelectMes }: Props) {
  const [hover, setHover] = useState<{ ym: string; x: number; y: number } | null>(null);

  if (meses.length === 0) return null;

  const iw = W - PAD_L - PAD_R;
  const ih = H - PAD_T - PAD_B;
  const slot = iw / meses.length;
  const bw = Math.min(38, slot * 0.52);

  const maiorValor = meses.reduce((max, m) => Math.max(max, m.comprometido, m.orcamento), 0);
  const passo = maiorValor > 1_200_000 ? 500_000 : maiorValor > 400_000 ? 100_000 : 50_000;
  const teto = Math.max(passo, Math.ceil(maiorValor / passo) * passo);
  const y = (v: number) => PAD_T + ih - (v / teto) * ih;

  const linhasGrade: number[] = [];
  for (let g = 0; g <= teto; g += passo) linhasGrade.push(g);

  const mesHover = hover ? meses.find((m) => m.ym === hover.ym) : null;

  return (
    <>
      <div className={styles.chartWrap}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Orçamento e comprometido por mês">
          <defs>
            <pattern
              id="gc-hachura"
              width="6"
              height="6"
              patternTransform="rotate(45)"
              patternUnits="userSpaceOnUse"
            >
              <rect width="6" height="6" fill="var(--s-white)" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--gc-firme)" strokeWidth="3.4" />
            </pattern>
          </defs>

          {linhasGrade.map((g) => (
            <g key={g}>
              <line
                x1={PAD_L}
                y1={y(g)}
                x2={W - PAD_R}
                y2={y(g)}
                stroke="var(--chart-grid)"
                strokeWidth="1"
              />
              <text
                x={PAD_L - 9}
                y={y(g) + 4}
                textAnchor="end"
                fontSize="10.5"
                fill="var(--chart-axis-text)"
              >
                {compacto(g)}
              </text>
            </g>
          ))}

          {meses.map((m, i) => {
            const cx = PAD_L + slot * i + slot / 2;
            const x = cx - bw / 2;
            const estouro = m.temOrcamento && m.comprometido > m.orcamento;
            const atual = m.ym === hoje.slice(0, 7);

            const segmentos = [
              { v: m.pago, fill: "var(--gc-pago)" },
              { v: m.firme, fill: "var(--gc-firme)" },
              { v: m.estimado, fill: "url(#gc-hachura)" },
            ].filter((s) => s.v > 0);

            let cursor = PAD_T + ih;
            const paths = segmentos.map((s, k) => {
              const h = (s.v / teto) * ih;
              const gap = k === 0 ? 0 : 2;
              const yy = cursor - h;
              const topo = k === segmentos.length - 1;
              const d = topo
                ? topoArredondado(x, yy, bw, h - gap)
                : `M${x},${yy + gap}h${bw}v${h - gap}h${-bw}Z`;
              cursor = yy;
              return <path key={k} d={d} fill={s.fill} />;
            });

            return (
              <g key={m.ym}>
                {m.temOrcamento && m.orcamento > 0 && (
                  <path
                    d={topoArredondado(x, y(m.orcamento), bw, PAD_T + ih - y(m.orcamento))}
                    fill="var(--gc-track)"
                    opacity="0.55"
                  />
                )}

                {paths}

                {m.temOrcamento && m.orcamento > 0 && (
                  <line
                    x1={x - 5}
                    y1={y(m.orcamento)}
                    x2={x + bw + 5}
                    y2={y(m.orcamento)}
                    stroke={estouro ? "var(--gc-crit)" : "var(--t-500)"}
                    strokeWidth="2"
                    strokeDasharray="4 3"
                    strokeLinecap="round"
                  />
                )}

                {estouro && (
                  <text
                    x={cx}
                    y={y(m.comprometido) - 7}
                    textAnchor="middle"
                    fontSize="10"
                    fontWeight="600"
                    fill="var(--gc-crit)"
                  >
                    {`▲ ${compacto(m.comprometido - m.orcamento)}`}
                  </text>
                )}

                <text
                  x={cx}
                  y={H - 24}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight={atual ? 600 : 400}
                  fill={estouro ? "var(--gc-crit)" : atual ? "var(--t-900)" : "var(--chart-axis-text)"}
                >
                  {mesCurto(m.ym)}
                </text>
                {atual && (
                  <text
                    x={cx}
                    y={H - 10}
                    textAnchor="middle"
                    fontSize="9"
                    fontWeight="600"
                    letterSpacing="0.08em"
                    fill="var(--gc-pago)"
                  >
                    HOJE
                  </text>
                )}

                <rect
                  x={PAD_L + slot * i}
                  y={PAD_T}
                  width={slot}
                  height={ih}
                  fill="transparent"
                  style={{ cursor: onSelectMes ? "pointer" : "default" }}
                  onMouseMove={(e) => setHover({ ym: m.ym, x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onSelectMes?.(m.ym)}
                />
              </g>
            );
          })}

          <line
            x1={PAD_L}
            y1={PAD_T + ih}
            x2={W - PAD_R}
            y2={PAD_T + ih}
            stroke="var(--b-300)"
            strokeWidth="1"
          />
        </svg>
      </div>

      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={styles.swatch} style={{ background: "var(--gc-pago)" }} /> Pago
        </span>
        <span className={styles.legendItem}>
          <span className={styles.swatch} style={{ background: "var(--gc-firme)" }} /> A pagar (compra fechada)
        </span>
        <span className={styles.legendItem}>
          <span className={styles.swatch} style={{ background: "var(--gc-firme)", opacity: 0.45 }} /> Estimativa
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.swatchTarget}`} /> Orçamento do mês
        </span>
      </div>

      {mesHover && hover && (
        <div className={styles.tip} style={{ left: hover.x, top: hover.y }} role="status">
          <div className={styles.tipTitle}>{mesLongo(mesHover.ym)}</div>
          <div className={styles.tipRow}>
            <span>
              <span className={`${styles.swatch} ${styles.swatchTarget}`} /> Orçamento
            </span>
            <b>{mesHover.temOrcamento ? brl(mesHover.orcamento) : "não definido"}</b>
          </div>
          <div className={styles.tipSep} />
          <div className={styles.tipRow}>
            <span>
              <span className={styles.swatch} style={{ background: "var(--gc-pago)" }} /> Pago
            </span>
            <b>{brl(mesHover.pago)}</b>
          </div>
          <div className={styles.tipRow}>
            <span>
              <span className={styles.swatch} style={{ background: "var(--gc-firme)" }} /> A pagar
            </span>
            <b>{brl(mesHover.firme)}</b>
          </div>
          {mesHover.estimado > 0 && (
            <div className={styles.tipRow}>
              <span>
                <span className={styles.swatch} style={{ background: "var(--gc-firme)", opacity: 0.45 }} />{" "}
                Estimativa
              </span>
              <b>{brl(mesHover.estimado)}</b>
            </div>
          )}
          <div className={styles.tipSep} />
          <div className={styles.tipRow}>
            <span>Comprometido</span>
            <b>{brl(mesHover.comprometido)}</b>
          </div>
          <div className={styles.tipRow}>
            <span>{mesHover.saldo >= 0 ? "Saldo" : "Estouro"}</span>
            <b className={!mesHover.temOrcamento ? styles.muted : mesHover.saldo >= 0 ? styles.pos : styles.neg}>
              {mesHover.temOrcamento
                ? `${mesHover.saldo < 0 ? "−" : ""}${brl(Math.abs(mesHover.saldo))}`
                : "—"}
            </b>
          </div>
        </div>
      )}
    </>
  );
}
