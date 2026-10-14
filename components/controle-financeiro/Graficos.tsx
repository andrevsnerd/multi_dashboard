"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { compacto, brl, dataBr, mesCurto } from "./shared";
import styles from "./ControleFinanceiro.module.css";

/* Gráficos em SVG próprio (mesmo padrão do Planejamento de Receita): marcas finas,
   ponta arredondada só na extremidade longe da base, 2px de respiro entre segmentos,
   eixo único e tooltip por mês. Cores por CSS var (claro/escuro no module.css). */

const M = { l: 70, r: 14, t: 14, b: 30 };

/** Largura real do contêiner: o SVG desenha em pixels de verdade (texto não encolhe). */
function useLargura(padrao = 960) {
  const ref = useRef<HTMLDivElement>(null);
  const [largura, setLargura] = useState(padrao);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setLargura(Math.max(560, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, largura] as const;
}

function ticksBonitos(min: number, max: number, alvo = 5): number[] {
  if (min === max) {
    const d = Math.abs(min) || 1;
    min -= d;
    max += d;
  }
  const passoBruto = (max - min) / alvo;
  const mag = 10 ** Math.floor(Math.log10(passoBruto));
  const passo = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((p) => p >= passoBruto) ?? passoBruto;
  const ini = Math.floor(min / passo) * passo;
  const out: number[] = [];
  for (let v = ini; v <= max + passo * 0.001; v += passo) out.push(Math.round(v * 1e6) / 1e6);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + passo);
  return out;
}

/** Retângulo com cantos arredondados só na ponta (longe da base). */
function barra(x: number, y0: number, y1: number, w: number, pontaEmCima: boolean, r = 4): string {
  const topo = Math.min(y0, y1);
  const h = Math.abs(y1 - y0);
  if (h < 0.5) return "";
  const rr = Math.min(r, h, w / 2);
  if (pontaEmCima) {
    return `M${x},${topo + h} V${topo + rr} Q${x},${topo} ${x + rr},${topo} H${x + w - rr} Q${x + w},${topo} ${x + w},${topo + rr} V${topo + h} Z`;
  }
  return `M${x},${topo} V${topo + h - rr} Q${x},${topo + h} ${x + rr},${topo + h} H${x + w - rr} Q${x + w},${topo + h} ${x + w},${topo + h - rr} V${topo} Z`;
}

export interface SerieBarra {
  key: string;
  label: string;
  cor: string;
  valores: (number | null)[];
}

interface Tip {
  x: number;
  y: number;
  idx: number;
}

export function GraficoBarrasMensal({
  meses,
  series,
  empilhado = true,
  divergente = false,
  projecaoDesde,
  altura = 260,
  totalLabel = "Total",
}: {
  meses: string[];
  series: SerieBarra[];
  empilhado?: boolean;
  /** Série única pintada pelo sinal (positivo azul, negativo vermelho). */
  divergente?: boolean;
  /** Mês da última atualização da planilha: dele em diante ainda não fechou. */
  projecaoDesde?: string | null;
  altura?: number;
  totalLabel?: string;
}) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [wrapRef, W] = useLargura();
  const H = altura;
  const plotW = W - M.l - M.r;
  const plotH = H - M.t - M.b;

  const { ticks, y, banda } = useMemo(() => {
    let min = 0;
    let max = 0;
    meses.forEach((_, i) => {
      if (empilhado) {
        let pos = 0;
        let neg = 0;
        for (const s of series) {
          const v = s.valores[i] ?? 0;
          if (v >= 0) pos += v;
          else neg += v;
        }
        max = Math.max(max, pos);
        min = Math.min(min, neg);
      } else {
        for (const s of series) {
          const v = s.valores[i] ?? 0;
          max = Math.max(max, v);
          min = Math.min(min, v);
        }
      }
    });
    const ticks = ticksBonitos(min, max);
    const tMin = ticks[0];
    const tMax = ticks[ticks.length - 1];
    const y = (v: number) => M.t + plotH - ((v - tMin) / (tMax - tMin || 1)) * plotH;
    return { ticks, y, banda: plotW / Math.max(1, meses.length) };
  }, [meses, series, empilhado, plotH, plotW]);

  const projetado = (mes: string) => !!projecaoDesde && mes >= projecaoDesde;
  const larg = Math.max(4, Math.min(42, banda * (empilhado || series.length === 1 ? 0.62 : 0.8)));
  const temProj = meses.some(projetado);

  return (
    <>
      <div ref={wrapRef} className={styles.chartWrap} onMouseLeave={() => setTip(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Gráfico mensal">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} className={t === 0 ? styles.zeroLine : styles.gridLine} />
              <text x={M.l - 8} y={y(t) + 4} textAnchor="end" className={styles.axisText}>
                {compacto(t)}
              </text>
            </g>
          ))}
          {meses.map((mes, i) => {
            const cx = M.l + banda * i + banda / 2;
            const proj = projetado(mes);
            const op = proj ? 0.42 : 1;
            const marcas: React.ReactNode[] = [];
            if (empilhado) {
              let pos = 0;
              let neg = 0;
              const vals = series.map((s) => s.valores[i] ?? 0);
              const ultimoPos = vals.map((v, k) => (v > 0 ? k : -1)).filter((k) => k >= 0).pop();
              const ultimoNeg = vals.map((v, k) => (v < 0 ? k : -1)).filter((k) => k >= 0).pop();
              series.forEach((s, k) => {
                const v = vals[k];
                if (!v) return;
                const ini = v > 0 ? pos : neg;
                const fim = ini + v;
                if (v > 0) pos = fim;
                else neg = fim;
                // 2px de respiro entre segmentos (do segundo em diante, no lado da base).
                const y0 = y(ini) + (ini === 0 ? 0 : v > 0 ? -2 : 2);
                const y1 = y(fim);
                const ponta = v > 0 ? k === ultimoPos : k === ultimoNeg;
                const d = ponta ? barra(cx - larg / 2, y0, y1, larg, v > 0) : `M${cx - larg / 2},${Math.min(y0, y1)}h${larg}v${Math.max(0, Math.abs(y1 - y0))}h${-larg}Z`;
                marcas.push(<path key={s.key} d={d} style={{ fill: s.cor, opacity: op }} />);
              });
            } else {
              const n = series.length;
              const lw = larg / n;
              series.forEach((s, k) => {
                const v = s.valores[i];
                if (v == null || v === 0) return;
                const x = cx - larg / 2 + k * lw + (n > 1 ? 1 : 0);
                const cor = divergente ? (v >= 0 ? "var(--cf-pos)" : "var(--cf-neg)") : s.cor;
                marcas.push(
                  <path
                    key={s.key}
                    d={barra(x, y(0), y(v), lw - (n > 1 ? 2 : 0), v > 0)}
                    style={{ fill: cor, opacity: op }}
                  />
                );
              });
            }
            return (
              <g key={mes}>
                {marcas}
                <text x={cx} y={H - 10} textAnchor="middle" className={styles.axisText}>
                  {mesCurto(mes)}
                </text>
                <rect
                  x={M.l + banda * i}
                  y={M.t}
                  width={banda}
                  height={plotH}
                  className={`${styles.hoverBand} ${tip?.idx === i ? styles.hoverBandAtiva : ""}`}
                  onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, idx: i })}
                />
              </g>
            );
          })}
        </svg>
      </div>
      {(series.length > 1 || temProj) && (
        <div className={styles.legend}>
          {series.length > 1 &&
            series.map((s) => (
              <span key={s.key} className={styles.legendItem}>
                <i className={styles.swatch} style={{ background: s.cor }} />
                {s.label}
              </span>
            ))}
          {divergente && (
            <>
              <span className={styles.legendItem}>
                <i className={styles.swatch} style={{ background: "var(--cf-pos)" }} /> Positivo
              </span>
              <span className={styles.legendItem}>
                <i className={styles.swatch} style={{ background: "var(--cf-neg)" }} /> Negativo
              </span>
            </>
          )}
          {temProj && (
            <span className={styles.legendItem}>
              <i className={`${styles.swatch} ${styles.swatchProj}`} /> Mês ainda não fechado (valor projetado na planilha)
            </span>
          )}
        </div>
      )}
      {tip && (
        <div className={styles.tip} style={{ left: tip.x, top: tip.y }}>
          <div className={styles.tipTitle}>
            {mesCurto(meses[tip.idx])}
            {projetado(meses[tip.idx]) ? " · projeção" : ""}
          </div>
          {series.map((s) => (
            <div key={s.key} className={styles.tipRow}>
              <span>
                {series.length > 1 && <i className={styles.swatch} style={{ background: s.cor }} />}
                {s.label}
              </span>
              <b>{brl(s.valores[tip.idx] ?? 0)}</b>
            </div>
          ))}
          {empilhado && series.length > 1 && (
            <>
              <div className={styles.tipSep} />
              <div className={styles.tipRow}>
                <span>{totalLabel}</span>
                <b>{brl(series.reduce((t, s) => t + (s.valores[tip.idx] ?? 0), 0))}</b>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

/** Linha diária (saldo de caixa), com marcação de "hoje" e crosshair. */
export function GraficoLinhaDiaria({
  pontos,
  hoje,
  label,
  altura = 260,
}: {
  pontos: { data: string; valor: number }[];
  hoje: string;
  label: string;
  altura?: number;
}) {
  const [tip, setTip] = useState<{ x: number; y: number; idx: number } | null>(null);
  const [wrapRef, W] = useLargura();
  const H = altura;
  const plotW = W - M.l - M.r;
  const plotH = H - M.t - M.b;

  const calc = useMemo(() => {
    if (!pontos.length) return null;
    const vals = pontos.map((p) => p.valor);
    const ticks = ticksBonitos(Math.min(0, ...vals), Math.max(0, ...vals));
    const tMin = ticks[0];
    const tMax = ticks[ticks.length - 1];
    const y = (v: number) => M.t + plotH - ((v - tMin) / (tMax - tMin || 1)) * plotH;
    const x = (i: number) => M.l + (pontos.length === 1 ? plotW / 2 : (i / (pontos.length - 1)) * plotW);
    const d = pontos.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.valor).toFixed(1)}`).join(" ");
    // Rótulos do eixo X: primeiro dia de cada mês, espaçados.
    const marcas: number[] = [];
    pontos.forEach((p, i) => {
      if (p.data.endsWith("-01") || i === 0) marcas.push(i);
    });
    const passo = Math.max(1, Math.ceil(marcas.length / 12));
    return { ticks, y, x, d, marcas: marcas.filter((_, k) => k % passo === 0) };
  }, [pontos, plotH, plotW]);

  if (!calc) return <div className={styles.aviso}>Sem dados no período.</div>;
  const idxHoje = pontos.findIndex((p) => p.data >= hoje);

  return (
    <>
      <div ref={wrapRef} className={styles.chartWrap} onMouseLeave={() => setTip(null)}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width={W}
          height={H}
          role="img"
          aria-label={label}
          onMouseMove={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const px = ((e.clientX - r.left) / r.width) * W;
            const i = Math.round(((px - M.l) / plotW) * (pontos.length - 1));
            if (i >= 0 && i < pontos.length) setTip({ x: e.clientX, y: e.clientY, idx: i });
          }}
        >
          {calc.ticks.map((t) => (
            <g key={t}>
              <line x1={M.l} x2={W - M.r} y1={calc.y(t)} y2={calc.y(t)} className={t === 0 ? styles.zeroLine : styles.gridLine} />
              <text x={M.l - 8} y={calc.y(t) + 4} textAnchor="end" className={styles.axisText}>
                {compacto(t)}
              </text>
            </g>
          ))}
          {calc.marcas.map((i) => (
            <text key={i} x={calc.x(i)} y={H - 10} textAnchor="middle" className={styles.axisText}>
              {mesCurto(pontos[i].data)}
            </text>
          ))}
          {idxHoje > 0 && (
            <g>
              <line
                x1={calc.x(idxHoje)}
                x2={calc.x(idxHoje)}
                y1={M.t}
                y2={M.t + plotH}
                style={{ stroke: "var(--t-500)", strokeDasharray: "4 4" }}
              />
              <text x={calc.x(idxHoje) + 6} y={M.t + 12} className={styles.axisText}>
                hoje
              </text>
            </g>
          )}
          <path d={calc.d} style={{ fill: "none", stroke: "var(--cf-s1)", strokeWidth: 2 }} />
          {tip && (
            <g>
              <line
                x1={calc.x(tip.idx)}
                x2={calc.x(tip.idx)}
                y1={M.t}
                y2={M.t + plotH}
                style={{ stroke: "var(--t-400)" }}
              />
              <circle
                cx={calc.x(tip.idx)}
                cy={calc.y(pontos[tip.idx].valor)}
                r={5}
                style={{ fill: "var(--cf-s1)", stroke: "var(--s-white)", strokeWidth: 2 }}
              />
            </g>
          )}
        </svg>
      </div>
      {tip && (
        <div className={styles.tip} style={{ left: tip.x, top: tip.y }}>
          <div className={styles.tipTitle}>{dataBr(pontos[tip.idx].data)}</div>
          <div className={styles.tipRow}>
            <span>{label}</span>
            <b>{brl(pontos[tip.idx].valor)}</b>
          </div>
        </div>
      )}
    </>
  );
}

/** Barras horizontais de magnitude (composição), série única. */
export function BarrasHorizontais({
  itens,
  onClick,
}: {
  itens: { chave: string; rotulo: string; valor: number; nota?: string }[];
  onClick?: (chave: string) => void;
}) {
  const max = Math.max(1, ...itens.map((i) => Math.abs(i.valor)));
  return (
    <div className={styles.barras}>
      {itens.map((i) => (
        <div key={i.chave} className={styles.barraLinha}>
          {onClick ? (
            <button type="button" onClick={() => onClick(i.chave)} title="Ver lançamentos">
              {i.rotulo}
            </button>
          ) : (
            <span>{i.rotulo}</span>
          )}
          <div className={styles.barraTrilho}>
            <i style={{ width: `${(Math.abs(i.valor) / max) * 100}%` }} />
          </div>
          <span className={styles.barraValor}>
            {compacto(i.valor)}
            {i.nota ? <span className={styles.muted}> · {i.nota}</span> : null}
          </span>
        </div>
      ))}
    </div>
  );
}
